'use strict';

/** A janela escondida com um Electron falso: opções de segurança, bloqueios de navegação, frames do caixa e limpeza das partições. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { criarJanela, limparParticoes, USER_AGENT } = require('../src/main/janelaEscondida');

function electronFalso({ frames = [], loadURL } = {}) {
  const estado = { opcoes: null, ua: null, ouvintes: {}, abrir: null, destruida: false, urls: [], executado: [] };
  class BrowserWindow {
    constructor(opcoes) {
      estado.opcoes = opcoes;
      this.webContents = {
        setUserAgent: (ua) => { estado.ua = ua; },
        on: (ev, f) => { estado.ouvintes[ev] = f; },
        setWindowOpenHandler: (f) => { estado.abrir = f; },
        loadURL: loadURL || (async (u) => { estado.urls.push(u); }),
        getURL: () => 'https://www.placard.pt/levantar',
        mainFrame: {
          executeJavaScript: async (c) => { estado.executado.push(c); return 'principal'; },
          framesInSubtree: frames
        }
      };
    }
    isDestroyed() { return estado.destruida; }
    destroy() { estado.destruida = true; }
  }
  return { BrowserWindow, estado };
}

test('abre escondida, sem preload e com o browser só desta conta', () => {
  const { BrowserWindow, estado } = electronFalso();
  criarJanela(7, { BrowserWindow });
  const w = estado.opcoes.webPreferences;
  assert.equal(estado.opcoes.show, false);
  assert.equal(w.partition, 'persist:op-7');
  assert.equal(w.nodeIntegration, false);
  assert.equal(w.contextIsolation, true);
  assert.equal(w.sandbox, true);
  assert.ok(!('preload' in w));
});

test('o user agent é o do Chrome, sem Electron', () => {
  const { BrowserWindow, estado } = electronFalso();
  criarJanela(7, { BrowserWindow });
  assert.equal(estado.ua, USER_AGENT);
  assert.doesNotMatch(USER_AGENT, /Electron/);
  assert.match(USER_AGENT, /^Mozilla\/5\.0 \(Windows NT 10\.0; Win64; x64\) AppleWebKit\/537\.36 \(KHTML, like Gecko\) Chrome\/\S+ Safari\/537\.36$/);
});

test('navegações para fora de https são impedidas e janelas novas negadas', () => {
  const { BrowserWindow, estado } = electronFalso();
  criarJanela(7, { BrowserWindow });
  for (const evento of ['will-navigate', 'will-redirect']) {
    for (const url of ['http://exemplo.pt/', 'file:///C:/x', 'javascript:alert(1)']) {
      let impedido = false;
      estado.ouvintes[evento]({ preventDefault: () => { impedido = true; } }, url);
      assert.ok(impedido, `${evento} ${url}`);
    }
    let impedido = false;
    estado.ouvintes[evento]({ preventDefault: () => { impedido = true; } }, 'https://www.placard.pt/');
    assert.ok(!impedido);
  }
  assert.deepEqual(estado.abrir({ url: 'https://x.pt' }), { action: 'deny' });
});

test('navegar só aceita https e um ERR_ABORTED não é falha', async () => {
  const abortada = electronFalso({ loadURL: async () => { throw Object.assign(new Error('abortado'), { code: 'ERR_ABORTED' }); } });
  const { driver } = criarJanela(7, { BrowserWindow: abortada.BrowserWindow });
  await driver.navegar('https://www.placard.pt/');
  await assert.rejects(driver.navegar('http://www.placard.pt/'));
  const semRede = electronFalso({ loadURL: async () => { throw Object.assign(new Error('sem rede'), { code: 'ERR_INTERNET_DISCONNECTED' }); } });
  await assert.rejects(criarJanela(7, { BrowserWindow: semRede.BrowserWindow }).driver.navegar('https://www.placard.pt/'));
});

test('naPagina leva a função e os argumentos como texto, com o pagina.js', async () => {
  const { BrowserWindow, estado } = electronFalso();
  const { driver } = criarJanela(7, { BrowserWindow });
  assert.equal(await driver.naPagina('lerSaldo', '.saldo'), 'principal');
  assert.match(estado.executado[0], /__bciPagina/);
  assert.match(estado.executado[0], /\.\.\.\["lerSaldo",".saldo"\]/);
});

test('naCaixa corre só nos frames do host do caixa e ignora os que rebentam', async () => {
  const chamados = [];
  const frame = (url, resposta) => ({
    url,
    executeJavaScript: async () => { chamados.push(url); if (resposta === 'erro') throw new Error('x'); return resposta; }
  });
  const frames = [
    frame('https://www.placard.pt/', 'principal'),
    frame('https://anuncios.exemplo.pt/', 'anuncio'),
    frame('https://secure.safecharge.com/a', 'erro'),
    frame('https://secure.safecharge.com/b', { ok: true })
  ];
  const { BrowserWindow } = electronFalso({ frames });
  const { driver } = criarJanela(7, { BrowserWindow });
  const r = await driver.naCaixa('prepararLevantamento', { caixaHost: 'secure.safecharge.com' }, 20);
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(chamados, ['https://secure.safecharge.com/a', 'https://secure.safecharge.com/b']);
});

test('naCaixa: se nenhum frame respondeu e algum rebentou, lança; sem frames do caixa devolve null', async () => {
  const frame = (url, resposta) => ({
    url, executeJavaScript: async () => { if (resposta === 'erro') throw new Error('x'); return resposta; }
  });
  const host = { caixaHost: 'secure.safecharge.com' };
  const rebenta = criarJanela(7, electronFalso({ frames: [frame('https://secure.safecharge.com/a', 'erro'), frame('https://secure.safecharge.com/b', null)] })).driver;
  await assert.rejects(rebenta.naCaixa('confirmarLevantamento', host));
  const nenhum = criarJanela(7, electronFalso({ frames: [frame('https://www.placard.pt/', 'erro')] })).driver;
  assert.equal(await nenhum.naCaixa('confirmarLevantamento', host), null);
});

test('fechar destrói a janela e pode repetir-se', () => {
  const { BrowserWindow, estado } = electronFalso();
  const j = criarJanela(7, { BrowserWindow });
  j.fechar();
  j.fechar();
  assert.equal(estado.destruida, true);
});

test('limparParticoes apaga só as pastas op-*', async () => {
  const limpas = [];
  const session = { fromPartition: (p) => ({ clearStorageData: async () => { limpas.push(p); } }) };
  const n = await limparParticoes({ listarParticoes: async () => ['op-3', 'op-9', 'outra', 'Cache', 'op'], session });
  assert.equal(n, 2);
  assert.deepEqual(limpas, ['persist:op-3', 'persist:op-9']);
});
