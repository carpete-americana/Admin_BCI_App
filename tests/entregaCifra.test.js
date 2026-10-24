'use strict';

/** A decifragem da entrega: abre o vetor partilhado com a API e não se afasta do código dela. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { decifrarEntrega, decifrarNascimento } = require('../src/main/entregaCifra');
const vetor = require('./fixtures/entrega-vetor.json');

const API = path.join(__dirname, '..', '..', 'API', 'services', 'operacoes', 'cifraEntrega.js');
const BLOCO = /\/\/ <decifrar>[\s\S]*?\/\/ <\/decifrar>/;
const BLOCO_NASC = /// <decifrar-nascimento>[sS]*?// </decifrar-nascimento>/;

test('abre o vetor partilhado com a API', () => {
  assert.equal(decifrarEntrega(vetor.privada, vetor.tarefaId, vetor.entrega), vetor.texto);
});

test('abre a data de nascimento do vetor', () => {
  assert.equal(decifrarNascimento(vetor.privada, vetor.tarefaId, vetor.entrega), vetor.nascimento);
});

test('sem nascimentoCifrado devolve null', () => {
  const { nascimentoCifrado, ...semData } = vetor.entrega;
  assert.equal(decifrarNascimento(vetor.privada, vetor.tarefaId, semData), null);
});

test('a data não abre com outro tarefaId, outra privada ou a etiqueta alterada', () => {
  assert.throws(() => decifrarNascimento(vetor.privada, `${vetor.tarefaId}x`, vetor.entrega));
  const outra = require('node:crypto').generateKeyPairSync('x25519').privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32).toString('base64');
  assert.throws(() => decifrarNascimento(outra, vetor.tarefaId, vetor.entrega));
  const tag = Buffer.from(vetor.entrega.nascimentoCifrado.tag, 'base64'); tag[0] ^= 1;
  assert.throws(() => decifrarNascimento(vetor.privada, vetor.tarefaId, { ...vetor.entrega, nascimentoCifrado: { ...vetor.entrega.nascimentoCifrado, tag: tag.toString('base64') } }));
});

test('outro tarefaId não abre', () => {
  assert.throws(() => decifrarEntrega(vetor.privada, `${vetor.tarefaId}x`, vetor.entrega));
});

test('o bloco de decifrar é igual byte a byte ao da API', { skip: !fs.existsSync(API) && 'API/ não está ao lado da User App (repo clonado sozinho)' }, () => {
  const daApi = fs.readFileSync(API, 'utf8').match(BLOCO);
  const local = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'entregaCifra.js'), 'utf8').match(BLOCO);
  assert.ok(daApi && local, 'marcadores em falta');
  assert.equal(local[0], daApi[0]);
});

test('o bloco de decifrar a data é igual byte a byte ao da API', { skip: !fs.existsSync(API) && 'API/ não está ao lado da app (repo clonado sozinho)' }, () => {
  const daApi = fs.readFileSync(API, 'utf8').match(BLOCO_NASC);
  const local = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'entregaCifra.js'), 'utf8').match(BLOCO_NASC);
  assert.ok(daApi && local, 'marcadores em falta');
  assert.equal(local[0], daApi[0]);
});
