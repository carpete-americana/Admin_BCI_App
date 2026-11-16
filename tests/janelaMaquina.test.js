'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { criarJanelaMaquina } = require('../src/main/janelaMaquina');

const pastaTemp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bci-janela-')), 'BCI Operacoes');

test('sem ficheiro lê null; grava e lê o valor; outra instância na mesma pasta vê o mesmo', async () => {
  const pasta = pastaTemp();
  const a = criarJanelaMaquina({ pasta });
  assert.equal(await a.ler(), null);
  await a.gravar(true);
  assert.equal(await criarJanelaMaquina({ pasta }).ler(), true);
  await a.gravar(false);
  assert.equal(await a.ler(), false);
});

test('ficheiro estragado ou com outro valor lê null', async () => {
  const pasta = pastaTemp();
  fs.mkdirSync(pasta, { recursive: true });
  fs.writeFileSync(path.join(pasta, 'janela.json'), '{ isto não é json');
  assert.equal(await criarJanelaMaquina({ pasta }).ler(), null);
  fs.writeFileSync(path.join(pasta, 'janela.json'), JSON.stringify({ visivel: 'sim' }));
  assert.equal(await criarJanelaMaquina({ pasta }).ler(), null);
});
