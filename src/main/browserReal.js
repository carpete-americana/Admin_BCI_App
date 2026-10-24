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
  '--window-size=1366,900', '--no-first-run', '--no-default-browser-check', '--mute-audio',
  '--disable-blink-features=AutomationControlled', '--lang=pt-PT',
  // Fora do ecrã o Windows dava a janela por tapada e o Chrome abrandava a página.
  '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
  '--disable-features=CalculateNativeWinOcclusion'
];
const POSICAO = { x: -2400, y: -2400 };
const POSICAO_VISIVEL = { x: 40, y: 40 };
// Sem posição o Chrome restaurava a guardada no perfil, que era a de fora do ecrã.
const argsDe = (perfil, pos = POSICAO) => [...ARGS, ...(pos ? [`--window-position=${pos.x},${pos.y}`] : []), `--user-data-dir=${perfil}`, 'about:blank'];

/** Canto fora de todos os monitores: com um à esquerda ou acima do principal, -2400 caía num deles. */
function posicaoFora(ecras) {
  // Chrome e Electron podem contar em pixels ou em DIP conforme a escala: vale o menor dos dois.
  const menor = (eixo) => Math.min(0, ...(ecras || []).flatMap(({ bounds, scaleFactor }) => {
    const v = Number(bounds?.[eixo]);
    return Number.isFinite(v) ? [v, v * (Number(scaleFactor) || 1)] : [];
  }));
  return { x: Math.round(menor('x')) - 2400, y: Math.round(menor('y')) - 2400 };
}

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

/** Põe a janela à frente e fora de maximizada/minimizada; o Windows deixava-a atrás da app. */
async function mostrarJanela(page) {
  try {
    const cdp = await page.createCDPSession();
    const { windowId } = await cdp.send('Browser.getWindowForTarget');
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal', left: POSICAO_VISIVEL.x, top: POSICAO_VISIVEL.y } });
    await page.bringToFront?.();
  } catch (e) { /* o browser abriu à mesma */ }
}

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
 * deps: { puppeteer, browser: { exe }, pastaPerfis, ecras?(), visivel?() }, com ecras() = screen.getAllDisplays() e visivel() a preferência de mostrar a janela. Janelas novas só para os hostsExtra do caixa (e subdomínios); as outras fecham-se.
 */
async function abrirBrowserReal(casino, deps, { hostsExtra = [] } = {}) {
  if (!/^[a-z0-9]{1,30}$/.test(String(casino))) throw new Error('casino inválido');
  const { puppeteer, browser: escolhido, pastaPerfis } = deps;
  const esperar = deps.esperar || ((ms) => new Promise(r => setTimeout(r, ms)));
  const perfil = path.join(pastaPerfis, `${PREFIXO_PERFIL}${casino}`);
  prepararPerfil(perfil, deps);
  const visivel = deps.visivel ? await deps.visivel().catch(() => false) : false;

  const lancar = puppeteer.launch({
    executablePath: escolhido.exe, headless: false, pipe: true, defaultViewport: null,
    ignoreDefaultArgs: true, args: argsDe(perfil, visivel ? POSICAO_VISIVEL : posicaoFora(deps.ecras?.())), timeout: ABRIR_MAX_MS
  });
  let browser;
  try {
    browser = await comLimite(lancar, ABRIR_MAX_MS + 5000, 'o browser não abriu');
  } catch (e) {
    // Um arranque que chega depois do limite fecha-se, senão ficava um Chrome sem dono a prender o perfil.
    lancar.then(b => b.close()).catch(() => {});
    throw e;
  }

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
    if (visivel) await mostrarJanela(principal);

    // A referência Multibanco do caixa abre numa janela nova; guardam-se as permitidas para o driver as ler.
    const filhas = [];
    const tratarNova = async (alvo) => {
      if (alvo.type() !== 'page') return;
      const nova = await alvo.page().catch(() => null);
      if (!nova || nova === principal) return;
      try {
        // Uma janela abre em branco e só depois navega: espera pelo endereço, até 3 s.
        // alvo.url() e não nova.url(): esta lança «main frame too early» numa janela acabada de abrir.
        for (let i = 0; !hostPermitido(alvo.url(), hostsExtra); i++) {
          if (i >= 10 || !['', 'about:blank'].includes(alvo.url())) { nova.close().catch(() => {}); return; }
          await esperar(300);
        }
        await soHttps(nova).catch(() => {});
        filhas.push(nova);
        nova.once('close', () => { const i = filhas.indexOf(nova); if (i >= 0) filhas.splice(i, 1); });
      } catch (e) {
        nova.close().catch(() => {});
      }
    };
    browser.on('targetcreated', (alvo) => { tratarNova(alvo).catch(() => {}); });

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
      // O Chrome que acabou de fechar ainda pode prender ficheiros uns instantes.
      await fsMod.promises.rm(path.join(pastaPerfis, nome), { recursive: true, force: true, maxRetries: 5, retryDelay: 400 });
      apagados++;
    } catch (e) { /* aberto agora: fica para a próxima limpeza */ }
  }
  return apagados;
}

module.exports = { encontrarBrowser, abrirBrowserReal, prepararPerfil, limparPerfis, ARGS, argsDe, posicaoFora, PREFERENCIAS, hostPermitido };
