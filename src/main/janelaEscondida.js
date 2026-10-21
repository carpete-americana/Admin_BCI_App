'use strict';

/**
 * Janela escondida de uma conta, com o browser (partição) só dela, e o driver que o motor de levantamento usa.
 * Sem `require('electron')`: o BrowserWindow e a sessão vêm por dependências, para testar com node --test.
 */

const fs = require('node:fs');
const path = require('node:path');
const { correrNaPagina, FICHEIRO_PAGINA, SCRIPT_LEVANTAR } = require('./levantar');

const PREFIXO_PARTICAO = 'op-';
const NAVEGAR_MAX_MS = 30 * 1000;

// Sem «Electron» no user agent: é o do Chrome da mesma versão.
const USER_AGENT = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome || '0.0.0.0'} Safari/537.36`;

let paginaJs = null;
const lerPagina = () => (paginaJs ??= fs.readFileSync(FICHEIRO_PAGINA, 'utf8'));

// Uma vez por sessão: a mesma conta abre muitas janelas e o will-download acumulava ouvintes.
const sessoesFechadas = new WeakSet();

/** Na sessão da conta não há pessoa a decidir: nenhuma permissão (câmara, microfone, notificações…) nem downloads. */
function fecharSessao(ses) {
  if (!ses || sessoesFechadas.has(ses)) return;
  sessoesFechadas.add(ses);
  ses.setPermissionRequestHandler((wc, permissao, responder) => responder(false));
  ses.setPermissionCheckHandler(() => false);
  // Sem isto o Electron abria o «Guardar como» no ecrã da pessoa.
  ses.on('will-download', (event, item) => { event.preventDefault(); try { item.cancel(); } catch (e) { /* já cancelado */ } });
}

const eHttps = (url) => {
  try { return new URL(url).protocol === 'https:'; } catch (e) { return false; }
};

// pagina.js e o script do login não repetem trabalho se a página já os tem; a função e os argumentos vão como texto.
const codigoDe = (nome, args) =>
  `${lerPagina()};\n${SCRIPT_LEVANTAR};\n(${correrNaPagina})(...${JSON.stringify([nome, ...args])})`;

const bloquear = (event, url) => { if (!eHttps(url)) event.preventDefault(); };

/** Sem som, user agent do Chrome e só https; as janelas novas ficam a cargo de quem chama. */
function protegerConteudo(wc) {
  fecharSessao(wc.session);
  wc.setAudioMuted(true);
  wc.setUserAgent(USER_AGENT);
  wc.on('will-navigate', bloquear);
  wc.on('will-redirect', bloquear);
}

// Hostname exato: um sufixo ou includes deixava passar cdn.safecharge.com.evil.example.
const hostPermitido = (url, hosts) => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && hosts.includes(u.hostname);
  } catch (e) { return false; }
};

/** { driver, fechar() } para a conta; nada de preload, só https e janelas novas só para os hostsExtra do caixa. */
function criarJanela(accountId, deps, { hostsExtra = [] } = {}) {
  const { BrowserWindow } = deps;
  const esperar = deps.esperar || ((ms) => new Promise(r => setTimeout(r, ms)));
  const webPreferences = () => ({
    partition: `persist:${PREFIXO_PARTICAO}${accountId}`,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true
  });
  const win = new BrowserWindow({ show: false, webPreferences: webPreferences() });
  const wc = win.webContents;
  protegerConteudo(wc);
  wc.setWindowOpenHandler(({ url }) => (hostPermitido(url, hostsExtra)
    ? { action: 'allow', overrideBrowserWindowOptions: { show: false, webPreferences: webPreferences() } }
    : { action: 'deny' }));

  // A referência Multibanco do caixa abre numa janela nova; guardam-se as vivas para o driver as ler.
  const filhas = [];
  wc.on('did-create-window', (filha) => {
    protegerConteudo(filha.webContents);
    filha.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    filhas.push(filha);
    filha.once('closed', () => { const i = filhas.indexOf(filha); if (i >= 0) filhas.splice(i, 1); });
  });

  const driver = {
    async navegar(url) {
      if (!eHttps(url)) throw new Error('só https');
      let temporizador;
      const limite = new Promise((_, rejeitar) => { temporizador = setTimeout(() => rejeitar(new Error('navegação demorou')), NAVEGAR_MAX_MS); });
      try {
        // Um redirecionamento a meio dá ERR_ABORTED sem a página ter falhado.
        await Promise.race([wc.loadURL(url).catch((e) => { if (e?.code !== 'ERR_ABORTED') throw e; }), limite]);
      } finally {
        clearTimeout(temporizador);
      }
    },
    async url() { return wc.getURL(); },
    esperar,
    naPagina(nome, ...args) {
      return wc.mainFrame.executeJavaScript(codigoDe(nome, args));
    },
    // O caixa é um iframe de outra origem: corre nos frames do host dele e fica a primeira resposta.
    // Nenhum respondeu e algum rebentou: lança, porque depois de Levantar o clique pode ter ido (verificar, não falhada).
    async naCaixa(nome, ...args) {
      const host = args[0]?.caixaHost;
      const frames = wc.mainFrame.framesInSubtree.filter((f) => {
        if (!host) return true;
        try { return new URL(f.url).hostname === host; } catch (e) { return false; }
      });
      const codigo = codigoDe(nome, args);
      let rebentou = false;
      for (const frame of frames) {
        try {
          const r = await frame.executeJavaScript(codigo);
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
        try {
          if (filha.isDestroyed() || filha.webContents.isDestroyed()) continue;
          const principal = filha.webContents.mainFrame;
          for (const frame of new Set([principal, ...(principal.framesInSubtree || [])])) {
            try {
              const r = await frame.executeJavaScript(codigo);
              if (r != null) return r;
            } catch (e) { /* frame sem resposta */ }
          }
        } catch (e) { /* filha a fechar */ }
      }
      return null;
    }
  };

  return {
    driver,
    fechar() {
      for (const filha of [...filhas]) {
        try { if (!filha.isDestroyed()) filha.destroy(); } catch (e) { /* já fechada */ }
      }
      filhas.length = 0;
      try { if (!win.isDestroyed()) win.destroy(); } catch (e) { /* já fechada */ }
    }
  };
}

/** Apaga o browser de cada conta (partições op-*); devolve quantas. */
async function limparParticoes(deps) {
  const listar = deps.listarParticoes || (async () => {
    try { return await fs.promises.readdir(path.join(deps.userData, 'Partitions')); } catch (e) { return []; }
  });
  const nomes = (await listar()).filter((n) => n.startsWith(PREFIXO_PARTICAO));
  let apagadas = 0;
  for (const nome of nomes) {
    try {
      await deps.session.fromPartition(`persist:${nome}`).clearStorageData();
      apagadas++;
    } catch (e) { /* fica para a próxima limpeza */ }
  }
  return apagadas;
}

module.exports = { criarJanela, limparParticoes, USER_AGENT };
