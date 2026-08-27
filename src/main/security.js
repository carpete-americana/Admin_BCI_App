// Content Security Policy configuration - Admin App
const { DEBUG } = require('./config');

// CSP directives for security
const CSP_DIRECTIVES = {
  'default-src': ["'self'"],
  // SEM 'unsafe-inline'.
  //
  // Era o que separava um XSS de uma tomada de conta: o token vive em
  // localStorage, portanto qualquer script arbitrario que corra aqui leva a
  // sessao inteira. Saiu depois de:
  //   - os ~470 handlers `onclick=` das paginas passarem a delegacao de
  //     eventos (assets/js/actions.js);
  //   - os blocos <script> inline deste shell irem para ficheiros
  //     (shell-tema.js, shell-atualizacoes.js, shell-ui.js).
  //
  // Nao ha meio termo: basta UM atributo de evento ou UM bloco inline voltar
  // para que tudo deixe de correr. Se algo parar de funcionar depois de
  // mexer no HTML, a consola diz exatamente qual foi.
  //
  // 'unsafe-eval' e blob: ficam: as paginas sao carregadas com import() de
  // URLs blob, que e como esta app sempre funcionou.
  'script-src': [
    "'self'",
    "'unsafe-eval'", // import() dinamico das paginas
    "https://cdn.jsdelivr.net",
    "blob:" // as paginas sao importadas como modulos a partir de blobs
  ],
  // 'unsafe-inline' AINDA CA ESTA no style-src, e e uma divida por pagar.
  //
  // Faltam 136 atributos `style="..."` (128 no painel admin, 6 no do
  // utilizador, 1 em cada shell) e 5 blocos <style>. So depois de todos
  // saírem e que esta diretiva pode ir atras da do script-src.
  //
  // Pesa menos do que a do script-src: um XSS que so consiga injetar CSS nao
  // rouba a sessao. Mas consegue esconder e falsificar o que esta no ecra —
  // num painel onde se aprovam levantamentos, isso nao e inofensivo.
  'style-src': [
    "'self'",
    "'unsafe-inline'", // 136 atributos style= + 5 blocos <style> por converter
    "https://fonts.googleapis.com",
    "https://cdnjs.cloudflare.com"
  ],
  'img-src': [
    "'self'",
    "data:",
    "blob:",
    "https:",
    "https://bcibizz.pt",
    // Admin Frontend API em producao. Faltava: o renderer nunca lhe tinha
    // chamado diretamente (as paginas vem pelo processo principal, que nao
    // passa por CSP), e a primeira vez que precisou — o health check da pagina
    // Estado do Sistema — nao estava ca.
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
