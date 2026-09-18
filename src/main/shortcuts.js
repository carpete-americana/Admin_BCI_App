const { globalShortcut, BrowserWindow, ipcMain } = require('electron');
const { DEBUG } = require('./config');

function setupKeyboardShortcuts(clearCacheCallback) {
  // F11 (ecrã inteiro) está registado em index.js.
  
  globalShortcut.register('CommandOrControl+R', () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) {
      DEBUG && console.log('[SHORTCUT] Reloading window');
      win.hide();
      win.reload();
      
      const showSafely = () => {
        if (!win.isDestroyed()) win.show();
      };
      
      const fallbackTimer = setTimeout(showSafely, 3000);
      ipcMain.once('renderer:ready', () => {
        clearTimeout(fallbackTimer);
        showSafely();
      });
    }
  });
  
  globalShortcut.register('F5', () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) {
      DEBUG && console.log('[SHORTCUT] Reloading window (F5)');
      win.hide();
      win.reload();
      
      const showSafely = () => {
        if (!win.isDestroyed()) win.show();
      };
      
      const fallbackTimer = setTimeout(showSafely, 3000);
      ipcMain.once('renderer:ready', () => {
        clearTimeout(fallbackTimer);
        showSafely();
      });
    }
  });

  globalShortcut.register('CommandOrControl+Shift+R', () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) {
      DEBUG && console.log('[SHORTCUT] Hard reload (clearing cache)');
      win.hide();
      win.webContents.session.clearCache().then(() => {
        if (clearCacheCallback) clearCacheCallback();
        win.reload();
        
        const showSafely = () => {
          if (!win.isDestroyed()) win.show();
        };
        
        const fallbackTimer = setTimeout(showSafely, 3000);
        ipcMain.once('renderer:ready', () => {
          clearTimeout(fallbackTimer);
          showSafely();
        });
      });
    }
  });

  globalShortcut.register('CommandOrControl+Shift+C', () => {
    DEBUG && console.log('[SHORTCUT] Clearing cache');
    if (clearCacheCallback) {
      clearCacheCallback();
      const win = BrowserWindow.getFocusedWindow();
      if (win) {
        win.webContents.send('cache-cleared');
      }
    }
  });

  // Ctrl+Shift+I só em DEBUG.
  if (DEBUG) {
    globalShortcut.register('CommandOrControl+Shift+I', () => {
      const win = BrowserWindow.getFocusedWindow();
      if (win) {
        DEBUG && console.log('[SHORTCUT] Toggling DevTools');
        win.webContents.toggleDevTools();
      }
    });
  }

  DEBUG && console.log('[SHORTCUTS] Keyboard shortcuts registered');
}

function unregisterShortcuts() {
  globalShortcut.unregisterAll();
  DEBUG && console.log('[SHORTCUTS] All shortcuts unregistered');
}

module.exports = {
  setupKeyboardShortcuts,
  unregisterShortcuts
};
