'use strict';

/** Ler a verificação (KYC) da conta sem abrir o formulário: bloqueio antes de navegar, estados, o link fora do progresso e o despacho no executor. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { verificarConta } = require('../src/main/verificacao');
const { levantarDaConta } = require('../src/main/levantar');
const { criarExecutorReal } = require('../src/main/executorReal');
const { criarDriver, fixture } = require('./ajuda/paginaJsdom');
const vetor = require('./fixtures/entrega-vetor.json');

const LB_LOGIN = 'https://www.lebull.pt/#login';
const LB_KYC = 'https://www.lebull.pt/profile/kyc';
const LB_LEVANTAR = 'https://www.lebull.pt/profile/wallet/withdrawal';
const LINK = 'https://forms.kycaid.com/000000000000000000000000000000000000';
const CREDENCIAL = { username: 'joao', password: 'segredo-9X!' };

// Login da LeBull pelo modal; `kyc` é a fixture da página da verificação. `bloquear: false` faz de app antiga.
function cenario({ kyc = 'lebull-kyc-precisa', bloquear = true, falharBloqueio = false, preparar } = {}) {
  let dentro = false;
  const d = criarDriver({
    paginas: {
      [LB_LOGIN]: () => ({ fixture: dentro ? 'lebull-com-sessao' : 'lebull-login' }),
      [LB_KYC]: { fixture: kyc, preparar },
      [LB_LEVANTAR]: { fixture: 'lebull-levantar-iban', caixa: fixture('lebull-levantar-iban'), caixaUrl: LB_LEVANTAR }
    },
    aoChamar: (nome, dr) => { if (nome === 'clicarEntrar' && !dentro) { dentro = true; dr.abrir(LB_LOGIN); } }
  });
  if (bloquear) {
    d.bloquear = async (hosts) => {
      d.chamadas.push({ nome: 'bloquear', args: [hosts] });
      if (falharBloqueio) throw new Error('bloquear rebentou');
    };
  }
  return d;
}
const pedido = (extra = {}) => ({ casino: 'lebull', fluxo: null, credencial: CREDENCIAL, ...extra });
const indice = (d, nome, arg) => d.chamadas.findIndex(c => c.nome === nome && (arg === undefined || c.args?.[0] === arg));

test('precisa: bloqueia forms.kycaid.com antes de abrir a página da verificação e devolve o link', async () => {
  const d = cenario();
  const r = await verificarConta(d, pedido());
  assert.deepEqual(r, { estado: 'ensaio', verificacao: 'precisa', link: LINK, motivo: 'Verificação lida' });
  const bloqueio = d.chamadas.find(c => c.nome === 'bloquear');
  assert.deepEqual(bloqueio.args, [['forms.kycaid.com']]);
  assert.ok(indice(d, 'bloquear') >= 0 && indice(d, 'bloquear') < indice(d, 'navegar', LB_KYC));
  // Antes de qualquer navegação: nem o login chega a correr sem o bloqueio.
  assert.ok(indice(d, 'bloquear') < indice(d, 'navegar'));
});

test('sem iframe nem ecrã conhecido: verificar, ao fim da espera de ~10 s', async () => {
  const d = cenario({ kyc: 'lebull-kyc-sem-iframe' });
  const r = await verificarConta(d, pedido());
  assert.deepEqual(r, { estado: 'verificar', fase: 'verificacao', motivo: 'Ecrã da verificação não reconhecido' });
  assert.equal(d.chamadas.filter(c => c.nome === 'lerVerificacao').length, 40);
});

test('iframe com outro endereço: verificar, nunca precisa', async () => {
  const d = cenario({ preparar: (w) => w.document.querySelector('iframe').setAttribute('src', 'https://evil.pt/x') });
  const r = await verificarConta(d, pedido());
  assert.equal(r.estado, 'verificar');
  assert.equal(r.link, undefined);
});

test('app sem driver.bloquear: verificar sem abrir o casino', async () => {
  const d = cenario({ bloquear: false });
  const r = await verificarConta(d, pedido());
  assert.equal(r.estado, 'verificar');
  assert.equal(r.fase, 'verificacao');
  assert.match(r.motivo, /bloquear/);
  assert.equal(indice(d, 'navegar'), -1);
});

test('bloqueio que rebenta: falhada sem navegar', async () => {
  const d = cenario({ falharBloqueio: true });
  const r = await verificarConta(d, pedido());
  assert.equal(r.estado, 'falhada');
  assert.equal(indice(d, 'navegar'), -1);
});

test('o link nunca vai no progresso', async () => {
  const passos = [];
  const r = await verificarConta(cenario(), pedido(), (...a) => passos.push(a));
  assert.equal(r.verificacao, 'precisa');
  assert.ok(passos.length > 0);
  assert.ok(!JSON.stringify(passos).includes('kycaid'));
});

test('deveParar: falhada «parado» antes de entrar', async () => {
  const d = cenario();
  const r = await verificarConta(d, pedido({ deveParar: () => true }));
  assert.deepEqual([r.estado, r.fase], ['falhada', 'parado']);
  assert.equal(indice(d, 'navegar'), -1);
});

test('casino sem verificação: falhada «casino»', async () => {
  const r = await verificarConta(cenario(), pedido({ casino: 'placard' }));
  assert.deepEqual([r.estado, r.fase], ['falhada', 'casino']);
});

test('levantamento com o aviso do IBAN: falhada «verificacao-pedida»', async () => {
  const d = cenario();
  const r = await levantarDaConta(d, { ...pedido(), parametros: { modo: 'igual', valor: 20, minimo: 10 }, ensaio: false });
  assert.deepEqual([r.estado, r.fase], ['falhada', 'verificacao-pedida']);
  assert.ok(!d.nomes().includes('prepararLevantamento'));
});

// ---------- executor ----------

function montarExecutor(motor) {
  const registo = [];
  const chamadas = { levantar: 0, verificar: 0 };
  const executar = criarExecutorReal({
    api: { post: async () => ({ status: 200, corpo: { result: { data: { ...vetor.entrega, username: 'joao', fluxo: null } } } }) },
    raiz: (id) => `/users/me/devices/${id}`,
    criarJanela: () => ({ driver: {}, fechar: () => {} }),
    levantar: async () => { chamadas.levantar++; return { estado: 'ensaio', saldo: 1, link: LINK }; },
    depositar: async () => ({ estado: 'falhada' }),
    verificar: async (driver, p, aoPasso) => { chamadas.verificar++; await aoPasso('a-entrar'); return motor(p); },
    sair: async () => null
  });
  const io = {
    iniciar: async () => {},
    progresso: async (p) => registo.push({ p }),
    concluir: async (estado, resultado) => registo.push({ estado, resultado })
  };
  const ctx = { deviceId: 'D1', privada: async () => vetor.privada };
  return { correr: (tarefa) => executar(tarefa, io, ctx), registo, chamadas };
}
const TAREFA = { tarefaId: vetor.tarefaId, casino: 'LeBull', tipo: 'levantar', parametros: { verificacao: true, ensaio: true } };

test('executor: parametros.verificacao chama verificar e não levantar, e o link chega ao concluir', async () => {
  const { correr, registo, chamadas } = montarExecutor(async () => ({ estado: 'ensaio', verificacao: 'precisa', link: LINK, motivo: 'Verificação lida' }));
  await correr(TAREFA);
  assert.deepEqual(chamadas, { levantar: 0, verificar: 1 });
  const fim = registo.find(x => x.estado);
  assert.equal(fim.estado, 'ensaio');
  assert.equal(fim.resultado.verificacao, 'precisa');
  assert.equal(fim.resultado.link, LINK);
  assert.equal(fim.resultado.saldo, undefined);
});

test('executor: verificação não reconhecida chega como verificar, com a fase', async () => {
  const { correr, registo } = montarExecutor(async () => ({ estado: 'verificar', fase: 'verificacao', motivo: 'Ecrã da verificação não reconhecido' }));
  await correr(TAREFA);
  const fim = registo.find(x => x.estado);
  assert.equal(fim.estado, 'verificar');
  assert.deepEqual([fim.resultado.fase, fim.resultado.motivo], ['verificacao', 'Ecrã da verificação não reconhecido']);
});

test('executor: um levantamento nunca deixa sair um link, mesmo que o motor o devolva', async () => {
  const { correr, registo, chamadas } = montarExecutor(async () => ({}));
  await correr({ ...TAREFA, parametros: { modo: 'igual', valor: 20 } });
  assert.deepEqual(chamadas, { levantar: 1, verificar: 0 });
  assert.equal(registo.find(x => x.estado).resultado.link, undefined);
});
