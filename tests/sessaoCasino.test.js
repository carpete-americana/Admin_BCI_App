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
  assert.deepEqual(LIMITES_LOGIN, { sessao: 40, entrar: 60, popups: 15, cliquesExtra: 4 });
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

const CODIGO_CERTO = '482915';
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
  const codigosEscritos = [];
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
        if (qa === 'validate_otp_button') {
          const escrito = w.document.querySelector('[data-qa="otp-input"]').value;
          codigosEscritos.push(escrito);
          if (escrito === CODIGO_CERTO) avancar();
        }
      });
    }
  };
  const ecrasPorUrl = {
    nascimento: { fixture: 'betclic-nascimento', preparar: (w) => { w.eval(w.document.querySelector('script').textContent); contar(w); } },
    telemovel: { fixture: 'betclic-telemovel', preparar: contar },
    codigo: { fixture: 'betclic-codigo', preparar: (w) => { contar(w); w.document.querySelector('form').addEventListener('submit', e => e.preventDefault()); } },
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
  return { d, cliques, dataNoClique, codigosEscritos, esperas };
}

// A data em qualquer formato: com barras, só dígitos ou o ano.
const semData = (valor) => {
  const texto = JSON.stringify(valor);
  return !texto.includes(NASCIMENTO) && !texto.includes('01051990') && !texto.includes('1990');
};
const registados = ({ d, esperas }) => [esperas, d.chamadas.filter(c => c.nome === 'url' || c.nome === 'navegar')];

// Banner de cookies do TrustCommander: enquanto está aberto, o Entrar não chega ao site.
const BANNER_BETCLIC = '<div id="tc-privacy-wrapper"><button>Aceitar tudo</button><button id="recusar">Recusar tudo</button></div>';
const INICIO_BETCLIC = `${BETCLIC}/ecra/inicio`;

function comBanner({ desde = 'inicio' } = {}) {
  const r = { recusado: false, aceite: false };
  let janela = null;
  const pôrBanner = (w) => {
    w.document.body.insertAdjacentHTML('beforeend', BANNER_BETCLIC);
    const banner = w.document.getElementById('tc-privacy-wrapper');
    banner.querySelector('button').addEventListener('click', () => { r.aceite = true; });
    w.document.getElementById('recusar').addEventListener('click', () => { r.recusado = true; banner.remove(); });
  };
  r.d = criarDriver({
    paginas: {
      [LOGIN_BETCLIC]: { html: FORM_BETCLIC, preparar: (w) => { janela = w; if (desde === 'inicio') pôrBanner(w); } },
      [INICIO_BETCLIC]: { fixture: 'betclic-inicio' }
    },
    aoChamar: (nome, dr) => {
      if (nome !== 'clicarEntrar') return;
      if (r.recusado) return dr.abrir(INICIO_BETCLIC);
      // Chega depois do primeiro clique, que se perde.
      if (desde === 'clique' && !janela.document.getElementById('tc-privacy-wrapper')) pôrBanner(janela);
    }
  });
  return r;
}

test('Betclic: só escreve depois da hidratação do Angular, que repõe os campos vazios', async () => {
  const SSR = `<!doctype html><html><body><app-desktop ngh="0"><form>
    <input name="username"><input name="password" type="password">
    <button type="submit" disabled>Aceder</button></form></app-desktop></body></html>`;
  let voltas = 0;
  const d = criarDriver({
    paginas: { [LOGIN_BETCLIC]: { html: SSR } },
    aoChamar: (nome, dr) => {
      const doc = dr.janela.document;
      const raiz = doc.querySelector('[ngh]');
      // A hidratação acaba passadas umas voltas e limpa o que lá estiver escrito.
      if (raiz && ++voltas === 4) {
        raiz.removeAttribute('ngh');
        for (const i of doc.querySelectorAll('input')) i.value = '';
        doc.querySelector('button').disabled = false;
      }
    }
  });
  await d.navegar(LOGIN_BETCLIC);
  await entrar(d, 'betclic', null, CREDENCIAL);
  const preencheu = d.chamadas.findIndex(c => c.nome === 'preencherLogin');
  const hidratou = d.chamadas.findIndex(c => c.nome === 'paginaHidratada');
  assert.ok(preencheu > hidratou && hidratou >= 0);
  assert.equal(d.janela.document.querySelector('input[name="username"]').value, 'joao');
  assert.equal(d.janela.document.querySelector('input[type="password"]').value, SENHA);
});

test('Betclic: banner de cookies por cima do login: recusa-o (nunca aceita) e entra', async () => {
  const b = comBanner();
  assert.equal(await entrar(b.d, 'betclic', null, CREDENCIAL), null);
  assert.deepEqual([b.recusado, b.aceite], [true, false]);
});

test('Betclic: banner que chega depois do clique: recusa-o e volta a carregar em Entrar', async () => {
  const b = comBanner({ desde: 'clique' });
  assert.equal(await entrar(b.d, 'betclic', null, CREDENCIAL), null);
  assert.deepEqual([b.recusado, b.aceite], [true, false]);
  assert.ok(b.d.nomes().filter(n => n === 'clicarEntrar').length >= 2);
});

test('Betclic: credenciais erradas («Atenção!») falham logo, sem esperar o tempo todo', async () => {
  const ATENCAO = '<div><h2>Atenção!</h2><p>Insere novamente o teu e-mail (ou nome de utilizador) e palavra-passe.</p></div>';
  const d = criarDriver({
    paginas: { [LOGIN_BETCLIC]: { html: FORM_BETCLIC }, [`${BETCLIC}/erro`]: { html: FORM_BETCLIC.replace('</body>', `${ATENCAO}</body>`) } },
    aoChamar: (nome, dr) => { if (nome === 'clicarEntrar') dr.abrir(`${BETCLIC}/erro`); }
  });
  const r = await entrar(d, 'betclic', null, CREDENCIAL);
  assert.deepEqual(r, { estado: 'falhada', fase: 'login', motivo: 'O site recusou o e-mail ou a palavra-passe' });
  assert.ok(d.esperas < 10, `esperou ${d.esperas} vezes`);
  assert.ok(!JSON.stringify(r).includes(SENHA));
});

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

test('Betclic: sair espera que o site volte à raiz antes de abrir o login', async () => {
  const CONTA = `<!doctype html><html><body><header><a href="/account">A minha conta</a></header>
    <button id="sair">Sair</button><div role="dialog" hidden><button id="sim">Sim</button></div></body></html>`;
  const d = criarDriver({
    paginas: { [`${BETCLIC}/account`]: { html: CONTA, preparar: (w) => {
      const doc = w.document;
      doc.getElementById('sair').addEventListener('click', () => { doc.querySelector('[role="dialog"]').hidden = false; });
      doc.getElementById('sim').addEventListener('click', () => { w.__saiu = true; });
    } }, [`${BETCLIC}/`]: { fixture: 'betclic-sem-sessao' }, [LOGIN_BETCLIC]: { html: FORM_BETCLIC } }
  });
  // O site demora a terminar a sessão: só passadas umas esperas volta à raiz.
  let depois = 0;
  const esperar = d.esperar;
  d.esperar = async () => { await esperar(); if (d.janela.__saiu && ++depois === 6) d.abrir(`${BETCLIC}/`); };
  const navegar = d.navegar;
  let noLogin = null;
  d.navegar = async (url) => { if (url === LOGIN_BETCLIC) noLogin = depois; return navegar(url); };
  await d.navegar(`${BETCLIC}/account`);
  assert.equal(await sair(d, 'betclic', null), null);
  assert.equal(noLogin, 6, 'o login só abre depois de o site voltar à raiz');
});

test('Betclic: sair reconhece a falta de sessão pelo botão Aceder, sem clicar em nada', async () => {
  const d = criarDriver({ paginas: { [`${BETCLIC}/`]: { fixture: 'betclic-sem-sessao' } } });
  await d.navegar(`${BETCLIC}/`);
  assert.equal(await sair(d, 'betclic', null), null);
  assert.ok(!d.nomes().includes('passoLogout'));
});

// O pedido ao dono da conta, como o executor real: devolve os códigos pela ordem dada e regista cada pedido.
function dono(codigos) {
  const pedidos = [];
  return { pedidos, pedirCodigo: async (o) => { pedidos.push(o); return codigos.shift() ?? null; } };
}

test('Betclic: ecrã do código por SMS: pede-o ao dono, escreve-o, valida e entra', async () => {
  const b = betclic(['codigo', 'inicio']);
  const p = dono([CODIGO_CERTO]);
  assert.equal(await entrar(b.d, 'betclic', null, COM_NASCIMENTO, { pedirCodigo: p.pedirCodigo }), null);
  assert.deepEqual(p.pedidos, [{ repetido: false }]);
  assert.deepEqual(b.codigosEscritos, [CODIGO_CERTO]);
  // O código só vai para o site, nunca para um registo do driver.
  assert.ok(!JSON.stringify(registados(b)).includes(CODIGO_CERTO));
});

test('Betclic: código recusado: pede outro (repetido) e entra com o segundo', async () => {
  const b = betclic(['codigo', 'inicio']);
  const p = dono(['111111', CODIGO_CERTO]);
  assert.equal(await entrar(b.d, 'betclic', null, COM_NASCIMENTO, { pedirCodigo: p.pedirCodigo }), null);
  assert.deepEqual(p.pedidos, [{ repetido: false }, { repetido: true }]);
  assert.deepEqual(b.codigosEscritos, ['111111', CODIGO_CERTO]);
});

test('Betclic: dois códigos recusados: falhada sem pedir um terceiro', async () => {
  const b = betclic(['codigo', 'inicio']);
  const p = dono(['111111', '222222', CODIGO_CERTO]);
  const r = await entrar(b.d, 'betclic', null, COM_NASCIMENTO, { pedirCodigo: p.pedirCodigo });
  assert.deepEqual(r, { estado: 'falhada', fase: 'codigo-telemovel', motivo: 'O casino não aceitou o código do telemóvel' });
  assert.equal(p.pedidos.length, 2);
});

test('Betclic: o dono não manda o código: falhada sem escrever nada', async () => {
  const b = betclic(['codigo', 'inicio']);
  const r = await entrar(b.d, 'betclic', null, COM_NASCIMENTO, dono([]));
  assert.equal(r.fase, 'codigo-telemovel');
  assert.match(r.motivo, /não mandou o código/);
  assert.deepEqual(b.codigosEscritos, []);
});

test('Betclic: ecrã do código numa tarefa sem forma de o pedir: falhada', async () => {
  const b = betclic(['codigo', 'inicio']);
  const r = await entrar(b.d, 'betclic', null, COM_NASCIMENTO);
  assert.equal(r.fase, 'codigo-telemovel');
});
