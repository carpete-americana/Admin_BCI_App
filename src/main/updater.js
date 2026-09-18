const { autoUpdater } = require('electron-updater');
const { BrowserWindow, ipcMain } = require('electron');
const { DEBUG, API_CONFIG } = require('./config');
const log = require('electron-log');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.allowPrerelease = true;
autoUpdater.allowDowngrade = false;
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'debug';

autoUpdater.disableWebInstaller = false;

let updateInfo = null;
let downloadInProgress = false;
// Caminho do instalador descarregado por este processo: é o único que se executa.
let caminhoInstaladorDescarregado = null;

/** Verifica atualizações através do backend. */
async function checkForUpdatesViaBackend() {
  try {
    const apiUrl = `${API_CONFIG.BASE_URL}/check-update`;
    if (DEBUG) {
      console.log('[UPDATER] Checking for updates via backend:', apiUrl);
    }

    const response = await fetch(apiUrl);
    if (!response.ok) {
      // 429: limite de pedidos do servidor, não é erro.
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

    const latestVersion = data.latestVersion.replace(/^v/, '');
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
      const tempDir = path.join(app.getPath('temp'), 'bci-admin-update');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const installerPath = path.join(tempDir, winAsset.name);
      caminhoInstaladorDescarregado = installerPath;
      
      if (DEBUG) {
        console.log('[UPDATER] Iniciando download:', winAsset.downloadUrl);
        console.log('[UPDATER] Para:', installerPath);
      }

      const response = await fetch(winAsset.downloadUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const totalSize = parseInt(response.headers.get('content-length'), 10);
      let downloaded = 0;

      const fileStream = fs.createWriteStream(installerPath);
      
      try {
        const reader = response.body.getReader();
        
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) break;
          
          downloaded += value.length;
          const percent = Math.round((downloaded / totalSize) * 100);
          
          fileStream.write(Buffer.from(value));
          
          if (DEBUG && percent % 10 === 0) {
            console.log(`[UPDATER] Download: ${percent}%`);
          }

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
        
        await new Promise((resolve, reject) => {
          fileStream.on('finish', resolve);
          fileStream.on('error', reject);
        });
        
      } catch (streamErr) {
        // Alternativa sem stream: descarrega tudo e simula o progresso.
        const buffer = await response.arrayBuffer();
        const chunkSize = 1024 * 1024;
        const totalBuffer = Buffer.from(buffer);
        const chunkCount = Math.ceil(totalBuffer.length / chunkSize);
        
        fs.writeFileSync(installerPath, totalBuffer);
        
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

  ipcMain.on('install-and-update', (event) => {
    // O caminho vindo do renderer é ignorado: só se executa o instalador descarregado nesta sessão.
    const installerPath = caminhoInstaladorDescarregado;
    if (DEBUG) console.log('[UPDATER] Installing update and restarting app');
    if (DEBUG) console.log('[UPDATER] Installer:', installerPath);
    
    try {
      if (!installerPath || !fs.existsSync(installerPath)) {
        if (DEBUG) console.error('[UPDATER] Sem instalador descarregado nesta sessão:', installerPath);
        event.reply('update-error', { message: 'Arquivo de instalação não encontrado' });
        return;
      }

      const { execFile } = require('child_process');
      
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) {
          win.destroy();
        }
      });

      // Espera 5 s para o processo libertar os ficheiros antes de instalar.
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
        
        try {
          fs.copyFileSync(installerPath, finalInstallerPath);
          log.info('[UPDATER] Arquivo copiado para:', finalInstallerPath);
        } catch (copyErr) {
          log.warn('[UPDATER] Não foi possível copiar:', copyErr.message);
        }
        
        // Script VBS para correr o instalador sem janela de consola.
        const vbsPath = path.join(bciPath, 'run-installer.vbs');
        const installDir = path.join(appDataPath, '..', 'Local', 'Programs', 'BCI Admin');
        const appExePath = path.join(installDir, 'BCI Admin.exe');
        const vbsContent = `Set objShell = CreateObject("WScript.Shell")
objShell.Run "${finalInstallerPath}" & " /S /D=" & "${installDir}", 0, True
WScript.Sleep 2000
objShell.Run "${appExePath}", 0, False`;
        
        fs.writeFileSync(vbsPath, vbsContent);
        log.info('[UPDATER] Script VBS criado:', vbsPath);
        log.info('[UPDATER] Instalador silencioso em:', installDir);
        log.info('[UPDATER] App será relançada em:', appExePath);
        
        const { exec } = require('child_process');
        exec(`cscript.exe "${vbsPath}"`, { windowsHide: true }, (err) => {
          if (err) {
            log.error('[UPDATER] Erro ao executar VBS:', err.message);
          }
        });

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

function checkForUpdates() {
  const checkInterval = DEBUG ? 5 * 60 * 1000 : 60 * 60 * 1000; // 5 min em desenvolvimento, 1 h em produção
  
  const performCheck = async () => {
    try {
      if (DEBUG) {
        console.log('');
        console.log('[UPDATER] ⏳ Iniciando verificação de updates...');
        console.log('[UPDATER] Versão local:', autoUpdater.currentVersion?.version || '?');
      }
      
      await checkForUpdatesViaBackend();
      
    } catch (e) {
      if (DEBUG) console.error('[UPDATER] Check failed:', e.message);
      log.error('[UPDATER] Check failed:', e);
    }
  };
  
  setTimeout(performCheck, 5 * 1000);
  
  if(DEBUG)
  setInterval(performCheck, checkInterval);
}

module.exports = {
  setupUpdateHandlers,
  checkForUpdates,
  simulateUpdateAvailable
};

// Só para testes: simula uma atualização disponível.
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
