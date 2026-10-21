'use strict';

/** O login partilhado contra jsdom: sessão iniciada, captcha, login recusado e a password fora do resultado. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { entrar, seguro, falhada, verificar, LIMITES_LOGIN } = require('../src/main/sessaoCasino');
const { criarDriver } = require('./ajuda/paginaJsdom');

const SENHA = 'segredo-9X!';
const CREDENCIAL = { username: 'joao', password: SENHA };
const HOME = 'https://www.placard.pt/levantar';
const FORMULARIO = `<!doctype html><html><body><form>
  <input name="userName"><input name="password" type="password">
  <button type="submit">Iniciar sessão</button></form></body></html>`;
const ENTROU = `<!doctype html><html><body><header><button>Depositar</button></header>
  <span class="cms-balance-withdrawable_balance">30.00 €</span></body></html>`;

test('limites e construtores de resultado', async () => {
  assert.deepEqual(LIMITES_LOGIN, { sessao: 20, entrar: 60, popups: 15 });
  assert.deepEqual(falhada('login', 'x', { a: 1 }), { estado: 'falhada', fase: 'login', motivo: 'x', a: 1 });
  assert.deepEqual(verificar('captcha', 'y'), { estado: 'verificar', fase: 'captcha', motivo: 'y' });
  assert.equal(await seguro(async () => { throw new Error('x'); }, 'omissao'), 'omissao');
});

test('sessão já iniciada: null', async () => {
  const d = criarDriver({ paginas: { [HOME]: { html: ENTROU } } });
  assert.equal(await entrar(d, 'placard', null, CREDENCIAL), null);
});

test('captcha a decorrer: verificar na fase captcha', async () => {
  const d = criarDriver({ paginas: { [HOME]: { fixture: 'captcha-a-decorrer' } } });
  const r = await entrar(d, 'placard', null, CREDENCIAL);
  assert.equal(r.estado, 'verificar');
  assert.equal(r.fase, 'captcha');
});

test('login recusado: falhada na fase login, sem a password no resultado', async () => {
  const ERRO = fs.readFileSync(path.join(__dirname, 'fixtures', 'placard-erro.html'), 'utf8');
  const d = criarDriver({
    paginas: { [HOME]: { html: FORMULARIO }, 'https://www.placard.pt/erro': { html: ERRO } },
    aoChamar: (nome, dr) => { if (nome === 'clicarEntrar') dr.abrir('https://www.placard.pt/erro'); }
  });
  const r = await entrar(d, 'placard', null, CREDENCIAL);
  assert.equal(r.estado, 'falhada');
  assert.equal(r.fase, 'login');
  assert.ok(!JSON.stringify(r).includes(SENHA));
});
