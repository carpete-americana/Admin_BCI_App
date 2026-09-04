// preload.js - exposes electron APIs and cache helpers - Admin App
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld("electronAPI", {
    // joinPaths/fileExists/readFile SAÍRAM.
    //
    // Anunciavam os canais "path:join", "fs:fileExists" e "fs:readFile", para
    // os quais não existe — nem deve existir — nenhum ipcMain.handle: leitura
    // arbitrária de ficheiros a partir do renderer foi fechada de propósito.
    // O que ficava era uma promessa rejeitada e, pior, um mapa do que já houve
    // aqui, apontando a quem sonde exatamente que canais valeria a pena tentar
    // reabrir. Se algum dia for preciso ler um ficheiro local, faz-se como o
    // assets:getLocal: caminho validado no processo principal.
    logout: () => ipcRenderer.invoke("logout"),
    listAssetsCss: () => ipcRenderer.invoke('assets:listCss'),
    listAssetsJs: () => ipcRenderer.invoke('assets:listJs'),
    getLocalAsset: (path) => ipcRenderer.invoke('assets:getLocal', path),
    getDebugMode: () => ipcRenderer.invoke('app:getDebugMode'),
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    checkServerStatus: () => ipcRenderer.invoke('app:checkServerStatus'),
    rendererReady: () => ipcRenderer.send('renderer:ready'),
    navigate: (filePath) => ipcRenderer.invoke('navigate', filePath),
    detachPage: (route, title) => ipcRenderer.invoke('detach-page', route, title),
    clearBrowserCache: () => ipcRenderer.invoke('cache:clearBrowser'),
    
    // Metrics
    trackPageLoad: (pageName, startTime) => ipcRenderer.invoke('metrics:trackPageLoad', pageName, startTime),
    trackFeature: (featureName) => ipcRenderer.invoke('metrics:trackFeature', featureName),
    getMetrics: () => ipcRenderer.invoke('metrics:getSummary'),
    
    // Trigger updater actions in main
    downloadUpdate: () => ipcRenderer.send('download-update'),
    // Install and update - pode receber installerPath como parâmetro
    InstallAndUpdate: (installerPath) => ipcRenderer.send('install-and-update', installerPath),
    installAndUpdate: (installerPath) => ipcRenderer.send('install-and-update', installerPath),

    // Odds Scraper (local)
    getOdds: (sports, sites, options) => ipcRenderer.invoke('odds:get', sports, sites, options),
    refreshOdds: (sports, sites, options) => ipcRenderer.invoke('odds:refresh', sports, sites, options),
    getOddsSports: () => ipcRenderer.invoke('odds:sports'),
    clearOddsCache: () => ipcRenderer.invoke('odds:clearCache'),
    getOddsProgress: () => ipcRenderer.invoke('odds:progress'),
    onOddsProgress: (cb) => {
      ipcRenderer.on('odds:progress', (e, data) => cb && cb(data));
    },
    removeOddsProgressListener: () => {
      ipcRenderer.removeAllListeners('odds:progress');
    },

    // Navegação vinda do processo principal (menu do tray).
    //
    // O tray já enviava 'navigate-to' desde sempre, mas não havia ponte nenhuma
    // para o renderer — e com contextIsolation:true a página não tem acesso ao
    // ipcRenderer por fora. As entradas "Dashboard"/"Utilizadores"/"Transações"
    // do menu traziam a janela para a frente e não mudavam de página.
    onNavigateTo: (cb) => {
      ipcRenderer.on('navigate-to', (e, route) => cb && cb(route));
    },

    // Confirmação de que a cache foi limpa (Ctrl+Shift+C).
    onCacheCleared: (cb) => {
      ipcRenderer.on('cache-cleared', () => cb && cb());
    },

    // Updater event listeners
    onUpdateAvailable: (cb) => {
      ipcRenderer.on('update-available', (e, data) => cb && cb(data));
    },
    onDownloadProgress: (cb) => {
      ipcRenderer.on('download-progress', (e, progress) => cb && cb(progress));
    },
    onUpdateDownloaded: (cb) => {
      ipcRenderer.on('update-downloaded', (e, info) => cb && cb(info));
    },
    onUpdateError: (cb) => {
      ipcRenderer.on('update-error', (e, error) => cb && cb(error));
    },
});

contextBridge.exposeInMainWorld("electronStorage", {
    setItem: (key, value) => ipcRenderer.invoke("storage:set", key, value),
    getItem: (key) => ipcRenderer.invoke("storage:get", key),
    removeItem: (key) => ipcRenderer.invoke("storage:remove", key)
});

contextBridge.exposeInMainWorld("githubCache", {
    fetchFile: (pathRel, ttl) => ipcRenderer.invoke("github-cache:fetch", pathRel, ttl),
    fetchAsset: (pathRel, ttl) => ipcRenderer.invoke("github-cache:fetchAsset", pathRel, ttl),
    clearFile: (pathRel) => ipcRenderer.invoke("github-cache:clear", pathRel),
    clearAll: () => ipcRenderer.invoke("github-cache:clearAll")
});

// Testing helper (DEV ONLY)
contextBridge.exposeInMainWorld("test", {
    simulateUpdate: () => ipcRenderer.invoke('test:simulateUpdate')
});
