'use strict';

// Cartão de atualização: o download é automático, por isso «Descarregar» só aparece para tentar outra vez e «Reiniciar» só com o instalador pronto.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const SCRIPT = fs.readFileSync(path.join(__dirname, '..', 'public', 'shell-atualizacoes.js'), 'utf8');

function abrir() {
  const inicio = HTML.indexOf('<div id="update-badge"');
  const fim = HTML.indexOf('<script src="./shell-atualizacoes.js">');
  const dom = new JSDOM(`<!doctype html><body>${HTML.slice(inicio, fim)}</body>`, { runScripts: 'outside-only' });
  const w = dom.window;
  const ouvintes = {};
  const pedidos = [];
  w.electronAPI = {
    getDebugMode: async () => false,
    getVersion: async () => '2.0.0',
    onUpdateAvailable: (cb) => { ouvintes.disponivel = cb; },
    onDownloadProgress: (cb) => { ouvintes.progresso = cb; },
    onUpdateDownloaded: (cb) => { ouvintes.pronta = cb; },
    onUpdateError: (cb) => { ouvintes.erro = cb; },
    downloadUpdate: () => pedidos.push('descarregar'),
    installAndUpdate: () => pedidos.push('instalar')
  };
  w.eval(SCRIPT);
  const $ = (id) => w.document.getElementById(id);
  const visivel = (id) => $(id).style.display !== 'none';
  return { w, $, visivel, ouvintes, pedidos };
}

test('versão nova: mostra o download a decorrer, sem «Descarregar» nem «Reiniciar»', () => {
  const c = abrir();
  c.ouvintes.disponivel({ version: '2.19.0' });
  c.ouvintes.progresso({ percent: 40 });
  assert.equal(c.visivel('download-update'), false);
  assert.equal(c.visivel('restart-button'), false);
  assert.match(c.$('update-title').textContent, /2\.19\.0/);
  assert.equal(c.$('progress-text').textContent, '40%');
});

test('pronta: só «Reiniciar», e diz que se instala sozinha', () => {
  const c = abrir();
  c.ouvintes.disponivel({ version: '2.19.0' });
  c.ouvintes.pronta({ version: '2.19.0' });
  assert.equal(c.visivel('download-update'), false);
  assert.equal(c.visivel('restart-button'), true);
  assert.match(c.$('progress-info-text').textContent, /sozinha/);
});

test('erro: «Tentar outra vez» volta a pedir, e «Reiniciar» sai', () => {
  const c = abrir();
  c.ouvintes.pronta({ version: '2.19.0' });
  c.ouvintes.erro({ message: 'Erro ao fazer download: o ficheiro descarregado não corresponde ao publicado' });
  assert.equal(c.visivel('download-update'), true);
  assert.equal(c.visivel('restart-button'), false);
  c.$('download-update').click();
  assert.deepEqual(c.pedidos, ['descarregar']);
  assert.equal(c.visivel('download-update'), false);
});
