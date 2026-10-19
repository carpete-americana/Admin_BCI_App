'use strict';

/**
 * Núcleo das operações automáticas na Admin App. O módulo é o mesmo da User App, que tem a suíte completa
 * (tests/dispositivo.test.js lá); aqui ficam os comportamentos que não podem divergir.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const D = require('../src/main/dispositivo');
const { VERSAO_TEXTO } = require('../src/main/dispositivo-texto');

const token = (id) => `x.${Buffer.from(JSON.stringify({ id })).toString('base64url')}.y`;

function cenario({ resposta = 0, ativo = true, rotas = {}, extra = {} } = {}) {
  const chamadas = [];
  const guardado = new Map();
  const arranque = [];
  const tray = [];
  let sessao = token(3);
  let tique = null;
  const responder = async (metodo, caminho, corpo) => {
    chamadas.push({ metodo, caminho, corpo });
    const chave = `${metodo} ${caminho.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/, ':id')}`;
    if (rotas[chave]) return typeof rotas[chave] === 'function' ? rotas[chave](corpo) : rotas[chave];
    if (chave === 'GET /users/me/devices/config') return { status: 200, corpo: { result: { data: { ativo, versaoConsentimento: VERSAO_TEXTO } } } };
    if (chave === 'POST /users/me/devices') return { status: 200, corpo: {} };
    if (chave === 'POST /users/me/devices/:id/sinal') return { status: 200, corpo: { result: { data: { consentimentoValido: true } } } };
    if (chave === 'DELETE /users/me/devices/:id') return { status: 200, corpo: {} };
    return { status: 404, corpo: {} };
  };
  const d = D.criarDispositivo({
    api: { get: (c) => responder('GET', c), post: (c, b) => responder('POST', c, b), del: (c) => responder('DELETE', c) },
    lerToken: () => sessao,
    storage: { getItem: (k) => guardado.get(k) ?? null, setItem: (k, v) => { guardado.set(k, JSON.parse(JSON.stringify(v))); }, removeItem: (k) => { guardado.delete(k); } },
    safeStorage: { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(`c:${s}`), decryptString: (b) => b.toString() },
    app: { setLoginItemSettings: (o) => arranque.push(o), getVersion: () => '1.2.0' },
    dialog: { showMessageBox: async () => ({ response: resposta }) },
    tray: { setOperacoes: (v) => tray.push(v) },
    versoes: { so: 'win32 10.0', electron: '44.4.5' },
    randomUUID: () => crypto.randomUUID(),
    setIntervalFn: (fn, ms) => { tique = { fn, ms }; return 1; },
    clearIntervalFn: () => { tique = null; },
    ...extra
  });
  return { d, chamadas, guardado, arranque, tray, tique: () => tique, sairDaSessao: () => { sessao = null; } };
}

test('nada é registado antes de aceitar; «Cancelar» não chama a API', async () => {
  const c = cenario({ resposta: 1 });
  assert.equal((await c.d.estado()).consentido, false);
  assert.deepEqual(await c.d.aceitar(), { ok: false, motivo: 'cancelado' });
  assert.equal(c.chamadas.filter(x => x.metodo === 'POST').length, 0);
  assert.equal(c.arranque.length, 0);
});

test('aceitar regista o dispositivo, liga o arranque oculto e o tray', async () => {
  const c = cenario();
  assert.deepEqual(await c.d.aceitar(), { ok: true });
  const post = c.chamadas.find(x => x.metodo === 'POST');
  assert.equal(Buffer.from(post.corpo.chavePublica, 'base64').length, 32);
  assert.equal(post.corpo.versao, VERSAO_TEXTO);
  assert.deepEqual(c.arranque.at(-1), { openAtLogin: true, args: ['--oculto'] });
  assert.equal(c.tray.at(-1), true);
});

test('o servidor dizer que o consentimento deixou de valer desliga tudo', async () => {
  const c = cenario({ rotas: { 'POST /users/me/devices/:id/sinal': { status: 200, corpo: { result: { data: { consentimentoValido: false } } } } } });
  await c.d.aceitar();
  c.d.iniciar();
  assert.equal(c.tique().ms, 120000);
  await c.tique().fn();
  assert.equal(c.guardado.get('dispositivo:3').consentido, false);
  assert.deepEqual(c.arranque.at(-1), { openAtLogin: false, args: [] });
  assert.equal(c.tray.at(-1), false);
});

test('sem sessão não há pedidos; o logout desliga o arranque sem revogar', async () => {
  const c = cenario();
  await c.d.aceitar();
  c.d.iniciar();
  c.sairDaSessao();
  c.chamadas.length = 0;
  await c.tique().fn();
  assert.equal(c.chamadas.length, 0);
  c.d.aoTerminarSessao();
  assert.deepEqual(c.arranque.at(-1), { openAtLogin: false, args: [] });
  assert.equal(c.guardado.get('dispositivo:3').consentido, true);
});

test('revogar faz DELETE, desliga o arranque e guarda o deviceId para um novo consentimento', async () => {
  const c = cenario();
  await c.d.aceitar();
  const id = c.guardado.get('dispositivo:3').deviceId;
  assert.deepEqual(await c.d.revogar(), { ok: true });
  assert.ok(c.chamadas.some(x => x.metodo === 'DELETE' && x.caminho === `/users/me/devices/${id}`));
  assert.equal(c.guardado.get('dispositivo:3').consentido, false);
  assert.equal(c.guardado.get('dispositivo:3').deviceId, id);
  assert.deepEqual(c.arranque.at(-1), { openAtLogin: false, args: [] });
  assert.equal(c.tray.at(-1), false);
});

test('arrancarOculto só com --oculto', () => {
  assert.equal(D.arrancarOculto(['BCI.exe', '--oculto']), true);
  assert.equal(D.arrancarOculto(['BCI.exe']), false);
  assert.equal(D.arrancarOculto(undefined), false);
});

const invalido = (motivo) => ({ status: 200, corpo: { result: { data: { consentimentoValido: false, motivo } } } });

test('os sinais válidos não reescrevem o arranque do Windows', async () => {
  const c = cenario();
  await c.d.aceitar();
  const antes = c.arranque.length;
  c.d.iniciar();
  await c.tique().fn();
  await c.tique().fn();
  assert.equal(c.arranque.length, antes);
});

test('«desligado» suspende o arranque e o tray mas mantém o consentimento', async () => {
  const c = cenario({ rotas: { 'POST /users/me/devices/:id/sinal': invalido('desligado') } });
  await c.d.aceitar();
  c.d.iniciar();
  await c.tique().fn();
  assert.equal(c.guardado.get('dispositivo:3').consentido, true);
  assert.deepEqual(c.arranque.at(-1), { openAtLogin: false, args: [] });
  assert.equal(c.tray.at(-1), false);
});

test('«versao» e «revogado» apagam o consentimento local', async () => {
  for (const motivo of ['versao', 'revogado']) {
    const c = cenario({ rotas: { 'POST /users/me/devices/:id/sinal': invalido(motivo) } });
    await c.d.aceitar();
    c.d.iniciar();
    await c.tique().fn();
    assert.equal(c.guardado.get('dispositivo:3').consentido, false, motivo);
  }
});

test('401 e 403 no sinal desligam o arranque e o tray sem revogar', async () => {
  for (const estado of [401, 403]) {
    const c = cenario({ rotas: { 'POST /users/me/devices/:id/sinal': { status: estado, corpo: {} } } });
    await c.d.aceitar();
    c.d.iniciar();
    await c.tique().fn();
    assert.deepEqual(c.arranque.at(-1), { openAtLogin: false, args: [] }, String(estado));
    assert.equal(c.tray.at(-1), false);
    assert.equal(c.guardado.get('dispositivo:3').consentido, true);
    assert.equal(c.chamadas.some(x => x.metodo === 'DELETE'), false);
  }
});

test('a revogação fica pendente sempre que o servidor não a confirmou', async () => {
  for (const [estado, pendente] of [[401, true], [500, true], [200, false], [404, false]]) {
    const c = cenario({ rotas: { 'DELETE /users/me/devices/:id': { status: estado, corpo: {} } } });
    await c.d.aceitar();
    await c.d.revogar();
    assert.equal(c.guardado.get('dispositivo:3').revogarPendente, pendente, String(estado));
  }
});

// Fase 2: tarefas na resposta do sinal.

const comTarefa = (tarefa) => ({ 'POST /users/me/devices/:id/sinal': { status: 200, corpo: { result: { data: { consentimentoValido: true, tarefa } } } } });
const tarefaSimulada = (extra = {}) => ({ tarefaId: 31, tipo: 'levantar', simulada: true, parametros: { simular: 'ok' }, contaRotulo: 'Placard · conta 5', leaseAte: '2026-10-19T12:10:00Z', ...extra });

function rotasTarefa(tarefa, registo) {
  return {
    ...comTarefa(tarefa),
    'POST /users/me/devices/:id/tarefas/31/iniciar': () => { registo.push('iniciar'); return { status: 200, corpo: {} }; },
    'POST /users/me/devices/:id/tarefas/31/concluir': (corpo) => { registo.push(['concluir', corpo]); return { status: 200, corpo: {} }; }
  };
}

const semEspera = { esperar: async () => {}, aleatorio: () => 0, registar: () => {} };

test('o registo e o sinal declaram a capacidade tarefas-v1', async () => {
  const c = cenario({ extra: semEspera });
  await c.d.aceitar();
  assert.deepEqual(c.chamadas.filter(x => x.metodo === 'POST')[0].corpo.capacidades, ['tarefas-v1']);
  c.d.iniciar();
  await c.tique().fn();
  assert.deepEqual(c.chamadas.filter(x => x.metodo === 'POST').filter(p => /sinal$/.test(p.caminho)).at(-1).corpo.capacidades, ['tarefas-v1']);
});

test('tarefa simulada no sinal: inicia e conclui pelas rotas da tarefa', async () => {
  const registo = [];
  const c = cenario({ rotas: rotasTarefa(tarefaSimulada(), registo), extra: semEspera });
  await c.d.aceitar();
  c.d.iniciar();
  await c.tique().fn();
  await c.d.aguardarTarefa();
  assert.deepEqual(registo, ['iniciar', ['concluir', { estado: 'feita', resultado: { simulado: true, motivo: 'Simulação' } }]]);
  const id = c.guardado.get('dispositivo:3').deviceId;
  assert.ok(c.chamadas.some(x => x.caminho === `/users/me/devices/${id}/tarefas/31/iniciar`));
});

test('a mesma tarefa em dois sinais seguidos só se executa uma vez', async () => {
  const registo = [];
  const c = cenario({ rotas: rotasTarefa(tarefaSimulada(), registo), extra: semEspera });
  await c.d.aceitar();
  c.d.iniciar();
  await c.tique().fn();
  await c.tique().fn();
  await c.d.aguardarTarefa();
  await c.tique().fn();
  await c.d.aguardarTarefa();
  assert.equal(registo.filter(r => r === 'iniciar').length, 1);
});

test('uma tarefa de cada vez: outra tarefa enquanto a primeira corre fica para depois', async () => {
  let soltar;
  const parado = new Promise(r => { soltar = r; });
  const registo = [];
  let tarefa = tarefaSimulada();
  const rotas = {
    'POST /users/me/devices/:id/sinal': () => ({ status: 200, corpo: { result: { data: { consentimentoValido: true, tarefa } } } }),
    'POST /users/me/devices/:id/tarefas/31/iniciar': () => { registo.push('iniciar 31'); return { status: 200, corpo: {} }; },
    'POST /users/me/devices/:id/tarefas/32/iniciar': () => { registo.push('iniciar 32'); return { status: 200, corpo: {} }; }
  };
  const c = cenario({ rotas, extra: { ...semEspera, esperar: () => parado } });
  await c.d.aceitar();
  c.d.iniciar();
  await c.tique().fn();
  tarefa = tarefaSimulada({ tarefaId: 32 });
  await c.tique().fn();
  assert.deepEqual(registo, ['iniciar 31']);
  soltar();
  await c.d.aguardarTarefa();
});

test('tarefa não simulada nunca chama iniciar', async () => {
  const registo = [];
  const avisos = [];
  const c = cenario({ rotas: rotasTarefa(tarefaSimulada({ simulada: false }), registo), extra: { ...semEspera, registar: (m) => avisos.push(m) } });
  await c.d.aceitar();
  c.d.iniciar();
  await c.tique().fn();
  await c.d.aguardarTarefa();
  assert.deepEqual(registo, []);
  assert.equal(avisos.length, 1);
});

test('servidor antigo (sem tarefa na resposta) continua a funcionar', async () => {
  const c = cenario({ extra: semEspera });
  await c.d.aceitar();
  c.d.iniciar();
  await c.tique().fn();
  await c.d.aguardarTarefa();
  assert.equal(c.chamadas.filter(x => /tarefas/.test(x.caminho)).length, 0);
  assert.deepEqual(c.tray.at(-1), true);
});

test('iniciar recusado (409): não conclui e a tarefa não volta a correr', async () => {
  const registo = [];
  const rotas = { ...rotasTarefa(tarefaSimulada(), registo), 'POST /users/me/devices/:id/tarefas/31/iniciar': () => { registo.push('iniciar'); return { status: 409, corpo: {} }; } };
  const c = cenario({ rotas, extra: semEspera });
  await c.d.aceitar();
  c.d.iniciar();
  await c.tique().fn();
  await c.d.aguardarTarefa();
  await c.tique().fn();
  await c.d.aguardarTarefa();
  assert.deepEqual(registo, ['iniciar']);
});

test('nenhum pedido sai de /users/me/devices', async () => {
  const registo = [];
  const c = cenario({ rotas: rotasTarefa(tarefaSimulada({ parametros: { simular: 'falha' } }), registo), extra: semEspera });
  await c.d.aceitar();
  c.d.iniciar();
  await c.tique().fn();
  await c.d.aguardarTarefa();
  assert.ok(c.chamadas.length > 2);
  for (const x of c.chamadas) assert.ok(x.caminho.startsWith('/users/me/devices'), x.caminho);
  assert.equal(registo.at(-1)[1].estado, 'falhada');
});
