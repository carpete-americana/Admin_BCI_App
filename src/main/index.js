require('dotenv').config();
const { app, globalShortcut, ipcMain, BrowserWindow } = require('electron');
const ElectronStorage = require('../../js/storage');
const { DEBUG } = require('./config');
const cache = require('./cache');
const updater = require('./updater');
const window = require('./window');
const errorHandler = require('./errorHandler');
const shortcuts = require('./shortcuts');
const tray = require('./tray');
const security = require('./security');
const metrics = require('./metrics');
const assets = require('./assets');
const oddsScraper = require('./odds-scraper');

ipcMain.handle('github-cache:fetch', cache.handleFetch);
ipcMain.handle('github-cache:fetchAsset', cache.handleFetchAsset);
ipcMain.handle('github-cache:clear', cache.handleClear);
ipcMain.handle('github-cache:clearAll', cache.handleClearAll);

ipcMain.handle('assets:listCss', cache.listCssFiles);
ipcMain.handle('assets:listJs', cache.listJsFiles);
ipcMain.handle('assets:getLocal', (e, path) => assets.getAssetDataUrl(path));

ipcMain.handle('app:getDebugMode', () => DEBUG);
ipcMain.handle('app:getVersion', () => require('../../package.json').version);

ipcMain.handle('metrics:trackPageLoad', (e, pageName, startTime) => metrics.trackPageLoad(pageName, startTime));
ipcMain.handle('metrics:trackFeature', (e, featureName) => metrics.trackFeatureUsage(featureName));
ipcMain.handle('metrics:getSummary', () => metrics.getMetricsSummary());

if (DEBUG) {
  ipcMain.handle('test:simulateUpdate', () => {
    DEBUG && console.log('[TEST] Simulating update available');
    updater.simulateUpdateAvailable();
    return true;
  });
}

ipcMain.handle('navigate', window.handleNavigate);
ipcMain.handle('logout', window.handleLogout);
ipcMain.handle('detach-page', window.handleDetachPage);

ipcMain.handle('cache:clearBrowser', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win) {
    await win.webContents.session.clearCache();
    DEBUG && console.log('[CACHE] Browser cache cleared');
  }
});

ipcMain.handle('storage:set', (e, k, v) => ElectronStorage.setItem(k, v));
ipcMain.handle('storage:get', (e, k) => ElectronStorage.getItem(k));
ipcMain.handle('storage:remove', (e, k) => ElectronStorage.removeItem(k));

ipcMain.handle('odds:get', (e, sports, sites, options) => oddsScraper.getOdds(sports, false, sites, options));
ipcMain.handle('odds:refresh', (e, sports, sites, options) => oddsScraper.getOdds(sports, true, sites, options));
ipcMain.handle('odds:sports', () => oddsScraper.getSports());
ipcMain.handle('odds:clearCache', () => oddsScraper.clearCache());
ipcMain.handle('odds:progress', () => oddsScraper.getProgress());

ipcMain.handle('app:checkServerStatus', async () => {
  try {
    const { API_CONFIG } = require('./config');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(`${API_CONFIG.BASE_URL}/api/list`, {
      signal: controller.signal
    });
    clearTimeout(timeout);
    
    return response.ok || response.status === 429;
  } catch (e) {
    return false;
  }
});

updater.setupUpdateHandlers();

errorHandler.setupErrorHandlers();

let mainWindow = null;
let appTray = null;

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  DEBUG && console.log('[APP] Another instance detected, quitting...');
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    DEBUG && console.log('[APP] Second instance detected, showing existing window');
    if (mainWindow) {
      if (!mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        if (!mainWindow.isVisible()) mainWindow.show();
        mainWindow.focus();
      }
    }

    // No Windows, uma ligação bciadmin:// chega como segunda instância, com o endereço na linha de comandos.
    tratarLigacao(commandLine);
  });

const autorizacaoPainel = require('./autorizacao-painel');

async function lerTokenDeAdmin() {
  try {
    const valor = await ElectronStorage.getItem('admin-token');
    return typeof valor === 'string' && valor ? valor : null;
  } catch (erro) {
    DEBUG && console.log('[AUTORIZACAO] falha a ler o token:', erro.message);
    return null;
  }
}

/** Procura um pedido de autorização numa linha de comandos e trata-o. */
function tratarLigacao(argv) {
  const pedido = autorizacaoPainel.procurarNosArgumentos(argv);
  if (!pedido) return;

  DEBUG && console.log('[AUTORIZACAO] pedido recebido');
  autorizacaoPainel.tratarPedido(pedido, {
    janelaPrincipal: mainWindow,
    lerToken: lerTokenDeAdmin
  }).catch(erro => {
    DEBUG && console.log('[AUTORIZACAO] falhou:', erro.message);
  });
}

app.whenReady().then(() => {
  DEBUG && console.log('[APP] Admin Application ready, initializing...');

  // Regista o esquema em todos os arranques: repara registos alterados e serve o desenvolvimento.
  autorizacaoPainel.registarEsquema();

  // Com a app fechada, a ligação vem no argv do arranque.
  tratarLigacao(process.argv);
  
  metrics.setupMetrics();
  
  errorHandler.cleanOldLogs();
  cache.cleanOldCache();
  
  mainWindow = window.createWindow();
  
  security.setupCSP(mainWindow.webContents.session);
  
  shortcuts.setupKeyboardShortcuts(() => {
    cache.handleClearAll();
  });
  
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
  
  mainWindow.webContents.on('did-fail-load', () => {
    cache.setOnlineStatus(false);
  });
  
  setTimeout(() => {
    cache.preloadFrequentPages();
  }, 5000);
  
  cache.startBackgroundSync();
  
  cache.startHashRefresh();
  
  DEBUG && console.log('[APP] All admin features initialized');
  updater.checkForUpdates();
});

app.on('window-all-closed', () => {
  // Com o tray ativo, a app continua a correr sem janelas.
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

app.on('before-quit', () => {
  DEBUG && console.log('[APP] Admin Application quitting, cleaning up...');
  
  cache.stopAllIntervals();
  
  oddsScraper.closeBrowser();
  
  shortcuts.unregisterShortcuts();
  
  tray.destroyTray();
  
  DEBUG && console.log('[APP] Cleanup complete');
});

}
