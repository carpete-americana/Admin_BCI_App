require('dotenv').config();
const os = require('os');
const crypto = require('crypto');
const { app, globalShortcut, ipcMain, BrowserWindow, safeStorage, session, screen } = require('electron');
const ElectronStorage = require('../../js/storage');
const { DEBUG, API_CONFIG } = require('./config');
const cache = require('./cache');
const updater = require('./updater');
const window = require('./window');
const errorHandler = require('./errorHandler');
const shortcuts = require('./shortcuts');
const tray = require('./tray');
const security = require('./security');
const metrics = require('./metrics');
const assets = require('./assets');
const { criarDispositivo } = require('./dispositivo');
const { pedirConsentimento } = require('./consentimentoJanela');
const { criarApi } = require('./apiDados');
const { criarExecutorReal } = require('./executorReal');
const { criarJanela, limparParticoes } = require('./janelaEscondida');
const { levantarDaConta } = require('./levantar');
const { depositarDaConta } = require('./depositar');

const lerTokenDoAdmin = async () => {
  const valor = await ElectronStorage.getItem('admin-token');
  return typeof valor === 'string' && valor ? valor : null;
};

// Operações automáticas neste computador: o consentimento é pedido aqui, numa janela local da app, nunca pela página.
// A instalada fala sempre com produção; o endereço só muda a partir do código (como o painel em autorizacao-painel).
const apiDados = criarApi({ baseUrl: (!app.isPackaged && process.env.BCI_API_URL) || API_CONFIG.API_URL, lerToken: lerTokenDoAdmin, guardarToken: (token) => ElectronStorage.setItem('admin-token', token) });
const particoes = { session, userData: app.getPath('userData') };

const dispositivo = criarDispositivo({
  api: apiDados,
  executorReal: criarExecutorReal({
    api: apiDados,
    raiz: (deviceId) => `/users/me/devices/${deviceId}`,
    criarJanela: (casino, opcoes) => criarJanela(casino, { BrowserWindow }, opcoes),
    levantar: levantarDaConta,
    depositar: depositarDaConta
  }),
  limparParticoes: () => limparParticoes(particoes),
  lerToken: lerTokenDoAdmin,
  storage: ElectronStorage,
  safeStorage,
  app,
  pedirConsentimento: (pedido) => pedirConsentimento(pedido, {
    BrowserWindow,
    ipcMain,
    janelaPai: () => (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() ? mainWindow : null),
    areaDoEcra: () => {
      const ref = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() ? mainWindow.getBounds() : null;
      return (ref ? screen.getDisplayMatching(ref) : screen.getPrimaryDisplay()).workArea;
    }
  }),
  tray: { setOperacoes: (ligado) => tray.setOperacoes(ligado) },
  versoes: { so: `${process.platform} ${os.release()}`, electron: process.versions.electron },
  randomUUID: () => crypto.randomUUID(),
  janelaVisivel: () => BrowserWindow.getAllWindows().some(w => !w.isDestroyed() && w.isVisible()),
  maquinaId: () => require('./maquina').maquinaId()
});

// Ao abrir e depois do login (cada página é um loadFile); o atraso deixa a janela voltar a aparecer depois da troca.
const AVISO_ATRASO_MS = 4000;
const avisarSeFaltar = () => setTimeout(() => dispositivo.perguntarSeFaltar().catch(() => {}), AVISO_ATRASO_MS);
app.on('browser-window-created', (e, win) => {
  win.webContents.on('did-finish-load', avisarSeFaltar);
  win.on('show', avisarSeFaltar);
});

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
ipcMain.handle('logout', (e) => {
  dispositivo.aoTerminarSessao();
  return window.handleLogout(e);
});

ipcMain.handle('dispositivo:estado', () => dispositivo.estado());
ipcMain.handle('dispositivo:aceitar', () => dispositivo.aceitar());
ipcMain.handle('dispositivo:revogar', () => dispositivo.revogar());
ipcMain.handle('dispositivo:definirArranque', (e, ligado) => dispositivo.definirArranque(ligado === true));
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

  dispositivo.iniciar();

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

let aSair = false;
app.on('before-quit', (evento) => {
  // Uma conta a meio acaba primeiro: cortá-la deixava-a «por verificar».
  if (!aSair && dispositivo.ocupado()) {
    evento.preventDefault();
    aSair = true;
    // A espera pode durar minutos: a app some em vez de ficar parada no ecrã.
    BrowserWindow.getAllWindows().forEach(w => { if (!w.isDestroyed()) w.hide(); });
    dispositivo.terminar().catch(() => {}).finally(() => app.quit());
    return;
  }
  DEBUG && console.log('[APP] Admin Application quitting, cleaning up...');
  
  cache.stopAllIntervals();

  dispositivo.parar();

  shortcuts.unregisterShortcuts();
  
  tray.destroyTray();
  
  DEBUG && console.log('[APP] Cleanup complete');
});

}
