'use strict';

/**
 * Pedido de consentimento numa janela modal da app. O HTML vem de public/ (nunca da rede) e só o preload desta janela
 * pode responder, pelo canal consentimento:responder; uma resposta de outro webContents é ignorada.
 * Sem `require('electron')`: tudo vem por dependências, para testar com node --test.
 */

const path = require('node:path');

const LARGURA = 540;
const ALTURA = 600;
const ALTURA_MIN = 360;
const MARGEM_ECRA = 40;
const CANAL = 'consentimento:responder';
// Altura sem scroll: a da janela, menos a parte visível do texto, mais o texto todo. Espera pela letra.
const MEDIR = `document.fonts.ready.then(() => {
  const t = document.getElementById('texto');
  return document.documentElement.clientHeight - t.clientHeight + t.scrollHeight;
})`;
const FICHEIRO = path.join(__dirname, '..', '..', 'public', 'consentimento.html');
const PRELOAD = path.join(__dirname, '..', 'preload', 'consentimento.js');

let aberta = null;

/** Resolve true se o utilizador aceitar; false se recusar ou fechar a janela. */
function pedirConsentimento({ modo, titulo, texto, botoes }, deps) {
  const { BrowserWindow, ipcMain } = deps;
  if (aberta && aberta.modo === modo) {
    aberta.win.focus?.();
    return aberta.promessa;
  }
  // O pedido não pode herdar a resposta do aviso: o aberto fecha (conta como «agora não») e este abre.
  if (aberta) aberta.terminar(false);
  const pai = deps.janelaPai?.() || null;
  const posicao = {};
  if (pai) {
    const b = pai.getBounds();
    posicao.x = Math.round(b.x + (b.width - LARGURA) / 2);
    posicao.y = Math.round(b.y + (b.height - ALTURA) / 2);
  }

  const win = new BrowserWindow({
    ...posicao,
    width: LARGURA,
    height: ALTURA,
    parent: pai || undefined,
    modal: !!pai,
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    backgroundColor: '#F8FAFC',
    title: titulo,
    webPreferences: { preload: PRELOAD, nodeIntegration: false, contextIsolation: true, sandbox: true }
  });
  const wc = win.webContents;
  // Nada sai desta janela: nem navegação nem janelas novas.
  wc.on('will-navigate', (event) => event.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.once('ready-to-show', async () => {
    try {
      await ajustarAoConteudo(win, pai, deps);
    } catch (e) { /* fica com a altura de partida */ }
    if (!win.isDestroyed()) win.show();
  });

  let terminar;
  const promessa = new Promise((resolve) => {
    let fechada = false;
    terminar = (aceite) => {
      if (fechada) return;
      fechada = true;
      ipcMain.removeListener(CANAL, aoResponder);
      aberta = null;
      resolve(aceite);
      if (!win.isDestroyed()) win.close();
    };
    const aoResponder = (event, aceite) => {
      if (event.sender !== wc) return;
      terminar(aceite === true);
    };
    ipcMain.on(CANAL, aoResponder);
    win.on('closed', () => terminar(false));
    // Sem isto, uma janela que não carrega nunca mostra nem responde, e o pedido seguinte devolvia esta promessa.
    wc.on('did-fail-load', () => terminar(false));
  });
  aberta = { win, promessa, modo, terminar };

  win.loadFile(FICHEIRO, { query: { modo, titulo, texto, aceitar: botoes[0], recusar: botoes[1] } });
  return promessa;
}

/** Cresce ou encolhe até caber o texto todo, sem passar da área útil do ecrã; volta a centrar. */
async function ajustarAoConteudo(win, pai, deps) {
  const natural = Number(await win.webContents.executeJavaScript(MEDIR, true));
  if (!Number.isFinite(natural) || win.isDestroyed()) return;
  const area = deps.areaDoEcra?.() || null;
  const maxima = area ? area.height - MARGEM_ECRA : Infinity;
  const altura = Math.round(Math.max(ALTURA_MIN, Math.min(natural, maxima)));
  win.setContentSize(LARGURA, altura);
  const ref = pai ? pai.getBounds() : area;
  if (!ref) return;
  const x = Math.round(ref.x + (ref.width - LARGURA) / 2);
  let y = Math.round(ref.y + (ref.height - altura) / 2);
  if (area) y = Math.max(area.y + MARGEM_ECRA / 2, Math.min(y, area.y + area.height - altura - MARGEM_ECRA / 2));
  win.setPosition(x, y);
}

module.exports = { pedirConsentimento, ajustarAoConteudo, FICHEIRO, PRELOAD, CANAL };
