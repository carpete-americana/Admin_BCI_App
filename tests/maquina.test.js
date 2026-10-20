'use strict';

/** Identificador da máquina: HMAC do MachineGuid, igual nas duas apps, nunca o GUID em claro. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { maquinaIdDe, lerMachineGuid } = require('../src/main/maquina');

const SAIDA = '\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\r\n    MachineGuid    REG_SZ    3F2504E0-4F89-11D3-9A0C-0305E82C3301\r\n';

test('maquinaIdDe: 64 hex, igual para o mesmo GUID, diferente para outro, nunca o GUID em claro', () => {
  const a = maquinaIdDe('3f2504e0-4f89-11d3-9a0c-0305e82c3301');
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, maquinaIdDe('3F2504E0-4F89-11D3-9A0C-0305E82C3301'), 'maiúsculas e minúsculas dão o mesmo');
  assert.notEqual(a, maquinaIdDe('00000000-0000-0000-0000-000000000000'));
  assert.ok(!a.includes('3f2504e0'));
  assert.equal(maquinaIdDe(null), null);
});

test('lerMachineGuid: lê do reg sem shell e normaliza', async () => {
  let chamada;
  const exec = (cmd, args, opts, cb) => { chamada = { cmd, args, opts }; cb(null, SAIDA); };
  assert.equal(await lerMachineGuid(exec, 'win32'), '3f2504e0-4f89-11d3-9a0c-0305e82c3301');
  assert.equal(chamada.cmd, 'reg');
  assert.deepEqual(chamada.args, ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid']);
  assert.equal(chamada.opts.shell, undefined);
});

test('lerMachineGuid: erro, saída estranha ou outro sistema → null', async () => {
  assert.equal(await lerMachineGuid((c, a, o, cb) => cb(new Error('x')), 'win32'), null);
  assert.equal(await lerMachineGuid((c, a, o, cb) => cb(null, 'nada'), 'win32'), null);
  assert.equal(await lerMachineGuid(() => { throw new Error('não devia correr'); }, 'linux'), null);
});
