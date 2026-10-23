const { ipcMain, BrowserWindow } = require('electron');

// Sem barra do sistema: minimizar, maximizar e fechar são botões da própria página (shell-janela.js).
// Igual na User App e na Admin App.

const ACOES = {
  'janela:minimizar': (win) => win.minimize(),
  'janela:maximizar': (win) => (win.isMaximized() ? win.unmaximize() : win.maximize()),
  // Passa pelo 'close' da janela: no Windows e no Linux esconde para o tray.
  'janela:fechar': (win) => win.close(),
};

/** Opções do BrowserWindow; no Mac ficam os semáforos do sistema. */
function opcoesBarra(plataforma = process.platform) {
  return { titleBarStyle: plataforma === 'darwin' ? 'hiddenInset' : 'hidden' };
}

function ligarBotoesDaJanela() {
  for (const [canal, acao] of Object.entries(ACOES)) {
    ipcMain.on(canal, (event) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win && !win.isDestroyed()) acao(win);
    });
  }
}

/** Avisa a página quando a janela maximiza ou restaura, para trocar o ícone do botão. */
function seguirMaximizada(win) {
  const avisar = () => {
    if (!win.isDestroyed()) win.webContents.send('janela:maximizada', win.isMaximized());
  };
  win.on('maximize', avisar);
  win.on('unmaximize', avisar);
  win.webContents.on('did-finish-load', avisar);
}

module.exports = { ACOES, opcoesBarra, ligarBotoesDaJanela, seguirMaximizada };
