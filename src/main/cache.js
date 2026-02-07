// Admin Frontend API cache module with hash-based validation
const ElectronStorage = require('../../js/storage');
const { API_CONFIG, DEBUG } = require('./config');
const crypto = require('crypto');

const STORAGE_PREFIX = API_CONFIG.STORAGE_PREFIX;
const HASHES_CACHE_KEY = 'admin-api-hashes-cache';
const HASHES_TTL = 5 * 60 * 1000; // Cache hashes por 5 minutos

// Exponential backoff configuration
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000, // 1s
  maxDelay: 10000  // 10s
};

// Offline request queue
let offlineQueue = [];
let isOnline = true;
let apiHashes = null;
let hashesLastFetched = 0;

/**
 * Busca hashes dos ficheiros da API
 */
async function fetchHashesFromAPI() {
  try {
    const now = Date.now();
    const cachedHashes = ElectronStorage.getItem(HASHES_CACHE_KEY);
    
    // Se tem cache de hashes e é recente, usa
    if (cachedHashes && cachedHashes.fetchedAt && (now - cachedHashes.fetchedAt < HASHES_TTL)) {
      DEBUG && console.log('[HASHES] Usando cache de hashes');
      return cachedHashes.data;
    }
    
    const url = `${API_CONFIG.BASE_URL}/api/hashes`;
    DEBUG && console.log('[HASHES] Buscando hashes da API...');
    
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    
    const result = await resp.json();
    if (result.success && result.data) {
      const hashData = {
        data: result.data,
        fetchedAt: now
      };
      ElectronStorage.setItem(HASHES_CACHE_KEY, hashData);
      DEBUG && console.log('[HASHES] ✓ Hashes carregados:', result.data.version);
      return result.data;
    }
    
    return null;
  } catch (e) {
    DEBUG && console.error('[HASHES] Erro ao buscar hashes:', e.message);
    // Retorna hashes em cache mesmo se antigos
    const cachedHashes = ElectronStorage.getItem(HASHES_CACHE_KEY);
    return cachedHashes?.data || null;
  }
}

/**
 * Calcula hash SHA-256 de um conteúdo (primeiros 16 chars)
 */
function calculateHash(content) {
  if (!content) return null;
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  return hash.substring(0, 16); // Primeiros 16 caracteres para maior segurança
}

/**
 * Valida se o ficheiro mudou comparando hashes
 */
function validateFileHash(filePath, content) {
  if (!apiHashes || !apiHashes.assets) {
    return true; // Se não tem hashes, assume que é válido
  }
  
  const expectedHash = apiHashes.assets[filePath];
  if (!expectedHash) {
    DEBUG && console.log('[HASH] Ficheiro não encontrado na lista de hashes:', filePath);
    return true; // Ficheiro novo ou não mapeado
  }
  
  const actualHash = calculateHash(content);
  const isValid = actualHash === expectedHash;
  
  if (!isValid) {
    DEBUG && console.log(`[HASH] ❌ Hash mismatch para ${filePath}: esperado ${expectedHash}, obtido ${actualHash}`);
  } else {
    DEBUG && console.log(`[HASH] ✓ Hash válido para ${filePath}`);
  }
  
  return isValid;
}

/**
 * Fetch a file from the Admin Frontend API with hash-based validation
 */
async function apiFetchWithCache(pathRel, basePath, ttl) {
  const key = STORAGE_PREFIX + pathRel;
  const cached = ElectronStorage.getItem(key);
  const now = Date.now();
  
  const filePath = `${basePath}${pathRel}`;
  // Adicionar versioning ao URL para invalidar cache em crítico
  const versionParam = `?v=${API_CONFIG.CACHE_BUSTER}`;
  const url = `${API_CONFIG.BASE_URL}${API_CONFIG.FILES_ENDPOINT}/${filePath}${versionParam}`;

  // Validate URL before fetching
  const security = require('./security');
  if (!security.isUrlSafe(url)) {
    throw new Error(`Unsafe URL blocked: ${url}`);
  }

  // Buscar hashes se não tem
  if (!apiHashes) {
    apiHashes = await fetchHashesFromAPI();
  }

  // Validar cache usando APENAS hashes (não TTL!)
  if (cached && cached.content && apiHashes) {
    const filePathForHash = filePath.startsWith('/') ? filePath.substring(1) : filePath;
    if (validateFileHash(filePathForHash, cached.content)) {
      DEBUG && console.log(`[STORAGE] ✓ Carregado: ${key} (hash: ${cached.hash})`);
      DEBUG && console.log(`[API CACHE HIT] ${pathRel} (hash válido)`);
      return cached;
    } else {
      DEBUG && console.log(`[STORAGE] ❌ Hash inválido: ${key}, recarregando...`);
      DEBUG && console.log(`[API CACHE INVALID] ${pathRel} (hash mudou, recarregando)`);
    }
  }

  DEBUG && console.log(`[API FETCH] ${url}`);

  const doFetch = async (retryCount = 0) => {
    try {
      const headers = {};
      
      // Add ETag if we have one cached
      if (cached && cached.etag) {
        headers['If-None-Match'] = cached.etag;
      }
      
      const resp = await fetch(url, { headers });
      
      // Handle 304 Not Modified
      if (resp.status === 304 && cached) {
        cached.fetchedAt = now;
        ElectronStorage.setItem(key, cached);
        DEBUG && console.log(`[STORAGE] ✓ Guardado (304): ${key}`);
        DEBUG && console.log(`[API CACHE HIT] ${pathRel} (304 Not Modified)`);
        
        // Track cache hit
        try {
          const metrics = require('./metrics');
          metrics.trackCacheHit(true);
        } catch (e) {}
        
        return cached;
      }
      
      if (resp.ok) {
        const text = await resp.text();
        const etag = resp.headers.get('etag');
        const payload = { 
          content: text, 
          etag, 
          fetchedAt: now,
          hash: calculateHash(text) // Guarda hash para validação
        };
        ElectronStorage.setItem(key, payload);
        DEBUG && console.log(`[STORAGE] ✓ Guardado: ${key} (hash: ${payload.hash})`);
        DEBUG && console.log(`[API SUCCESS] ${pathRel} (${text.length} bytes, hash: ${payload.hash})`);
        
        // Track cache miss
        try {
          const metrics = require('./metrics');
          metrics.trackCacheHit(false);
        } catch (e) {}
        
        return payload;
      }
      
      // Handle errors
      if (resp.status === 404) {
        throw new Error(`File not found: ${pathRel}`);
      }
      
      if (resp.status === 429) {
        throw new Error('Rate limit exceeded. Please try again later.');
      }
      
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      
    } catch (err) {
      // Exponential backoff retry with jitter
      if (retryCount < RETRY_CONFIG.maxRetries) {
        const delay = Math.min(
          RETRY_CONFIG.baseDelay * Math.pow(2, retryCount) + Math.random() * 1000,
          RETRY_CONFIG.maxDelay
        );
        DEBUG && console.log(`[RETRY ${retryCount + 1}/${RETRY_CONFIG.maxRetries}] ${pathRel} after ${Math.round(delay)}ms - ${err.message}`);
        await new Promise(r => setTimeout(r, delay));
        return doFetch(retryCount + 1);
      }
      
      DEBUG && console.error(`[API ERROR] ${pathRel}:`, err);
      
      // Return cached version if available (even if expired)
      if (cached && cached.content) {
        console.warn(`[API FALLBACK] Using stale cache for ${pathRel}`);
        return cached;
      }
      
      // If all retries failed and offline, queue the request
      if (!isOnline) {
        DEBUG && console.log(`[OFFLINE QUEUE] Adding ${pathRel} to queue`);
        offlineQueue.push({ pathRel, basePath, ttl });
      }
      
      throw err;
    }
  };
  return doFetch();
}

// IPC handler to fetch page content with cache
function handleFetch(event, pathRel, ttl) {
  const effectiveTTL = ttl || API_CONFIG.PAGE_TTL;
  return apiFetchWithCache(pathRel, 'pages/', effectiveTTL);
}

// IPC handler to fetch assets (path already includes 'assets/' prefix)
function handleFetchAsset(event, pathRel, ttl) {
  const effectiveTTL = ttl || API_CONFIG.ASSET_TTL;
  // Don't add prefix - pathRel already contains full path like 'assets/js/utils.js'
  return apiFetchWithCache(pathRel, '', effectiveTTL);
}

// IPC handler to clear cache for a specific file
function handleClear(event, pathRel) {
  ElectronStorage.removeItem(STORAGE_PREFIX + pathRel);
}

// IPC handler to clear all cache
function handleClearAll() {
  Object.keys(ElectronStorage.data)
    .filter(k => k.startsWith(STORAGE_PREFIX))
    .forEach(k => ElectronStorage.removeItem(k));
}

/**
 * List CSS files under assets/css from the Admin Frontend API.
 */
async function listCssFiles() {
  try {
    DEBUG && console.log('[assets:listCss] fetching from Admin Frontend API...');
    const apiUrl = `${API_CONFIG.BASE_URL}/api/list`;
    
    const resp = await fetch(apiUrl);
    if (resp && resp.ok) {
      const data = await resp.json();
      if (data && data.success && Array.isArray(data.files)) {
        // Filter CSS files from assets/css/
        const cssFiles = data.files
          .filter(f => f.startsWith('assets/css/') && f.endsWith('.css'))
          .map(f => f.replace('assets/css/', ''));
        DEBUG && console.log('[assets:listCss] ✓ API success:', cssFiles);
        return cssFiles;
      }
    }
    console.warn('[assets:listCss] ✗ API failed with status', resp?.status);
    return [];
  } catch (e) {
    console.error('[assets:listCss] error:', e.message);
    return [];
  }
}

/**
 * List JS files under assets/js from the Admin Frontend API.
 */
async function listJsFiles() {
  try {
    DEBUG && console.log('[assets:listJs] fetching from Admin Frontend API...');
    const apiUrl = `${API_CONFIG.BASE_URL}/api/list`;
    
    const resp = await fetch(apiUrl);
    if (resp && resp.ok) {
      const data = await resp.json();
      if (data && data.success && Array.isArray(data.files)) {
        // Filter JS files from assets/js/
        const jsFiles = data.files
          .filter(f => f.startsWith('assets/js/') && f.endsWith('.js'))
          .map(f => f.replace('assets/js/', ''));
        DEBUG && console.log('[assets:listJs] ✓ API success:', jsFiles);
        return jsFiles;
      }
    }
    console.warn('[assets:listJs] ✗ API failed with status', resp?.status);
    return [];
  } catch (e) {
    console.error('[assets:listJs] error:', e.message);
    return [];
  }
}

// Clean old cache entries (remove entries older than MAX_CACHE_AGE)
function cleanOldCache() {
  const now = Date.now();
  const keys = Object.keys(ElectronStorage.data).filter(k => k.startsWith(API_CONFIG.STORAGE_PREFIX));
  let cleaned = 0;
  keys.forEach(k => {
    const item = ElectronStorage.getItem(k);
    if (item && item.fetchedAt && (now - item.fetchedAt > API_CONFIG.MAX_CACHE_AGE)) {
      ElectronStorage.removeItem(k);
      cleaned++;
    }
  });
  DEBUG && cleaned > 0 && console.log(`[CACHE CLEANUP] Removed ${cleaned} old entries`);
}

// Set online/offline status
function setOnlineStatus(online) {
  const wasOffline = !isOnline;
  isOnline = online;
  
  DEBUG && console.log(`[NETWORK] Status changed: ${online ? 'ONLINE' : 'OFFLINE'}`);
  
  // Process offline queue when coming back online
  if (online && wasOffline && offlineQueue.length > 0) {
    processOfflineQueue();
  }
}

// Process offline queue
async function processOfflineQueue() {
  if (offlineQueue.length === 0) return;
  
  DEBUG && console.log(`[OFFLINE QUEUE] Processing ${offlineQueue.length} queued requests`);
  
  const queue = [...offlineQueue];
  offlineQueue = [];
  
  for (const { pathRel, basePath, ttl } of queue) {
    try {
      await apiFetchWithCache(pathRel, basePath, ttl);
      DEBUG && console.log(`[OFFLINE QUEUE] ✓ Synced ${pathRel}`);
    } catch (err) {
      DEBUG && console.log(`[OFFLINE QUEUE] ✗ Failed to sync ${pathRel}:`, err.message);
    }
  }
  
  DEBUG && console.log('[OFFLINE QUEUE] Sync complete');
}

// Preload frequently accessed admin pages
async function preloadFrequentPages() {
  const frequentPages = ['dashboard', 'users', 'transactions'];
  
  DEBUG && console.log('[CACHE] Preloading frequent admin pages...');
  
  for (const page of frequentPages) {
    try {
      await apiFetchWithCache(`${page}/index.html`, 'pages/', API_CONFIG.PAGE_TTL);
      await apiFetchWithCache(`${page}/styles.css`, 'pages/', API_CONFIG.PAGE_TTL);
      DEBUG && console.log(`[CACHE] ✓ Preloaded ${page}`);
    } catch (err) {
      DEBUG && console.log(`[CACHE] ✗ Failed to preload ${page}:`, err.message);
    }
  }
}

// Referências para cleanup dos intervals
let backgroundSyncInterval = null;
let hashRefreshInterval = null;

// Background cache refresh (updates cache without blocking)
function startBackgroundSync() {
  // Clear existing interval if any
  if (backgroundSyncInterval) {
    clearInterval(backgroundSyncInterval);
  }
  
  // Refresh cache every 30 minutes
  backgroundSyncInterval = setInterval(async () => {
    if (!isOnline) return;
    
    DEBUG && console.log('[BACKGROUND SYNC] Starting cache refresh...');
    
    try {
      // Refresh CSS/JS assets
      const cssFiles = await listCssFiles();
      const jsFiles = await listJsFiles();
      
      for (const file of cssFiles) {
        await apiFetchWithCache(`css/${file}`, 'assets/', API_CONFIG.ASSET_TTL);
      }
      
      for (const file of jsFiles) {
        await apiFetchWithCache(`js/${file}`, 'assets/', API_CONFIG.ASSET_TTL);
      }
      
      DEBUG && console.log('[BACKGROUND SYNC] Cache refresh complete');
    } catch (err) {
      DEBUG && console.log('[BACKGROUND SYNC] Error:', err.message);
    }
  }, 30 * 60 * 1000); // 30 minutes
  
  DEBUG && console.log('[BACKGROUND SYNC] Background sync started (30min interval)');
}

/**
 * Inicia refresh periódico de hashes
 */
function startHashRefresh() {
  // Clear existing interval if any
  if (hashRefreshInterval) {
    clearInterval(hashRefreshInterval);
  }
  
  // Busca hashes a cada 5 minutos
  hashRefreshInterval = setInterval(async () => {
    DEBUG && console.log('[HASHES] Iniciando refresh periódico...');
    apiHashes = await fetchHashesFromAPI();
  }, 5 * 60 * 1000);
}

/**
 * Para todos os intervals para cleanup graceful
 */
function stopAllIntervals() {
  if (backgroundSyncInterval) {
    clearInterval(backgroundSyncInterval);
    backgroundSyncInterval = null;
    DEBUG && console.log('[CACHE] Background sync stopped');
  }
  if (hashRefreshInterval) {
    clearInterval(hashRefreshInterval);
    hashRefreshInterval = null;
    DEBUG && console.log('[CACHE] Hash refresh stopped');
  }
}

module.exports = {
  handleFetch,
  handleFetchAsset,
  handleClear,
  handleClearAll,
  listCssFiles,
  listJsFiles,
  cleanOldCache,
  setOnlineStatus,
  preloadFrequentPages,
  startBackgroundSync,
  startHashRefresh,
  stopAllIntervals,
  fetchHashesFromAPI
};
