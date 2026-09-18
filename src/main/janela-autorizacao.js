'use strict';

/**
 * Janela da app que pede a confirmação de uma autorização.
 * Página local com sessão e preload próprios; só esta janela responde, e uma única vez.
 * Fechar, Escape ou o tempo esgotar contam como recusa; um sim cedo demais é ignorado.
 */

const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { DEBUG } = require('./config');

/** Um sim antes deste tempo, contado desde que a janela ficou visível, não conta. */
const ATRASO_MINIMO_MS = 600;

/** Sem resposta neste tempo, é recusa. */
const TEMPO_MAXIMO_MS = 2 * 60 * 1000;

/** Sessão em memória (sem persist:), só desta janela. */
const PARTICAO = 'autorizacao-app';

let pendente = null;

/** Os canais só respondem ao webContents da janela do pedido em curso. */
let canaisRegistados = false;
function registarCanais() {
  if (canaisRegistados) return;
  canaisRegistados = true;

  ipcMain.handle('autorizacao:estado', (e) => {
    if (!pendente || e.sender !== pendente.janela.webContents) return null;
    return pendente.dados;
  });

  ipcMain.on('autorizacao:responder', (e, sim) => {
    if (!pendente || e.sender !== pendente.janela.webContents) return;

    if (sim === true && pendente.dados.tipo === 'confirmar') {
      const desde = pendente.visivelDesde;
      if (!desde || Date.now() - desde < ATRASO_MINIMO_MS) {
        DEBUG && console.log('[AUTORIZACAO] resposta cedo demais, ignorada');
        return;
      }
    }

    terminar(sim === true);
  });
}

function terminar(resultado) {
  if (!pendente) return;
  const { janela, resolver, temporizador } = pendente;
  pendente = null;

  clearTimeout(temporizador);
  if (!janela.isDestroyed()) janela.destroy();
  resolver(resultado);
}

/** Só é filha da principal quando esta está visível; senão ficaria escondida com ela. */
function paiVisivel(janelaPrincipal) {
  return janelaPrincipal &&
    !janelaPrincipal.isDestroyed() &&
    janelaPrincipal.isVisible() &&
    !janelaPrincipal.isMinimized()
    ? janelaPrincipal
    : null;
}

/** tipo: confirmar, info ou erro. Devolve true só para Autorizar num pedido confirmar. */
function mostrar(dados, { janelaPrincipal = null } = {}) {
  registarCanais();

  if (pendente) {
    // Já há uma aberta: traz essa para a frente e recusa esta.
    if (!pendente.janela.isDestroyed()) pendente.janela.focus();
    DEBUG && console.log('[AUTORIZACAO] já havia uma janela aberta; pedido recusado');
    return Promise.resolve(false);
  }

  return new Promise((resolver) => {
    const pai = paiVisivel(janelaPrincipal);

    const janela = new BrowserWindow({
      // Com folga: a mensagem de erro vem da API, e o texto ganha scroll se não couber.
      width: 440,
      height: dados.tipo === 'confirmar' ? 372 : 300,
      useContentSize: true,
      parent: pai || undefined,
      modal: !!pai,
      show: false,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: false,
      center: true,
      title: 'Autorizar o navegador',
      backgroundColor: '#1a1a24',
      webPreferences: {
        preload: path.join(__dirname, '..', 'autorizacao', 'preload.js'),
        partition: PARTICAO,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        spellcheck: false,
        devTools: !app.isPackaged
      }
    });

    janela.setMenu(null);

    // Não sai do ficheiro local. Nem por navegação, nem por janela nova.
    janela.webContents.on('will-navigate', (e) => e.preventDefault());
    janela.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    pendente = {
      janela,
      resolver,
      dados: { ...dados },
      visivelDesde: null,
      temporizador: setTimeout(() => {
        DEBUG && console.log('[AUTORIZACAO] sem resposta a tempo; recusado');
        terminar(false);
      }, TEMPO_MAXIMO_MS)
    };

    janela.once('ready-to-show', () => {
      if (janela.isDestroyed()) return;
      janela.show();
      janela.focus();
      if (pendente && pendente.janela === janela) pendente.visivelDesde = Date.now();
    });

    // Fechar por qualquer via é recusar.
    janela.on('closed', () => {
      if (pendente && pendente.janela === janela) terminar(false);
    });
    janela.webContents.on('render-process-gone', () => {
      if (pendente && pendente.janela === janela) terminar(false);
    });

    janela.loadFile(path.join(__dirname, '..', 'autorizacao', 'confirmar.html'))
      .catch((erro) => {
        DEBUG && console.log('[AUTORIZACAO] falha a abrir a janela:', erro.message);
        if (pendente && pendente.janela === janela) terminar(false);
      });
  });
}

module.exports = {
  mostrar,
  ATRASO_MINIMO_MS,
  TEMPO_MAXIMO_MS,
  PARTICAO
};
