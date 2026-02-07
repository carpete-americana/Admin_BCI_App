// Network status banner utilities - Admin App
export function showOfflineBanner() {
  if (document.getElementById('offline-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'offline-banner';
  banner.style.position = 'fixed';
  banner.style.top = '0';
  banner.style.left = '0';
  banner.style.right = '0';
  banner.style.zIndex = '9999';
  banner.style.background = '#b71c1c';
  banner.style.color = '#fff';
  banner.style.padding = '10px 16px';
  banner.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, sans-serif';
  banner.style.fontSize = '14px';
  banner.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)';
  banner.textContent = 'Sem ligação à internet. Liga-te e tenta novamente.';
  document.body.appendChild(banner);
}

export function hideOfflineBanner() {
  const banner = document.getElementById('offline-banner');
  if (banner) banner.remove();
}
