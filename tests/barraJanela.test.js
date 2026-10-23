'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ACOES, opcoesBarra } = require('../src/main/barraJanela');

test('sem barra do sistema e sem botões do Windows; no Mac ficam os semáforos', () => {
  assert.deepEqual(opcoesBarra('win32'), { titleBarStyle: 'hidden' });
  assert.deepEqual(opcoesBarra('linux'), { titleBarStyle: 'hidden' });
  assert.deepEqual(opcoesBarra('darwin'), { titleBarStyle: 'hiddenInset' });
});

test('os botões da página só minimizam, maximizam/restauram e fecham', () => {
  assert.deepEqual(Object.keys(ACOES).sort(), ['janela:fechar', 'janela:maximizar', 'janela:minimizar']);
  const feito = [];
  const win = (max) => ({
    minimize: () => feito.push('min'), maximize: () => feito.push('max'),
    unmaximize: () => feito.push('restaurar'), isMaximized: () => max, close: () => feito.push('close'),
  });
  ACOES['janela:minimizar'](win(false));
  ACOES['janela:maximizar'](win(false));
  ACOES['janela:maximizar'](win(true));
  ACOES['janela:fechar'](win(false));
  // Fechar passa pelo close da janela, que esconde para o tray.
  assert.deepEqual(feito, ['min', 'max', 'restaurar', 'close']);
});

test('o preload não deixa a página passar argumentos aos botões', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src/preload/index.js'), 'utf8');
  for (const canal of ['minimizar', 'maximizar', 'fechar']) {
    assert.match(preload, new RegExp(`${canal}: \\(\\) => ipcRenderer\\.send\\('janela:${canal}'\\)`));
  }
});

test('os ecrãs sem barra deixam arrastar a janela e têm os botões', () => {
  const pub = path.join(__dirname, '..', 'public');
  const shell = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
  assert.match(shell, /shell-janela\.js/);
  assert.match(shell, /\.main-header[^{]*\{ -webkit-app-region: drag; \}/);
  for (const p of ['offline.html', 'server-unavailable.html']) {
    const html = fs.readFileSync(path.join(pub, p), 'utf8');
    assert.match(html, /class="arrastar"/, `${p} sem zona de arrastar`);
    assert.match(html, /shell-janela\.js/, `${p} sem os botões da janela`);
  }
});
