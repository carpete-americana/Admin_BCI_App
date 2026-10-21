'use strict';

/** A janela do consentimento com um Electron falso, e o preload dela contra jsdom. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { pedirConsentimento, FICHEIRO, PRELOAD, CANAL } = require('../src/main/consentimentoJanela');

const PEDIDO = { modo: 'pedido', titulo: 'Título', texto: 'Linha 1\n• item\n\nLinha 2', botoes: ['Aceito', 'Cancelar'] };

function ambiente() {
  const estado = { opcoes: null, carregado: null, ouvintes: {}, fechou: false, mostrou: false, destruida: false };
  const wc = {
    on: (ev, f) => { estado.ouvintes[ev] = f; },
    setWindowOpenHandler: (f) => { estado.abrir = f; }
  };
  class BrowserWindow {
    constructor(opcoes) {
      estado.opcoes = opcoes;
      estado.janela = this;
      this.webContents = wc;
      this.eventos = {};
    }
    once(ev, f) { this.eventos[ev] = f; }
    on(ev, f) { this.eventos[ev] = f; }
    loadFile(f, opcoes) { estado.carregado = { f, opcoes }; }
    show() { estado.mostrou = true; }
    focus() { estado.focou = true; }
    close() { estado.fechou = true; this.eventos.closed?.(); }
    isDestroyed() { return estado.destruida; }
  }
  const canais = new Map();
  const ipcMain = {
    on: (c, f) => canais.set(c, f),
    removeListener: (c, f) => { if (canais.get(c) === f) canais.delete(c); }
  };
  const pai = { getBounds: () => ({ x: 100, y: 50, width: 1000, height: 800 }) };
  const deps = { BrowserWindow, ipcMain, janelaPai: () => pai };
  return { estado, canais, deps, wc };
}

test('abre a janela modal, escondida até estar pronta, centrada sobre a principal', async () => {
  const { estado, deps } = ambiente();
  const p = pedirConsentimento(PEDIDO, deps);
  const o = estado.opcoes;
  assert.equal(o.modal, true);
  assert.equal(o.show, false);
  assert.ok(o.parent);
  assert.equal(o.x, 100 + (1000 - o.width) / 2);
  assert.equal(estado.mostrou, false);
  estado.janela.eventos['ready-to-show']();
  assert.equal(estado.mostrou, true);
  estado.janela.close();
  assert.equal(await p, false);
});

test('webPreferences: só o preload do consentimento, sem node, isolada e em sandbox', () => {
  const { estado, deps } = ambiente();
  pedirConsentimento(PEDIDO, deps);
  const w = estado.opcoes.webPreferences;
  assert.equal(w.preload, PRELOAD);
  assert.equal(path.basename(PRELOAD), 'consentimento.js');
  assert.equal(path.basename(path.dirname(PRELOAD)), 'preload');
  assert.equal(w.nodeIntegration, false);
  assert.equal(w.contextIsolation, true);
  assert.equal(w.sandbox, true);
  estado.janela.close();
});

test('loadFile aponta para um ficheiro dentro de public/ e nunca para um URL', () => {
  const { estado, deps } = ambiente();
  pedirConsentimento(PEDIDO, deps);
  const { f, opcoes } = estado.carregado;
  assert.ok(!/^[a-z]+:\/\//i.test(f), f);
  assert.equal(f, FICHEIRO);
  assert.equal(path.basename(path.dirname(f)), 'public');
  assert.ok(fs.existsSync(f));
  assert.equal(opcoes.query.titulo, 'Título');
  estado.janela.close();
});

test('aceitar resolve true, recusar resolve false, e a janela fecha', async () => {
  for (const [resposta, esperado] of [[true, true], [false, false]]) {
    const { estado, canais, deps, wc } = ambiente();
    const p = pedirConsentimento(PEDIDO, deps);
    canais.get(CANAL)({ sender: wc }, resposta);
    assert.equal(await p, esperado);
    assert.equal(estado.fechou, true);
    assert.equal(canais.size, 0, 'o ouvinte sai');
  }
});

test('só o booleano true aceita: texto ou outros valores contam como recusa', async () => {
  for (const valor of ['true', 1, {}, undefined]) {
    const { canais, deps, wc } = ambiente();
    const p = pedirConsentimento(PEDIDO, deps);
    canais.get(CANAL)({ sender: wc }, valor);
    assert.equal(await p, false, String(valor));
  }
});

test('uma resposta vinda de outro webContents é ignorada', async () => {
  const { estado, canais, deps, wc } = ambiente();
  const p = pedirConsentimento(PEDIDO, deps);
  let resolvida = false;
  p.then(() => { resolvida = true; });
  canais.get(CANAL)({ sender: { outro: true } }, true);
  await new Promise(r => setImmediate(r));
  assert.equal(resolvida, false);
  assert.equal(estado.fechou, false);
  canais.get(CANAL)({ sender: wc }, true);
  assert.equal(await p, true);
});

test('fechar a janela resolve false e liberta o ouvinte', async () => {
  const { estado, canais, deps } = ambiente();
  const p = pedirConsentimento(PEDIDO, deps);
  estado.janela.eventos.closed();
  assert.equal(await p, false);
  assert.equal(canais.size, 0);
});

test('um segundo pedido com a janela aberta reaproveita-a em vez de abrir outra', async () => {
  const { estado, canais, deps, wc } = ambiente();
  const a = pedirConsentimento(PEDIDO, deps);
  const aberturas = estado.janela;
  const b = pedirConsentimento(PEDIDO, deps);
  assert.equal(estado.janela, aberturas);
  canais.get(CANAL)({ sender: wc }, true);
  assert.equal(await a, true);
  assert.equal(await b, true);
});

test('a janela não navega nem abre outras', () => {
  const { estado, deps } = ambiente();
  pedirConsentimento(PEDIDO, deps);
  let impedido = false;
  estado.ouvintes['will-navigate']({ preventDefault: () => { impedido = true; } }, 'https://exemplo.pt/');
  assert.equal(impedido, true);
  assert.deepEqual(estado.abrir({ url: 'https://exemplo.pt/' }), { action: 'deny' });
  estado.janela.close();
});

// ---------- o preload, contra jsdom ----------

function correrPreload(query) {
  const html = fs.readFileSync(FICHEIRO, 'utf8');
  const dom = new JSDOM(html, { url: `file:///C:/app/public/consentimento.html?${query}`, runScripts: 'outside-only' });
  const enviados = [];
  const electron = { ipcRenderer: { send: (...a) => enviados.push(a) } };
  const codigo = fs.readFileSync(PRELOAD, 'utf8');
  dom.window.eval(`(function (require) {\n${codigo}\n})`)((m) => { assert.equal(m, 'electron'); return electron; });
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  dom.window.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  return { doc: dom.window.document, enviados };
}

test('o preload monta o texto por textContent: marcas HTML não viram elementos', () => {
  const q = new URLSearchParams({ titulo: '<b>T</b>', texto: 'um <img src=x onerror=1>\n\n• dois', aceitar: 'Aceito', recusar: 'Cancelar' });
  const { doc } = correrPreload(q.toString());
  assert.equal(doc.getElementById('titulo').textContent, '<b>T</b>');
  assert.equal(doc.querySelectorAll('#texto p').length, 2);
  assert.equal(doc.querySelectorAll('img, b').length, 0);
  assert.equal(doc.getElementById('aceitar').textContent, 'Aceito');
  assert.equal(doc.getElementById('recusar').textContent, 'Cancelar');
});

test('os botões respondem true e false pelo canal certo', () => {
  const { doc, enviados } = correrPreload(new URLSearchParams({ titulo: 'T', texto: 'x', aceitar: 'A', recusar: 'R' }).toString());
  doc.getElementById('aceitar').click();
  doc.getElementById('recusar').click();
  assert.deepEqual(enviados, [[CANAL, true], [CANAL, false]]);
});

test('o HTML não tem scripts nem ligações externas e tem CSP fechada', () => {
  const html = fs.readFileSync(FICHEIRO, 'utf8');
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /https?:\/\//i);
  assert.match(html, /Content-Security-Policy[^>]*default-src 'none'/);
});

// Uma janela por instância, cada uma com o seu webContents: é o que distingue quem responde.
function ambienteVarias() {
  const janelas = [];
  class BrowserWindow {
    constructor(opcoes) {
      this.opcoes = opcoes;
      this.eventos = {};
      this.destruida = false;
      this.webContents = { on: (ev, f) => { this.eventos[`wc:${ev}`] = f; }, setWindowOpenHandler() {} };
      janelas.push(this);
    }
    once(ev, f) { this.eventos[ev] = f; }
    on(ev, f) { this.eventos[ev] = f; }
    loadFile(f, opcoes) { this.carregado = opcoes; }
    show() {}
    focus() {}
    close() { if (this.destruida) return; this.destruida = true; this.eventos.closed?.(); }
    isDestroyed() { return this.destruida; }
  }
  const canais = new Map();
  const ipcMain = { on: (c, f) => canais.set(c, f), removeListener: (c, f) => { if (canais.get(c) === f) canais.delete(c); } };
  const responder = (janela, aceite) => canais.get(CANAL)?.({ sender: janela.webContents }, aceite);
  return { janelas, responder, deps: { BrowserWindow, ipcMain } };
}

test('com o aviso aberto, o pedido completo abre por cima e só a resposta dele conta', async () => {
  const { janelas, responder, deps } = ambienteVarias();
  const aviso = pedirConsentimento({ ...PEDIDO, modo: 'aviso' }, deps);
  const pedido = pedirConsentimento(PEDIDO, deps);
  assert.equal(janelas.length, 2, 'o pedido não reaproveita a janela do aviso');
  assert.equal(janelas[0].destruida, true);
  assert.equal(await aviso, false, 'o aviso fechado conta como «agora não»');
  assert.equal(janelas[1].carregado.query.modo, 'pedido');
  responder(janelas[0], true);
  responder(janelas[1], false);
  assert.equal(await pedido, false, 'o «sim» da janela do aviso não aceita o pedido');
});

test('o mesmo modo duas vezes reaproveita a janela aberta', async () => {
  const { janelas, responder, deps } = ambienteVarias();
  const a = pedirConsentimento(PEDIDO, deps);
  const b = pedirConsentimento(PEDIDO, deps);
  assert.equal(janelas.length, 1);
  responder(janelas[0], true);
  assert.equal(await a, true);
  assert.equal(await b, true);
});

test('uma janela que não carrega fecha e responde «não», em vez de ficar pendurada', async () => {
  const { janelas, deps } = ambienteVarias();
  const p = pedirConsentimento(PEDIDO, deps);
  janelas[0].eventos['wc:did-fail-load']();
  assert.equal(await p, false);
  assert.equal(janelas[0].destruida, true);
  pedirConsentimento(PEDIDO, deps);
  assert.equal(janelas.length, 2, 'depois disso volta a poder abrir');
});
