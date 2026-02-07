const path = require('path');
const { execSync } = require('child_process');
const fs = require('fs');

// Hook do electron-builder - recebe context como parâmetro
exports.default = async function(context) {
  // Apenas processar no Windows
  if (context.electronPlatformName !== 'win32') {
    return;
  }

  const packageJson = require('./package.json');
  const productName = packageJson.build.productName;
  
  const exePath = path.join(context.appOutDir, `${productName}.exe`);
  const iconPath = path.join(__dirname, 'build', 'app-icon.ico');
  
  // Buscar rcedit no node_modules
  const rceditPath = path.join(__dirname, 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe');
  
  if (!fs.existsSync(exePath)) {
    console.error('❌ Executável não encontrado:', exePath);
    return;
  }
  
  if (!fs.existsSync(iconPath)) {
    console.error('❌ Ícone não encontrado:', iconPath);
    return;
  }
  
  if (!fs.existsSync(rceditPath)) {
    console.error('❌ rcedit não encontrado:', rceditPath);
    return;
  }
  
  console.log('\n🎨 Adicionando ícone ao executável do Admin App...');
  console.log('Product Name:', productName);
  console.log('Executável:', exePath);
  console.log('Ícone:', iconPath);
  
  // Usar rcedit para adicionar o ícone
  const cmd = `"${rceditPath}" "${exePath}" --set-icon "${iconPath}"`;
  
  execSync(cmd, { stdio: 'inherit' });
  
  console.log('✓ Ícone adicionado com sucesso!\n');
};
