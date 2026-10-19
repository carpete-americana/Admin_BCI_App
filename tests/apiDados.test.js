'use strict';

/** O cliente HTTP do processo principal: só usa o token da sessão e nunca fica pendurado. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { criarApi } = require('../src/main/apiDados');

function fetchFalso(resposta = { status: 200, json: { ok: true } }) {
  const pedidos = [];
  const fn = async (url, opcoes) => {
    pedidos.push({ url, opcoes });
    if (resposta instanceof Error) throw resposta;
    return { status: resposta.status, json: async () => { if (resposta.json === undefined) throw new Error('sem corpo'); return resposta.json; } };
  };
  return { fn, pedidos };
}

test('junta a base ao caminho, manda o Bearer e o corpo em JSON', async () => {
  const f = fetchFalso();
  const api = criarApi({ baseUrl: 'https://exemplo.pt/api', lerToken: () => 'tok', fetchFn: f.fn });
  const r = await api.post('/users/me/devices', { a: 1 });
  assert.deepEqual(r, { status: 200, corpo: { ok: true } });
  assert.equal(f.pedidos[0].url, 'https://exemplo.pt/api/users/me/devices');
  assert.equal(f.pedidos[0].opcoes.method, 'POST');
  assert.equal(f.pedidos[0].opcoes.headers.Authorization, 'Bearer tok');
  assert.equal(f.pedidos[0].opcoes.body, '{"a":1}');
});

test('sem token responde 401 sem sair para a rede', async () => {
  const f = fetchFalso();
  const api = criarApi({ baseUrl: 'https://exemplo.pt/api', lerToken: () => null, fetchFn: f.fn });
  assert.deepEqual(await api.get('/x'), { status: 401, corpo: null });
  assert.equal(f.pedidos.length, 0);
});

test('resposta sem JSON dá corpo null; erro de rede lança', async () => {
  const semCorpo = criarApi({ baseUrl: 'https://e.pt', lerToken: () => 't', fetchFn: fetchFalso({ status: 204 }).fn });
  assert.deepEqual(await semCorpo.del('/x'), { status: 204, corpo: null });
  const rede = criarApi({ baseUrl: 'https://e.pt', lerToken: () => 't', fetchFn: fetchFalso(new Error('ECONNRESET')).fn });
  await assert.rejects(rede.get('/x'), /ECONNRESET/);
});

test('um pedido que não responde é abortado ao fim do tempo limite', async () => {
  const fn = (url, { signal }) => new Promise((_, rejeitar) => signal.addEventListener('abort', () => rejeitar(new Error('abortado'))));
  const api = criarApi({ baseUrl: 'https://e.pt', lerToken: () => 't', fetchFn: fn, tempoLimiteMs: 20 });
  await assert.rejects(api.get('/x'), /abortado/);
});

test('o token renovado pelo servidor (X-Sessao-Renovada) é guardado; sem cabeçalho não se guarda nada', async () => {
  const guardados = [];
  const comCabecalho = async () => ({ status: 200, headers: { get: (n) => (n.toLowerCase() === 'x-sessao-renovada' ? 'novo.token.jwt' : null) }, json: async () => ({}) });
  const semCabecalho = async () => ({ status: 200, headers: { get: () => null }, json: async () => ({}) });
  const a = criarApi({ baseUrl: 'https://e.pt', lerToken: () => 'velho', fetchFn: comCabecalho, guardarToken: (t) => guardados.push(t) });
  await a.get('/x');
  assert.deepEqual(guardados, ['novo.token.jwt']);
  const b = criarApi({ baseUrl: 'https://e.pt', lerToken: () => 'velho', fetchFn: semCabecalho, guardarToken: (t) => guardados.push(t) });
  await b.get('/x');
  assert.equal(guardados.length, 1);
});

test('guardar o token renovado nunca estraga a resposta', async () => {
  const fn = async () => ({ status: 200, headers: { get: () => 'novo' }, json: async () => ({ ok: true }) });
  const api = criarApi({ baseUrl: 'https://e.pt', lerToken: () => 't', fetchFn: fn, guardarToken: () => { throw new Error('disco cheio'); } });
  assert.deepEqual(await api.get('/x'), { status: 200, corpo: { ok: true } });
});
