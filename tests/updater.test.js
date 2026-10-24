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
test('instala-se sozinha só com a app parada', () => {
  const { podeInstalarAgora } = carregarUpdater();
  const base = { pronto: true, ocupado: false, janelasVisiveis: 0, inativoSeg: 0 };
  assert.strictEqual(podeInstalarAgora(base), true, 'sem janelas e sem trabalho');
  assert.strictEqual(podeInstalarAgora({ ...base, pronto: false }), false, 'sem instalador verificado');
  assert.strictEqual(podeInstalarAgora({ ...base, ocupado: true }), false, 'com uma conta a decorrer');
  assert.strictEqual(podeInstalarAgora({ ...base, janelasVisiveis: 1, inativoSeg: 30 }), false, 'a pessoa está a usá-la');
  assert.strictEqual(podeInstalarAgora({ ...base, janelasVisiveis: 1, inativoSeg: 600 }), true, 'janela aberta mas PC parado há 10 min');
});

test('o script de instalação põe aspas nos caminhos com espaços', () => {
  const { scriptInstalador } = carregarUpdater();
  const vbs = scriptInstalador({
    instalador: String.raw`C:\Users\Ana Silva\Roaming\BCI Admin-Setup.exe`,
    pasta: String.raw`C:\Programs\BCI Admin`,
    exe: String.raw`C:\Programs\BCI Admin\BCI Admin.exe`
  });
  assert.ok(vbs.includes(String.raw`objShell.Run """C:\Users\Ana Silva\Roaming\BCI Admin-Setup.exe""" & " /S /D=C:\Programs\BCI Admin", 0, True`));
  assert.ok(vbs.includes(String.raw`objShell.Run """C:\Programs\BCI Admin\BCI Admin.exe""", 1, False`));
});
