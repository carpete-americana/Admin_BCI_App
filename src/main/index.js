// Main process entry point - Admin App
require('dotenv').config();
const { app, globalShortcut, ipcMain, BrowserWindow } = require('electron');
const ElectronStorage = require('../../js/storage');
const { routes, DEBUG } = require('./config');
const cache = require('./cache');
const updater = require('./updater');
const window = require('./window');
const errorHandler = require('./errorHandler');
const shortcuts = require('./shortcuts');
const tray = require('./tray');
const security = require('./security');
const metrics = require('./metrics');
const assets = require('./assets');

// IPC Handlers - GitHub Cache
ipcMain.handle('github-cache:fetch', cache.handleFetch);
ipcMain.handle('github-cache:fetchAsset', cache.handleFetchAsset);
ipcMain.handle('github-cache:clear', cache.handleClear);
ipcMain.handle('github-cache:clearAll', cache.handleClearAll);

// IPC Handlers - Assets
ipcMain.handle('assets:listCss', cache.listCssFiles);
ipcMain.handle('assets:listJs', cache.listJsFiles);
ipcMain.handle('assets:getLocal', (e, path) => assets.getAssetDataUrl(path));

// IPC Handlers - Routes and Config
ipcMain.handle('routes:getConfig', () => routes);
ipcMain.handle('app:getDebugMode', () => DEBUG);
ipcMain.handle('app:getVersion', () => require('../../package.json').version);
ipcMain.handle('security:validateUrl', (e, url) => security.isUrlSafe(url));

// IPC Handlers - Metrics
ipcMain.handle('metrics:trackPageLoad', (e, pageName, startTime) => metrics.trackPageLoad(pageName, startTime));
ipcMain.handle('metrics:trackFeature', (e, featureName) => metrics.trackFeatureUsage(featureName));
ipcMain.handle('metrics:getSummary', () => metrics.getMetricsSummary());

// IPC Handlers - Testing (DEV ONLY)
if (DEBUG) {
  ipcMain.handle('test:simulateUpdate', () => {
    DEBUG && console.log('[TEST] Simulating update available');
    updater.simulateUpdateAvailable();
    return true;
  });
}

// IPC Handlers - Navigation and Auth
ipcMain.handle('navigate', window.handleNavigate);
ipcMain.handle('logout', window.handleLogout);

// IPC Handlers - Cache Management
ipcMain.handle('cache:clearBrowser', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win) {
    await win.webContents.session.clearCache();
    DEBUG && console.log('[CACHE] Browser cache cleared');
  }
});

// IPC Handlers - Storage
ipcMain.handle('storage:set', (e, k, v) => ElectronStorage.setItem(k, v));
ipcMain.handle('storage:get', (e, k) => ElectronStorage.getItem(k));
ipcMain.handle('storage:remove', (e, k) => ElectronStorage.removeItem(k));

// IPC Handler - Check Server Status
ipcMain.handle('app:checkServerStatus', async () => {
  try {
    const { API_CONFIG } = require('./config');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout
    
    const response = await fetch(`${API_CONFIG.BASE_URL}/api/list`, {
      signal: controller.signal
    });
    clearTimeout(timeout);
    
    return response.ok;
  } catch (e) {
    return false;
  }
});

// Setup updater handlers
updater.setupUpdateHandlers();

// Setup error handlers early
errorHandler.setupErrorHandlers();

let mainWindow = null;
let appTray = null;

// Single instance lock - prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Another instance is already running, quit this one
  DEBUG && console.log('[APP] Another instance detected, quitting...');
  app.quit();
} else {
  // This is the first instance, handle second-instance events
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    DEBUG && console.log('[APP] Second instance detected, showing existing window');
    // Someone tried to run a second instance, we should focus our window instead
    if (mainWindow) {
      if (!mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        if (!mainWindow.isVisible()) mainWindow.show();
        mainWindow.focus();
      }
    }
  });

// App lifecycle
app.whenReady().then(() => {
  DEBUG && console.log('[APP] Admin Application ready, initializing...');
  
  // Setup metrics
  metrics.setupMetrics();
  
  // Clean old logs and cache
  errorHandler.cleanOldLogs();
  cache.cleanOldCache();
  
  // Create main window
  mainWindow = window.createWindow();
  
  // Setup CSP security headers
  security.setupCSP(mainWindow.webContents.session);
  
  // Setup keyboard shortcuts
  shortcuts.setupKeyboardShortcuts(() => {
    cache.handleClearAll();
  });
  
  // Create system tray
  appTray = tray.createTray(
    () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
      } else {
        mainWindow = window.createWindow();
      }
    },
    () => {
      app.quit();
    }
  );
  
  // Monitor network status
  mainWindow.webContents.on('did-fail-load', () => {
    cache.setOnlineStatus(false);
  });
  
  // Preload frequent pages after a short delay
  setTimeout(() => {
    cache.preloadFrequentPages();
  }, 5000);
  
  // Start background sync
  cache.startBackgroundSync();
  
  // Start hash refresh (valida integridade dos ficheiros a cada 5 minutos)
  cache.startHashRefresh();
  
  DEBUG && console.log('[APP] All admin features initialized');
  updater.checkForUpdates();
});

app.on('window-all-closed', () => {
  // On macOS, keep app running in background
  // On Windows/Linux, keep running if tray is active
  if (process.platform !== 'darwin' && !appTray) {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    DEBUG && console.log('[APP] Activating - creating new window');
    mainWindow = window.createWindow();
  }
});

// Cleanup on quit
app.on('before-quit', () => {
  DEBUG && console.log('[APP] Admin Application quitting, cleaning up...');
  
  // Stop all intervals
  cache.stopAllIntervals();
  
  // Unregister shortcuts
  shortcuts.unregisterShortcuts();
  
  // Destroy tray
  tray.destroyTray();
  
  DEBUG && console.log('[APP] Cleanup complete');
});

} // End of single instance lock else block
