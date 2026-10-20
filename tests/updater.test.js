'use strict';

const { test, mock } = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');

/** Carrega o updater com Electron, electron-updater e config falsos. */
function carregarUpdater({ debug = false } = {}) {
  const falsos = {
    electron: { BrowserWindow: { getAllWindows: () => [] }, ipcMain: { on() {}, handle() {} }, app: { getPath: () => '' } },
    'electron-updater': { autoUpdater: { currentVersion: { toString: () => '1.0.0', version: '1.0.0' }, logger: null } },
    'electron-log': { transports: { file: {} }, error() {}, warn() {}, info() {} },
    './config': { DEBUG: debug, API_CONFIG: { BASE_URL: 'http://api.teste' } }
  };
  const original = Module._load;
  Module._load = function (pedido, ...resto) {
    return pedido in falsos ? falsos[pedido] : original.call(this, pedido, ...resto);
  };
  try {
    const caminho = require.resolve('../src/main/updater');
    delete require.cache[caminho];
    return require(caminho);
  } finally {
    Module._load = original;
  }
}

test('em produção volta a procurar atualizações de hora a hora', (t) => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  t.after(() => mock.timers.reset());
  let pedidos = 0;
  const fetchOriginal = global.fetch;
  global.fetch = async () => { pedidos++; return { ok: true, status: 200, json: async () => ({ success: true, latestVersion: '1.0.0' }) }; };
  t.after(() => { global.fetch = fetchOriginal; });

  carregarUpdater({ debug: false }).checkForUpdates();
  mock.timers.tick(5 * 1000);
  assert.strictEqual(pedidos, 1, 'primeira verificação 5 s depois de arrancar');
  mock.timers.tick(60 * 60 * 1000);
  assert.strictEqual(pedidos, 2, 'segunda verificação uma hora depois');
});
