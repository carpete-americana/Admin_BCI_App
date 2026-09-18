import { showLoading, hideLoading, showErrorPage } from './utils/ui.js';
import { showOfflineBanner, hideOfflineBanner } from './utils/network.js';
import { fetchWithCache, DEFAULT_TTL } from './utils/cache.js';

let Utils = null;
let DEBUG = false;
let routes = {};
export let currentPage = null;

window.addEventListener('error', (event) => {
  console.error('[GLOBAL ERROR]', event.message, event.filename, event.lineno);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[UNHANDLED REJECTION]', event.reason);
});

(async () => {
  try {
    DEBUG = await window.electronAPI.getDebugMode();
  } catch (e) {
    console.warn('Could not load DEBUG mode from main:', e.message);
  }
})();


async function injectCSSFromRoute(route) {
  const cssPath = `${route}/styles.css`;
  try {
    const res = await fetchWithCache(cssPath);
    document.querySelectorAll('[data-page-css]').forEach(n => n.remove());
    const style = document.createElement('style');
    style.setAttribute('data-page-css', route);
    style.textContent = res.content || '';
    document.head.appendChild(style);
  } catch (err) {
    console.warn('CSS load failed', err);
  }
}

async function loadAllAssetsCSS() {
  try {
    let list = null;
    if (window.electronAPI && typeof window.electronAPI.listAssetsCss === 'function') {
      try {
        list = await window.electronAPI.listAssetsCss();
      } catch (e) {
        console.warn('[loadAllAssetsCSS] listAssetsCss failed:', e.message);
      }
    }

    if (!list || !Array.isArray(list) || list.length === 0) {
      return;
    }

    const stylesToInsert = [];
    for (const filename of list) {
      if (!filename || typeof filename !== 'string') continue;
      const path = `assets/css/${filename}`;
      try {
        if (document.querySelector(`style[data-asset-css="${path}"]`)) {
          DEBUG && console.log(`[loadAllAssetsCSS] already injected ${path}`);
          continue;
        }
        const r = await window.githubCache.fetchAsset(path, DEFAULT_TTL);
        if (r && r.content) {
          const style = document.createElement('style');
          style.setAttribute('data-asset-css', path);
          style.textContent = r.content;
          stylesToInsert.push(style);
        } else {
          console.warn(`[loadAllAssetsCSS] empty content for ${path}`);
        }
      } catch (err) {
        console.warn(`[loadAllAssetsCSS] failed to load ${path}:`, err.message);
      }
    }
    
    if (stylesToInsert.length > 0) {
      const frag = document.createDocumentFragment();
      stylesToInsert.forEach(s => frag.appendChild(s));
      document.head.insertBefore(frag, document.head.firstChild);
    }
  } catch (err) {
    console.error('[loadAllAssetsCSS] error:', err);
  }
}

/* utils.js e api.js carregam primeiro. */
async function loadAllAssetsJS() {
  try {
    let names = [];
    if (window.electronAPI && typeof window.electronAPI.listAssetsJs === 'function') {
      try {
        names = await window.electronAPI.listAssetsJs();
      } catch (e) {
        console.warn('[loadAllAssetsJS] listAssetsJs failed:', e.message);
      }
    }
    if (!Array.isArray(names) || names.length === 0) return;

    const critical = ['utils.js', 'api.js'];
    const ordered = [...critical.filter(c => names.includes(c)), ...names.filter(n => !critical.includes(n))];

    for (const name of ordered) {
      const path = `assets/js/${name}`;
      try {
        const res = await window.githubCache.fetchAsset(path, DEFAULT_TTL);
        if (!res || !res.content) {
          console.warn('[loadAllAssetsJS] empty content for', path);
          continue;
        }
        const blob = new Blob([res.content], { type: 'text/javascript' });
        const url = URL.createObjectURL(blob);
        try {
          const mod = await import(/* @vite-ignore */ url);
          if (name.toLowerCase() === 'utils.js') {
            Utils = mod.default || mod.Utils || mod;
            window.Utils = Utils;
          } else if (name.toLowerCase() === 'api.js') {
            const API = mod.default || mod.API || mod;
            window.API = API;
          }
        } finally {
          URL.revokeObjectURL(url);
        }
      } catch (err) {
        console.warn('[loadAllAssetsJS] failed to load', path, err.message);
      }
    }
  } catch (err) {
    console.error('[loadAllAssetsJS] error:', err);
  }
}

/* Importa o script da página a partir de um blob, para funcionar como módulo. */
async function executePageScript(route) {
  const jsPath = `${route}/index.js`;
  try {
    const res = await fetchWithCache(jsPath);
    const content = res.content || '';
    if (!content.trim()) return;
    const blob = new Blob([content], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    try {
      const mod = await import(/* @vite-ignore */ url);
      if (mod && typeof mod.init === 'function') {
        await mod.init();
      }
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (err) {
    console.warn('Page script error', err);
  }
}

export async function loadPage(route) {
  if (!route) route = 'dashboard';
  if (route === currentPage) return;
  if (!routes[route]) route = 'dashboard';
  currentPage = route;
  
  const pageLoadStart = Date.now();
  
  try {
    showLoading();
    const htmlRes = await fetchWithCache(`${route}/index.html`);
    const html = htmlRes.content;
    if (!html) throw new Error('HTML vazio');
    document.getElementById('main-content').innerHTML = html;
    const meta = routes[route] || {};
    document.title = `${meta.title || route} | BCi Admin`;
    await injectCSSFromRoute(route);
    await executePageScript(route);
    if (window.updateActiveMenu) window.updateActiveMenu(route);
    
    if (window.updateGlobalUserInfo) await window.updateGlobalUserInfo();
    
    window.history.pushState({}, '', `#${route}`);
    
    if (window.electronAPI && window.electronAPI.trackPageLoad) {
      window.electronAPI.trackPageLoad(route, pageLoadStart);
    }
  } catch (err) {
    console.error('loadPage error', err);
    showErrorPage(err, route);
  } finally {
    await hideLoading();
  }
}

window.navigateTo = async (route) => {
  await hideLoading();
  
  if (window.electronAPI && window.electronAPI.trackFeature) {
    window.electronAPI.trackFeature(`navigate-${route}`);
  }
  
  loadPage(route);
};

document.addEventListener('DOMContentLoaded', async () => {
  // Registado antes do resto do arranque: o clique no tray pode chegar a qualquer momento.
  if (window.electronAPI && typeof window.electronAPI.onNavigateTo === 'function') {
    window.electronAPI.onNavigateTo((route) => {
      if (route) window.navigateTo(route);
    });
  }

  if (window.electronAPI && typeof window.electronAPI.onCacheCleared === 'function') {
    window.electronAPI.onCacheCleared(() => {
      DEBUG && console.log('[CACHE] limpa pelo atalho');
    });
  }

  try {
    // Mudança de versão maior: limpa as caches.
    const currentVersion = await window.electronAPI.getVersion();
    const lastVersion = await window.electronStorage.getItem('admin-app-version');
    
    if (lastVersion && lastVersion.charAt(0) !== currentVersion.charAt(0)) {
      DEBUG && console.log('[VERSION] Major update detected, clearing all caches');
      await window.githubCache.clearAll();
      if (window.electronAPI && window.electronAPI.clearBrowserCache) {
        await window.electronAPI.clearBrowserCache();
      }
      await window.electronStorage.setItem('admin-app-version', currentVersion);
      DEBUG && console.log('[VERSION] Cache cleared, reloading...');
      window.location.reload();
      return;
    }
    
    if (!lastVersion) {
      await window.electronStorage.setItem('admin-app-version', currentVersion);
    }
    
    window.addEventListener('offline', () => {
      if (document.getElementById('offline-start-flag')) return;
      showOfflineBanner();
      
      if (window.electronAPI && window.electronAPI.trackFeature) {
        window.electronAPI.trackFeature('network-offline');
      }
    });
    
    window.addEventListener('online', () => {
      hideOfflineBanner();
      
      if (window.electronAPI && window.electronAPI.trackFeature) {
        window.electronAPI.trackFeature('network-online');
      }
    });

    if (!navigator.onLine) {
      hideOfflineBanner();
      try {
        window.location.replace('offline.html');
      } catch (e) {
        window.location.href = 'offline.html';
      }
      return;
    }

    showLoading();

    if (window.electronAPI && typeof window.electronAPI.checkServerStatus === 'function') {
      try {
        const serverAvailable = await window.electronAPI.checkServerStatus();
        if (!serverAvailable) {
          console.error('[INIT] Server is unavailable');
          hideLoading();
          try {
            window.location.replace('server-unavailable.html');
          } catch (e) {
            window.location.href = 'server-unavailable.html';
          }
          return;
        }
      } catch (e) {
        console.warn('[INIT] Could not check server status:', e.message);
      }
    }

    await loadAllAssetsJS().catch(e => console.warn('loadAllAssetsJS failed', e));

    // Se o Utils não carregou (por exemplo, limite de pedidos), tenta de novo uma vez.
    if (!Utils) {
      console.warn('[INIT] Utils not loaded, retrying in 2s...');
      await new Promise(r => setTimeout(r, 2000));
      await loadAllAssetsJS().catch(e => console.warn('loadAllAssetsJS retry failed', e));
    }

    const session = Utils ? await Utils.findSession(false) : null;
    if (!session) {
      try {
        showLoading();
        const htmlRes = await fetchWithCache('login/index.html');
        const html = htmlRes.content;
        if (!html) throw new Error('Login HTML vazio');

        try {
          const chromeSelectors = ['.sidebar', '.main-header', '#update-badge', '.profile-card', '#sidebar-menu'];
          chromeSelectors.forEach(sel => {
            document.querySelectorAll(sel).forEach(n => n.remove());
          });
        } catch (e) {
          DEBUG && console.warn('Could not remove chrome elements:', e.message);
        }

        await injectCSSFromRoute('login');
        
        document.body.innerHTML = html;
        document.title = 'Login | BCi Admin';
        
        await executePageScript('login');
        
        await hideLoading();
        
        requestAnimationFrame(() => {
          document.body.classList.add('ready');
        });

        setTimeout(() => {
          window.electronAPI.rendererReady && window.electronAPI.rendererReady();
        }, 150);
      } catch (err) {
        console.error('Failed to load login page from repo', err);
        await hideLoading();
        showErrorPage(err, 'login');
        document.body.style.opacity = '1';
        document.body.classList.add('ready');
        window.electronAPI.rendererReady && window.electronAPI.rendererReady();
      }
      return;
    }

    await loadAllAssetsCSS().catch(e => console.warn('loadAllAssetsCSS failed', e));

    // As rotas vêm da Admin Frontend API (sidebar.js).
    routes = window.adminRoutes || {};
    if (window.generateSidebarMenu) window.generateSidebarMenu();
    
    document.body.style.opacity = '0';
    
    const initialRoute = window.location.hash.substring(1) || 'dashboard';

    // Modo destacado: só o conteúdo da página, sem barra lateral nem cabeçalho.
    const isDetached = new URLSearchParams(window.location.search).get('detached') === 'true';
    if (isDetached) {
      document.querySelectorAll('.sidebar, .main-header, #update-badge').forEach(el => {
        el.style.display = 'none';
      });
      const mainContent = document.getElementById('main-content');
      if (mainContent) {
        mainContent.style.marginLeft = '0';
        mainContent.style.width = '100%';
        mainContent.style.height = '100vh';
      }
    }

    await loadPage(initialRoute);
    await Utils.notification();
    
    await hideLoading();
    
    requestAnimationFrame(() => {
      document.body.style.opacity = '1';
      document.body.classList.add('ready');
    });

    if (window.electronAPI && typeof window.electronAPI.rendererReady === 'function') {
      setTimeout(() => {
        window.electronAPI.rendererReady && window.electronAPI.rendererReady();
      }, 150);
    }
    
    window.addEventListener('popstate', () => {
      const r = window.location.hash.substring(1);
      loadPage(r);
    });
  } catch (err) {
    console.error('renderer init error', err);
    await hideLoading();
    showErrorPage(err, 'dashboard');
    // Garante o corpo visível no ecrã de erro (a opacidade pode estar a 0).
    document.body.style.opacity = '1';
    document.body.classList.add('ready');
    if (window.electronAPI && typeof window.electronAPI.rendererReady === 'function') {
      window.electronAPI.rendererReady();
    }
  }
});
