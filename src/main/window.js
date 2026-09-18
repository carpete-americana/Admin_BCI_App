const { BrowserWindow, ipcMain, screen, shell } = require('electron');
const path = require('path');
const ElectronStorage = require('../../js/storage');
const { DEBUG } = require('./config');

function loadWindowState() {
  const state = ElectronStorage.getItem('admin-window-state');
  DEBUG && console.log('[WINDOW] Loading window state:', state);
  return state || { width: 1200, height: 800, x: undefined, y: undefined, isMaximized: true };
}

function saveWindowState(win) {
  if (win.isDestroyed()) return;
  const bounds = win.getBounds();
  const state = {
    ...bounds,
    isMaximized: win.isMaximized()
  };
  DEBUG && console.log('[WINDOW] Saving window state:', state);
  ElectronStorage.setItem('admin-window-state', state);
}

/**
 * A janela não navega para fora: noutra origem, o preload ficava com o token.
 * file:// é a própria shell a mudar de página (validado em handleNavigate). Vale para as duas janelas.
 */
const ORIGENS_PERMITIDAS = new Set(['https://admin.bcibizz.pt', 'https://bcibizz.pt']);

function destinoPermitido(url) {
  if (typeof url !== 'string') return false;
  if (url.startsWith('file://')) return true;
  try { return ORIGENS_PERMITIDAS.has(new URL(url).origin); }
  catch (e) { return false; }
}

function protegerNavegacao(janela) {
  janela.webContents.on('will-navigate', (event, url) => {
    if (destinoPermitido(url)) return;
    DEBUG && console.warn('[SECURITY] Navegação bloqueada:', url);
    event.preventDefault();
  });

  janela.webContents.setWindowOpenHandler(({ url }) => {
    // Nenhuma janela nova com preload: links do domínio abrem no browser do sistema.
    if (/^https:\/\/(www\.)?(admin\.)?bcibizz\.pt\//.test(url)) {
      shell.openExternal(url).catch(() => {});
    } else {
      DEBUG && console.warn('[SECURITY] window.open bloqueado:', url);
    }
    return { action: 'deny' };
  });
}

function createWindow() {
  const state = loadWindowState();
  
  let icon;
  try {
    const iconPath = path.join(__dirname, '../../assets/icons/icon.png');
    icon = require('electron').nativeImage.createFromPath(iconPath);
  } catch (e) {
    DEBUG && console.warn('[WINDOW] Could not load app icon:', e.message);
  }
  
  const win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 1200,
    minHeight: 800,
    show: false,
    fullscreenable: true,
    icon: icon,
    title: 'BCI Admin',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: true,
      webSecurity: true,
      plugins: true
    },
  });

  protegerNavegacao(win);

  win.setMenu(null);
  win.loadFile(path.join(__dirname, '../../public/index.html'));
  
  let shown = false;
  const showSafely = () => {
    if (shown) return;
    shown = true;
    if (!win.isDestroyed()) {
      win.maximize();
      win.show();
    }
  };

  win.on('close', (event) => {
    saveWindowState(win);
    
    // No Windows e Linux, fechar esconde para o tray.
    if (process.platform !== 'darwin') {
      event.preventDefault();
      win.hide();
      DEBUG && console.log('[WINDOW] Window hidden to tray');
    }
  });

  ipcMain.once('renderer:ready', () => {
    showSafely();
  });

  // Se o renderer nunca avisar (arranque offline), mostra a janela na mesma.
  const fallbackTimer = setTimeout(() => {
    showSafely();
  }, 5000);

  win.on('closed', () => clearTimeout(fallbackTimer));
  win.webContents.on('did-fail-load', () => {
    showSafely();
  });
  
  DEBUG && win.openDevTools({ mode: 'detach' });
  
  return win;
}

/**
 * Resolve um caminho do renderer para dentro de public/, ou devolve null.
 * Valida o caminho já resolvido; o separador final exclui pastas irmãs com o mesmo prefixo.
 */
function resolverPaginaLocal(filePath) {
  if (typeof filePath !== 'string' || !filePath) return null;

  const base = path.resolve(__dirname, '../../public');
  const alvo = path.resolve(base, filePath.replace(/^[/\\]+/, ''));

  if (alvo !== base && !alvo.startsWith(base + path.sep)) {
    DEBUG && console.warn('[NAVIGATE] Caminho fora de public/, recusado:', filePath);
    return null;
  }

  // Só HTML.
  if (path.extname(alvo).toLowerCase() !== '.html') {
    DEBUG && console.warn('[NAVIGATE] Extensão não permitida, recusado:', filePath);
    return null;
  }

  return alvo;
}

function handleNavigate(event, filePath) {
  DEBUG && console.log('[NAVIGATE] Navigating to:', filePath);
  const fullPath = resolverPaginaLocal(filePath);
  if (!fullPath) return false;

  const win = BrowserWindow.getFocusedWindow();
  if (win) {
    win.hide();
    DEBUG && console.log('[NAVIGATE] Full path:', fullPath);
    win.loadFile(fullPath);
    let shown = false;
    const showSafely = () => {
      if (shown) return;
      shown = true;
      if (!win.isDestroyed()) win.show();
    };
    const fallbackTimer = setTimeout(showSafely, 3000);
    ipcMain.once('renderer:ready', () => {
      clearTimeout(fallbackTimer);
      showSafely();
    });
    win.webContents.once('did-fail-load', showSafely);
  }
  return true;
}

function handleLogout(event) {
  DEBUG && console.log('[LOGOUT] Clearing session and returning to login');
  ElectronStorage.removeItem('admin-token');
  const win = BrowserWindow.getFocusedWindow();
  if (win) {
    win.hide();
    win.loadFile(path.join(__dirname, '../../public/index.html'));
    let shown = false;
    const showSafely = () => {
      if (shown) return;
      shown = true;
      if (!win.isDestroyed()) win.show();
    };
    const fallbackTimer = setTimeout(showSafely, 3000);
    ipcMain.once('renderer:ready', () => {
      clearTimeout(fallbackTimer);
      showSafely();
    });
    win.webContents.once('did-fail-load', showSafely);
  }
  return true;
}

function toggleFullscreen() {
  const win = BrowserWindow.getFocusedWindow();
  if (win) {
    win.setFullScreen(!win.isFullScreen());
  }
}

// Janelas destacadas
let detachedWindows = new Map();
let detachedCounter = 0;

function createDetachedWindow(route, title) {
  const windowId = `${route}_${++detachedCounter}`;

  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  const w = Math.min(400, screenW);
  const h = Math.min(420, screenH);

  let icon;
  try {
    const iconPath = path.join(__dirname, '../../assets/icons/icon.png');
    icon = require('electron').nativeImage.createFromPath(iconPath);
  } catch (e) {
    DEBUG && console.warn('[DETACH] Could not load app icon:', e.message);
  }

  const detached = new BrowserWindow({
    width: w,
    height: h,
    minWidth: w,
    minHeight: h,
    maxWidth: w,
    maxHeight: h,
    resizable: false,
    alwaysOnTop: true,
    show: false,
    icon: icon,
    title: title || 'BCI Admin',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: true,
      webSecurity: true,
      plugins: true
    },
  });

  protegerNavegacao(detached);

  detached.setMenu(null);
  detached.loadFile(path.join(__dirname, '../../public/index.html'), {
    hash: route,
    query: { detached: 'true' }
  });

  let shown = false;
  const showSafely = () => {
    if (shown) return;
    shown = true;
    if (!detached.isDestroyed()) detached.show();
  };

  ipcMain.once('renderer:ready', showSafely);
  setTimeout(showSafely, 5000);

  detached.on('closed', () => {
    detachedWindows.delete(windowId);
    DEBUG && console.log(`[DETACH] Detached window closed: ${windowId}`);
  });

  detachedWindows.set(windowId, detached);
  DEBUG && console.log(`[DETACH] Created detached window: ${windowId}`);

  return detached;
}

function handleDetachPage(event, route, title) {
  createDetachedWindow(route, title);
  return true;
}

module.exports = {
  createWindow,
  handleNavigate,
  handleLogout,
  toggleFullscreen,
  handleDetachPage
};
