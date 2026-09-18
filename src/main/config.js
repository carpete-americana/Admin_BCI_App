const DEBUG = false;

const API_CONFIG = {
  BASE_URL: "https://admin.bcibizz.pt/frontend-api",
  FILES_ENDPOINT: "/files",
  API_ENDPOINT: "/api/file",
  STORAGE_PREFIX: "admin-api-cache:",
  // A cache é validada por hash, não por TTL.
  PAGE_TTL: Infinity,
  ASSET_TTL: Infinity,
  CONFIG_TTL: Infinity,
  MAX_CACHE_AGE: 90 * 24 * 60 * 60 * 1000, // 90 dias (limpeza de cache muito antigo)
  CACHE_BUSTER: "",                       // Sem versão no URL: a validação é por hash.
};

// As rotas vêm da Admin Frontend API (sidebar.js, window.adminRoutes).

module.exports = {
  API_CONFIG,
  DEBUG
};
