// Asset server - serves local images to renderer - Admin App
const path = require('path');
const fs = require('fs');
const { DEBUG } = require('./config');

// Extensões que um asset PODE ter. Sem esta lista, um caminho válido dentro da
// pasta ainda conseguia devolver qualquer ficheiro que lá estivesse.
const EXTENSOES_PERMITIDAS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico']);

// Get path to local asset
//
// O CAMINHO VEM DO RENDERER, E O RENDERER NÃO É DE CONFIANÇA.
//
// Isto fazia `path.join(__dirname, '../../assets', relativePath)` e devolvia o
// resultado. O `path.join` resolve os `..`, portanto
// `getLocalAsset('../../../../.ssh/id_rsa')` saía da pasta de assets e lia o
// que quisesse — devolvido ao renderer em base64, pelo `getAssetDataUrl`.
//
// Porque é que isto importa mesmo com a CSP a bloquear scripts inline: as
// páginas do painel são DESCARREGADAS da Frontend API em runtime e executadas
// via import() de um blob. Quem controlar esse servidor controla o que corre
// aqui — e, sem esta verificação, passava de "controlo do servidor" para
// "leitura de qualquer ficheiro na máquina de cada admin".
//
// A verificação é feita sobre o caminho JÁ RESOLVIDO (path.resolve), porque é
// o único que não se deixa enganar por `..`, por barras invertidas ou por
// caminhos absolutos vindos do outro lado.
function getAssetPath(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath) {
    return null;
  }

  // Remove leading slash if present
  const cleanPath = relativePath.replace(/^\//, '');

  const base = path.resolve(__dirname, '../../assets');
  const assetPath = path.resolve(base, cleanPath);

  // Tem de ficar DENTRO da pasta de assets. O separador no fim evita que
  // "…/assets-outra-coisa" passe por estar contida em "…/assets".
  if (assetPath !== base && !assetPath.startsWith(base + path.sep)) {
    DEBUG && console.warn(`[ASSETS] Caminho fora da pasta de assets, recusado: ${relativePath}`);
    return null;
  }

  if (!EXTENSOES_PERMITIDAS.has(path.extname(assetPath).toLowerCase())) {
    DEBUG && console.warn(`[ASSETS] Extensão não permitida, recusado: ${relativePath}`);
    return null;
  }

  // Check if file exists
  if (!fs.existsSync(assetPath)) {
    DEBUG && console.warn(`[ASSETS] File not found: ${assetPath}`);
    return null;
  }

  return assetPath;
}

// Read asset file
function readAsset(relativePath) {
  const assetPath = getAssetPath(relativePath);
  
  if (!assetPath) {
    return null;
  }
  
  try {
    return fs.readFileSync(assetPath);
  } catch (e) {
    DEBUG && console.error(`[ASSETS] Error reading file: ${assetPath}`, e.message);
    return null;
  }
}

// Get asset as base64 data URL
function getAssetDataUrl(relativePath) {
  const data = readAsset(relativePath);
  
  if (!data) {
    return null;
  }
  
  // Determine MIME type from extension
  const ext = path.extname(relativePath).toLowerCase();
  const mimeTypes = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp'
  };
  
  const mimeType = mimeTypes[ext] || 'application/octet-stream';
  const base64 = data.toString('base64');
  
  return `data:${mimeType};base64,${base64}`;
}

module.exports = {
  getAssetPath,
  readAsset,
  getAssetDataUrl
};
