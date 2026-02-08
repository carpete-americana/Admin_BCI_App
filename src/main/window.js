// Window management with state persistence - Admin App
const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const ElectronStorage = require('../../js/storage');
const { DEBUG } = require('./config');

// Window state persistence
function loadWindowState() {
  const state = ElectronStorage.getItem('admin-window-state');
  DEBUG && console.log('[WINDOW] Loading window state:', state);
  // Always default to maximized
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

// Create main window with state persistence
function createWindow() {
  const state = loadWindowState();
  
  // Load app icon
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

  win.setMenu(null);
  // Load main shell
  win.loadFile(path.join(__dirname, '../../public/index.html'));
  
  // Show window when renderer signals it's ready
  let shown = false;
  const showSafely = () => {
    if (shown) return;
    shown = true;
    if (!win.isDestroyed()) {
      // Always maximize on startup for better UX
      win.maximize();
      win.show();
    }
  };

  // Save window state on close
  win.on('close', (event) => {
    saveWindowState(win);
    
    // On Windows/Linux, minimize to tray instead of closing
    if (process.platform !== 'darwin') {
      event.preventDefault();
      win.hide();
      DEBUG && console.log('[WINDOW] Window hidden to tray');
    }
  });

  ipcMain.once('renderer:ready', () => {
    showSafely();
  });

  // Fallback: if app starts offline and renderer never sends ready, show anyway after longer delay
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

// Navigation handler - hides window when navigating
function handleNavigate(event, filePath) {
  DEBUG && console.log('[NAVIGATE] Navigating to:', filePath);
  const win = BrowserWindow.getFocusedWindow();
  if (win) {
    win.hide();
    const fullPath = path.join(__dirname, '../../public', filePath);
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

// Logout handler
function handleLogout(event) {
  DEBUG && console.log('[LOGOUT] Clearing session and returning to login');
  // Clear token and rememberMe from storage
  ElectronStorage.removeItem('admin-token');
  ElectronStorage.removeItem('admin-rememberMe');
  // Navigate to login page
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

// Fullscreen toggle
function toggleFullscreen() {
  const win = BrowserWindow.getFocusedWindow();
  if (win) {
    win.setFullScreen(!win.isFullScreen());
  }
}

// =========================================
// DETACHED WINDOWS
// =========================================
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

  detached.setMenu(null);
  detached.loadFile(path.join(__dirname, '../../public/index.html'), {
    hash: route,
    query: { detached: 'true' }
  });

  // Show when ready
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
