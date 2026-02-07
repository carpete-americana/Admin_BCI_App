// DEBUG: auto-detecção em desenvolvimento, forçado a false em produção
const DEBUG = true;

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

// Admin routes - páginas específicas de administração
const routes = {
  dashboard: { title: "Dashboard", path: "dashboard", icon: "fa-chart-bar" },
  documents: { title: "Documentos", path: "documents", icon: "fa-file-alt" },
  users: { title: "Utilizadores", path: "users", icon: "fa-users" },
  profiles: { title: "Perfis", path: "profiles", icon: "fa-id-card" },
  casinoaccounts: { title: "Contas Casino", path: "casinoaccounts", icon: "fa-dice" },
  casinoprofit: { title: "Lucros Casino", path: "casinoprofit", icon: "fa-coins" },
  withdrawals: { title: "Levantamentos", path: "withdrawals", icon: "fa-money-bill-wave" },
  transactions: { title: "Transações", path: "transactions", icon: "fa-exchange-alt" },
  logs: { title: "Logs", path: "logs", icon: "fa-terminal" },
  email: { title: "Email", path: "email", icon: "fa-envelope" },
  settings: { title: "Definições", path: "settings", icon: "fa-cog" },
  reports: { title: "Relatórios", path: "reports", icon: "fa-chart-pie" },
  notifications: { title: "Notificações", path: "notifications", icon: "fa-bell" }
};

module.exports = {
  API_CONFIG,
  DEBUG,
  routes
};
