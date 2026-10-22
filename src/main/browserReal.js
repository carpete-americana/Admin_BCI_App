'use strict';

/**
 * Operações reais no Chrome instalado (ou, sem ele, no Edge, que vem sempre no Windows), com um perfil próprio por casino.
 * O Cloudflare da Placard pedia a verificação de humano à 3.ª conta no browser do Electron; num Chrome a sério, como na extensão, não.
 * Dá o mesmo driver que janelaEscondida.js. Sem `require('electron')` nem do puppeteer: chegam por dependências, para testar com node --test.
 */

const fs = require('node:fs');
const path = require('node:path');
const { correrNaPagina, FICHEIRO_PAGINA, SCRIPT_LEVANTAR } = require('./levantar');

const PREFIXO_PERFIL = 'op-casa-';
const NAVEGAR_MAX_MS = 30 * 1000;
const ABRIR_MAX_MS = 30 * 1000;
const FECHAR_MAX_MS = 10 * 1000;

// Por ordem de preferência: o Chrome é o browser da extensão, que nunca pediu a verificação.
function candidatos(env) {
  const pf = env.ProgramFiles || 'C:\\Program Files';
  const pf86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = env.LOCALAPPDATA || '';
  return [
    { nome: 'Chrome', exe: path.win32.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe') },
    { nome: 'Chrome', exe: path.win32.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe') },
    ...(local ? [{ nome: 'Chrome', exe: path.win32.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe') }] : []),
    { nome: 'Edge', exe: path.win32.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe') },
    { nome: 'Edge', exe: path.win32.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe') }
  ];
}

/** { nome, exe } do primeiro browser instalado, ou null (o PC deixa de anunciar contas reais). */
function encontrarBrowser({ env = process.env, existe = fs.existsSync, plataforma = process.platform } = {}) {
  if (plataforma !== 'win32') return null;
  return candidatos(env).find(c => existe(c.exe)) || null;
}

// Sem os argumentos por omissão do puppeteer: o --enable-automation e afins punham navigator.webdriver a true.
// Por isso o perfil (--user-data-dir) e a página inicial vão à mão em argsDe; o pipe o puppeteer acrescenta.
const ARGS = [
  '--window-position=-2400,-2400', '--window-size=1366,900', '--no-first-run', '--no-default-browser-check', '--mute-audio',
  '--disable-blink-features=AutomationControlled', '--lang=pt-PT',
  // Fora do ecrã o Windows dava a janela por tapada e o Chrome abrandava a página.
  '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
  '--disable-features=CalculateNativeWinOcclusion'
];
const argsDe = (perfil) => [...ARGS, `--user-data-dir=${perfil}`, 'about:blank'];

// O perfil não guarda passwords nem preenchimentos, recusa permissões e fala português.
const PREFERENCIAS = {
  intl: { accept_languages: 'pt-PT,pt' },
  credentials_enable_service: false,
  profile: {
    password_manager_enabled: false,
    default_content_setting_values: { notifications: 2, geolocation: 2, media_stream_mic: 2, media_stream_camera: 2, clipboard: 2, automatic_downloads: 2 }
  },
  autofill: { profile_enabled: false, credit_card_enabled: false },
  download: { prompt_for_download: false }
};

function juntar(base, novo) {
  const r = { ...(base && typeof base === 'object' ? base : {}) };
  for (const [k, v] of Object.entries(novo)) r[k] = v && typeof v === 'object' && !Array.isArray(v) ? juntar(r[k], v) : v;
  return r;
}

/** Escreve as preferências por cima das do perfil, antes de cada arranque (o browser reescreve o ficheiro). */
function prepararPerfil(pasta, { fsMod = fs } = {}) {
  const ficheiro = path.join(pasta, 'Default', 'Preferences');
  let atuais = {};
  try { atuais = JSON.parse(fsMod.readFileSync(ficheiro, 'utf8')); } catch (e) { /* perfil novo ou ficheiro estragado */ }
  fsMod.mkdirSync(path.dirname(ficheiro), { recursive: true });
  fsMod.writeFileSync(ficheiro, JSON.stringify(juntar(atuais, PREFERENCIAS)));
}

let paginaJs = null;
const lerPagina = () => (paginaJs ??= fs.readFileSync(FICHEIRO_PAGINA, 'utf8'));
const codigoDe = (nome, args) =>
  `${lerPagina()};\n${SCRIPT_LEVANTAR};\n(${correrNaPagina})(...${JSON.stringify([nome, ...args])})`;

const eHttps = (url) => {
  try { return new URL(url).protocol === 'https:'; } catch (e) { return false; }
};

// O próprio host ou um subdomínio; nunca includes, que deixava passar safecharge.com.evil.example.
const hostPermitido = (url, hosts) => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && hosts.some(h => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch (e) { return false; }
};

const comLimite = (promessa, ms, motivo) => {
  let t;
  return Promise.race([promessa, new Promise((_, rejeitar) => { t = setTimeout(() => rejeitar(new Error(motivo)), ms); })]).finally(() => clearTimeout(t));
};

/** Só https nos documentos da página: um http é recusado antes de sair. */
async function soHttps(page) {
  const cdp = await page.createCDPSession();
  cdp.on('Fetch.requestPaused', (e) => {
    cdp.send('Fetch.failRequest', { requestId: e.requestId, errorReason: 'BlockedByClient' }).catch(() => {});
  });
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: 'http://*', resourceType: 'Document' }] });
}

/**
 * Abre o browser do casino e devolve { driver, fechar() }, como criarJanela.
 * deps: { puppeteer, browser: { exe }, pastaPerfis }. Janelas novas só para os hostsExtra do caixa (e subdomínios); as outras fecham-se.
 */
async function abrirBrowserReal(casino, deps, { hostsExtra = [] } = {}) {
  if (!/^[a-z0-9]{1,30}$/.test(String(casino))) throw new Error('casino inválido');
  const { puppeteer, browser: escolhido, pastaPerfis } = deps;
  const esperar = deps.esperar || ((ms) => new Promise(r => setTimeout(r, ms)));
  const perfil = path.join(pastaPerfis, `${PREFIXO_PERFIL}${casino}`);
  prepararPerfil(perfil, deps);

  const browser = await comLimite(puppeteer.launch({
    executablePath: escolhido.exe, headless: false, pipe: true, defaultViewport: null,
    ignoreDefaultArgs: true, args: argsDe(perfil)
  }), ABRIR_MAX_MS, 'o browser não abriu');

  let fechado = false;
  const fechar = async () => {
    if (fechado) return;
    fechado = true;
    try { await comLimite(browser.close(), FECHAR_MAX_MS, 'fechar'); } catch (e) {
      try { browser.process()?.kill(); } catch (e2) { /* já saiu */ }
    }
  };

  try {
    const cdp = await browser.target().createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' });
    const [principal = await browser.newPage(), ...restantes] = await browser.pages();
    // Um perfil que restaura separadores da sessão anterior.
    for (const p of restantes) await p.close().catch(() => {});
    await soHttps(principal);

    // A referência Multibanco do caixa abre numa janela nova; guardam-se as permitidas para o driver as ler.
    const filhas = [];
    browser.on('targetcreated', async (alvo) => {
      if (alvo.type() !== 'page') return;
      const nova = await alvo.page().catch(() => null);
      if (!nova || nova === principal) return;
      // Uma janela abre em branco e só depois navega: espera pelo endereço, até 3 s.
      for (let i = 0; !hostPermitido(nova.url(), hostsExtra); i++) {
        if (i >= 10 || nova.url() !== 'about:blank') { nova.close().catch(() => {}); return; }
        await esperar(300);
      }
      await soHttps(nova).catch(() => {});
      filhas.push(nova);
      nova.once('close', () => { const i = filhas.indexOf(nova); if (i >= 0) filhas.splice(i, 1); });
    });

    const driver = {
      async navegar(url) {
        if (!eHttps(url)) throw new Error('só https');
        try {
          await principal.goto(url, { waitUntil: 'load', timeout: NAVEGAR_MAX_MS });
        } catch (e) {
          // Um redirecionamento a meio dá ERR_ABORTED sem a página ter falhado.
          if (/ERR_ABORTED/.test(e?.message || '')) return;
          if (e?.name === 'TimeoutError') throw new Error('navegação demorou');
          throw e;
        }
      },
      async url() { return principal.url(); },
      esperar,
      naPagina(nome, ...args) {
        return principal.mainFrame().evaluate(codigoDe(nome, args));
      },
      // O caixa é um iframe de outra origem: corre nos frames do host dele e fica a primeira resposta.
      // Nenhum respondeu e algum rebentou: lança, porque depois de Levantar o clique pode ter ido (verificar, não falhada).
      async naCaixa(nome, ...args) {
        const host = args[0]?.caixaHost;
        const frames = principal.frames().filter((f) => {
          if (!host) return true;
          try { return new URL(f.url()).hostname === host; } catch (e) { return false; }
        });
        const codigo = codigoDe(nome, args);
        let rebentou = false;
        for (const frame of frames) {
          try {
            const r = await frame.evaluate(codigo);
            if (r != null) return r;
          } catch (e) { rebentou = true; }
        }
        if (rebentou) throw new Error('o caixa não respondeu');
        return null;
      },
      // Primeira resposta não nula das janelas abertas pelo caixa; as que rebentam ou já fecharam ignoram-se.
      async naJanelasNovas(nome, ...args) {
        const codigo = codigoDe(nome, args);
        for (const filha of [...filhas]) {
          if (filha.isClosed()) continue;
          for (const frame of filha.frames()) {
            try {
              const r = await frame.evaluate(codigo);
              if (r != null) return r;
            } catch (e) { /* frame sem resposta */ }
          }
        }
        return null;
      }
    };
    return { driver, fechar };
  } catch (e) {
    await fechar();
    throw e;
  }
}

/** Apaga os perfis do browser das operações (pastas op-casa-*); devolve quantos. */
async function limparPerfis(pastaPerfis, { fsMod = fs } = {}) {
  let nomes = [];
  try { nomes = await fsMod.promises.readdir(pastaPerfis); } catch (e) { return 0; }
  let apagados = 0;
  for (const nome of nomes.filter(n => n.startsWith(PREFIXO_PERFIL))) {
    try {
      await fsMod.promises.rm(path.join(pastaPerfis, nome), { recursive: true, force: true });
      apagados++;
    } catch (e) { /* aberto agora: fica para a próxima limpeza */ }
  }
  return apagados;
}

module.exports = { encontrarBrowser, abrirBrowserReal, prepararPerfil, limparPerfis, ARGS, argsDe, PREFERENCIAS, hostPermitido };
