const { DEBUG } = require('./config');

const CSP_DIRECTIVES = {
  'default-src': ["'self'"],
  // Sem 'unsafe-inline': o token está em localStorage, e um script injetado levaria a sessão.
  // Um atributo de evento ou um <script> inline deixa de correr; a consola indica qual.
  'script-src': [
    "'self'",
    "'unsafe-eval'", // import() dinamico das paginas
    "https://cdn.jsdelivr.net",
    "blob:" // as paginas sao importadas como modulos a partir de blobs
  ],
  // 'unsafe-inline' ainda é necessário no style-src: há atributos style= e blocos <style> por converter.
  'style-src': [
    "'self'",
    "'unsafe-inline'",
    "https://fonts.googleapis.com",
    "https://cdnjs.cloudflare.com"
  ],
  'img-src': [
    "'self'",
    "data:",
    "blob:",
    "https:",
    "https://bcibizz.pt",
    // Admin Frontend API em produção (verificação de estado na página Estado do Sistema).
    "https://admin.bcibizz.pt"
  ],
  'font-src': [
    "'self'",
    "https://fonts.gstatic.com",
    "https://cdnjs.cloudflare.com"
  ],
  'connect-src': [
    "'self'",
    "http://localhost:3000",  // Backend API (dev)
    "http://localhost:3002",  // Admin Frontend API (dev)
    "https://raw.githubusercontent.com",
    "https://api.github.com",
    "https://bcibizz.pt"
  ],
  'frame-src': ["blob:", "chrome-extension:"],
  'worker-src': ["blob:", "https://cdn.jsdelivr.net"],
  'object-src': ["blob:"],
  'base-uri': ["'self'"]
};

function buildCSPHeader() {
  return Object.entries(CSP_DIRECTIVES)
    .map(([directive, values]) => `${directive} ${values.join(' ')}`)
    .join('; ');
}

function setupCSP(session) {
  const cspHeader = buildCSPHeader();
  
  session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [cspHeader]
      }
    });
  });
  
  DEBUG && console.log('[SECURITY] CSP headers configured');
}

function isUrlSafe(url) {
  try {
    const urlObj = new URL(url);
    
    if (urlObj.hostname === 'localhost' || urlObj.hostname === '127.0.0.1' || urlObj.hostname === '0.0.0.0') {
      DEBUG && console.log('[SECURITY] Localhost URL allowed:', url);
      return true;
    }
    
    if (urlObj.protocol !== 'https:') {
      DEBUG && console.warn('[SECURITY] Blocked non-HTTPS URL:', url);
      return false;
    }
    
    const allowedDomains = [
      'raw.githubusercontent.com',
      'api.github.com',
      'bcibizz.pt',
      'fonts.googleapis.com',
      'fonts.gstatic.com',
      'cdnjs.cloudflare.com',
      'cdn.jsdelivr.net'
    ];
    
    const isAllowed = allowedDomains.some(domain => 
      urlObj.hostname === domain || urlObj.hostname.endsWith('.' + domain)
    );
    
    if (!isAllowed) {
      DEBUG && console.warn('[SECURITY] Blocked non-whitelisted domain:', urlObj.hostname);
      return false;
    }
    
    return true;
  } catch (e) {
    DEBUG && console.warn('[SECURITY] Invalid URL:', url, e.message);
    return false;
  }
}

module.exports = {
  setupCSP,
  isUrlSafe,
  buildCSPHeader
};
