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

test('Placard: o login nunca passa pelos passos depois do login da Betclic', async () => {
  const d = criarDriver({
    paginas: { [HOME]: { html: FORMULARIO }, 'https://www.placard.pt/dentro': { html: ENTROU } },
    aoChamar: (nome, dr) => { if (nome === 'clicarEntrar') dr.abrir('https://www.placard.pt/dentro'); }
  });
  assert.equal(await entrar(d, 'placard', null, CREDENCIAL), null);
  assert.ok(!d.nomes().includes('passosPosLogin'));
});

// Betclic: depois de Entrar vêm, por ordem, os ecrãs pedidos (nascimento, telemovel, inicio).
const NASCIMENTO = '01/05/1990';
const BETCLIC = 'https://www.betclic.pt';
const LOGIN_BETCLIC = `${BETCLIC}/login`;
const FORM_BETCLIC = `<!doctype html><html><body><form>
  <input name="username"><input name="password" type="password">
  <button type="submit">Entrar</button></form></body></html>`;
const COM_NASCIMENTO = { ...CREDENCIAL, nascimento: NASCIMENTO };

function betclic(ecras, { dataFica = false, base = BETCLIC } = {}) {
  const cliques = {};
  const dataNoClique = [];
  let ecra = -1;
  let seguinte = null;
  const urlDe = (i) => `${base}/ecra/${ecras[i]}`;
  const avancar = () => { if (ecra + 1 < ecras.length) seguinte = urlDe(ecra + 1); };
  const contar = (w) => {
    for (const b of w.document.querySelectorAll('button[data-qa]')) {
      b.addEventListener('click', () => {
        const qa = b.getAttribute('data-qa');
        cliques[qa] = (cliques[qa] || 0) + 1;
        if (qa === 'validate_birthdate_button') {
          dataNoClique.push(w.document.querySelector('[data-qa="birthdate"]').value);
          if (!dataFica) avancar();
        }
        if (qa === 'cancel_phone-confirmation_button') avancar();
      });
    }
  };
  const ecrasPorUrl = {
    nascimento: { fixture: 'betclic-nascimento', preparar: (w) => { w.eval(w.document.querySelector('script').textContent); contar(w); } },
    telemovel: { fixture: 'betclic-telemovel', preparar: contar },
    inicio: { fixture: 'betclic-inicio' }
  };
  const paginas = { [LOGIN_BETCLIC]: { html: FORM_BETCLIC } };
  ecras.forEach((nome, i) => { paginas[urlDe(i)] = ecrasPorUrl[nome]; });
  const d = criarDriver({
    paginas,
    aoChamar: (nome, dr) => {
      if (nome === 'clicarEntrar' && ecra < 0) seguinte = urlDe(0);
      if (seguinte) { ecra++; const url = seguinte; seguinte = null; dr.abrir(url); }
    }
  });
  // Regista os argumentos de esperar, que o driver de jsdom deita fora.
  const esperas = [];
  const esperar = d.esperar;
  d.esperar = async (...args) => { esperas.push(args); return esperar(); };
  return { d, cliques, dataNoClique, esperas };
}

// A data em qualquer formato: com barras, só dígitos ou o ano.
const semData = (valor) => {
  const texto = JSON.stringify(valor);
  return !texto.includes(NASCIMENTO) && !texto.includes('01051990') && !texto.includes('1990');
};
const registados = ({ d, esperas }) => [esperas, d.chamadas.filter(c => c.nome === 'url' || c.nome === 'navegar')];

test('Betclic: data de nascimento, telemóvel e casa: entra com a data escrita e Mais tarde', async () => {
  const b = betclic(['nascimento', 'telemovel', 'inicio']);
  assert.equal(await entrar(b.d, 'betclic', null, COM_NASCIMENTO), null);
  assert.deepEqual(b.dataNoClique, [NASCIMENTO]);
  assert.equal(b.cliques.validate_birthdate_button, 1);
  assert.equal(b.cliques['cancel_phone-confirmation_button'], 1);
  assert.equal(b.cliques['validate_phone-confirmation_button'] || 0, 0);
  assert.ok(semData(registados(b)));
});

test('Betclic: só o ecrã do telemóvel: Mais tarde e entra, sem escrever a data', async () => {
  const b = betclic(['telemovel', 'inicio']);
  assert.equal(await entrar(b.d, 'betclic', null, COM_NASCIMENTO), null);
  assert.equal(b.cliques['cancel_phone-confirmation_button'], 1);
  assert.equal(b.cliques['validate_phone-confirmation_button'] || 0, 0);
  assert.deepEqual(b.dataNoClique, []);
});

test('Betclic: direto à casa: a sessão vê-se pelos seletores e entra', async () => {
  const b = betclic(['inicio']);
  assert.equal(await entrar(b.d, 'betclic', null, COM_NASCIMENTO), null);
  assert.deepEqual(b.cliques, {});
});

test('Betclic: a data continua no ecrã depois de Validar: falhada com um só clique', async () => {
  const b = betclic(['nascimento'], { dataFica: true });
  const r = await entrar(b.d, 'betclic', null, COM_NASCIMENTO);
  assert.deepEqual(r, { estado: 'falhada', fase: 'login', motivo: 'A Betclic não aceitou a data de nascimento' });
  assert.equal(b.cliques.validate_birthdate_button, 1);
  assert.ok(semData(r));
  assert.ok(semData(registados(b)));
});

test('Betclic: sem data de nascimento na conta e o site a pedi-la: falhada sem escrever nada', async () => {
  const b = betclic(['nascimento']);
  const r = await entrar(b.d, 'betclic', null, CREDENCIAL);
  assert.deepEqual(r, { estado: 'falhada', fase: 'login', motivo: 'A Betclic pede a data de nascimento e a conta não a tem' });
  assert.equal(b.d.janela.document.querySelector('[data-qa="birthdate"]').value, '');
  assert.equal(b.cliques.validate_birthdate_button || 0, 0);
});

test('Betclic: o botão Validar nunca ativa: o tempo esgota sem a data no resultado nem nos registos', async () => {
  // Sem o script da fixture o botão fica desativado.
  const d = criarDriver({
    paginas: { [LOGIN_BETCLIC]: { html: FORM_BETCLIC }, [`${BETCLIC}/ecra/nascimento`]: { fixture: 'betclic-nascimento' } },
    aoChamar: (nome, dr) => { if (nome === 'clicarEntrar') dr.abrir(`${BETCLIC}/ecra/nascimento`); }
  });
  const esperas = [];
  d.esperar = async (...args) => { esperas.push(args); };
  const r = await entrar(d, 'betclic', null, COM_NASCIMENTO);
  assert.equal(r.estado, 'falhada');
  assert.equal(r.motivo, 'O login ficou por confirmar');
  assert.ok(semData(r));
  assert.ok(semData(registados({ d, esperas })));
});

test('Betclic: o ecrã da data fora do site do casino não recebe a data', async () => {
  const b = betclic(['nascimento'], { base: 'https://betclic.example.com' });
  const r = await entrar(b.d, 'betclic', null, COM_NASCIMENTO);
  assert.equal(r.estado, 'falhada');
  assert.ok(b.d.chamadas.filter(c => c.nome === 'passosPosLogin').every(c => semData(c.args)));
  assert.equal(b.d.janela.document.querySelector('[data-qa="birthdate"]').value, '');
});

test('Betclic: sair reconhece a falta de sessão pelo botão Aceder, sem clicar em nada', async () => {
  const d = criarDriver({ paginas: { [`${BETCLIC}/`]: { fixture: 'betclic-sem-sessao' } } });
  await d.navegar(`${BETCLIC}/`);
  assert.equal(await sair(d, 'betclic', null), null);
  assert.ok(!d.nomes().includes('passoLogout'));
});
