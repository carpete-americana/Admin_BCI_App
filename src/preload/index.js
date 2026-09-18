const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld("electronAPI", {
    // Sem canais de leitura de ficheiros: isso passa pelo processo principal com validação (ver assets:getLocal).
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
    
    trackPageLoad: (pageName, startTime) => ipcRenderer.invoke('metrics:trackPageLoad', pageName, startTime),
    trackFeature: (featureName) => ipcRenderer.invoke('metrics:trackFeature', featureName),
    getMetrics: () => ipcRenderer.invoke('metrics:getSummary'),
    
    downloadUpdate: () => ipcRenderer.send('download-update'),
    // O caminho é ignorado no processo principal.
    InstallAndUpdate: (installerPath) => ipcRenderer.send('install-and-update', installerPath),
    installAndUpdate: (installerPath) => ipcRenderer.send('install-and-update', installerPath),

    // Scraper de odds local
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

    // Navegação pedida pelo menu do tray.
    onNavigateTo: (cb) => {
      ipcRenderer.on('navigate-to', (e, route) => cb && cb(route));
    },

    // Confirmação de que a cache foi limpa (Ctrl+Shift+C).
    onCacheCleared: (cb) => {
      ipcRenderer.on('cache-cleared', () => cb && cb());
    },

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

// Só em desenvolvimento.
contextBridge.exposeInMainWorld("test", {
    simulateUpdate: () => ipcRenderer.invoke('test:simulateUpdate')
});
