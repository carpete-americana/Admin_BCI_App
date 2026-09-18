
let DEBUG = false;

(async () => {
  try {
    DEBUG = await window.electronAPI.getDebugMode();
  } catch (e) {
    console.warn('Could not load DEBUG mode');
  }
})();

window.electronAPI.onUpdateAvailable((data) => {
  DEBUG && console.log('[ADMIN-UPDATE] Update available:', data);
  const badge = document.getElementById('update-badge');
  if (!badge) return;
  badge.style.display = 'block';
  setTimeout(() => {
    badge.classList.add('show');
  }, 100);
});

document.getElementById('download-update')?.addEventListener('click', () => {
  DEBUG && console.log('[ADMIN-UPDATE] Starting download');
  document.getElementById('download-progress-container').style.display = 'block';
  
  document.getElementById('download-update').style.display = 'none';
  
  window.electronAPI.downloadUpdate();
});

window.electronAPI.onDownloadProgress((progress) => {
  const percent = Math.round(progress.percent);
  DEBUG && console.log('[ADMIN-UPDATE] Download progress:', percent + '%');
  const bar = document.getElementById('download-progress-bar');
  const text = document.getElementById('progress-text');
  if (bar) bar.style.width = `${percent}%`;
  if (text) text.innerText = `${percent}%`;
});

let currentUpdateInfo = null;

window.electronAPI.onUpdateDownloaded((info) => {
  DEBUG && console.log('[ADMIN-UPDATE] Update downloaded:', info);
  currentUpdateInfo = info;
  const bar = document.getElementById('download-progress-bar');
  const text = document.getElementById('progress-text');
  const infoText = document.getElementById('progress-info-text');
  if (bar) bar.style.width = '100%';
  if (text) text.innerText = '100%';
  if (infoText) infoText.innerText = 'Atualização pronta!';
  
  setTimeout(() => {
    const restartBtn = document.getElementById('restart-button');
    if (!restartBtn) return;
    restartBtn.style.display = 'flex';
    setTimeout(() => {
      restartBtn.style.opacity = '1';
    }, 50);
  }, 1000);
});

window.electronAPI.onUpdateError((error) => {
  DEBUG && console.error('[ADMIN-UPDATE] Error:', error);
  const infoText = document.getElementById('progress-info-text');
  const container = document.getElementById('download-progress-container');
  if (infoText) infoText.innerText = 'Erro ao atualizar: ' + error.message;
  if (container) container.style.display = 'block';
});

(async () => {
  try {
    const version = await window.electronAPI.getVersion();
    const badge = document.getElementById('appVersionBadge');
    if (badge && version) badge.textContent = `v${version}`;
  } catch (e) {
    console.warn('Could not load app version');
  }
})();

document.getElementById('restart-button')?.addEventListener('click', () => {
  const btn = document.getElementById('restart-button');
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
  DEBUG && console.log('[ADMIN-UPDATE] Installing update and restarting');
  
  setTimeout(() => {
    if (currentUpdateInfo && currentUpdateInfo.installerPath) {
      window.electronAPI.installAndUpdate(currentUpdateInfo.installerPath);
    } else {
      console.error('[ADMIN-UPDATE] Installer path not available');
      window.electronAPI.installAndUpdate();
    }
  }, 1500);
});
