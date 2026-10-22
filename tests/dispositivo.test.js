'use strict';

/** Núcleo das operações automáticas: consentimento, chave, registo, sinal e arranque. Tudo por dependências falsas. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const D = require('../src/main/dispositivo');
const { VERSAO_TEXTO } = require('../src/main/dispositivo-texto');

/** JWT sem assinatura, só para o userIdDoToken. */
const token = (id) => `x.${Buffer.from(JSON.stringify({ id })).toString('base64url')}.y`;

/**
 * Cenário: `rotas` responde a "MÉTODO caminho" com { status, corpo } (ou lança); regista tudo o que se passou.
 */
function cenario({ userId = 7, ativo = true, versaoServidor = VERSAO_TEXTO, resposta = 0, cifra = true, rotas = {}, extra = {} } = {}) {
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
    const r = rotas[chave];
    if (r instanceof Error) throw r;
    if (r) return typeof r === 'function' ? r(corpo) : r;
    if (chave === 'GET /users/me/devices/config') return { status: 200, corpo: { result: { data: { ativo, versaoConsentimento: versaoServidor } } } };
    if (chave === 'POST /users/me/devices') return { status: 200, corpo: { result: { data: { dispositivo: {} } } } };
    if (chave === 'POST /users/me/devices/:id/sinal') return { status: 200, corpo: { result: { data: { consentimentoValido: true } } } };
    if (chave === 'DELETE /users/me/devices/:id') return { status: 200, corpo: {} };
    return { status: 404, corpo: {} };
  };

  const deps = {
    api: { get: (c) => responder('GET', c), post: (c, b) => responder('POST', c, b), del: (c) => responder('DELETE', c) },
    lerToken: () => sessao,
    storage: {
      getItem: (k) => guardado.get(k) ?? null,
      setItem: (k, v) => { guardado.set(k, JSON.parse(JSON.stringify(v))); },
      removeItem: (k) => { guardado.delete(k); }
    },
    safeStorage: {
      isEncryptionAvailable: () => cifra,
      encryptString: (s) => Buffer.from(`cifrado:${s}`),
      decryptString: (b) => b.toString().replace(/^cifrado:/, '')
    },
    app: { setLoginItemSettings: (o) => arranque.push(o), getVersion: () => '2.2.0' },
    pedirConsentimento: async (o) => { caixas.push(o); return resposta === 0; },
    tray: { setOperacoes: (v) => tray.push(v) },
    versoes: { so: 'win32 10.0.26300', electron: '44.4.5' },
    randomUUID: () => crypto.randomUUID(),
    setTimeoutFn: (fn, ms) => { tique = { fn, ms }; return 1; },
    clearTimeoutFn: () => { tique = null; },
    maquinaId: async () => 'f'.repeat(64),
    ...extra
  };
  return {
    d: D.criarDispositivo(deps), chamadas, guardado, arranque, tray, caixas,
    tique: () => tique, sairDaSessao: () => { sessao = null; }, entrarComo: (id) => { sessao = token(id); },
    posts: () => chamadas.filter(c => c.metodo === 'POST')
  };
}

test('gerarParDeChaves dá 32 bytes e a pública corresponde à privada', () => {
  const { publica, privada } = D.gerarParDeChaves();
  assert.equal(Buffer.from(publica, 'base64').length, 32);
  assert.equal(Buffer.from(privada, 'base64').length, 32);
  const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b656e04220420', 'hex'), Buffer.from(privada, 'base64')]);
  const derivada = crypto.createPublicKey(crypto.createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' }))
    .export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
  assert.equal(derivada, publica);
});

test('userIdDoToken lê o id e aguenta lixo', () => {
  assert.equal(D.userIdDoToken(token(42)), 42);
  for (const mau of [null, undefined, '', 'abc', 'a.b.c', `x.${Buffer.from('{}').toString('base64url')}.y`, 42]) {
    assert.equal(D.userIdDoToken(mau), null, String(mau));
  }
});

test('estado() sem consentimento não regista nada: só pergunta a configuração', async () => {
  const c = cenario();
  const e = await c.d.estado();
  assert.deepEqual(e, { disponivel: true, consentido: false, autostart: false, versaoConsentimento: VERSAO_TEXTO });
  assert.equal(c.posts().length, 0, 'nada recolhido antes de aceitar');
  assert.equal(c.guardado.size, 0);
});

test('estado() sem sessão ou com a funcionalidade desligada diz indisponível', async () => {
  assert.equal((await cenario({ userId: null }).d.estado()).disponivel, false);
  assert.equal((await cenario({ ativo: false }).d.estado()).disponivel, false);
});

test('aceitar com «Agora não» não chama a API nem guarda nada', async () => {
  const c = cenario({ resposta: 1 });
  assert.deepEqual(await c.d.aceitar(), { ok: false, motivo: 'cancelado' });
  assert.equal(c.posts().length, 0);
  assert.equal(c.guardado.size, 0);
  assert.equal(c.arranque.length, 0);
});

test('aceitar com «Aceito» regista, guarda a chave privada cifrada, liga o arranque e o tray', async () => {
  const c = cenario();
  assert.deepEqual(await c.d.aceitar(), { ok: true });
  assert.equal(c.caixas.length, 1);
  assert.deepEqual(c.caixas[0].botoes, ['Aceito', 'Agora não']);
  assert.equal(c.caixas[0].modo, 'pedido');
  const [post] = c.posts();
  assert.equal(post.caminho, '/users/me/devices');
  assert.match(post.corpo.deviceId, /^[0-9a-f-]{36}$/);
  assert.equal(Buffer.from(post.corpo.chavePublica, 'base64').length, 32);
  assert.deepEqual({ so: post.corpo.so, appVersao: post.corpo.appVersao, electronVersao: post.corpo.electronVersao, autostart: post.corpo.autostart, versao: post.corpo.versao },
    { so: 'win32 10.0.26300', appVersao: '2.2.0', electronVersao: '44.4.5', autostart: true, versao: VERSAO_TEXTO });
  const reg = c.guardado.get('dispositivo:7');
  assert.equal(reg.consentido, true);
  assert.match(reg.privadaCifrada, /^[A-Za-z0-9+/=]+$/);
  assert.ok(!JSON.stringify(reg).includes(post.corpo.chavePublica) || reg.chavePublica === post.corpo.chavePublica);
  assert.deepEqual(c.arranque.at(-1), { openAtLogin: true, args: ['--oculto'] });
  assert.equal(c.tray.at(-1), true);
});

test('sem cifra do sistema não aceita', async () => {
  const c = cenario({ cifra: false });
  assert.deepEqual(await c.d.aceitar(), { ok: false, motivo: 'sem-cifra' });
  assert.equal(c.caixas.length, 0, 'nem sequer mostra o diálogo');
  assert.equal(c.posts().length, 0);
});

test('o texto da app tem de ser a versão que o servidor espera', async () => {
  const c = cenario({ versaoServidor: VERSAO_TEXTO + 1 });
  assert.deepEqual(await c.d.aceitar(), { ok: false, motivo: 'app-desatualizada' });
  assert.equal(c.caixas.length, 0);
  assert.equal(c.posts().length, 0);
});

test('falha de rede ao aceitar: nada fica guardado como consentido', async () => {
  const c = cenario({ rotas: { 'POST /users/me/devices': new Error('ECONNRESET') } });
  assert.deepEqual(await c.d.aceitar(), { ok: false, motivo: 'rede' });
  assert.equal(c.guardado.get('dispositivo:7')?.consentido ?? false, false);
  assert.equal(c.arranque.length, 0);
  assert.equal(c.tray.at(-1) ?? false, false);
});

test('o servidor recusar o registo (409) não deixa consentimento local', async () => {
  const c = cenario({ rotas: { 'POST /users/me/devices': { status: 409, corpo: {} } } });
  assert.deepEqual(await c.d.aceitar(), { ok: false, motivo: 'versao' });
  assert.equal(c.guardado.get('dispositivo:7')?.consentido ?? false, false);
});

test('iniciar() agenda o sinal de 2 em 2 minutos e cada sinal vai ao dispositivo certo', async () => {
  const c = cenario();
  await c.d.aceitar();
  c.d.iniciar();
  assert.equal(c.tique().ms, 120000);
  await c.tique().fn();
  const sinais = c.posts().filter(p => /sinal$/.test(p.caminho));
  assert.equal(sinais.length >= 1, true);
  const id = c.guardado.get('dispositivo:7').deviceId;
  assert.equal(sinais.at(-1).caminho, `/users/me/devices/${id}/sinal`);
  assert.deepEqual(sinais.at(-1).corpo, { appVersao: '2.2.0', electronVersao: '44.4.5', autostart: true, capacidades: ['tarefas-v1', 'pacotes-v1', 'levantar-v1', 'depositar-v1'], maquinaId: 'f'.repeat(64), estado: { pc: 'livre' } });
  c.d.parar();
  assert.equal(c.tique(), null);
});

test('sem consentimento o sinal não faz pedidos', async () => {
  const c = cenario();
  c.d.iniciar();
  await c.tique().fn();
  assert.equal(c.chamadas.length, 0);
});

test('consentimentoValido:false desliga o consentimento local, o arranque e o tray', async () => {
  const c = cenario({ rotas: { 'POST /users/me/devices/:id/sinal': { status: 200, corpo: { result: { data: { consentimentoValido: false } } } } } });
  await c.d.aceitar();
  c.d.iniciar();
  await c.tique().fn();
  assert.equal(c.guardado.get('dispositivo:7').consentido, false);
  assert.deepEqual(c.arranque.at(-1), { openAtLogin: false, args: [] });
  assert.equal(c.tray.at(-1), false);
});

test('404 no sinal (o servidor não conhece o dispositivo) também desliga o consentimento local', async () => {
  const c = cenario({ rotas: { 'POST /users/me/devices/:id/sinal': { status: 404, corpo: {} } } });
  await c.d.aceitar();
  c.d.iniciar();
  await c.tique().fn();
  assert.equal(c.guardado.get('dispositivo:7').consentido, false);
  assert.deepEqual(c.arranque.at(-1), { openAtLogin: false, args: [] });
});

test('401 no sinal (sem sessão válida) não lança nem muda o consentimento', async () => {
  const c = cenario({ rotas: { 'POST /users/me/devices/:id/sinal': { status: 401, corpo: {} } } });
  await c.d.aceitar();
  c.d.iniciar();
  await assert.doesNotReject(c.tique().fn());
  assert.equal(c.guardado.get('dispositivo:7').consentido, true);
});

test('sem token (logout) não faz pedidos', async () => {
  const c = cenario();
  await c.d.aceitar();
  c.d.iniciar();
  c.sairDaSessao();
  c.chamadas.length = 0;
  await c.tique().fn();
  assert.equal(c.chamadas.length, 0);
});

test('aoTerminarSessao desliga o arranque sem revogar o consentimento', async () => {
  const c = cenario();
  await c.d.aceitar();
  c.d.aoTerminarSessao();
  assert.deepEqual(c.arranque.at(-1), { openAtLogin: false, args: [] });
  assert.equal(c.tray.at(-1), false);
  assert.equal(c.guardado.get('dispositivo:7').consentido, true, 'volta a valer no próximo login');
  assert.equal(c.chamadas.some(x => x.metodo === 'DELETE'), false);
});

test('outro utilizador no mesmo PC gera outro deviceId e não herda o consentimento', async () => {
  const c = cenario({ userId: 7 });
  await c.d.aceitar();
  const primeiro = c.guardado.get('dispositivo:7').deviceId;
  c.entrarComo(8);
  const e = await c.d.estado();
  assert.equal(e.consentido, false);
  await c.d.aceitar();
  const segundo = c.guardado.get('dispositivo:8').deviceId;
  assert.notEqual(primeiro, segundo);
  assert.equal(c.guardado.get('dispositivo:7').consentido, true);
});

test('definirArranque(false) guarda a preferência e desliga openAtLogin; (true) volta a ligar', async () => {
  const c = cenario();
  await c.d.aceitar();
  assert.deepEqual(await c.d.definirArranque(false), { ok: true });
  assert.equal(c.guardado.get('dispositivo:7').autostart, false);
  assert.deepEqual(c.arranque.at(-1), { openAtLogin: false, args: [] });
  assert.deepEqual(await c.d.definirArranque(true), { ok: true });
  assert.deepEqual(c.arranque.at(-1), { openAtLogin: true, args: ['--oculto'] });
});

test('definirArranque sem consentimento recusa', async () => {
  const c = cenario();
  assert.deepEqual(await c.d.definirArranque(true), { ok: false });
  assert.equal(c.arranque.length, 0);
});

test('revogar faz DELETE, limpa o consentimento e desliga o arranque e o tray', async () => {
  const c = cenario();
  await c.d.aceitar();
  const id = c.guardado.get('dispositivo:7').deviceId;
  assert.deepEqual(await c.d.revogar(), { ok: true });
  assert.ok(c.chamadas.some(x => x.metodo === 'DELETE' && x.caminho === `/users/me/devices/${id}`));
  assert.equal(c.guardado.get('dispositivo:7').consentido, false);
  assert.deepEqual(c.arranque.at(-1), { openAtLogin: false, args: [] });
  assert.equal(c.tray.at(-1), false);
});

test('revogar sem rede desliga já localmente e repete o DELETE no sinal seguinte', async () => {
  let rede = false;
  const c = cenario({ rotas: { 'DELETE /users/me/devices/:id': () => { if (!rede) throw new Error('offline'); return { status: 200, corpo: {} }; } } });
  await c.d.aceitar();
  c.d.iniciar();
  assert.deepEqual(await c.d.revogar(), { ok: true });
  assert.equal(c.guardado.get('dispositivo:7').consentido, false);
  rede = true;
  c.chamadas.length = 0;
  await c.tique().fn();
  assert.ok(c.chamadas.some(x => x.metodo === 'DELETE'), 'repetiu o DELETE pendente');
  assert.equal(c.guardado.get('dispositivo:7').revogarPendente, false);
});

test('aceitar outra vez depois de revogar reutiliza a mesma chave e o mesmo deviceId', async () => {
  const c = cenario();
  await c.d.aceitar();
  const antes = c.guardado.get('dispositivo:7');
  await c.d.revogar();
  await c.d.aceitar();
  const depois = c.guardado.get('dispositivo:7');
  assert.equal(depois.deviceId, antes.deviceId);
  assert.equal(depois.chavePublica, antes.chavePublica);
  assert.equal(depois.consentido, true);
});

test('arrancarOculto só com o argumento --oculto', () => {
  assert.equal(D.arrancarOculto(['C:\BCI.exe', '--oculto']), true);
  assert.equal(D.arrancarOculto(['C:\BCI.exe']), false);
  assert.equal(D.arrancarOculto([]), false);
  assert.equal(D.arrancarOculto(undefined), false);
  assert.equal(D.arrancarOculto(['--ocultox']), false);
});

const invalido = (motivo) => ({ status: 200, corpo: { result: { data: { consentimentoValido: false, motivo } } } });
const valido = { status: 200, corpo: { result: { data: { consentimentoValido: true } } } };

test('os sinais válidos não reescrevem o arranque do Windows (o cliente pode tê-lo desligado lá)', async () => {
  const c = cenario();
  await c.d.aceitar();
  const antes = c.arranque.length;
  c.d.iniciar();
  await c.tique().fn();
  await c.tique().fn();
  assert.equal(c.arranque.length, antes);
});

test('«desligado» ou «conta» suspendem o arranque e o tray mas mantêm o consentimento, e voltam sozinhos', async () => {
  let resposta = invalido('desligado');
  const c = cenario({ rotas: { 'POST /users/me/devices/:id/sinal': () => resposta } });
  await c.d.aceitar();
  c.d.iniciar();
  await c.tique().fn();
  assert.equal(c.guardado.get('dispositivo:7').consentido, true, 'o consentimento fica');
  assert.deepEqual(c.arranque.at(-1), { openAtLogin: false, args: [] });
  assert.equal(c.tray.at(-1), false);

  const n = c.arranque.length;
  await c.tique().fn();
  assert.equal(c.arranque.length, n, 'não repete o desligar a cada sinal');

  resposta = valido;
  await c.tique().fn();
  assert.deepEqual(c.arranque.at(-1), { openAtLogin: true, args: ['--oculto'] });
  assert.equal(c.tray.at(-1), true);
  const m = c.arranque.length;
  await c.tique().fn();
  assert.equal(c.arranque.length, m, 'só restaura uma vez');
});

test('«versao» e «revogado» apagam o consentimento local de vez', async () => {
  for (const motivo of ['versao', 'revogado']) {
    const c = cenario({ rotas: { 'POST /users/me/devices/:id/sinal': invalido(motivo) } });
    await c.d.aceitar();
    c.d.iniciar();
    await c.tique().fn();
    assert.equal(c.guardado.get('dispositivo:7').consentido, false, motivo);
  }
});

test('401 ou 403 no sinal são fim de sessão: desliga o arranque e o tray sem revogar, e restaura quando volta a valer', async () => {
  for (const estado of [401, 403]) {
    let resposta = { status: estado, corpo: {} };
    const c = cenario({ rotas: { 'POST /users/me/devices/:id/sinal': () => resposta } });
    await c.d.aceitar();
    c.d.iniciar();
    await c.tique().fn();
    assert.deepEqual(c.arranque.at(-1), { openAtLogin: false, args: [] }, String(estado));
    assert.equal(c.tray.at(-1), false);
    assert.equal(c.guardado.get('dispositivo:7').consentido, true, 'não revoga');
    assert.equal(c.chamadas.some(x => x.metodo === 'DELETE'), false);
    const n = c.arranque.length;
    await c.tique().fn();
    assert.equal(c.arranque.length, n, 'não repete');
    resposta = valido;
    await c.tique().fn();
    assert.deepEqual(c.arranque.at(-1), { openAtLogin: true, args: ['--oculto'] });
  }
});

test('a revogação fica pendente sempre que o servidor não a confirmou (não só nos 5xx)', async () => {
  for (const [estado, pendente] of [[401, true], [429, true], [500, true], [200, false], [404, false]]) {
    const c = cenario({ rotas: { 'DELETE /users/me/devices/:id': { status: estado, corpo: {} } } });
    await c.d.aceitar();
    await c.d.revogar();
    assert.equal(c.guardado.get('dispositivo:7').revogarPendente, pendente, String(estado));
    assert.equal(c.guardado.get('dispositivo:7').consentido, false);
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

test('sem Chrome nem Edge o registo e o sinal não anunciam levantamentos nem depósitos', async () => {
  const c = cenario({ extra: { ...semEspera, contasReais: () => false } });
  await c.d.aceitar();
  assert.deepEqual(c.posts()[0].corpo.capacidades, ['tarefas-v1', 'pacotes-v1']);
  c.d.iniciar();
  await c.tique().fn();
  assert.deepEqual(c.posts().filter(p => /sinal$/.test(p.caminho)).at(-1).corpo.capacidades, ['tarefas-v1', 'pacotes-v1']);
});

test('o registo e o sinal declaram tarefas e pacotes, e levam o identificador cifrado da máquina', async () => {
  const c = cenario({ extra: semEspera });
  await c.d.aceitar();
  assert.deepEqual(c.posts()[0].corpo.capacidades, ['tarefas-v1', 'pacotes-v1', 'levantar-v1', 'depositar-v1']);
  assert.equal(c.posts()[0].corpo.maquinaId, 'f'.repeat(64));
  c.d.iniciar();
  await c.tique().fn();
  const s = c.posts().filter(p => /sinal$/.test(p.caminho)).at(-1).corpo;
  assert.deepEqual(s.capacidades, ['tarefas-v1', 'pacotes-v1', 'levantar-v1', 'depositar-v1']);
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
  const s = c.posts().filter(p => /sinal$/.test(p.caminho)).at(-1).corpo;
  assert.equal('maquinaId' in s, false);
  assert.deepEqual(s.capacidades, ['tarefas-v1', 'pacotes-v1', 'levantar-v1', 'depositar-v1']);
});

test('tarefa simulada no sinal: inicia e conclui pelas rotas da tarefa', async () => {
  const registo = [];
  const c = cenario({ rotas: rotasTarefa(tarefaSimulada(), registo), extra: semEspera });
  await c.d.aceitar();
  c.d.iniciar();
  await c.tique().fn();
  await c.d.aguardarTarefa();
  assert.deepEqual(registo, ['iniciar', ['concluir', { estado: 'feita', resultado: { simulado: true, motivo: 'Simulação' } }]]);
  const id = c.guardado.get('dispositivo:7').deviceId;
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

// Pedido ao abrir a app: uma janela só, no máximo uma vez por dia.

const { TITULO, TEXTO_CONSENTIMENTO } = require('../src/main/dispositivo-texto');

test('ligada e sem resposta: mostra o pedido uma vez e, com «Aceito», regista', async () => {
  const c = cenario({ resposta: 0 });
  const r = await c.d.perguntarSeFaltar();
  assert.equal(r.mostrado, true);
  assert.deepEqual(c.caixas.map(x => x.botoes), [['Aceito', 'Agora não']]);
  assert.equal(c.guardado.get('dispositivo:7').consentido, true);
  assert.equal(c.posts().length, 1, 'regista só depois do «Aceito»');
});

test('«Agora não» não regista, e não volta a perguntar no mesmo dia', async () => {
  const c = cenario({ resposta: 1 });
  assert.equal((await c.d.perguntarSeFaltar()).mostrado, true);
  assert.equal(c.caixas.length, 1);
  assert.equal(c.posts().length, 0);
  assert.equal(c.guardado.get('dispositivo:7').consentido ?? false, false);
  assert.equal((await c.d.perguntarSeFaltar()).mostrado, false);
  assert.equal(c.caixas.length, 1);
});

// A data é a local (AAAA-MM-DD): o relógio falso mostra que o dia seguinte volta a perguntar.
const dia = (ano, mes, d, h = 12) => new Date(ano, mes - 1, d, h, 0, 0);

test('«Agora não» grava o dia de hoje e só volta a perguntar no dia seguinte', async () => {
  let agora = dia(2026, 10, 21);
  const c = cenario({ resposta: 1, extra: { agora: () => agora } });
  assert.equal((await c.d.perguntarSeFaltar()).mostrado, true);
  assert.equal(c.guardado.get('dispositivo:7').perguntadoEm, '2026-10-21');
  agora = dia(2026, 10, 21, 23);
  assert.equal((await c.d.perguntarSeFaltar()).mostrado, false, 'no mesmo dia');
  assert.equal(c.caixas.length, 1);
  agora = dia(2026, 10, 22, 0);
  assert.equal((await c.d.perguntarSeFaltar()).mostrado, true, 'no dia seguinte');
  assert.equal(c.caixas.length, 2);
  assert.equal(c.guardado.get('dispositivo:7').perguntadoEm, '2026-10-22');
});

test('quem revogou volta a ver o pedido no dia seguinte', async () => {
  let agora = dia(2026, 10, 21);
  const c = cenario({ resposta: 1, extra: { agora: () => agora } });
  // Como fica o registo depois de revogar: a chave e o deviceId mantêm-se, o consentimento não.
  c.guardado.set('dispositivo:7', { deviceId: 'x', consentido: false, versao: VERSAO_TEXTO, revogarPendente: false });
  assert.equal((await c.d.perguntarSeFaltar()).mostrado, true);
  c.caixas.length = 0;
  assert.equal((await c.d.perguntarSeFaltar()).mostrado, false);
  agora = dia(2026, 10, 22);
  assert.equal((await c.d.perguntarSeFaltar()).mostrado, true);
});

test('ao abrir a app vai direto ao pedido completo, sem aviso antes', async () => {
  const c = cenario({ resposta: 0 });
  const r = await c.d.perguntarSeFaltar();
  assert.deepEqual(r, { mostrado: true, aceite: true });
  assert.deepEqual(c.caixas.map(x => x.modo), ['pedido']);
  assert.equal(c.caixas[0].titulo, TITULO);
  assert.equal(c.caixas[0].texto, TEXTO_CONSENTIMENTO);
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

test('chamadas seguidas (carregar e navegar) mostram um só pedido', async () => {
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

test('conta real sem executor real: pára o pacote e larga o resto, sem iniciar nada', async () => {
  const pacote = { pacoteId: 9, loteId: 5, pausaSeg: [0, 0], contas: [{ tarefaId: 1, simulada: false, parametros: {} }, ...contasSimuladas(2)] };
  const c = cenario({ rotas: comPacote(pacote), extra: semEspera });
  await c.d.aceitar();
  c.d.iniciar();
  await c.tique().fn();
  await c.d.aguardarTarefa();
  const id = c.guardado.get('dispositivo:7').deviceId;
  assert.ok(c.chamadas.some(x => x.metodo === 'POST' && x.caminho === `/users/me/devices/${id}/pacotes/9/largar`));
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

// ---------- contas reais ----------

const contaReal = (tarefaId) => ({ tarefaId, simulada: false, casino: 'Placard', parametros: {} });
const limiteFalso = () => {
  const pedidos = [];
  return { pedidos, aguardarLimite: (ms) => { pedidos.push(ms); return { p: new Promise(() => {}), cancelar: () => {} }; } };
};

test('no pacote, a conta real vai ao executor real e a simulada ao fictício', async () => {
  const reais = [];
  const simuladas = [];
  const pacote = { pacoteId: 9, loteId: 5, pausaSeg: [0, 0], contas: [contaReal(1), ...contasSimuladas(2)] };
  const c = cenario({
    rotas: comPacote(pacote),
    extra: {
      ...semEspera,
      executor: async (t, io) => { await io.iniciar(1); simuladas.push(t.tarefaId); await io.concluir('feita', {}); },
      executorReal: async (t, io) => { await io.iniciar(1); reais.push(t.tarefaId); await io.concluir('feita', {}); }
    }
  });
  await c.d.aceitar();
  c.d.iniciar();
  await c.tique().fn();
  await c.d.aguardarTarefa();
  assert.deepEqual(reais, [1]);
  assert.deepEqual(simuladas, [2]);
  assert.equal(c.chamadas.filter(x => x.caminho.endsWith('/largar')).length, 0);
});

test('o executor real recebe o contexto com a privada decifrada, e ela não está na tarefa nem no io', async () => {
  let visto;
  const pacote = { pacoteId: 9, loteId: 5, pausaSeg: [0, 0], contas: [contaReal(1)] };
  const c = cenario({
    rotas: comPacote(pacote),
    extra: { ...semEspera, executorReal: async (t, io, ctx) => { visto = { t, io, ctx, privada: await ctx.privada() }; await io.iniciar(1); await io.concluir('feita', {}); } }
  });
  await c.d.aceitar();
  c.d.iniciar();
  await c.tique().fn();
  await c.d.aguardarTarefa();
  const id = c.guardado.get('dispositivo:7').deviceId;
  assert.equal(visto.ctx.deviceId, id);
  assert.equal(Buffer.from(visto.privada, 'base64').length, 32);
  assert.ok(!JSON.stringify(visto.t).includes(visto.privada));
  assert.ok(!c.guardado.get('dispositivo:7').privadaCifrada.includes(visto.privada));
});

test('terminar com uma conta real a decorrer espera até ao limite das reais e acaba quando ela acaba', async () => {
  let soltar;
  const limite = limiteFalso();
  const pacote = { pacoteId: 9, loteId: 5, pausaSeg: [0, 0], contas: [contaReal(1), contaReal(2)] };
  const c = cenario({
    rotas: comPacote(pacote),
    extra: { ...semEspera, aguardarLimite: limite.aguardarLimite, executorReal: async (t, io) => { await io.iniciar(1); await new Promise(r => { soltar = r; }); await io.concluir('feita', {}); } }
  });
  await c.d.aceitar();
  c.d.iniciar();
  await c.tique().fn();
  await new Promise(r => setImmediate(r));
  const fim = c.d.terminar();
  await new Promise(r => setImmediate(r));
  assert.deepEqual(limite.pedidos, [10 * 60 * 1000]);
  soltar();
  await fim;
  assert.equal(c.d.ocupado(), false);
  assert.ok(c.chamadas.some(x => x.caminho.endsWith('/pacotes/9/largar')), 'a segunda real larga-se');
});

test('terminar com uma conta simulada continua nos 60 s', async () => {
  let soltar;
  const limite = limiteFalso();
  const pacote = { pacoteId: 9, loteId: 5, pausaSeg: [0, 0], contas: contasSimuladas(1) };
  const c = cenario({
    rotas: comPacote(pacote),
    extra: { ...semEspera, aguardarLimite: limite.aguardarLimite, executor: async (t, io) => { await io.iniciar(1); await new Promise(r => { soltar = r; }); await io.concluir('feita', {}); } }
  });
  await c.d.aceitar();
  c.d.iniciar();
  await c.tique().fn();
  await new Promise(r => setImmediate(r));
  const fim = c.d.terminar();
  await new Promise(r => setImmediate(r));
  assert.deepEqual(limite.pedidos, [60 * 1000]);
  soltar();
  await fim;
});

test('terminar durante a pausa entre duas reais não começa a seguinte nem espera', async () => {
  const reais = [];
  const limite = limiteFalso();
  const pacote = { pacoteId: 9, loteId: 5, pausaSeg: [100, 100], contas: [contaReal(1), contaReal(2)] };
  const c = cenario({
    rotas: comPacote(pacote),
    extra: {
      ...semEspera, aguardarLimite: limite.aguardarLimite, esperar: () => new Promise(() => {}),
      executorReal: async (t, io) => { await io.iniciar(1); reais.push(t.tarefaId); await io.concluir('feita', {}); }
    }
  });
  await c.d.aceitar();
  c.d.iniciar();
  await c.tique().fn();
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  await c.d.terminar();
  assert.deepEqual(reais, [1]);
  assert.ok(c.chamadas.some(x => x.caminho.endsWith('/pacotes/9/largar')));
  assert.ok(limite.pedidos.every(ms => ms === 60 * 1000), 'na pausa não é uma real a decorrer');
});

test('consentimento invalido no sinal e revogar() apagam os browsers das contas', async () => {
  let apagados = 0;
  const limparParticoes = async () => { apagados++; };
  const c = cenario({
    rotas: { 'POST /users/me/devices/:id/sinal': { status: 200, corpo: { result: { data: { consentimentoValido: false, motivo: 'revogado' } } } } },
    extra: { ...semEspera, limparParticoes }
  });
  await c.d.aceitar();
  c.d.iniciar();
  await c.tique().fn();
  assert.ok(apagados >= 1, 'sinal');
  const antes = apagados;
  await c.d.revogar();
  assert.equal(apagados, antes + 1, 'revogar');
});

test('«desligado» e «conta» no sinal não apagam os browsers das contas (podem voltar)', async () => {
  for (const motivo of ['desligado', 'conta']) {
    let apagados = 0;
    const c = cenario({
      rotas: { 'POST /users/me/devices/:id/sinal': invalido(motivo) },
      extra: { ...semEspera, limparParticoes: async () => { apagados++; } }
    });
    await c.d.aceitar();
    c.d.iniciar();
    await c.tique().fn();
    await c.tique().fn();
    assert.equal(apagados, 0, motivo);
  }
});

test('uma falha ao apagar os browsers não impede a revogação', async () => {
  const avisos = [];
  const c = cenario({ extra: { ...semEspera, registar: (m) => avisos.push(m), limparParticoes: async () => { throw new Error('ocupado'); } } });
  await c.d.aceitar();
  const r = await c.d.revogar();
  assert.equal(r.ok, true);
  assert.equal(c.guardado.get('dispositivo:7').consentido, false);
  assert.equal(avisos.length, 1);
});

test('revogar com uma conta real a meio: o executor vê deveParar, o pacote não segue e os browsers só se apagam no fim', async () => {
  let soltar;
  let ctxVisto;
  let apagados = 0;
  const reais = [];
  const pacote = { pacoteId: 9, loteId: 5, pausaSeg: [0, 0], contas: [contaReal(1), contaReal(2)] };
  const c = cenario({
    rotas: comPacote(pacote),
    extra: {
      ...semEspera,
      limparParticoes: async () => { apagados++; },
      executorReal: async (t, io, ctx) => {
        ctxVisto = ctx;
        reais.push(t.tarefaId);
        await io.iniciar(1);
        await new Promise(r => { soltar = r; });
        await io.concluir('falhada', {});
      }
    }
  });
  await c.d.aceitar();
  c.d.iniciar();
  await c.tique().fn();
  await new Promise(r => setImmediate(r));
  assert.equal(ctxVisto.deveParar(), false);
  await c.d.revogar();
  assert.equal(ctxVisto.deveParar(), true);
  assert.equal(apagados, 0, 'não se apaga o browser de uma conta a meio');
  soltar();
  await c.d.aguardarTarefa();
  await new Promise(r => setImmediate(r));
  assert.deepEqual(reais, [1], 'a segunda conta não começa');
  assert.equal(apagados, 1);
  assert.ok(c.chamadas.some(x => x.caminho.endsWith('/pacotes/9/largar')));
});
