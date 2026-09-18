// Serve imagens locais ao renderer.
const path = require('path');
const fs = require('fs');
const { DEBUG } = require('./config');

// Extensões permitidas: um caminho válido não pode devolver outro tipo de ficheiro.
const EXTENSOES_PERMITIDAS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico']);

// O caminho vem do renderer, que não é de confiança.
// Valida-se o caminho já resolvido, para .., barras invertidas e caminhos absolutos não saírem da pasta.
function getAssetPath(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath) {
    return null;
  }

  const cleanPath = relativePath.replace(/^\//, '');

  const base = path.resolve(__dirname, '../../assets');
  const assetPath = path.resolve(base, cleanPath);

  // O separador no fim evita que uma pasta irmã (assets-x) passe por estar dentro.
  if (assetPath !== base && !assetPath.startsWith(base + path.sep)) {
    DEBUG && console.warn(`[ASSETS] Caminho fora da pasta de assets, recusado: ${relativePath}`);
    return null;
  }

  if (!EXTENSOES_PERMITIDAS.has(path.extname(assetPath).toLowerCase())) {
    DEBUG && console.warn(`[ASSETS] Extensão não permitida, recusado: ${relativePath}`);
    return null;
  }

  if (!fs.existsSync(assetPath)) {
    DEBUG && console.warn(`[ASSETS] File not found: ${assetPath}`);
    return null;
  }

  return assetPath;
}

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

function getAssetDataUrl(relativePath) {
  const data = readAsset(relativePath);
  
  if (!data) {
    return null;
  }
  
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
