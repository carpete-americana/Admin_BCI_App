// Keyboard shortcuts handler - Admin App
const { globalShortcut, BrowserWindow, ipcMain } = require('electron');
const { DEBUG } = require('./config');

function setupKeyboardShortcuts(clearCacheCallback) {
  // F11 - Fullscreen (already registered in index.js)
  
  // Ctrl+R or F5 - Reload (with FOUC prevention)
  globalShortcut.register('CommandOrControl+R', () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) {
      DEBUG && console.log('[SHORTCUT] Reloading window');
      win.hide();
      win.reload();
      
      // Show window when renderer is ready
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
      
      // Show window when renderer is ready
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

  // Ctrl+Shift+R - Hard reload (clear cache and reload)
  globalShortcut.register('CommandOrControl+Shift+R', () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) {
      DEBUG && console.log('[SHORTCUT] Hard reload (clearing cache)');
      win.hide();
      win.webContents.session.clearCache().then(() => {
        if (clearCacheCallback) clearCacheCallback();
        win.reload();
        
        // Show window when renderer is ready
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

  // Ctrl+Shift+C - Clear GitHub cache
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

  // Ctrl+Shift+I - Toggle DevTools (only in DEBUG mode)
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
