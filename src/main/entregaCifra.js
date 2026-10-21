'use strict';

// Cópia do bloco de API/services/operacoes/cifraEntrega.js; um teste compara os dois.

// <decifrar>
function decifrarEntrega(privadaB64, tarefaId, entrega) {
  const crypto = require('node:crypto');
  const PKCS8 = Buffer.from('302e020100300506032b656e04220420', 'hex');
  const SPKI = Buffer.from('302a300506032b656e032100', 'hex');
  const epk = Buffer.from(entrega.epk, 'base64');
  const privada = crypto.createPrivateKey({
    key: Buffer.concat([PKCS8, Buffer.from(privadaB64, 'base64')]), format: 'der', type: 'pkcs8'
  });
  const publica = crypto.createPublicKey({ key: Buffer.concat([SPKI, epk]), format: 'der', type: 'spki' });
  const segredo = crypto.diffieHellman({ privateKey: privada, publicKey: publica });
  const chave = Buffer.from(crypto.hkdfSync('sha256', segredo, epk, 'bci-entrega-v1', 32));
  const d = crypto.createDecipheriv('aes-256-gcm', chave, Buffer.from(entrega.iv, 'base64'));
  d.setAAD(Buffer.from(String(tarefaId)));
  d.setAuthTag(Buffer.from(entrega.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(entrega.cifrado, 'base64')), d.final()]).toString('utf8');
}
// </decifrar>

module.exports = { decifrarEntrega };
