'use strict';

/** O motor de depósito contra jsdom: cada estado final, o código promocional, a referência e a paridade com a extensão. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { depositarDaConta, valorDoDeposito, codigoDoDeposito, hostsExtraDe } = require('../src/main/depositar');
const { criarDriver, fixture } = require('./ajuda/paginaJsdom');

const SENHA = 'segredo-9X!';
const CREDENCIAL = { username: 'joao', password: SENHA };
const LOGIN = 'https://www.placard.pt/levantar';
const DEPOSITAR = 'https://www.placard.pt/depositar';

const FORMULARIO = `<!doctype html><html><body><form>
  <input name="userName"><input name="password" type="password">
  <button type="submit">Iniciar sessão</button></form></body></html>`;
const ENTROU = '<!doctype html><html><body><header><button>Depositar</button></header></body></html>';
const corpo = (nome) => fixture(nome).match(/<body>([^]*)<\/body>/)[1];

/**
 * O caixa da Placard. depois: o que o clique em Depositar faz ('referencia' no caixa, 'janela' nova, 'erro', 'nada').
 * codigo: 'valido' (o caixa valida), 'invalido', 'recusado' (mensagem de recusa) ou 'sem-campo'.
 */
function preparaCaixa({ depois, codigo }) {
  return (w) => {
    const d = w.document;
    d.getElementById('item_amount_1').addEventListener('input', (e) => { d.getElementById('continueButton').disabled = !e.target.value; });
    d.getElementById('mb').addEventListener('click', (e) => e.currentTarget.classList.add('selected'));
    if (codigo === 'sem-campo') d.querySelector('.promocode-wrapper').remove();
    d.getElementById('show_promo_code')?.addEventListener('change', (e) => { d.querySelector('.row.promoCode').style.display = e.target.checked ? 'block' : 'none'; });
    d.getElementById('promoCode')?.addEventListener('blur', () => {
      d.getElementById('promoCode_validation').className = `validation_image ${codigo === 'invalido' ? 'invalid_field' : 'valid_field'}`;
      if (codigo === 'recusado') d.body.insertAdjacentHTML('beforeend', '<span class="promo-error">Código promocional já utilizado</span>');
    });
    d.getElementById('continueButton').addEventListener('click', () => {
      if (depois === 'referencia') d.body.innerHTML = corpo('referencia-sibs');
      if (depois === 'erro') d.body.innerHTML = '<div role="alert">Limite de depósito excedido.</div>';
      if (depois === 'limites') d.body.insertAdjacentHTML('beforeend', '<p>Mínimo 10 € · Máximo 1000 €</p>');
      if (depois === 'montante-lido') {
        d.body.innerHTML = '<p>Entidade: 50410</p><p>Referência: 123 456 789</p><p>Montante: 1.000,00 €</p>';
      }
    });
  };
}

function cenario({ logado = false, depois = 'referencia', codigo = 'valido', aoChamar, ...resto } = {}) {
  let dentro = logado;
  const paginas = {
    [LOGIN]: () => (dentro ? { html: ENTROU } : { html: FORMULARIO }),
    [DEPOSITAR]: () => ({ html: ENTROU, caixa: fixture('caixa-deposito'), preparaCaixa: preparaCaixa({ depois, codigo }) })
  };
  return criarDriver({
    paginas,
    aoChamar: (nome, d) => {
      if (nome === 'clicarEntrar' && !dentro) { dentro = true; d.abrir(LOGIN); }
      if (nome === 'confirmarDeposito' && depois === 'janela') d.abrirJanela('referencia-sibs');
      aoChamar?.(nome, d);
    },
    ...resto
  });
}

const PARAMETROS = { modo: 'igual', valor: 20, minimo: 10, ensaio: false };
const pedido = (extra = {}, parametros = {}) => ({
  casino: 'placard', fluxo: null, credencial: CREDENCIAL, parametros: { ...PARAMETROS, ...parametros }, ensaio: false, ...extra
});
const conta = (d, nome) => d.nomes().filter(n => n === nome).length;

// ---------- feita ----------

test('referência no caixa: feita com entidade, referência, valor, validade ISO e o código', async () => {
  const d = cenario();
  const r = await depositarDaConta(d, pedido({}, { codigo: 'BEMVINDO' }));
  assert.deepEqual(
    [r.estado, r.valor, r.codigo, r.entidade, r.referencia, r.validade],
    ['feita', 20, 'BEMVINDO', '50410', '123456789', '2026-10-19']
  );
  assert.equal('montante' in r, false);
  assert.match(r.motivo, /50410/);
  assert.equal(conta(d, 'confirmarDeposito'), 1);
});

test('referência numa janela nova: feita', async () => {
  const d = cenario({ depois: 'janela' });
  const r = await depositarDaConta(d, pedido());
  assert.equal(r.estado, 'feita');
  assert.deepEqual([r.entidade, r.referencia, r.validade, r.codigo], ['50410', '123456789', '2026-10-19', null]);
  assert.ok(d.nomes().includes('janelas:lerReferenciaMB'));
});

test('referência com pontos fica só com dígitos; sem montante lido vale o valor escrito', async () => {
  const d = cenario({ depois: 'nada' });
  d.naJanelasNovas = async () => ({ entidade: '50410', referencia: '123.456 789', montante: null, validade: null });
  const r = await depositarDaConta(d, pedido());
  assert.deepEqual([r.estado, r.referencia, r.valor, r.validade], ['feita', '123456789', 20, null]);
});

test('a página mostra outro montante: o resultado leva o valor que o PC escreveu', async () => {
  const d = cenario({ depois: 'montante-lido' });
  const r = await depositarDaConta(d, pedido());
  assert.equal(r.estado, 'feita');
  assert.equal(r.valor, 20);
  assert.equal('montante' in r, false);
});

// ---------- antes de Depositar ----------

test('ensaio: faz tudo menos carregar em Depositar', async () => {
  const d = cenario();
  const r = await depositarDaConta(d, pedido({ ensaio: true }, { codigo: 'BEMVINDO' }));
  assert.equal(r.estado, 'ensaio');
  assert.equal(r.valor, 20);
  assert.equal(r.codigo, 'BEMVINDO');
  assert.equal(conta(d, 'aplicarCodigo') > 0, true);
  assert.equal(conta(d, 'confirmarDeposito'), 0);
  // O ensaio dos parâmetros também conta.
  const d2 = cenario();
  assert.equal((await depositarDaConta(d2, pedido({}, { ensaio: true }))).estado, 'ensaio');
  assert.equal(conta(d2, 'confirmarDeposito'), 0);
});

test('abaixo do mínimo: saltada sem abrir o caixa', async () => {
  const d = cenario();
  const r = await depositarDaConta(d, pedido({}, { valor: 5 }));
  assert.equal(r.estado, 'saltada');
  assert.match(r.motivo, /mínimo/);
  assert.equal(conta(d, 'prepararDeposito'), 0);
  assert.equal(conta(d, 'navegar'), 0);
});

test('código maior que o máximo do caixa: falhada sem abrir o caixa', async () => {
  const d = cenario();
  const r = await depositarDaConta(d, pedido({}, { codigo: 'UM-CODIGO-DEMASIADO-LONGO' }));
  assert.equal(r.estado, 'falhada');
  assert.match(r.motivo, /15 caracteres/);
  assert.equal(r.codigo, 'UM-CODIGO-DEMASIADO-LONGO');
  assert.equal(conta(d, 'prepararDeposito'), 0);
  assert.equal(conta(d, 'navegar'), 0);
});

test('código que o caixa marca como inválido: falhada sem Depositar', async () => {
  const d = cenario({ codigo: 'invalido' });
  const r = await depositarDaConta(d, pedido({}, { codigo: 'ERRADO' }));
  assert.equal(r.estado, 'falhada');
  assert.match(r.motivo, /inválido/);
  assert.equal(conta(d, 'confirmarDeposito'), 0);
});

test('código recusado pelo caixa: falhada sem Depositar', async () => {
  const d = cenario({ codigo: 'recusado' });
  const r = await depositarDaConta(d, pedido({}, { codigo: 'USADO' }));
  assert.equal(r.estado, 'falhada');
  assert.match(r.motivo, /recusado.*utilizado/i);
  assert.equal(conta(d, 'confirmarDeposito'), 0);
});

test('sem campo do código: falhada, não deposita sem o bónus', async () => {
  const d = cenario({ codigo: 'sem-campo' });
  const r = await depositarDaConta(d, pedido({}, { codigo: 'ABC' }));
  assert.equal(r.estado, 'falhada');
  assert.match(r.motivo, /campo do código promocional/);
  assert.equal(conta(d, 'aplicarCodigo'), 40);
  assert.equal(conta(d, 'confirmarDeposito'), 0);
});

test('sem código não toca no campo do código', async () => {
  const d = cenario();
  const r = await depositarDaConta(d, pedido());
  assert.equal(r.estado, 'feita');
  assert.equal(conta(d, 'aplicarCodigo'), 0);
});

// ---------- depois de Depositar ----------

test('confirmarDeposito rebenta: verificar', async () => {
  const d = cenario({ falhar: (n) => n === 'confirmarDeposito' });
  const r = await depositarDaConta(d, pedido());
  assert.equal(r.estado, 'verificar');
  assert.equal(r.valor, 20);
});

test('90 voltas sem referência: verificar', async () => {
  const d = cenario({ depois: 'nada' });
  const r = await depositarDaConta(d, pedido());
  assert.equal(r.estado, 'verificar');
  assert.equal(r.fase, 'resultado');
  assert.equal(conta(d, 'resultadoDeposito'), 90);
  assert.equal(conta(d, 'janelas:lerReferenciaMB'), 90);
});

test('as janelas novas a rebentar não param as voltas: verificar no fim', async () => {
  const d = cenario({ depois: 'nada', falhar: (n) => n === 'janelas:lerReferenciaMB' });
  const r = await depositarDaConta(d, pedido());
  assert.equal(r.estado, 'verificar');
  assert.equal(conta(d, 'resultadoDeposito'), 90);
});

test('o caixa mostra um erro depois do clique: verificar (a referência pode ter sido gerada)', async () => {
  const d = cenario({ depois: 'erro' });
  const r = await depositarDaConta(d, pedido());
  assert.equal(r.estado, 'verificar');
  assert.equal(r.fase, 'caixa');
  assert.match(r.motivo, /Limite/);
  assert.equal(r.valor, 20);
});

test('texto normal do caixa com «Mínimo» e «Máximo» depois do clique: verificar, nunca falhada', async () => {
  const d = cenario({ depois: 'limites' });
  const r = await depositarDaConta(d, pedido());
  assert.equal(r.estado, 'verificar');
  assert.equal(r.fase, 'caixa');
  assert.match(r.motivo, /Mínimo 10 €/);
});

// ---------- paragem e progresso ----------

test('deveParar depois de aplicar o código: falhada «parado» e nunca Depositar', async () => {
  let parar = false;
  const d = cenario({ aoChamar: (nome) => { if (nome === 'aplicarCodigo') parar = true; } });
  const r = await depositarDaConta(d, pedido({ deveParar: () => parar }, { codigo: 'BEMVINDO' }));
  assert.equal(r.estado, 'falhada');
  assert.equal(r.fase, 'parado');
  assert.match(r.motivo, /antes de Depositar/);
  assert.equal(conta(d, 'confirmarDeposito'), 0);

  const logo = cenario();
  const r0 = await depositarDaConta(logo, pedido({ deveParar: () => true }));
  assert.equal(r0.fase, 'parado');
  assert.deepEqual(logo.nomes(), []);
});

test('deveParar durante o aviso a-depositar: falhada «parado» e nunca Depositar', async () => {
  let parar = false;
  const d = cenario();
  const r = await depositarDaConta(d, pedido({ deveParar: () => parar }), (p) => { if (p === 'a-depositar') parar = true; });
  assert.equal(r.estado, 'falhada');
  assert.equal(r.fase, 'parado');
  assert.equal(conta(d, 'confirmarDeposito'), 0);
});

test('deveParar depois de carregar em Depositar já não pára', async () => {
  let parar = false;
  const d = cenario({ aoChamar: (nome) => { if (nome === 'confirmarDeposito') parar = true; } });
  const r = await depositarDaConta(d, pedido({ deveParar: () => parar }));
  assert.equal(r.estado, 'feita');
});

test('progresso pela ordem, com a-codigo só quando há código', async () => {
  const com = [];
  await depositarDaConta(cenario({ logado: false }), pedido({}, { codigo: 'BEMVINDO' }), (p) => com.push(p));
  assert.deepEqual(com, ['a-entrar', 'a-abrir', 'a-preencher', 'a-codigo', 'a-depositar']);
  const sem = [];
  await depositarDaConta(cenario(), pedido(), (p) => sem.push(p));
  assert.deepEqual(sem, ['a-entrar', 'a-abrir', 'a-preencher', 'a-depositar']);
});

// ---------- a password nunca sai ----------

test('a password não aparece em nenhum resultado, nem quando o driver rebenta com ela', async () => {
  const casos = [
    cenario({ logado: false }),
    cenario({ logado: false, falhar: (n) => n === 'preencherLogin' }),
    cenario({ logado: false, falhar: (n) => n === 'clicarEntrar' }),
    cenario({ falhar: (n) => n === 'prepararDeposito' }),
    cenario({ falhar: (n) => n === 'confirmarDeposito' })
  ];
  for (const d of casos) {
    const r = await depositarDaConta(d, pedido());
    assert.ok(!JSON.stringify(r).includes(SENHA), JSON.stringify(r));
  }
});

test('casino sem depósito automático falha sem navegar', async () => {
  const d = cenario();
  const r = await depositarDaConta(d, pedido({ casino: 'betano' }));
  assert.equal(r.estado, 'falhada');
  assert.equal(r.fase, 'casino');
  assert.equal(d.nomes().length, 0);
});

test('hostsExtraDe: os hosts da janela da referência', () => {
  // O caixa abre a janela em secure.safecharge.com/ppp/review.do (visto no depósito real de 2026-10-21); cdn fica coberto pelo domínio.
  assert.deepEqual(hostsExtraDe('placard'), ['safecharge.com']);
  assert.deepEqual(hostsExtraDe('betano'), []);
  assert.deepEqual(hostsExtraDe('nao-existe'), []);
});

// ---------- paridade com a extensão ----------

// [run da extensão, contaId]; a API já entrega em parametros o valor e o código da conta.
const CASOS = [
  [{ modo: 'igual', valor: 25.9, minimo: 10 }, 1],
  [{ modo: 'porConta', valores: { 1: 15 }, minimo: 10 }, 1],
  [{ modo: 'porConta', valores: { 1: 15 }, minimo: 10 }, 2],
  [{ modo: 'igual', valor: 5, minimo: 10 }, 1],
  [{ modo: 'igual', valor: 'abc' }, 1],
  [{ codigo: 'GERAL' }, 1],
  [{ codigo: 'GERAL', codigos: { 2: 'SO-DELA' } }, 2],
  [{ codigo: 'GERAL', codigos: { 2: 'SO-DELA' } }, 1],
  [{ codigo: '  ' }, 1],
  [{}, 1],
  [{ codigo: 'Bónus 100% - Ç / x_y' }, 1]
];
const paraParametros = (run, contaId) => {
  const { valores, codigos, ...p } = run;
  if (run.modo === 'porConta') p.valor = valores?.[contaId];
  const codigo = codigos?.[contaId] ?? run.codigo;
  if (codigo !== undefined) p.codigo = codigo; else delete p.codigo;
  return p;
};

test('valorDoDeposito e codigoDoDeposito: as saídas conhecidas', () => {
  assert.deepEqual(valorDoDeposito({ modo: 'igual', valor: 25.9, minimo: 10 }), { valor: 25 });
  assert.match(valorDoDeposito({ modo: 'igual', valor: 5, minimo: 10 }).saltar, /mínimo/);
  assert.equal(codigoDoDeposito({ codigo: ' ABC ' }), 'ABC');
  assert.equal(codigoDoDeposito({}), '');
});

const EXTENSAO = path.join(__dirname, '..', '..', 'Casino Autofill Extension', 'background', 'fluxos.js');

test('valorDoDeposito e codigoDoDeposito: iguais aos da extensão nos mesmos casos', { skip: !fs.existsSync(EXTENSAO) && 'a extensão não está ao lado da User App (repo clonado sozinho)' }, () => {
  const ext = require(EXTENSAO);
  for (const [run, contaId] of CASOS) {
    const p = paraParametros(run, contaId);
    assert.deepEqual(valorDoDeposito(p), ext.valorDoDeposito(run, contaId), JSON.stringify([run, contaId]));
    assert.equal(codigoDoDeposito(p), ext.codigoDoDeposito(run, contaId), JSON.stringify([run, contaId]));
  }
});
