'use strict';

/** O login partilhado contra jsdom: sessão iniciada, captcha, login recusado e a password fora do resultado. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { entrar, sair, seguro, falhada, verificar, LIMITES_LOGIN } = require('../src/main/sessaoCasino');
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
  assert.deepEqual(LIMITES_LOGIN, { sessao: 20, entrar: 60, popups: 15, cliquesExtra: 4 });
  assert.deepEqual(falhada('login', 'x', { a: 1 }), { estado: 'falhada', fase: 'login', motivo: 'x', a: 1 });
  assert.deepEqual(verificar('captcha', 'y'), { estado: 'verificar', fase: 'captcha', motivo: 'y' });
  assert.equal(await seguro(async () => { throw new Error('x'); }, 'omissao'), 'omissao');
});

// Sessão de outra conta no browser partilhado: botão de sair da Placard, que leva ao formulário.
const COM_SAIR = `<!doctype html><html><body><header><button>Depositar</button>
  <button id="sportsLogoutBtnDesktop">Terminar sessão</button></header></body></html>`;

function partilhado({ saiDeVez = true } = {}) {
  let aberta = true;
  return criarDriver({
    paginas: { [HOME]: () => (aberta ? { html: COM_SAIR } : { html: FORMULARIO }), 'https://www.placard.pt/dentro': { html: ENTROU } },
    aoChamar: (nome, dr) => {
      if (nome === 'passoLogout' && saiDeVez) { aberta = false; dr.abrir(HOME); }
      if (nome === 'clicarEntrar' && !aberta) dr.abrir('https://www.placard.pt/dentro');
    }
  });
}

test('sessão de outra conta aberta: termina-a, confirma sem sessão e só depois preenche o login', async () => {
  const d = partilhado();
  assert.equal(await entrar(d, 'placard', null, CREDENCIAL), null);
  const n = d.nomes();
  assert.ok(n.includes('passoLogout'));
  assert.ok(n.indexOf('passoLogout') < n.indexOf('preencherLogin'));
  assert.equal(n.filter(x => x === 'preencherLogin').length, 1);
});

test('sessão que não termina: falhada no logout, sem nunca preencher o login', async () => {
  const d = partilhado({ saiDeVez: false });
  const r = await entrar(d, 'placard', null, CREDENCIAL);
  assert.equal(r.estado, 'falhada');
  assert.equal(r.fase, 'logout');
  assert.ok(!d.nomes().includes('preencherLogin'));
  assert.ok(!JSON.stringify(r).includes(SENHA));
});

test('sair sem sessão aberta: null sem clicar em nada', async () => {
  const d = criarDriver({ paginas: { [HOME]: { html: FORMULARIO } } });
  await d.navegar(HOME);
  assert.equal(await sair(d, 'placard', null), null);
  assert.ok(!d.nomes().includes('passoLogout'));
});

test('sair sem botão de terminar sessão: falhada no logout', async () => {
  const d = criarDriver({ paginas: { [HOME]: { html: ENTROU } } });
  await d.navegar(HOME);
  const r = await sair(d, 'placard', null);
  assert.equal(r.estado, 'falhada');
  assert.equal(r.fase, 'logout');
});

test('captcha a decorrer: verificar na fase captcha', async () => {
  const d = criarDriver({ paginas: { [HOME]: { fixture: 'captcha-a-decorrer' } } });
  const r = await entrar(d, 'placard', null, CREDENCIAL);
  assert.equal(r.estado, 'verificar');
  assert.equal(r.fase, 'captcha');
});

test('captcha que acaba sozinho: volta a clicar em Entrar e entra', async () => {
  let voltas = 0;
  const d = criarDriver({
    paginas: { [HOME]: { fixture: 'captcha-a-decorrer' }, 'https://www.placard.pt/dentro': { html: ENTROU } },
    aoChamar: (nome, dr) => {
      if (nome === 'estadoLogin' && ++voltas === 5) dr.janela.document.querySelector('[name="cf-turnstile-response"]').value = 'tok';
      if (nome === 'clicarEntrar' && voltas >= 5) dr.abrir('https://www.placard.pt/dentro');
    }
  });
  assert.equal(await entrar(d, 'placard', null, CREDENCIAL), null);
  assert.equal(d.nomes().filter(x => x === 'clicarEntrar').length, 2);
});

test('password limpa depois da verificação: volta a preencher antes de clicar', async () => {
  const d = criarDriver({
    paginas: { [HOME]: { fixture: 'captcha-a-decorrer' } },
    aoChamar: (nome, dr) => {
      if (nome === 'estadoLogin') {
        dr.janela.document.querySelector('[name="cf-turnstile-response"]').value = 'tok';
        if (!dr.limpou) { dr.limpou = true; dr.janela.document.querySelector('[name="password"]').value = ''; }
      }
    }
  });
  const r = await entrar(d, 'placard', null, CREDENCIAL);
  assert.equal(r.estado, 'falhada');
  const n = d.nomes();
  assert.equal(n.filter(x => x === 'preencherLogin').length, 2);
  assert.ok(n.lastIndexOf('preencherLogin') < n.lastIndexOf('clicarEntrar'));
  assert.ok(!JSON.stringify(r).includes(SENHA));
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
