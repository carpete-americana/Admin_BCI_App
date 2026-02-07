// DEBUG: auto-detecção em desenvolvimento, forçado a false em produção
const DEBUG = false;

// Admin Frontend API configuration
const API_CONFIG = {
  BASE_URL: "https://admin.bcibizz.pt/frontend-api",
  FILES_ENDPOINT: "/files",
  API_ENDPOINT: "/api/file",
  STORAGE_PREFIX: "admin-api-cache:",
  // Cache is validated using hashes, not TTL
  PAGE_TTL: Infinity,                     // Infinito - usa hashes
  ASSET_TTL: Infinity,                    // Infinito - usa hashes
  CONFIG_TTL: Infinity,                   // Infinito - usa hashes
  MAX_CACHE_AGE: 90 * 24 * 60 * 60 * 1000, // 90 dias (limpeza de cache muito antigo)
  CACHE_BUSTER: "",                       // Sem versioning - usa hashes para validação
};

// Admin routes are now loaded from Frontend API via sidebar.js
// Access via window.adminRoutes in renderer after loadAllAssetsJS()

module.exports = {
  API_CONFIG,
  DEBUG
};
