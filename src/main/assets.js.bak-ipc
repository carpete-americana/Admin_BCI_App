// Asset server - serves local images to renderer - Admin App
const path = require('path');
const fs = require('fs');
const { DEBUG } = require('./config');

// Get path to local asset
function getAssetPath(relativePath) {
  // Remove leading slash if present
  const cleanPath = relativePath.replace(/^\//, '');
  
  // Build absolute path to asset
  const assetPath = path.join(__dirname, '../../assets', cleanPath);
  
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
