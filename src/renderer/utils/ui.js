// UI utilities - Admin App
export function showLoading() {
  if (document.getElementById('loading-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'loading-overlay';
  overlay.innerHTML = '<div class="spinner"></div>';
  document.body.appendChild(overlay);
}

export function hideLoading() {
  const overlay = document.getElementById('loading-overlay');
  if (overlay) overlay.remove();
}

export function showErrorPage(error, route) {
  const mainContent = document.getElementById('main-content');
  if (!mainContent) return;
  mainContent.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;padding:40px;text-align:center;font-family:'Inter',system-ui,sans-serif">
      <i class="fas fa-exclamation-triangle" style="font-size:3rem;color:#ef4444;margin-bottom:20px"></i>
      <h2 style="color:#f1f1f4;margin:0 0 8px">Erro ao carregar página</h2>
      <p style="color:#6b6b7a;margin:0 0 20px;max-width:400px">${route ? `Não foi possível carregar "${route}".` : 'Ocorreu um erro inesperado.'}</p>
      <p style="color:#6b6b7a;font-size:0.8rem;margin:0 0 20px">${error?.message || ''}</p>
      <button onclick="window.location.reload()" style="background:#6366f1;color:#fff;border:none;padding:10px 24px;border-radius:8px;cursor:pointer;font-size:0.9rem">
        <i class="fas fa-sync-alt"></i> Recarregar
      </button>
    </div>
  `;
}

export function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = 'notification';
  notification.style.position = 'fixed';
  notification.style.top = '20px';
  notification.style.right = '20px';
  notification.style.padding = '12px 20px';
  notification.style.borderRadius = '6px';
  notification.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, sans-serif';
  notification.style.fontSize = '14px';
  notification.style.zIndex = '10001';
  notification.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
  notification.style.animation = 'slideIn 0.3s ease-out';

  const colors = {
    info: { bg: '#e3f2fd', text: '#1565c0' },
    success: { bg: '#e8f5e9', text: '#2e7d32' },
    warning: { bg: '#fff3e0', text: '#ef6c00' },
    error: { bg: '#ffebee', text: '#c62828' }
  };

  const color = colors[type] || colors.info;
  notification.style.background = color.bg;
  notification.style.color = color.text;
  notification.textContent = message;

  const style = document.createElement('style');
  style.textContent = '@keyframes slideIn{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}';
  notification.appendChild(style);

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease-in forwards';
    const outStyle = document.createElement('style');
    outStyle.textContent = '@keyframes slideOut{from{transform:translateX(0);opacity:1}to{transform:translateX(100%);opacity:0}}';
    notification.appendChild(outStyle);
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

export function updateTitle(pageTitle) {
  document.title = pageTitle ? `${pageTitle} | BCi Admin` : 'BCi Admin';
}

export function formatDate(dateString) {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleDateString('pt-PT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function formatCurrency(value) {
  if (value === null || value === undefined) return '-';
  return new Intl.NumberFormat('pt-PT', {
    style: 'currency',
    currency: 'EUR'
  }).format(value);
}

export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

export function throttle(func, limit) {
  let inThrottle;
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}
