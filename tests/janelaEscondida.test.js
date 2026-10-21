'use strict';

/** A janela escondida com um Electron falso: opções de segurança, bloqueios de navegação, frames do caixa e limpeza das partições. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { criarJanela, limparParticoes, USER_AGENT } = require('../src/main/janelaEscondida');

function sessaoFalsa() {
  const s = { pedido: null, verificacao: null, ouvintes: {}, registos: 0 };
  s.setPermissionRequestHandler = (f) => { s.pedido = f; s.registos++; };
  s.setPermissionCheckHandler = (f) => { s.verificacao = f; };
  s.on = (ev, f) => { s.ouvintes[ev] = [...(s.ouvintes[ev] || []), f]; };
  return s;
}

function electronFalso({ frames = [], loadURL, session = sessaoFalsa() } = {}) {
  const estado = { opcoes: null, ua: null, ouvintes: {}, abrir: null, destruida: false, urls: [], executado: [], mudo: false, session };
  class BrowserWindow {
    constructor(opcoes) {
      estado.opcoes = opcoes;
      this.webContents = {
        session,
        setAudioMuted: (m) => { estado.mudo = m; },
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

test('a sessão da conta recusa todas as permissões e cancela downloads; a janela não tem som', () => {
  const { BrowserWindow, estado } = electronFalso();
  criarJanela(7, { BrowserWindow });
  const s = estado.session;
  assert.equal(estado.mudo, true);
  for (const p of ['media', 'notifications', 'geolocation', 'clipboard-read']) {
    let resposta = null;
    s.pedido(null, p, (r) => { resposta = r; });
    assert.equal(resposta, false, p);
    assert.equal(s.verificacao(null, p), false, p);
  }
  let impedido = false;
  let cancelado = false;
  s.ouvintes['will-download'][0]({ preventDefault: () => { impedido = true; } }, { cancel: () => { cancelado = true; } });
  assert.ok(impedido && cancelado);
});

test('a mesma sessão (mesma conta) só é preparada uma vez', () => {
  const session = sessaoFalsa();
  const a = electronFalso({ session });
  criarJanela(7, { BrowserWindow: a.BrowserWindow });
  criarJanela(7, { BrowserWindow: a.BrowserWindow });
  assert.equal(session.registos, 1);
  assert.equal(session.ouvintes['will-download'].length, 1);
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

// Filha como o Electron a entrega no did-create-window: BrowserWindow com webContents próprio.
function filhaFalsa({ resposta = null, frames = [] } = {}) {
  const f = { ouvintes: {}, ouvintesJanela: {}, abrir: null, mudo: false, ua: null, destruida: false, executado: [] };
  f.janela = {
    webContents: {
      setAudioMuted: (m) => { f.mudo = m; },
      setUserAgent: (ua) => { f.ua = ua; },
      on: (ev, fn) => { f.ouvintes[ev] = fn; },
      setWindowOpenHandler: (fn) => { f.abrir = fn; },
      isDestroyed: () => f.destruida,
      mainFrame: {
        executeJavaScript: async (c) => { f.executado.push(c); if (resposta === 'erro') throw new Error('x'); return resposta; },
        framesInSubtree: frames
      }
    },
    on: (ev, fn) => { f.ouvintesJanela[ev] = fn; },
    once: (ev, fn) => { f.ouvintesJanela[ev] = fn; },
    isDestroyed: () => f.destruida,
    destroy: () => { f.destruida = true; f.ouvintesJanela.closed?.(); }
  };
  return f;
}

const HOSTS = { hostsExtra: ['cdn.safecharge.com'] };

test('janela nova: só https e só os hosts exatos de hostsExtra, com as mesmas webPreferences e sem preload', () => {
  const { BrowserWindow, estado } = electronFalso();
  criarJanela(7, { BrowserWindow }, HOSTS);
  for (const url of ['https://evil.example/', 'http://cdn.safecharge.com/', 'https://cdn.safecharge.com.evil.example/',
    'https://evilcdn.safecharge.com/', 'javascript:alert(1)', 'nada']) {
    assert.deepEqual(estado.abrir({ url }), { action: 'deny' }, url);
  }
  const r = estado.abrir({ url: 'https://cdn.safecharge.com/x/sibs.html' });
  assert.deepEqual(r, {
    action: 'allow',
    overrideBrowserWindowOptions: {
      show: false,
      webPreferences: { partition: 'persist:op-7', sandbox: true, contextIsolation: true, nodeIntegration: false }
    }
  });
  assert.ok(!('preload' in r.overrideBrowserWindowOptions.webPreferences));
});

test('sem hostsExtra, todas as janelas novas são negadas (fase 3)', () => {
  const { BrowserWindow, estado } = electronFalso();
  criarJanela(7, { BrowserWindow });
  assert.deepEqual(estado.abrir({ url: 'https://cdn.safecharge.com/x/sibs.html' }), { action: 'deny' });
});

test('a filha fica sem som, com o user agent do Chrome, só https e sem netas', () => {
  const { BrowserWindow, estado } = electronFalso();
  criarJanela(7, { BrowserWindow }, HOSTS);
  const f = filhaFalsa();
  estado.ouvintes['did-create-window'](f.janela, { url: 'https://cdn.safecharge.com/x/sibs.html' });
  assert.equal(f.mudo, true);
  assert.equal(f.ua, USER_AGENT);
  for (const evento of ['will-navigate', 'will-redirect']) {
    let impedido = false;
    f.ouvintes[evento]({ preventDefault: () => { impedido = true; } }, 'http://cdn.safecharge.com/');
    assert.ok(impedido, evento);
    impedido = false;
    f.ouvintes[evento]({ preventDefault: () => { impedido = true; } }, 'https://cdn.safecharge.com/y');
    assert.ok(!impedido, evento);
  }
  assert.deepEqual(f.abrir({ url: 'https://cdn.safecharge.com/z' }), { action: 'deny' });
});

test('naJanelasNovas devolve a primeira resposta das filhas e ignora as que rebentam', async () => {
  const { BrowserWindow, estado } = electronFalso();
  const { driver } = criarJanela(7, { BrowserWindow }, HOSTS);
  assert.equal(await driver.naJanelasNovas('lerReferenciaMB'), null);
  const ma = filhaFalsa({ resposta: 'erro' });
  const vazia = filhaFalsa({ resposta: null, frames: [{ url: 'https://cdn.safecharge.com/f', executeJavaScript: async () => ({ referencia: '123' }) }] });
  estado.ouvintes['did-create-window'](ma.janela, {});
  estado.ouvintes['did-create-window'](vazia.janela, {});
  assert.deepEqual(await driver.naJanelasNovas('lerReferenciaMB'), { referencia: '123' });
  assert.match(ma.executado[0], /\.\.\.\["lerReferenciaMB"\]/);
});

test('uma filha fechada sai da lista; fechar() destrói as filhas e a mãe e pode repetir-se', async () => {
  const { BrowserWindow, estado } = electronFalso();
  const j = criarJanela(7, { BrowserWindow }, HOSTS);
  const fechada = filhaFalsa({ resposta: 'velha' });
  const viva = filhaFalsa({ resposta: null });
  estado.ouvintes['did-create-window'](fechada.janela, {});
  estado.ouvintes['did-create-window'](viva.janela, {});
  fechada.ouvintesJanela.closed();
  assert.equal(await j.driver.naJanelasNovas('lerReferenciaMB'), null);
  assert.equal(fechada.executado.length, 0);
  j.fechar();
  j.fechar();
  assert.equal(viva.destruida, true);
  assert.equal(estado.destruida, true);
});

test('limparParticoes apaga só as pastas op-*', async () => {
  const limpas = [];
  const session = { fromPartition: (p) => ({ clearStorageData: async () => { limpas.push(p); } }) };
  const n = await limparParticoes({ listarParticoes: async () => ['op-3', 'op-9', 'outra', 'Cache', 'op'], session });
  assert.equal(n, 2);
  assert.deepEqual(limpas, ['persist:op-3', 'persist:op-9']);
});
