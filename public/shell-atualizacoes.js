let DEBUG = false;

(async () => {
  try {
    DEBUG = await window.electronAPI.getDebugMode();
  } catch (e) {
    console.warn('Could not load DEBUG mode');
  }
})();

// O updater descarrega sozinho assim que vê a versão nova: o cartão só mostra o estado.
// «Descarregar» só aparece depois de um erro, para tentar outra vez; «Reiniciar» só com o instalador pronto.
const el = (id) => document.getElementById(id);
let currentUpdateInfo = null;

function mostrarCartao() {
  const badge = el('update-badge');
  if (!badge) return;
  badge.style.display = 'block';
  setTimeout(() => badge.classList.add('show'), 100);
}

function estado(nome, { titulo, info, percent } = {}) {
  const botaoDescarregar = el('download-update');
  const progresso = el('download-progress-container');
  const reiniciar = el('restart-button');
  if (titulo && el('update-title')) el('update-title').textContent = titulo;
  if (info && el('progress-info-text')) el('progress-info-text').textContent = info;
  if (percent != null) {
    if (el('download-progress-bar')) el('download-progress-bar').style.width = `${percent}%`;
    if (el('progress-text')) el('progress-text').textContent = `${percent}%`;
  }
  if (botaoDescarregar) botaoDescarregar.style.display = nome === 'erro' ? '' : 'none';
  if (progresso) progresso.style.display = 'block';
  if (reiniciar) {
    reiniciar.style.display = nome === 'pronta' ? 'flex' : 'none';
    reiniciar.style.opacity = '0';
    if (nome === 'pronta') setTimeout(() => { reiniciar.style.opacity = '1'; }, 50);
  }
}

window.electronAPI.onUpdateAvailable((data) => {
  DEBUG && console.log('[ADMIN-UPDATE] Update available:', data);
  const versao = data?.version ? ` (v${data.version})` : '';
  estado('a-descarregar', { titulo: `Nova atualização${versao}`, info: 'A descarregar…', percent: 0 });
  mostrarCartao();
});

el('download-update')?.addEventListener('click', () => {
  DEBUG && console.log('[ADMIN-UPDATE] Retrying download');
  estado('a-descarregar', { info: 'A descarregar…', percent: 0 });
  window.electronAPI.downloadUpdate();
});

window.electronAPI.onDownloadProgress((progress) => {
  const percent = Math.round(progress.percent) || 0;
  DEBUG && console.log('[ADMIN-UPDATE] Download progress:', percent + '%');
  estado('a-descarregar', { percent });
});

window.electronAPI.onUpdateDownloaded((info) => {
  DEBUG && console.log('[ADMIN-UPDATE] Update downloaded:', info);
  currentUpdateInfo = info;
  const versao = info?.version ? ` (v${info.version})` : '';
  estado('pronta', { titulo: `Atualização pronta${versao}`, info: 'Instala-se sozinha quando não estiveres a usar a app.', percent: 100 });
  mostrarCartao();
});

window.electronAPI.onUpdateError((error) => {
  DEBUG && console.error('[ADMIN-UPDATE] Error:', error);
  // Também falha a instalação: o processo principal esquece o instalador, e «Descarregar» volta a buscá-lo.
  currentUpdateInfo = null;
  estado('erro', { info: error?.message || 'Não foi possível atualizar' });
  mostrarCartao();
});

(async () => {
  try {
    const version = await window.electronAPI.getVersion();
    const badge = el('appVersionBadge');
    if (badge && version) badge.textContent = `v${version}`;
  } catch (e) {
    console.warn('Could not load app version');
  }
})();

el('restart-button')?.addEventListener('click', () => {
  const btn = el('restart-button');
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
  DEBUG && console.log('[ADMIN-UPDATE] Installing update and restarting');
  // O caminho é ignorado no processo principal: só corre o instalador descarregado nesta sessão.
  setTimeout(() => window.electronAPI.installAndUpdate(currentUpdateInfo?.installerPath), 1500);
});
