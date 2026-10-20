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

function cenario({ userId = 3, resposta = 0, ativo = true, versaoServidor = VERSAO_TEXTO, rotas = {}, extra = {} } = {}) {
  const chamadas = [];
  const guardado = new Map();
  const arranque = [];
  const tray = [];
  const caixas = [];
  let sessao = userId == null ? null : token(userId);
  let tique = null;
  const responder = async (metodo, caminho, corpo) => {
    chamadas.push({ metodo, caminho, corpo });
    const chave = `${metodo} ${caminho.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/, ':id')}`;
    if (rotas[chave] instanceof Error) throw rotas[chave];
    if (rotas[chave]) return typeof rotas[chave] === 'function' ? rotas[chave](corpo) : rotas[chave];
    if (chave === 'GET /users/me/devices/config') return { status: 200, corpo: { result: { data: { ativo, versaoConsentimento: versaoServidor } } } };
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
    dialog: { showMessageBox: async (o) => { caixas.push(o); return { response: resposta }; } },
    tray: { setOperacoes: (v) => tray.push(v) },
    versoes: { so: 'win32 10.0', electron: '44.4.5' },
    randomUUID: () => crypto.randomUUID(),
    setTimeoutFn: (fn, ms) => { tique = { fn, ms }; return 1; },
    clearTimeoutFn: () => { tique = null; },
    maquinaId: async () => 'f'.repeat(64),
    ...extra
  });
  return { d, chamadas, guardado, arranque, tray, caixas, tique: () => tique, sairDaSessao: () => { sessao = null; }, entrarComo: (id) => { sessao = token(id); } };
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

test('o registo e o sinal declaram tarefas e pacotes, e levam o identificador cifrado da máquina', async () => {
  const c = cenario({ extra: semEspera });
  await c.d.aceitar();
  assert.deepEqual(c.chamadas.filter(x => x.metodo === 'POST')[0].corpo.capacidades, ['tarefas-v1', 'pacotes-v1']);
  assert.equal(c.chamadas.filter(x => x.metodo === 'POST')[0].corpo.maquinaId, 'f'.repeat(64));
  c.d.iniciar();
  await c.tique().fn();
  const s = c.chamadas.filter(x => x.metodo === 'POST').filter(p => /sinal$/.test(p.caminho)).at(-1).corpo;
  assert.deepEqual(s.capacidades, ['tarefas-v1', 'pacotes-v1']);
  assert.equal(s.maquinaId, 'f'.repeat(64));
  assert.deepEqual(s.estado, { pc: 'livre' });
});

test('com o consentimento do texto v1 o sinal não leva o identificador da máquina', async () => {
  const c = cenario({ extra: semEspera });
  await c.d.aceitar();
  // Aceite numa versão da app anterior ao texto que fala do identificador.
  const chave = [...c.guardado.keys()].find(k => k.startsWith('dispositivo:'));
  c.guardado.set(chave, { ...c.guardado.get(chave), versao: 1 });
  c.d.iniciar();
  await c.tique().fn();
  const s = c.chamadas.filter(x => x.metodo === 'POST').filter(p => /sinal$/.test(p.caminho)).at(-1).corpo;
  assert.equal('maquinaId' in s, false);
  assert.deepEqual(s.capacidades, ['tarefas-v1', 'pacotes-v1']);
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

test('a tarefa simulada avisa o progresso e a estimativa ao servidor', async () => {
  const registo = [];
  const rotas = {
    ...rotasTarefa(tarefaSimulada(), registo),
    'POST /users/me/devices/:id/tarefas/31/iniciar': (corpo) => { registo.push(['iniciar', corpo]); return { status: 200, corpo: {} }; },
    'POST /users/me/devices/:id/tarefas/31/progresso': (corpo) => { registo.push(['progresso', corpo]); return { status: 200, corpo: {} }; }
  };
  const c = cenario({ rotas, extra: semEspera });
  await c.d.aceitar();
  c.d.iniciar();
  await c.tique().fn();
  await c.d.aguardarTarefa();
  const ini = registo.find(r => r[0] === 'iniciar');
  assert.equal(ini[1].estimativaSeg, 5, 'aleatorio 0 → 5 s');
  const avisos = registo.filter(r => r[0] === 'progresso').map(r => r[1]);
  assert.equal(avisos.length, 4);
  assert.ok(avisos.every(a => a.passo === 'a-simular'));
  assert.deepEqual(avisos.map(a => a.restanteSeg), [5, 4, 3, 1], "5 s em 4 fatias, arredondado");
});

test('o aviso de progresso falhar não interrompe a tarefa', async () => {
  const registo = [];
  const rotas = { ...rotasTarefa(tarefaSimulada(), registo), 'POST /users/me/devices/:id/tarefas/31/progresso': new Error('rede') };
  const c = cenario({ rotas, extra: semEspera });
  await c.d.aceitar();
  c.d.iniciar();
  await c.tique().fn();
  await c.d.aguardarTarefa();
  assert.equal(registo.at(-1)[1].estado, 'feita');
});

test('concluir repete quando a rede falha ou o servidor responde 5xx, e pára nos 4xx', async () => {
  for (const [falhas, esperado] of [[[new Error('rede'), { status: 503, corpo: {} }], 3], [[{ status: 409, corpo: {} }], 1]]) {
    let n = 0;
    const pausas = [];
    const rotas = {
      ...comTarefa(tarefaSimulada()),
      'POST /users/me/devices/:id/tarefas/31/iniciar': { status: 200, corpo: {} },
      'POST /users/me/devices/:id/tarefas/31/concluir': () => { const r = falhas[n++]; if (r instanceof Error) throw r; return r || { status: 200, corpo: {} }; }
    };
    const c = cenario({ rotas, extra: { ...semEspera, esperar: async (ms) => { pausas.push(ms); } } });
    await c.d.aceitar();
    c.d.iniciar();
    await c.tique().fn();
    await c.d.aguardarTarefa();
    assert.equal(n, esperado);
  }
});

test('concluir desiste ao fim de 4 tentativas e regista, sem rebentar', async () => {
  const avisos = [];
  const rotas = {
    ...comTarefa(tarefaSimulada()),
    'POST /users/me/devices/:id/tarefas/31/iniciar': { status: 200, corpo: {} },
    'POST /users/me/devices/:id/tarefas/31/concluir': { status: 500, corpo: {} }
  };
  const c = cenario({ rotas, extra: { ...semEspera, registar: (m) => avisos.push(m) } });
  await c.d.aceitar();
  c.d.iniciar();
  await c.tique().fn();
  await c.d.aguardarTarefa();
  assert.equal(c.chamadas.filter(x => /concluir$/.test(x.caminho)).length, 4);
  assert.ok(avisos.some(m => /não entregue/.test(m)));
});

test('iniciar falha por rede ou 5xx: a tarefa volta a tentar-se no sinal seguinte; 4xx não', async () => {
  for (const [resposta, deveRepetir] of [[new Error('rede'), true], [{ status: 503, corpo: {} }, true], [{ status: 409, corpo: {} }, false]]) {
    let n = 0;
    const rotas = {
      ...comTarefa(tarefaSimulada()),
      'POST /users/me/devices/:id/tarefas/31/iniciar': () => { n++; if (n === 1) { if (resposta instanceof Error) throw resposta; return resposta; } return { status: 200, corpo: {} }; },
      'POST /users/me/devices/:id/tarefas/31/concluir': { status: 200, corpo: {} }
    };
    const c = cenario({ rotas, extra: semEspera });
    await c.d.aceitar();
    c.d.iniciar();
    await c.tique().fn();
    await c.d.aguardarTarefa();
    await c.tique().fn();
    await c.d.aguardarTarefa();
    assert.equal(n, deveRepetir ? 2 : 1, String(resposta.status || resposta.message));
  }
});

test('a mesma tarefa reatribuída (outro lease) volta a correr; no mesmo lease não', async () => {
  const registo = [];
  let tarefa = tarefaSimulada();
  const rotas = {
    'POST /users/me/devices/:id/sinal': () => ({ status: 200, corpo: { result: { data: { consentimentoValido: true, tarefa } } } }),
    'POST /users/me/devices/:id/tarefas/31/iniciar': () => { registo.push('iniciar'); return { status: 200, corpo: {} }; },
    'POST /users/me/devices/:id/tarefas/31/concluir': { status: 200, corpo: {} }
  };
  const c = cenario({ rotas, extra: semEspera });
  await c.d.aceitar();
  c.d.iniciar();
  await c.tique().fn();
  await c.d.aguardarTarefa();
  await c.tique().fn();
  await c.d.aguardarTarefa();
  assert.equal(registo.length, 1, 'mesmo lease: uma vez');
  tarefa = tarefaSimulada({ leaseAte: '2026-10-19T13:00:00Z' });
  await c.tique().fn();
  await c.d.aguardarTarefa();
  assert.equal(registo.length, 2, 'lease novo: corre outra vez');
});

// Aviso ao abrir a app: leva ao consentimento, uma vez por versão do texto.

const { AVISO } = require('../src/main/dispositivo-texto');

test('ligada e sem resposta: o aviso leva ao diálogo de consentimento e regista', async () => {
  const c = cenario({ resposta: 0 });
  const r = await c.d.perguntarSeFaltar();
  assert.equal(r.mostrado, true);
  assert.deepEqual(c.caixas.map(x => x.buttons), [AVISO.botoes, ['Aceito', 'Cancelar']]);
  assert.equal(c.guardado.get('dispositivo:3').consentido, true);
  assert.equal(c.chamadas.filter(x => x.metodo === 'POST').length, 1, 'regista só depois do «Aceito»');
});

test('«Agora não» não abre o consentimento nem regista, e não volta a perguntar nesta versão', async () => {
  const c = cenario({ resposta: 1 });
  assert.equal((await c.d.perguntarSeFaltar()).mostrado, true);
  assert.equal(c.caixas.length, 1);
  assert.equal(c.chamadas.filter(x => x.metodo === 'POST').length, 0);
  assert.equal(c.guardado.get('dispositivo:3').consentido ?? false, false);
  assert.equal((await c.d.perguntarSeFaltar()).mostrado, false);
  assert.equal(c.caixas.length, 1);
});

test('versão nova do texto volta a perguntar uma vez', async () => {
  const c = cenario({ resposta: 1 });
  c.guardado.set('dispositivo:3', { perguntadoVersao: VERSAO_TEXTO - 1 });
  assert.equal((await c.d.perguntarSeFaltar()).mostrado, true);
  assert.equal(c.guardado.get('dispositivo:3').perguntadoVersao, VERSAO_TEXTO);
});

test('já aceite nesta versão, funcionalidade desligada ou app desatualizada: não pergunta', async () => {
  const aceite = cenario();
  await aceite.d.aceitar();
  aceite.caixas.length = 0;
  assert.equal((await aceite.d.perguntarSeFaltar()).mostrado, false);
  assert.equal(aceite.caixas.length, 0);

  for (const c of [cenario({ ativo: false }), cenario({ versaoServidor: VERSAO_TEXTO + 1 })]) {
    assert.equal((await c.d.perguntarSeFaltar()).mostrado, false);
    assert.equal(c.caixas.length, 0);
    assert.equal(c.guardado.size, 0, 'nada fica marcado');
  }
});

test('sem sessão ou com a janela escondida não pergunta nem marca; pergunta depois', async () => {
  const c = cenario({ userId: null });
  assert.equal((await c.d.perguntarSeFaltar()).mostrado, false);
  assert.equal(c.chamadas.length, 0);
  c.entrarComo(7);
  assert.equal((await c.d.perguntarSeFaltar()).mostrado, true);

  let visivel = false;
  const escondida = cenario({ resposta: 1, extra: { janelaVisivel: () => visivel } });
  assert.equal((await escondida.d.perguntarSeFaltar()).mostrado, false);
  assert.equal(escondida.chamadas.length, 0);
  visivel = true;
  assert.equal((await escondida.d.perguntarSeFaltar()).mostrado, true);
});

test('chamadas seguidas (carregar e navegar) mostram um só aviso', async () => {
  const c = cenario({ resposta: 1 });
  await Promise.all([c.d.perguntarSeFaltar(), c.d.perguntarSeFaltar(), c.d.perguntarSeFaltar()]);
  assert.equal(c.caixas.length, 1);
});

test('sem rede não pergunta nem marca', async () => {
  const c = cenario({ rotas: { 'GET /users/me/devices/config': new Error('offline') } });
  assert.equal((await c.d.perguntarSeFaltar()).mostrado, false);
  assert.equal(c.guardado.size, 0);
});

// Pacotes: as contas de um lote para esta máquina, uma a uma, com pausa entre elas.

const comPacote = (pacote, extra = {}) => ({
  'POST /users/me/devices/:id/sinal': () => ({ status: 200, corpo: { result: { data: { consentimentoValido: true, tarefa: null, pacote, proximoSinalSeg: 10, ...extra } } } }),
  ...Object.fromEntries([1, 2, 3].flatMap(id => ['iniciar', 'concluir'].map(r => [`POST /users/me/devices/:id/tarefas/${id}/${r}`, { status: 200, corpo: {} }])))
});
const contasSimuladas = (...ids) => ids.map(tarefaId => ({ tarefaId, simulada: true, parametros: {} }));
const executorQueRegista = (feitas) => async (t, io) => { await io.iniciar(5); feitas.push(t.tarefaId); await io.concluir('feita', {}); };

test('o intervalo seguinte vem do servidor, limitado a [5, 300] s; sem resposta mantém o último', async () => {
  for (const [pedido, esperado] of [[10, 10], [1, 5], [9999, 300], [undefined, 120]]) {
    const c = cenario({ rotas: { 'POST /users/me/devices/:id/sinal': { status: 200, corpo: { result: { data: { consentimentoValido: true, pacote: null, proximoSinalSeg: pedido } } } } } });
    await c.d.aceitar();
    c.d.iniciar();
    await c.tique().fn();
    assert.equal(c.tique().ms, esperado * 1000, `pedido ${pedido}`);
    c.d.parar();
  }
  let resposta = { status: 200, corpo: { result: { data: { consentimentoValido: true, proximoSinalSeg: 10 } } } };
  const c = cenario({ rotas: { 'POST /users/me/devices/:id/sinal': () => resposta } });
  await c.d.aceitar();
  c.d.iniciar();
  await c.tique().fn();
  resposta = new Error('rede');
  c.d.parar();
  c.d.iniciar();
  await c.tique().fn().catch(() => {});
  assert.equal(c.tique().ms, 10000, 'um sinal falhado não abranda o ritmo');
});

test('pacote: as contas correm pela ordem, com pausa ao acaso entre elas, e o sinal leva o estado', async () => {
  const feitas = [];
  const pausas = [];
  const estados = [];
  const pacote = { pacoteId: 9, loteId: 5, pausaSeg: [30, 120], contas: contasSimuladas(1, 2, 3) };
  const c = cenario({
    rotas: { ...comPacote(pacote), 'POST /users/me/devices/:id/sinal': (corpo) => { estados.push(corpo.estado.pc); return comPacote(pacote)['POST /users/me/devices/:id/sinal'](); } },
    extra: { ...semEspera, executor: executorQueRegista(feitas), esperar: async (ms) => { pausas.push(ms); }, aleatorio: () => 0.5 }
  });
  await c.d.aceitar();
  c.d.iniciar();
  await c.tique().fn();
  await c.d.aguardarTarefa();
  assert.deepEqual(feitas, [1, 2, 3]);
  assert.deepEqual(pausas, [75000, 75000], 'duas pausas, a meio de 30 e 120 s');
  assert.equal(c.chamadas.filter(x => /largar$/.test(x.caminho)).length, 0, 'tudo começou: não larga');
  await c.tique().fn();
  assert.equal(estados.at(-1), 'livre');
});

test('o mesmo pacote no sinal seguinte não corre outra vez', async () => {
  const feitas = [];
  const pacote = { pacoteId: 9, loteId: 5, pausaSeg: [0, 0], contas: contasSimuladas(1) };
  const c = cenario({ rotas: comPacote(pacote), extra: { ...semEspera, executor: executorQueRegista(feitas) } });
  await c.d.aceitar();
  c.d.iniciar();
  await c.tique().fn();
  await c.d.aguardarTarefa();
  await c.tique().fn();
  await c.d.aguardarTarefa();
  assert.deepEqual(feitas, [1]);
});

test('conta não simulada: pára o pacote e larga o resto, sem iniciar nada', async () => {
  const pacote = { pacoteId: 9, loteId: 5, pausaSeg: [0, 0], contas: [{ tarefaId: 1, simulada: false, parametros: {} }, ...contasSimuladas(2)] };
  const c = cenario({ rotas: comPacote(pacote), extra: semEspera });
  await c.d.aceitar();
  c.d.iniciar();
  await c.tique().fn();
  await c.d.aguardarTarefa();
  assert.ok(c.chamadas.some(x => x.metodo === 'POST' && /^\/users\/me\/devices\/[0-9a-f-]{36}\/pacotes\/9\/largar$/.test(x.caminho)));
  assert.ok(!c.chamadas.some(x => /\/iniciar$/.test(x.caminho)));
});

test('uma conta recusada (409) não prende a máquina: o pacote é largado no fim', async () => {
  const pacote = { pacoteId: 9, loteId: 5, pausaSeg: [0, 0], contas: contasSimuladas(1, 2) };
  const rotas = {
    ...comPacote(pacote),
    'POST /users/me/devices/:id/tarefas/1/iniciar': { status: 409, corpo: {} },
    'POST /users/me/devices/:id/tarefas/2/iniciar': { status: 200, corpo: {} },
    'POST /users/me/devices/:id/tarefas/2/concluir': { status: 200, corpo: {} }
  };
  const c = cenario({ rotas, extra: semEspera });
  await c.d.aceitar();
  c.d.iniciar();
  await c.tique().fn();
  await c.d.aguardarTarefa();
  assert.ok(c.chamadas.some(x => /\/tarefas\/2\/concluir$/.test(x.caminho)), 'a seguinte corre na mesma');
  assert.equal(c.chamadas.filter(x => /pacotes\/9\/largar$/.test(x.caminho)).length, 1);
});

test('contas recusadas (pacote cancelado) não contam como feitas: nada de pausas por elas', async () => {
  for (const [recusadas, esperadas] of [[[1, 2, 3], 0], [[2], 1]]) {
    const pausas = [];
    const pacote = { pacoteId: 9, loteId: 5, pausaSeg: [30, 120], contas: contasSimuladas(1, 2, 3) };
    const rotas = { ...comPacote(pacote) };
    for (const id of recusadas) rotas[`POST /users/me/devices/:id/tarefas/${id}/iniciar`] = { status: 409, corpo: {} };
    const c = cenario({ rotas, extra: { ...semEspera, esperar: async (ms) => { pausas.push(ms); }, aleatorio: () => 0.5 } });
    await c.d.aceitar();
    c.d.iniciar();
    await c.tique().fn();
    await c.d.aguardarTarefa();
    assert.equal(pausas.filter(ms => ms === 75000).length, esperadas, `recusadas ${recusadas}`);
  }
});

test('terminar: acaba a conta atual, não começa a seguinte, avisa a-terminar e larga', async () => {
  let soltar;
  const feitas = [];
  const pacote = { pacoteId: 9, loteId: 5, pausaSeg: [0, 0], contas: contasSimuladas(1, 2) };
  const c = cenario({
    rotas: comPacote(pacote),
    extra: { ...semEspera, executor: async (t, io) => { await io.iniciar(1); await new Promise(r => { soltar = r; }); feitas.push(t.tarefaId); await io.concluir('feita', {}); } }
  });
  await c.d.aceitar();
  c.d.iniciar();
  await c.tique().fn();
  assert.equal(c.d.ocupado(), true);
  const fim = c.d.terminar();
  await new Promise(r => setImmediate(r));
  soltar();
  await fim;
  assert.deepEqual(feitas, [1]);
  assert.ok(c.chamadas.some(x => /sinal$/.test(x.caminho) && x.corpo?.estado?.pc === 'a-terminar'));
  assert.ok(c.chamadas.some(x => /pacotes\/9\/largar$/.test(x.caminho)));
  assert.equal(c.d.ocupado(), false);
  assert.equal(c.tique(), null, 'o sinal parou');
});

test('terminar a meio de uma pausa não espera por ela', async () => {
  const feitas = [];
  const pacote = { pacoteId: 9, loteId: 5, pausaSeg: [100, 100], contas: contasSimuladas(1, 2) };
  const c = cenario({
    rotas: comPacote(pacote),
    extra: { ...semEspera, executor: executorQueRegista(feitas), esperar: () => new Promise(() => {}) }
  });
  await c.d.aceitar();
  c.d.iniciar();
  await c.tique().fn();
  await new Promise(r => setImmediate(r));
  await c.d.terminar();
  assert.deepEqual(feitas, [1]);
  assert.ok(c.chamadas.some(x => /pacotes\/9\/largar$/.test(x.caminho)));
});
