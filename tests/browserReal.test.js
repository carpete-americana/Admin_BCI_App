'use strict';

/** O browser real sem Chrome: escolha do executável, argumentos, perfil, driver sobre um puppeteer falso e limpeza dos perfis. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { encontrarBrowser, abrirBrowserReal, prepararPerfil, limparPerfis, argsDe, posicaoFora, ARGS, hostPermitido } = require('../src/main/browserReal');

const ENV = { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' };
const so = (...exes) => (e) => exes.includes(e);

test('prefere o Chrome (Program Files, x86, utilizador) e cai no Edge', () => {
  const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  assert.deepEqual(encontrarBrowser({ env: ENV, existe: so(chrome, edge) }), { nome: 'Chrome', exe: chrome });
  const doUtilizador = 'C:\\Users\\x\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
  assert.equal(encontrarBrowser({ env: ENV, existe: so(doUtilizador, edge) }).exe, doUtilizador);
  assert.deepEqual(encontrarBrowser({ env: ENV, existe: so(edge) }), { nome: 'Edge', exe: edge });
});

test('sem Chrome nem Edge, ou fora do Windows, não há browser', () => {
  assert.equal(encontrarBrowser({ env: ENV, existe: () => false }), null);
  assert.equal(encontrarBrowser({ env: ENV, existe: () => true, plataforma: 'darwin' }), null);
  assert.equal(encontrarBrowser({ env: {}, existe: () => false }), null);
});

test('os argumentos levam o perfil e não o modo de automação', () => {
  const args = argsDe('C:\\p\\op-casa-placard');
  assert.ok(args.includes('--user-data-dir=C:\\p\\op-casa-placard'));
  assert.ok(args.includes('--disable-blink-features=AutomationControlled'));
  assert.ok(!ARGS.some(a => /enable-automation|remote-debugging/.test(a)));
  assert.ok(args.includes('--window-position=-2400,-2400'));
});

test('a janela fica fora de todos os monitores, também com um à esquerda ou acima do principal', () => {
  assert.deepEqual(posicaoFora([{ bounds: { x: 0, y: 0 }, scaleFactor: 1 }]), { x: -2400, y: -2400 });
  // Monitor à esquerda com escala 150%: conta o maior recuo, em pixels.
  assert.deepEqual(posicaoFora([{ bounds: { x: 0, y: 0 }, scaleFactor: 1 }, { bounds: { x: -1920, y: -300 }, scaleFactor: 1.5 }]), { x: -5280, y: -2850 });
  for (const nada of [undefined, [], [{ bounds: {} }]]) assert.deepEqual(posicaoFora(nada), { x: -2400, y: -2400 });
  assert.ok(argsDe('p', { x: -5280, y: -2850 }).includes('--window-position=-5280,-2850'));
});

test('com a preferência de mostrar a janela, o browser abre sem posição fora do ecrã', async () => {
  assert.ok(!argsDe('p', null).some(a => a.startsWith('--window-position')));
  for (const [visivel, esperado] of [[async () => true, false], [async () => false, true], [undefined, true]]) {
    const f = puppeteerFalso();
    const pastaPerfis = fs.mkdtempSync(path.join(os.tmpdir(), 'bci-perfis-'));
    const r = await abrirBrowserReal('placard', { puppeteer: f.puppeteer, browser: { exe: 'x' }, pastaPerfis, visivel, esperar: async () => {} });
    try { assert.equal(f.estado.lancado.args.some(a => a.startsWith('--window-position=')), esperado); }
    finally { await r.fechar(); fs.rmSync(pastaPerfis, { recursive: true, force: true }); }
  }
});

test('hostPermitido: o host ou um subdomínio, só https', () => {
  const hosts = ['safecharge.com'];
  assert.ok(hostPermitido('https://cdn.safecharge.com/x', hosts));
  for (const u of ['https://safecharge.com.evil.example/', 'http://cdn.safecharge.com/', 'https://evilsafecharge.com/', 'nada']) {
    assert.ok(!hostPermitido(u, hosts), u);
  }
});

test('prepararPerfil junta as preferências às que o perfil já tinha', () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'bci-perfil-'));
  try {
    fs.mkdirSync(path.join(pasta, 'Default'));
    fs.writeFileSync(path.join(pasta, 'Default', 'Preferences'), JSON.stringify({ profile: { name: 'x', password_manager_enabled: true }, outra: 1 }));
    prepararPerfil(pasta);
    const p = JSON.parse(fs.readFileSync(path.join(pasta, 'Default', 'Preferences'), 'utf8'));
    assert.equal(p.profile.name, 'x');
    assert.equal(p.profile.password_manager_enabled, false);
    assert.equal(p.profile.default_content_setting_values.notifications, 2);
    assert.equal(p.outra, 1);
    // Ficheiro estragado: recomeça.
    fs.writeFileSync(path.join(pasta, 'Default', 'Preferences'), '{nao json');
    prepararPerfil(pasta);
    assert.equal(JSON.parse(fs.readFileSync(path.join(pasta, 'Default', 'Preferences'), 'utf8')).credentials_enable_service, false);
  } finally { fs.rmSync(pasta, { recursive: true, force: true }); }
});

// Puppeteer falso: uma página principal, e `abrirFilha` simula o caixa a abrir uma janela nova.
function puppeteerFalso({ gotoErro } = {}) {
  const estado = { lancado: null, fechou: 0, cdp: [], paginas: [] };
  const pagina = (url = 'about:blank') => {
    const p = {
      _url: url, fechada: false, ouvintes: {},
      url() { return this._url; },
      isClosed() { return this.fechada; },
      close: async () => { p.fechada = true; p.ouvintes.close?.(); },
      once(ev, f) { this.ouvintes[ev] = f; },
      goto: async (u) => { if (gotoErro) throw gotoErro; p._url = u; },
      createCDPSession: async () => ({ on() {}, send: async (m, a) => { estado.cdp.push([m, a]); } }),
      mainFrame: () => ({ evaluate: async () => 'principal' }),
      frames: () => [],
      resposta: null
    };
    estado.paginas.push(p);
    return p;
  };
  const principal = pagina();
  const ouvintes = {};
  const browser = {
    target: () => ({ createCDPSession: async () => ({ send: async (m, a) => { estado.cdp.push([m, a]); } }) }),
    pages: async () => [principal],
    newPage: async () => pagina(),
    on: (ev, f) => { ouvintes[ev] = f; },
    close: async () => { estado.fechou++; },
    process: () => null
  };
  // Como no Chrome real, o endereço lê-se no alvo; page.url() de uma janela acabada de abrir lança.
  const abrirFilha = async (url) => {
    const nova = pagina(url);
    nova.url = () => { throw new Error('Requesting main frame too early!'); };
    ouvintes.targetcreated({ type: () => 'page', url: () => nova._url, page: async () => nova });
    for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
    return nova;
  };
  return { estado, principal, abrirFilha, puppeteer: { launch: async (o) => { estado.lancado = o; return browser; } } };
}

async function abrir(f, opcoes) {
  const pastaPerfis = fs.mkdtempSync(path.join(os.tmpdir(), 'bci-perfis-'));
  const r = await abrirBrowserReal('placard', { puppeteer: f.puppeteer, browser: { exe: 'C:\\chrome.exe' }, pastaPerfis, esperar: async () => {} }, opcoes);
  return { ...r, pastaPerfis };
}

test('lança o browser instalado com o perfil do casino, em pipe e sem os argumentos por omissão', async () => {
  const f = puppeteerFalso();
  const { pastaPerfis, fechar } = await abrir(f);
  try {
    const o = f.estado.lancado;
    assert.equal(o.executablePath, 'C:\\chrome.exe');
    assert.equal(o.pipe, true);
    assert.equal(o.headless, false);
    assert.equal(o.ignoreDefaultArgs, true);
    assert.ok(o.args.includes(`--user-data-dir=${path.join(pastaPerfis, 'op-casa-placard')}`));
    assert.ok(fs.existsSync(path.join(pastaPerfis, 'op-casa-placard', 'Default', 'Preferences')));
    assert.ok(f.estado.cdp.some(([m, a]) => m === 'Browser.setDownloadBehavior' && a.behavior === 'deny'));
    await fechar();
    await fechar();
    assert.equal(f.estado.fechou, 1);
  } finally { fs.rmSync(pastaPerfis, { recursive: true, force: true }); }
});

test('casino com caracteres fora de [a-z0-9] não abre browser', async () => {
  const f = puppeteerFalso();
  for (const c of ['../x', 'Placard', '']) {
    await assert.rejects(abrirBrowserReal(c, { puppeteer: f.puppeteer, browser: { exe: 'x' }, pastaPerfis: os.tmpdir() }), /casino inválido/);
  }
  assert.equal(f.estado.lancado, null);
});

test('navegar só aceita https, ERR_ABORTED não é falha e o tempo esgotado vira «navegação demorou»', async () => {
  const f = puppeteerFalso();
  const a = await abrir(f);
  await a.driver.navegar('https://www.placard.pt/');
  assert.equal(await a.driver.url(), 'https://www.placard.pt/');
  await assert.rejects(a.driver.navegar('http://www.placard.pt/'), /só https/);
  fs.rmSync(a.pastaPerfis, { recursive: true, force: true });

  const abortada = await abrir(puppeteerFalso({ gotoErro: new Error('net::ERR_ABORTED') }));
  await abortada.driver.navegar('https://www.placard.pt/');
  fs.rmSync(abortada.pastaPerfis, { recursive: true, force: true });

  const lenta = await abrir(puppeteerFalso({ gotoErro: Object.assign(new Error('t'), { name: 'TimeoutError' }) }));
  await assert.rejects(lenta.driver.navegar('https://www.placard.pt/'), /navegação demorou/);
  fs.rmSync(lenta.pastaPerfis, { recursive: true, force: true });
});

test('naPagina leva a função e os argumentos como texto, com o pagina.js', async () => {
  const f = puppeteerFalso();
  let codigo;
  f.principal.mainFrame = () => ({ evaluate: async (c) => { codigo = c; return 'principal'; } });
  const a = await abrir(f);
  assert.equal(await a.driver.naPagina('lerSaldo', '.saldo'), 'principal');
  assert.match(codigo, /__bciPagina/);
  assert.match(codigo, /\.\.\.\["lerSaldo",".saldo"\]/);
  fs.rmSync(a.pastaPerfis, { recursive: true, force: true });
});

test('naCaixa corre só nos frames do host do caixa e lança se nenhum respondeu e algum rebentou', async () => {
  const f = puppeteerFalso();
  const frame = (url, r) => ({ url: () => url, evaluate: async () => { if (r === 'erro') throw new Error('x'); return r; } });
  f.principal.frames = () => [frame('https://www.placard.pt/', 'principal'), frame('https://secure.safecharge.com/a', 'erro'), frame('https://secure.safecharge.com/b', { ok: true })];
  const a = await abrir(f);
  assert.deepEqual(await a.driver.naCaixa('prepararLevantamento', { caixaHost: 'secure.safecharge.com' }), { ok: true });
  f.principal.frames = () => [frame('https://secure.safecharge.com/a', 'erro')];
  await assert.rejects(a.driver.naCaixa('confirmarLevantamento', { caixaHost: 'secure.safecharge.com' }), /o caixa não respondeu/);
  f.principal.frames = () => [frame('https://www.placard.pt/', 'erro')];
  assert.equal(await a.driver.naCaixa('confirmarLevantamento', { caixaHost: 'secure.safecharge.com' }), null);
  fs.rmSync(a.pastaPerfis, { recursive: true, force: true });
});

test('janelas novas: só hostsExtra ficam (e lêem-se); as outras fecham-se, também as que ficam em branco', async () => {
  const f = puppeteerFalso();
  const a = await abrir(f, { hostsExtra: ['safecharge.com'] });
  const mal = await f.abrirFilha('https://evil.example/');
  assert.equal(mal.fechada, true);
  const branco = await f.abrirFilha('about:blank');
  assert.equal(branco.fechada, true);

  assert.equal(await a.driver.naJanelasNovas('lerReferenciaMB'), null);

  const nova = await f.abrirFilha('https://cdn.safecharge.com/x/sibs.html');
  assert.equal(nova.fechada, false);
  nova.frames = () => [{ evaluate: async () => { throw new Error('x'); } }, { evaluate: async () => ({ referencia: '123' }) }];
  assert.deepEqual(await a.driver.naJanelasNovas('lerReferenciaMB'), { referencia: '123' });
  await nova.close();
  assert.equal(await a.driver.naJanelasNovas('lerReferenciaMB'), null);
  fs.rmSync(a.pastaPerfis, { recursive: true, force: true });
});

test('se a preparação falha depois de abrir, o browser fecha-se', async () => {
  const f = puppeteerFalso();
  f.principal.createCDPSession = async () => { throw new Error('sem cdp'); };
  const pastaPerfis = fs.mkdtempSync(path.join(os.tmpdir(), 'bci-perfis-'));
  try {
    await assert.rejects(abrirBrowserReal('placard', { puppeteer: f.puppeteer, browser: { exe: 'x' }, pastaPerfis }), /sem cdp/);
    assert.equal(f.estado.fechou, 1);
  } finally { fs.rmSync(pastaPerfis, { recursive: true, force: true }); }
});

test('limparPerfis apaga só as pastas op-casa-*', async () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'bci-limpar-'));
  try {
    for (const n of ['op-casa-placard', 'op-casa-outro', 'Cache', 'op-3']) fs.mkdirSync(path.join(pasta, n, 'Default'), { recursive: true });
    assert.equal(await limparPerfis(pasta), 2);
    assert.deepEqual(fs.readdirSync(pasta).sort(), ['Cache', 'op-3']);
    assert.equal(await limparPerfis(path.join(pasta, 'nao-existe')), 0);
  } finally { fs.rmSync(pasta, { recursive: true, force: true }); }
});
