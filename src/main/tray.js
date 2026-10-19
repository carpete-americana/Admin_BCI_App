const { app, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { DEBUG } = require('./config');

let tray = null;
let operacoesLigadas = false;
let aoMostrar = null;
let aoSair = null;

const TOOLTIP = 'BCi Admin Application';
const TOOLTIP_OPERACOES = 'BCI · operações automáticas ligadas';

function irParaPagina(pagina) {
  if (aoMostrar) aoMostrar();
  const { BrowserWindow } = require('electron');
  const win = BrowserWindow.getFocusedWindow();
  if (win) win.webContents.send('navigate-to', pagina);
}

function construirMenu() {
  return Menu.buildFromTemplate([
    {
      label: 'Mostrar Aplicação',
      click: () => {
        DEBUG && console.log('[TRAY] Show application clicked');
        if (aoMostrar) aoMostrar();
      }
    },
    { type: 'separator' },
    { label: 'Dashboard', click: () => irParaPagina('dashboard') },
    { label: 'Utilizadores', click: () => irParaPagina('users') },
    { label: 'Transações', click: () => irParaPagina('transactions') },
    { type: 'separator' },
    // Só informa: ligar e desligar faz-se nas Definições, depois de um diálogo de consentimento.
    { label: `Operações automáticas: ${operacoesLigadas ? 'ligadas' : 'desligadas'}`, enabled: false },
    { type: 'separator' },
    {
      label: 'Sair',
      click: () => {
        DEBUG && console.log('[TRAY] Quit clicked');
        if (aoSair) aoSair();
      }
    }
  ]);
}

function atualizar() {
  if (!tray) return;
  tray.setContextMenu(construirMenu());
  tray.setToolTip(operacoesLigadas ? TOOLTIP_OPERACOES : TOOLTIP);
}

function createTray(showWindowCallback, quitCallback) {
  aoMostrar = showWindowCallback;
  aoSair = quitCallback;

  const iconPath = path.join(__dirname, '../../assets/icons/tray-icon.png');

  let icon;
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
      const buildIconPath = path.join(__dirname, '../../build/tray-icon.png');
      icon = nativeImage.createFromPath(buildIconPath);

      if (icon.isEmpty()) {
        icon = nativeImage.createEmpty();
        DEBUG && console.warn('[TRAY] No icon found, using empty icon');
      }
    }
  } catch (e) {
    icon = nativeImage.createEmpty();
    DEBUG && console.warn('[TRAY] Error loading icon:', e.message);
  }

  tray = new Tray(icon);
  atualizar();

  tray.on('double-click', () => {
    DEBUG && console.log('[TRAY] Double clicked');
    if (aoMostrar) aoMostrar();
  });

  DEBUG && console.log('[TRAY] System tray created');

  return tray;
}

/** Mostra no tooltip e no menu se este computador aceitou as operações automáticas. */
function setOperacoes(ligado) {
  operacoesLigadas = !!ligado;
  atualizar();
}

function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
    DEBUG && console.log('[TRAY] System tray destroyed');
  }
}

module.exports = {
  createTray,
  destroyTray,
  setOperacoes
};
