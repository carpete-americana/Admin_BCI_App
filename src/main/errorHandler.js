// Error handling and crash reporting - Admin App
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { DEBUG } = require('./config');

const logsDir = path.join(app.getPath('userData'), 'logs');

// Ensure logs directory exists
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Log error to file
function logError(error, context = '') {
  const timestamp = new Date().toISOString();
  const logFile = path.join(logsDir, `admin-error-${new Date().toISOString().split('T')[0]}.log`);
  
  const logEntry = `
[${timestamp}] ${context}
${error.stack || error.message || String(error)}
---
`;
  
  try {
    fs.appendFileSync(logFile, logEntry);
    DEBUG && console.log('[ERROR HANDLER] Error logged to:', logFile);
  } catch (e) {
    console.error('[ERROR HANDLER] Failed to write log:', e);
  }
}

// Setup global error handlers
function setupErrorHandlers() {
  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    console.error('[UNCAUGHT EXCEPTION]', error);
    logError(error, 'UNCAUGHT EXCEPTION');
    
    // In production, try to keep the app running
    // In development, crash to see the error
    if (DEBUG) {
      throw error;
    }
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    console.error('[UNHANDLED REJECTION]', reason);
    logError(reason instanceof Error ? reason : new Error(String(reason)), 'UNHANDLED REJECTION');
  });

  // Handle app crash
  app.on('render-process-gone', (event, webContents, details) => {
    console.error('[RENDER PROCESS GONE]', details);
    logError(new Error(`Render process gone: ${details.reason}`), 'RENDER PROCESS GONE');
    
    // Try to reload the window
    if (details.reason === 'crashed' || details.reason === 'killed') {
      setTimeout(() => {
        try {
          if (!webContents.isDestroyed()) {
            webContents.reload();
          }
        } catch (e) {
          console.error('[ERROR HANDLER] Failed to reload:', e);
        }
      }, 1000);
    }
  });

  // Handle child process crash
  app.on('child-process-gone', (event, details) => {
    console.error('[CHILD PROCESS GONE]', details);
    logError(new Error(`Child process gone: ${details.type} - ${details.reason}`), 'CHILD PROCESS GONE');
  });

  DEBUG && console.log('[ERROR HANDLER] Admin error handlers registered');
}

// Clean old log files (older than 7 days)
function cleanOldLogs() {
  try {
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
    const now = Date.now();
    
    const files = fs.readdirSync(logsDir).filter(f => f.startsWith('admin-error-'));
    let cleaned = 0;
    files.forEach(file => {
      const filePath = path.join(logsDir, file);
      const stats = fs.statSync(filePath);
      if (now - stats.mtime.getTime() > maxAge) {
        fs.unlinkSync(filePath);
        cleaned++;
      }
    });
    
    DEBUG && cleaned > 0 && console.log(`[ERROR HANDLER] Cleaned ${cleaned} old log files`);
  } catch (e) {
    console.error('[ERROR HANDLER] Failed to clean logs:', e);
  }
}

module.exports = {
  setupErrorHandlers,
  cleanOldLogs,
  logError
};
