const path = require('path');
const { execSync } = require('child_process');
const fs = require('fs');


/** O electron-winstaller já não vem nas dependências; o electron-builder guarda o seu rcedit na cache do winCodeSign. */
function encontrarRcedit() {
  const antigo = path.join(__dirname, 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe');
  if (fs.existsSync(antigo)) return antigo;
  const cache = path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'winCodeSign');
  if (!fs.existsSync(cache)) return null;
  for (const versao of fs.readdirSync(cache).sort().reverse()) {
    const candidato = path.join(cache, versao, 'rcedit-x64.exe');
    if (fs.existsSync(candidato)) return candidato;
  }
  return null;
}

// Hook do electron-builder.
exports.default = async function(context) {
  if (context.electronPlatformName !== 'win32') {
    return;
  }

  const packageJson = require('./package.json');
  const productName = packageJson.build.productName;
  
  const exePath = path.join(context.appOutDir, `${productName}.exe`);
  const iconPath = path.join(__dirname, 'build', 'app-icon.ico');
  
  const rceditPath = encontrarRcedit();
  
  if (!fs.existsSync(exePath)) {
    console.error('❌ Executável não encontrado:', exePath);
    return;
  }
  
  if (!fs.existsSync(iconPath)) {
    console.error('❌ Ícone não encontrado:', iconPath);
    return;
  }
  
  if (!rceditPath) {
    console.error('❌ rcedit não encontrado: nem em node_modules nem na cache do electron-builder');
    return;
  }
  
  console.log('\n🎨 Adicionando ícone ao executável do Admin App...');
  console.log('Product Name:', productName);
  console.log('Executável:', exePath);
  console.log('Ícone:', iconPath);
  
  const cmd = `"${rceditPath}" "${exePath}" --set-icon "${iconPath}"`;
  
  execSync(cmd, { stdio: 'inherit' });
  
  console.log('✓ Ícone adicionado com sucesso!\n');
};
