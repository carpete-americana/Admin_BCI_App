'use strict';

/** A decifragem da entrega: abre o vetor partilhado com a API e não se afasta do código dela. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { decifrarEntrega } = require('../src/main/entregaCifra');
const vetor = require('./fixtures/entrega-vetor.json');

const API = path.join(__dirname, '..', '..', 'API', 'services', 'operacoes', 'cifraEntrega.js');
const BLOCO = /\/\/ <decifrar>[\s\S]*?\/\/ <\/decifrar>/;

test('abre o vetor partilhado com a API', () => {
  assert.equal(decifrarEntrega(vetor.privada, vetor.tarefaId, vetor.entrega), vetor.texto);
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
