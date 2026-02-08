// Content Security Policy configuration - Admin App
const { DEBUG } = require('./config');

// CSP directives for security
const CSP_DIRECTIVES = {
  'default-src': ["'self'"],
  'script-src': [
    "'self'",
    "'unsafe-inline'", // Required for inline scripts in HTML
    "'unsafe-eval'", // Required for dynamic imports
    "https://cdn.jsdelivr.net",
    "blob:" // Required for blob URLs (dynamic JS loading)
  ],
  'style-src': [
    "'self'",
    "'unsafe-inline'", // Required for inline styles
    "https://fonts.googleapis.com",
    "https://cdnjs.cloudflare.com"
  ],
  'img-src': [
    "'self'",
    "data:",
    "blob:",
    "https:",
    "https://bcibizz.pt"
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
  'frame-src': ["blob:"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"]
};

// Build CSP header string
function buildCSPHeader() {
  return Object.entries(CSP_DIRECTIVES)
    .map(([directive, values]) => `${directive} ${values.join(' ')}`)
    .join('; ');
}

// Setup CSP headers for all requests
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

// Validate URLs before fetching
function isUrlSafe(url) {
  try {
    const urlObj = new URL(url);
    
    // Allow localhost (any port) for development and testing
    if (urlObj.hostname === 'localhost' || urlObj.hostname === '127.0.0.1' || urlObj.hostname === '0.0.0.0') {
      DEBUG && console.log('[SECURITY] Localhost URL allowed:', url);
      return true;
    }
    
    // Allow only HTTPS for remote URLs
    if (urlObj.protocol !== 'https:') {
      DEBUG && console.warn('[SECURITY] Blocked non-HTTPS URL:', url);
      return false;
    }
    
    // Whitelist of allowed domains
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
