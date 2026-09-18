const { app, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { DEBUG } = require('./config');

let tray = null;

function createTray(showWindowCallback, quitCallback) {
  const iconPath = path.join(__dirname, '../../assets/icons/tray-icon.png');
  
  let icon;
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
      const buildIconPath = path.join(__dirname, '../../build/tray-icon.png');
      icon = nativeImage.createFromPath(buildIconPath);
      
      if (icon.isEmpty()) {
        // Último recurso: ícone gerado.
        const canvas = { width: 16, height: 16 };
        icon = nativeImage.createEmpty();
        DEBUG && console.warn('[TRAY] No icon found, using empty icon');
      }
    }
  } catch (e) {
    icon = nativeImage.createEmpty();
    DEBUG && console.warn('[TRAY] Error loading icon:', e.message);
  }
  
  tray = new Tray(icon);
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Mostrar Aplicação',
      click: () => {
        DEBUG && console.log('[TRAY] Show application clicked');
        if (showWindowCallback) showWindowCallback();
      }
    },
    {
      type: 'separator'
    },
    {
      label: 'Dashboard',
      click: () => {
        if (showWindowCallback) showWindowCallback();
        const { BrowserWindow } = require('electron');
        const win = BrowserWindow.getFocusedWindow();
        if (win) win.webContents.send('navigate-to', 'dashboard');
      }
    },
    {
      label: 'Utilizadores',
      click: () => {
        if (showWindowCallback) showWindowCallback();
        const { BrowserWindow } = require('electron');
        const win = BrowserWindow.getFocusedWindow();
        if (win) win.webContents.send('navigate-to', 'users');
      }
    },
    {
      label: 'Transações',
      click: () => {
        if (showWindowCallback) showWindowCallback();
        const { BrowserWindow } = require('electron');
        const win = BrowserWindow.getFocusedWindow();
        if (win) win.webContents.send('navigate-to', 'transactions');
      }
    },
    {
      type: 'separator'
    },
    {
      label: 'Sair',
      click: () => {
        DEBUG && console.log('[TRAY] Quit clicked');
        if (quitCallback) quitCallback();
      }
    }
  ]);
  
  tray.setToolTip('BCi Admin Application');
  tray.setContextMenu(contextMenu);
  
  tray.on('double-click', () => {
    DEBUG && console.log('[TRAY] Double clicked');
    if (showWindowCallback) showWindowCallback();
  });
  
  DEBUG && console.log('[TRAY] System tray created');
  
  return tray;
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
  destroyTray
};
