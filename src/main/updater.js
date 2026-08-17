// Auto-updater configuration and handlers - Admin App
const { autoUpdater } = require('electron-updater');
const { BrowserWindow, ipcMain } = require('electron');
const { DEBUG, API_CONFIG } = require('./config');
const log = require('electron-log');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// Configure auto-updater with better error handling
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.allowPrerelease = true; // Allow prerelease versions
autoUpdater.allowDowngrade = false;
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'debug';

// Disable signature verification for development (enable in production with code signing)
autoUpdater.disableWebInstaller = false;

// Armazenar dados da última atualização disponível
let updateInfo = null;
let downloadInProgress = false;

/**
 * Verifica updates via backend (seguro, com rate limit do servidor)
 */
async function checkForUpdatesViaBackend() {
  try {
    const apiUrl = `${API_CONFIG.BASE_URL}/check-update`;
    if (DEBUG) {
      console.log('[UPDATER] Checking for updates via backend:', apiUrl);
    }

    const response = await fetch(apiUrl);
    if (!response.ok) {
      // 429 = rate limited, silenciar (não é erro real)
      if (response.status === 429) {
        if (DEBUG) console.log('[UPDATER] Rate limited (429), tentando mais tarde...');
        return;
      }
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error || 'Unknown error');
    }

    // Comparar versão
    const latestVersion = data.latestVersion.replace(/^v/, ''); // Remove 'v' prefix
    const currentVersion = autoUpdater.currentVersion.toString();

    if (latestVersion !== currentVersion) {
      if (DEBUG) {
        console.log('');
        console.log('╔════════════════════════════════════════╗');
        console.log('║      🎉 UPDATE DISPONÍVEL!             ║');
        console.log('╚════════════════════════════════════════╝');
        console.log('[UPDATER] Nova versão detectada:', latestVersion);
        console.log('[UPDATER] Versão atual:', currentVersion);
        console.log('[UPDATER] Release date:', data.releaseDate);
        console.log('');
      }
      
      // Notificar renderer
      const wins = BrowserWindow.getAllWindows();
      wins.forEach(win => {
        if (!win.isDestroyed()) {
          updateInfo = {
            version: latestVersion,
            name: data.releaseName,
            description: data.description,
            assets: data.assets
          };
          win.webContents.send('update-available', updateInfo);
        }
      });
    } else if (DEBUG) {
      console.log('[UPDATER] ✓ App já está atualizada. Versão:', currentVersion);
    }

  } catch (err) {
    if (DEBUG) {
      console.error('[UPDATER] ❌ Erro ao verificar updates via backend:', err.message);
    }
    log.error('[UPDATER] Backend check error:', err);
  }
}

// IPC handlers
function setupUpdateHandlers() {
  ipcMain.on('download-update', async () => {
    if (DEBUG) console.log('[UPDATER] Starting update download');
    
    if (!updateInfo || !updateInfo.assets || updateInfo.assets.length === 0) {
      if (DEBUG) console.error('[UPDATER] Nenhuma informação de update disponível');
      const wins = BrowserWindow.getAllWindows();
      wins.forEach(win => {
        if (!win.isDestroyed()) {
          win.webContents.send('update-error', { message: 'Nenhuma atualização disponível' });
        }
      });
      return;
    }

    // Encontrar o .exe para Windows
    const winAsset = updateInfo.assets.find(a => a.name.endsWith('.exe'));
    if (!winAsset) {
      if (DEBUG) console.error('[UPDATER] Instalador Windows (.exe) não encontrado');
      const wins = BrowserWindow.getAllWindows();
      wins.forEach(win => {
        if (!win.isDestroyed()) {
          win.webContents.send('update-error', { message: 'Instalador não encontrado' });
        }
      });
      return;
    }

    downloadInProgress = true;

    try {
      // Fazer download do arquivo
      const tempDir = path.join(app.getPath('temp'), 'bci-admin-update');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const installerPath = path.join(tempDir, winAsset.name);
      
      if (DEBUG) {
        console.log('[UPDATER] Iniciando download:', winAsset.downloadUrl);
        console.log('[UPDATER] Para:', installerPath);
      }

      // Fazer fetch do arquivo
      const response = await fetch(winAsset.downloadUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const totalSize = parseInt(response.headers.get('content-length'), 10);
      let downloaded = 0;

      // Escrever arquivo com stream real (ReadableStream)
      const fileStream = fs.createWriteStream(installerPath);
      
      // Usar getReader() para ler o stream com progresso real
      try {
        const reader = response.body.getReader();
        
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) break;
          
          downloaded += value.length;
          const percent = Math.round((downloaded / totalSize) * 100);
          
          // Escrever chunk no arquivo
          fileStream.write(Buffer.from(value));
          
          if (DEBUG && percent % 10 === 0) {
            console.log(`[UPDATER] Download: ${percent}%`);
          }

          // Enviar progresso para renderer
          const wins = BrowserWindow.getAllWindows();
          wins.forEach(win => {
            if (!win.isDestroyed()) {
              win.webContents.send('download-progress', {
                percent: percent,
                transferred: downloaded,
                total: totalSize
              });
            }
          });
        }
        
        fileStream.end();
        
        // Aguardar fim da escrita
        await new Promise((resolve, reject) => {
          fileStream.on('finish', resolve);
          fileStream.on('error', reject);
        });
        
      } catch (streamErr) {
        // Fallback: download em chunks (sem stream)
        const buffer = await response.arrayBuffer();
        const chunkSize = 1024 * 1024; // 1MB chunks
        const totalBuffer = Buffer.from(buffer);
        const chunkCount = Math.ceil(totalBuffer.length / chunkSize);
        
        // Escrever arquivo
        fs.writeFileSync(installerPath, totalBuffer);
        
        // Simular progresso com chunks
        for (let i = 0; i <= chunkCount; i++) {
          const percent = Math.round((i / chunkCount) * 100);
          
          if (DEBUG && percent % 10 === 0) {
            console.log(`[UPDATER] Download (simulated): ${percent}%`);
          }

          const wins = BrowserWindow.getAllWindows();
          wins.forEach(win => {
            if (!win.isDestroyed()) {
              win.webContents.send('download-progress', {
                percent: Math.min(100, percent),
                transferred: Math.min(i * chunkSize, totalBuffer.length),
                total: totalBuffer.length
              });
            }
          });
          
          // Pequeno delay entre chunks para simular progresso
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }

      if (DEBUG) {
        console.log('');
        console.log('╔════════════════════════════════════════╗');
        console.log('║      ✅ DOWNLOAD COMPLETO!             ║');
        console.log('╚════════════════════════════════════════╝');
        console.log('[UPDATER] Arquivo baixado:', installerPath);
      }

      // Notificar que download completou
      const wins = BrowserWindow.getAllWindows();
      wins.forEach(win => {
        if (!win.isDestroyed()) {
          win.webContents.send('update-downloaded', {
            version: updateInfo.version,
            installerPath: installerPath
          });
        }
      });

      downloadInProgress = false;

    } catch (err) {
      downloadInProgress = false;
      if (DEBUG) console.error('[UPDATER] Download failed:', err.message);
      log.error('[UPDATER] Download error:', err);
      
      const wins = BrowserWindow.getAllWindows();
      wins.forEach(win => {
        if (!win.isDestroyed()) {
          win.webContents.send('update-error', { message: 'Erro ao fazer download: ' + err.message });
        }
      });
    }
  });

  ipcMain.on('install-and-update', (event, installerPath) => {
    if (DEBUG) console.log('[UPDATER] Installing update and restarting app');
    if (DEBUG) console.log('[UPDATER] Installer:', installerPath);
    
    try {
      if (!installerPath || !fs.existsSync(installerPath)) {
        if (DEBUG) console.error('[UPDATER] Arquivo de instalação não encontrado:', installerPath);
        event.reply('update-error', { message: 'Arquivo de instalação não encontrado' });
        return;
      }

      const { execFile } = require('child_process');
      
      // Fechar todas as janelas e aguardar
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) {
          win.destroy();
        }
      });

      // Executar o instalador com delay para permitir libertação completa do processo
      if (DEBUG) console.log('[UPDATER] Agendando execução do instalador em 5s...');
      log.info('[UPDATER] Agendando execução do instalador:', installerPath);
      
      try {
        if (DEBUG) console.log('[UPDATER] Executando instalador agora...');
        log.info('[UPDATER] Executando instalador:', installerPath);
        
        const appDataPath = app.getPath('appData');
        const bciPath = path.join(appDataPath, 'bci-admin-installers');
        if (!fs.existsSync(bciPath)) {
          fs.mkdirSync(bciPath, { recursive: true });
        }
        
        const fileName = path.basename(installerPath);
        const finalInstallerPath = path.join(bciPath, fileName);
        
        // Copiar arquivo
        try {
          fs.copyFileSync(installerPath, finalInstallerPath);
          log.info('[UPDATER] Arquivo copiado para:', finalInstallerPath);
        } catch (copyErr) {
          log.warn('[UPDATER] Não foi possível copiar:', copyErr.message);
        }
        
        // Criar script VBS para executar silenciosamente (sem console)
        const vbsPath = path.join(bciPath, 'run-installer.vbs');
        const installDir = path.join(appDataPath, '..', 'Local', 'Programs', 'BCI Admin'); // Diretório padrão
        const appExePath = path.join(installDir, 'BCI Admin.exe');
        const vbsContent = `Set objShell = CreateObject("WScript.Shell")
objShell.Run "${finalInstallerPath}" & " /S /D=" & "${installDir}", 0, True
WScript.Sleep 2000
objShell.Run "${appExePath}", 0, False`;
        
        fs.writeFileSync(vbsPath, vbsContent);
        log.info('[UPDATER] Script VBS criado:', vbsPath);
        log.info('[UPDATER] Instalador silencioso em:', installDir);
        log.info('[UPDATER] App será relançada em:', appExePath);
        
        // Executar o VBS script (roda silenciosamente sem mostrar console)
        const { exec } = require('child_process');
        exec(`cscript.exe "${vbsPath}"`, { windowsHide: true }, (err) => {
          if (err) {
            log.error('[UPDATER] Erro ao executar VBS:', err.message);
          }
        });

        // Sair imediatamente
        setTimeout(() => {
          if (DEBUG) console.log('[UPDATER] Saindo da app...');
          log.info('[UPDATER] App quit...');
          app.quit();
        }, 500);

      } catch (innerErr) {
        if (DEBUG) console.error('[UPDATER] Erro ao executar instalador:', innerErr);
        log.error('[UPDATER] Erro ao executar instalador:', innerErr);
        event.reply('update-error', { message: 'Erro ao iniciar instalador: ' + innerErr.message });
      }

    } catch (e) {
      if (DEBUG) console.error('[UPDATER] Install error:', e);
      log.error('[UPDATER] Install error:', e);
      event.reply('update-error', { message: 'Erro ao instalar atualização: ' + e.message });
    }
  });
}

// Check for updates (delayed start to avoid startup impact)
function checkForUpdates() {
  const checkInterval = DEBUG ? 5 * 60 * 1000 : 60 * 60 * 1000; // 5min em dev, 1h em prod
  
  const performCheck = async () => {
    try {
      if (DEBUG) {
        console.log('');
        console.log('[UPDATER] ⏳ Iniciando verificação de updates...');
        console.log('[UPDATER] Versão local:', autoUpdater.currentVersion?.version || '?');
      }
      
      // Tentar usar backend (mais seguro)
      await checkForUpdatesViaBackend();
      
    } catch (e) {
      if (DEBUG) console.error('[UPDATER] Check failed:', e.message);
      log.error('[UPDATER] Check failed:', e);
    }
  };
  
  // Initial check (delayed)
  setTimeout(performCheck, 5 * 1000); // 5 seconds after startup
  
  // Periodic checks in DEBUG mode
  if(DEBUG)
  setInterval(performCheck, checkInterval);
}

module.exports = {
  setupUpdateHandlers,
  checkForUpdates,
  simulateUpdateAvailable
};

// Testing helper - simulates update available (DEV ONLY)
function simulateUpdateAvailable() {
  if (DEBUG) {
    console.log('');
    console.log('[UPDATER] 🧪 Simulando update disponível...');
  }
  const wins = BrowserWindow.getAllWindows();
  wins.forEach(win => {
    if (!win.isDestroyed()) {
      win.webContents.send('update-available', { version: '1.0.1-test' });
    }
  });
}
