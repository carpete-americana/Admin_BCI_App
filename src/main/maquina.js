'use strict';

/**
 * Identificador desta máquina, igual na User App e na Admin App: HMAC do MachineGuid do Windows; o GUID nunca sai em claro.
 * Cópia igual na outra app: mudar um obriga a mudar o outro.
 */

const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

const CHAVE = 'bci-maquina-v1';
let emCache;

function maquinaIdDe(guid) {
  return guid ? crypto.createHmac('sha256', CHAVE).update(String(guid).toLowerCase()).digest('hex') : null;
}

function lerMachineGuid(exec = execFile, plataforma = process.platform) {
  if (plataforma !== 'win32') return Promise.resolve(null);
  return new Promise((resolve) => {
    exec('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { windowsHide: true, timeout: 5000 }, (erro, saida) => {
      if (erro) return resolve(null);
      const m = /MachineGuid\s+REG_SZ\s+([0-9a-f-]{36})/i.exec(String(saida || ''));
      resolve(m ? m[1].toLowerCase() : null);
    });
  });
}

async function maquinaId(deps = {}) {
  if (emCache === undefined) emCache = maquinaIdDe(await (deps.lerGuid || lerMachineGuid)());
  return emCache;
}

module.exports = { maquinaId, maquinaIdDe, lerMachineGuid };
