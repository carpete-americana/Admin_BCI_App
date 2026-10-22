'use strict';

/** O motor de levantamento contra jsdom: cada estado final, o captcha, as exceções e a paridade com a extensão. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { levantarDaConta, valorDoLevantamento, chaveDoNome } = require('../src/main/levantar');
const { criarDriver } = require('./ajuda/paginaJsdom');

const SENHA = 'segredo-9X!';
const CREDENCIAL = { username: 'joao', password: SENHA };
const HOME = 'https://www.placard.pt/levantar';

const FORMULARIO = `<!doctype html><html><body><form>
  <input name="userName"><input name="password" type="password">
  <button type="submit">Iniciar sessão</button></form></body></html>`;
const ENTROU = (saldo) => `<!doctype html><html><body><header><button>Depositar</button></header>
  <span class="cms-balance-withdrawable_balance">${saldo}</span></body></html>`;
const CAIXA = `<!doctype html><html><body>
  <ul><li class="selected" id="sepa"><div class="pm-logo apmgw_sepa_payouts"></div></li></ul>
  <ul><li class="selected">PT50 0000 0000 0000 0000 1234 5 <div class="upm-logo apmgw_sepa_payouts"></div></li></ul>
  <input id="item_amount_1" type="text"><button id="continueButton" disabled>Levantar</button></body></html>`;

// O caixa só ativa o botão com um montante; ao confirmar mostra a mensagem dada.
function preparaCaixa(mensagem) {
  return (w) => {
    const d = w.document;
    d.getElementById('item_amount_1').addEventListener('input', (e) => { d.getElementById('continueButton').disabled = !e.target.value; });
    if (mensagem) d.getElementById('continueButton').addEventListener('click', () => { d.body.innerHTML = `<p>${mensagem}</p>`; });
  };
}

// Sessão iniciada no arranque, ou formulário que o clique em Entrar troca pela página de dentro.
function cenario({ logado = false, saldo = '30.00 €', mensagem = 'O pedido de levantamento foi submetido com sucesso', depoisDoLogin, aoChamar, ...resto } = {}) {
  let dentro = logado;
  const paginas = {
    [HOME]: () => dentro
      ? { html: ENTROU(saldo), caixa: CAIXA, preparaCaixa: preparaCaixa(mensagem) }
      : depoisDoLogin && depoisDoLogin.antes ? depoisDoLogin.antes : { html: FORMULARIO }
  };
  const driver = criarDriver({
    paginas,
    aoChamar: (nome, d) => {
      if (nome === 'clicarEntrar' && !dentro && !depoisDoLogin) { dentro = true; d.abrir(HOME); }
      aoChamar?.(nome, d);
    },
    ...resto
  });
  return driver;
}

const PARAMETROS = { modo: 'igual', valor: 20, minimo: 10, deixar: 0, ensaio: false };
const pedido = (extra = {}) => ({ casino: 'placard', fluxo: null, credencial: CREDENCIAL, parametros: PARAMETROS, ensaio: false, ...extra });

// ---------- estados finais ----------

test('deveParar antes de Levantar: falhada «parado» e o botão nunca é premido', async () => {
  const logo = cenario();
  const r0 = await levantarDaConta(logo, pedido({ deveParar: () => true }));
  assert.equal(r0.estado, 'falhada');
  assert.equal(r0.fase, 'parado');
  assert.deepEqual(logo.nomes(), [], 'nem chega a abrir o casino');

  // Retirado depois de preparar o caixa: pára antes do clique.
  let parar = false;
  const d = cenario({ aoChamar: (nome) => { if (nome === 'prepararLevantamento') parar = true; } });
  const r = await levantarDaConta(d, pedido({ deveParar: () => parar }));
  assert.equal(r.estado, 'falhada');
  assert.equal(r.fase, 'parado');
  assert.equal(r.valor, 20);
  assert.ok(!d.nomes().includes('confirmarLevantamento'));
});

test('deveParar durante o aviso a-levantar: falhada «parado» e o botão nunca é premido', async () => {
  let parar = false;
  const d = cenario();
  const r = await levantarDaConta(d, pedido({ deveParar: () => parar }), (p) => { if (p === 'a-levantar') parar = true; });
  assert.equal(r.estado, 'falhada');
  assert.equal(r.fase, 'parado');
  assert.ok(!d.nomes().includes('confirmarLevantamento'));
});

test('deveParar depois de carregar em Levantar já não pára: a conta acaba', async () => {
  let parar = false;
  const d = cenario({ aoChamar: (nome) => { if (nome === 'confirmarLevantamento') parar = true; } });
  const r = await levantarDaConta(d, pedido({ deveParar: () => parar }));
  assert.equal(r.estado, 'feita');
});

test('saldo lido: o ensaio devolve valor e iban e nunca confirma', async () => {
  const d = cenario();
  const r = await levantarDaConta(d, pedido({ ensaio: true }));
  assert.equal(r.estado, 'ensaio');
  assert.equal(r.saldo, 30);
  assert.equal(r.valor, 20);
  assert.equal(r.iban, '…2345');
  assert.ok(!d.nomes().includes('confirmarLevantamento'));
});

test('fluxo completo: entra, prepara, confirma e lê o sucesso', async () => {
  const d = cenario({ logado: false });
  const passos = [];
  const r = await levantarDaConta(d, pedido(), (p) => passos.push(p));
  assert.equal(r.estado, 'feita');
  assert.equal(r.valor, 20);
  assert.match(r.motivo, /submetido/);
  assert.deepEqual(passos, ['a-entrar', 'a-abrir', 'a-ler-saldo', 'a-preencher', 'a-levantar']);
  const n = d.nomes();
  assert.ok(n.indexOf('preencherLogin') < n.indexOf('clicarEntrar'));
  assert.ok(n.indexOf('clicarEntrar') < n.indexOf('confirmarLevantamento'));
});

test('o caixa recusa: falhada na fase caixa', async () => {
  const d = cenario({ mensagem: 'Erro: montante recusado' });
  const r = await levantarDaConta(d, pedido());
  assert.equal(r.estado, 'falhada');
  assert.equal(r.fase, 'caixa');
  assert.match(r.motivo, /recusado/);
});

test('saldo ilegível: falhada', async () => {
  const r = await levantarDaConta(cenario({ saldo: 'sem saldo' }), pedido());
  assert.equal(r.estado, 'falhada');
  assert.equal(r.fase, 'saldo');
  assert.equal(r.motivo, 'Não foi possível ler o saldo');
});

test('abaixo do mínimo: saltada, sem tocar no caixa', async () => {
  const d = cenario({ saldo: '5.00 €' });
  const r = await levantarDaConta(d, pedido());
  assert.equal(r.estado, 'saltada');
  assert.equal(r.saldo, 5);
  assert.ok(!d.nomes().includes('prepararLevantamento'));
});

test('login recusado pelo site: falhada na fase login', async () => {
  const ERRO = fs.readFileSync(path.join(__dirname, 'fixtures', 'placard-erro.html'), 'utf8');
  const comErro = criarDriver({
    paginas: { [HOME]: { html: FORMULARIO }, 'https://www.placard.pt/erro': { html: ERRO } },
    aoChamar: (nome, dr) => { if (nome === 'clicarEntrar') dr.abrir('https://www.placard.pt/erro'); }
  });
  const r = await levantarDaConta(comErro, pedido());
  assert.equal(r.estado, 'falhada');
  assert.equal(r.fase, 'login');
  assert.match(r.motivo, /incorreta/);
});

// ---------- verificação de humano ----------

test('captcha que não acaba: espera, não volta a clicar e fica verificar', async () => {
  const d = criarDriver({ paginas: { [HOME]: { fixture: 'captcha-a-decorrer' } } });
  const r = await levantarDaConta(d, pedido());
  assert.equal(r.estado, 'verificar');
  assert.equal(r.fase, 'captcha');
  const n = d.nomes();
  assert.equal(n.filter(x => x === 'estadoLogin').length, 60);
  assert.equal(n.filter(x => x === 'clicarEntrar').length, 1, 'só o clique inicial');
  assert.equal(n.filter(x => x === 'navegar').length, 1);
});

// ---------- depois de confirmar ----------

test('60 voltas sem resposta depois de confirmar: verificar', async () => {
  const d = cenario({ mensagem: '' });
  const r = await levantarDaConta(d, pedido());
  assert.equal(r.estado, 'verificar');
  assert.equal(r.fase, 'resultado');
  assert.equal(d.nomes().filter(n => n === 'resultadoLevantamento').length, 60);
});

test('exceção do driver depois de confirmar é verificar; antes é falhada', async () => {
  const depois = await levantarDaConta(cenario({ falhar: (n) => n === 'confirmarLevantamento' }), pedido());
  assert.equal(depois.estado, 'verificar');
  const antes = await levantarDaConta(cenario({ falhar: (n) => n === 'navegar' }), pedido());
  assert.equal(antes.estado, 'falhada');
});

test('o casino do separador é conferido antes de a password sair', async () => {
  const d = criarDriver({ paginas: { [HOME]: { html: FORMULARIO } } });
  d.url = async () => 'https://www.outro-site.pt/';
  const r = await levantarDaConta(d, pedido({ credencial: CREDENCIAL }));
  assert.equal(r.estado, 'falhada');
  assert.equal(r.fase, 'casino');
  assert.ok(!d.nomes().includes('preencherLogin'));
});

test('se o separador muda de site depois de abrir, a password não sai', async () => {
  const d = criarDriver({ paginas: { [HOME]: { html: FORMULARIO } } });
  const url = d.url;
  let n = 0;
  d.url = async () => (++n === 1 ? url() : 'https://www.outro-site.pt/');
  const r = await levantarDaConta(d, pedido());
  assert.equal(r.fase, 'casino');
  assert.ok(!d.nomes().includes('preencherLogin'));
});

test('casino desconhecido falha sem navegar', async () => {
  const d = cenario();
  const r = await levantarDaConta(d, pedido({ casino: 'nao-existe' }));
  assert.equal(r.estado, 'falhada');
  assert.equal(r.fase, 'casino');
  assert.equal(d.nomes().length, 0);
});

// ---------- a password nunca sai ----------

test('a password não aparece em nenhum resultado, nem quando o driver rebenta com ela', async () => {
  const casos = [
    cenario({ logado: false }),
    cenario({ logado: false, falhar: (n) => n === 'preencherLogin' }),
    cenario({ logado: false, falhar: (n) => n === 'clicarEntrar' }),
    cenario({ falhar: (n) => n === 'lerSaldo' })
  ];
  for (const d of casos) {
    const r = await levantarDaConta(d, pedido());
    assert.ok(!JSON.stringify(r).includes(SENHA), JSON.stringify(r));
  }
});

// ---------- valor e nomes ----------

test('chaveDoNome: os nomes das contas dão a chave do casino', () => {
  const nomes = { Betano: 'betano', Bwin: 'bwin', Betclic: 'betclic', Placard: 'placard', Lebull: 'lebull', Solverde: 'solverde', 'ESC Online': 'esconline' };
  for (const [nome, chave] of Object.entries(nomes)) assert.equal(chaveDoNome(nome), chave, nome);
  assert.equal(chaveDoNome(' placard '), 'placard');
  assert.equal(chaveDoNome('Jogos Santa Casa'), null);
  assert.equal(chaveDoNome(null), null);
  assert.equal(chaveDoNome('Casino Desconhecido'), null);
  // Sem espaços, sim; sem a letra «s», não (a regex antiga tirava os «s»).
  assert.equal(chaveDoNome('Le Bull'), 'lebull');
  assert.equal(chaveDoNome('Placards'), null);
  assert.equal(chaveDoNome('Betanos'), null);
});

const CASOS_VALOR = [
  [{ modo: 'deixar', deixar: 5, minimo: 10 }, 30],
  [{ modo: 'deixar', deixar: 0, minimo: 10 }, 30.9],
  [{ modo: 'deixar', deixar: 30, minimo: 10 }, 50.64],
  [{ modo: 'deixar', deixar: 5, minimo: 10 }, 12],
  [{ modo: 'deixar', deixar: 50, minimo: 1 }, 30],
  [{ modo: 'igual', valor: 20.7, minimo: 10 }, 50],
  [{ modo: 'igual', valor: 20, minimo: 10 }, 19.99],
  [{ modo: 'porConta', valor: 15.5, minimo: 10 }, 50],
  [{ modo: 'porConta', valor: 0, minimo: 10 }, 100],
  [{ modo: 'igual', valor: 'abc' }, 50]
];

test('valorDoLevantamento: as saídas conhecidas', () => {
  assert.deepEqual(valorDoLevantamento({ modo: 'deixar', deixar: 30, minimo: 10 }, 50.64), { valor: 20.64 });
  assert.deepEqual(valorDoLevantamento({ modo: 'igual', valor: 20.7, minimo: 10 }, 50), { valor: 20 });
  assert.match(valorDoLevantamento({ modo: 'igual', valor: 20, minimo: 10 }, 19.99).saltar, /insuficiente/i);
  assert.match(valorDoLevantamento({ modo: 'deixar', deixar: 5, minimo: 10 }, 12).saltar, /abaixo do mínimo/i);
  assert.ok(valorDoLevantamento({ modo: 'igual', valor: 'abc' }, 50).saltar);
});

const EXTENSAO = path.join(__dirname, '..', '..', 'Casino Autofill Extension', 'background', 'fluxos.js');

test('valorDoLevantamento: igual ao da extensão nos mesmos casos', { skip: !fs.existsSync(EXTENSAO) && 'a extensão não está ao lado da User App (repo clonado sozinho)' }, () => {
  const { valorDoLevantamento: daExtensao } = require(EXTENSAO);
  for (const [p, saldo] of CASOS_VALOR) {
    // Na extensão o valor de cada conta vem de run.valores; aqui a API já o entrega em parametros.valor.
    const run = p.modo === 'porConta' ? { ...p, valores: { 1: p.valor } } : p;
    assert.deepEqual(valorDoLevantamento(p, saldo), daExtensao(run, 1, saldo), JSON.stringify([p, saldo]));
  }
});
