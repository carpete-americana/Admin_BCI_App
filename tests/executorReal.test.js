'use strict';

/** O executor real com dependências falsas: a ordem das chamadas, o que cada estado devolve e que a password nunca sai. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { criarExecutorReal, TEMPO_MAX_REAL_MS } = require('../src/main/executorReal');
const vetor = require('./fixtures/entrega-vetor.json');

const SENHA = vetor.texto;
const TAREFA = { tarefaId: vetor.tarefaId, accountId: 7, casino: 'Placard', parametros: { modo: 'igual', valor: 20, minimo: 10 } };
const ENTREGA = { ...vetor.entrega, username: 'joao', fluxo: null };

function montar({ status = 200, motor, resposta, relogio = {}, deveParar, sair } = {}) {
  const registo = [];
  const api = {
    post: async (rota, corpo) => {
      registo.push({ api: rota, corpo });
      if (resposta instanceof Error) throw resposta;
      return { status, corpo: { result: { data: resposta || ENTREGA } } };
    }
  };
  const io = {
    iniciar: async (...a) => registo.push({ io: 'iniciar', a }),
    progresso: async (p) => registo.push({ io: 'progresso', p }),
    concluir: async (estado, resultado) => registo.push({ io: 'concluir', estado, resultado })
  };
  const janela = { driver: { id: 'driver' }, fechar: () => registo.push({ janela: 'fechar' }) };
  const chamadas = { criarJanela: [], levantar: [], depositar: [], sair: [] };
  const executar = criarExecutorReal({
    api,
    raiz: (deviceId) => `/users/me/devices/${deviceId}`,
    criarJanela: (...a) => { chamadas.criarJanela.push(a); registo.push({ janela: 'criar' }); return janela; },
    levantar: async (driver, pedido, aoPasso) => {
      chamadas.levantar.push([driver, pedido]);
      registo.push({ motor: 'levantar' });
      if (motor) return motor(driver, pedido, aoPasso);
      for (const p of ['a-entrar', 'a-abrir', 'a-ler-saldo', 'a-preencher', 'a-levantar']) await aoPasso(p);
      return { estado: 'feita', saldo: 30, valor: 20, iban: 'PT50 … 0154', motivo: 'Pedido submetido' };
    },
    depositar: async (driver, pedido, aoPasso) => {
      chamadas.depositar.push([driver, pedido]);
      registo.push({ motor: 'depositar' });
      if (motor) return motor(driver, pedido, aoPasso);
      return { estado: 'feita', valor: 20, entidade: '21312', referencia: '123456789', validade: '2026-10-25', codigo: 'X1' };
    },
    sair: async (driver, casino, fluxo) => {
      chamadas.sair.push([driver, casino, fluxo]);
      registo.push({ sair: casino });
      return sair ? sair() : null;
    },
    ...relogio
  });
  const ctx = { deviceId: 'D1', privada: async () => vetor.privada, deveParar };
  return { executar: (tarefa, io) => executar(tarefa, io, ctx), io, registo, chamadas };
}

const concluido = (registo) => registo.find(x => x.io === 'concluir');

test('consentimento retirado antes da credencial: falhada «parado», sem pedir a credencial nem abrir a janela', async () => {
  const { executar, io, registo, chamadas } = montar({ deveParar: () => true });
  await executar(TAREFA, io);
  assert.ok(!registo.some(x => x.api), 'não pede a credencial');
  assert.equal(chamadas.criarJanela.length, 0);
  assert.equal(concluido(registo).estado, 'falhada');
  assert.equal(concluido(registo).resultado.fase, 'parado');
});

test('o motor recebe deveParar ligado ao do contexto', async () => {
  let parar = false;
  const { executar, io, chamadas } = montar({ deveParar: () => parar });
  await executar(TAREFA, io);
  const p = chamadas.levantar[0][1];
  assert.equal(p.deveParar(), false);
  parar = true;
  assert.equal(p.deveParar(), true);
});

test('ordem: iniciar, credenciais, janela, motor, sair, fechar, concluir', async () => {
  const { executar, io, registo } = montar();
  await executar(TAREFA, io);
  const ordem = registo.filter(x => x.io !== 'progresso').map(x => x.io || x.api || x.janela || x.motor || (x.sair && 'sair'));
  assert.deepEqual(ordem, ['iniciar', `/users/me/devices/D1/tarefas/${TAREFA.tarefaId}/credenciais`, 'criar', 'levantar', 'sair', 'fechar', 'concluir']);
});

test('o progresso chega pela ordem do motor', async () => {
  const { executar, io, registo } = montar();
  await executar(TAREFA, io);
  assert.deepEqual(registo.filter(x => x.io === 'progresso').map(x => x.p), ['a-entrar', 'a-abrir', 'a-ler-saldo', 'a-preencher', 'a-levantar']);
});

test('cada estado do motor chega ao concluir só com os 4 últimos dígitos do IBAN', async () => {
  for (const estado of ['feita', 'ensaio', 'saltada', 'falhada', 'verificar']) {
    const { executar, io, registo } = montar({
      motor: async () => ({ estado, saldo: 30, freebets: 5.5, valor: 20, iban: 'PT50 0000 0000 0000 0000 0154', motivo: 'm', fase: 'caixa' })
    });
    await executar(TAREFA, io);
    const c = concluido(registo);
    assert.equal(c.estado, estado);
    assert.equal(c.resultado.ibanFim, '0154');
    assert.equal(c.resultado.freebets, 5.5);
    assert.ok(!JSON.stringify(c).includes('PT50'));
  }
});

test('um estado que o motor não conhece é verificar', async () => {
  const { executar, io, registo } = montar({ motor: async () => ({ estado: 'qualquer-coisa' }) });
  await executar(TAREFA, io);
  assert.equal(concluido(registo).estado, 'verificar');
});

test('credenciais recusadas (403, 409) falham sem criar janela', async () => {
  for (const status of [403, 409]) {
    const { executar, io, registo, chamadas } = montar({ status });
    await executar(TAREFA, io);
    const c = concluido(registo);
    assert.equal(c.estado, 'falhada');
    assert.equal(c.resultado.fase, 'credencial');
    assert.equal(chamadas.criarJanela.length, 0);
  }
});

test('falha de rede no pedido da credencial também falha sem janela', async () => {
  const { executar, io, registo, chamadas } = montar({ resposta: new Error('rede') });
  await executar(TAREFA, io);
  assert.equal(concluido(registo).resultado.fase, 'credencial');
  assert.equal(chamadas.criarJanela.length, 0);
});

test('casino desconhecido falha antes de pedir a credencial', async () => {
  const { executar, io, registo } = montar();
  await executar({ ...TAREFA, casino: 'Casino Desconhecido' }, io);
  assert.equal(concluido(registo).resultado.fase, 'casino');
  assert.ok(!registo.some(x => x.api));
});

test('a janela fecha quando o motor rebenta, sem a password no que se regista', async () => {
  const { executar, io, registo } = montar({ motor: async () => { throw new Error(`rebentou com ${SENHA}`); } });
  await executar(TAREFA, io);
  assert.ok(registo.some(x => x.janela === 'fechar'));
  assert.equal(concluido(registo).estado, 'falhada');
  assert.ok(!JSON.stringify(registo).includes(SENHA));
});

test('passado o tempo máximo fecha a janela e conclui verificar na fase tempo', async () => {
  let disparar;
  const relogio = {
    setTimeoutFn: (f, ms) => { assert.equal(ms, TEMPO_MAX_REAL_MS); disparar = f; return 1; },
    clearTimeoutFn: () => {}
  };
  const { executar, io, registo } = montar({ motor: () => new Promise(() => {}), relogio });
  const p = executar(TAREFA, io);
  await new Promise(r => setImmediate(r));
  disparar();
  await p;
  const c = concluido(registo);
  assert.equal(c.estado, 'verificar');
  assert.equal(c.resultado.fase, 'tempo');
  assert.ok(registo.some(x => x.janela === 'fechar'));
});

test('a password só chega ao motor: não está em nada que se registe nem na janela', async () => {
  const { executar, io, registo, chamadas } = montar();
  await executar(TAREFA, io);
  assert.ok(!JSON.stringify(registo).includes(SENHA));
  assert.ok(!JSON.stringify(chamadas.criarJanela).includes(SENHA));
  assert.equal(chamadas.levantar[0][1].credencial.username, 'joao');
  assert.equal(chamadas.levantar[0][1].casino, 'placard');
});

test('o motor recebe a password e depois ela some do objeto', async () => {
  let dentro;
  const { executar, io, chamadas } = montar({ motor: async (d, pedido) => { dentro = pedido.credencial.password; return { estado: 'feita' }; } });
  await executar(TAREFA, io);
  assert.equal(dentro, SENHA);
  assert.equal(chamadas.levantar[0][1].credencial.password, null);
});

test('a privada nunca chega à janela nem ao motor', async () => {
  const { executar, io, chamadas } = montar();
  await executar(TAREFA, io);
  assert.ok(!JSON.stringify(chamadas).includes(vetor.privada));
});

test('uma entrega que não abre (outra tarefa) falha sem janela', async () => {
  const { executar, io, registo, chamadas } = montar();
  await executar({ ...TAREFA, tarefaId: TAREFA.tarefaId + 1 }, io);
  assert.equal(concluido(registo).resultado.fase, 'credencial');
  assert.equal(chamadas.criarJanela.length, 0);
});

test('tipo depositar vai ao depositar, com hostsExtra na janela, e deixa sair os campos da referência', async () => {
  const { executar, io, registo, chamadas } = montar();
  await executar({ ...TAREFA, tipo: 'depositar', parametros: { valor: 20 } }, io);
  assert.equal(chamadas.levantar.length, 0);
  assert.equal(chamadas.depositar.length, 1);
  const [casino, opcoes] = chamadas.criarJanela[0];
  assert.equal(casino, 'placard');
  assert.ok(Array.isArray(opcoes.hostsExtra) && opcoes.hostsExtra.length > 0);
  const c = concluido(registo);
  assert.equal(c.estado, 'feita');
  assert.deepEqual(c.resultado, { valor: 20, entidade: '21312', referencia: '123456789', validade: '2026-10-25', codigo: 'X1', motivo: undefined, fase: undefined });
});

test('depósito: o valor da referência é o que o motor escreveu, nunca um montante lido na página', async () => {
  const { executar, io, registo } = montar({ motor: async () => ({ estado: 'feita', valor: 20, montante: 1000, entidade: 'E', referencia: 'R' }) });
  await executar({ ...TAREFA, tipo: 'depositar', parametros: { valor: 20 } }, io);
  assert.equal(concluido(registo).resultado.valor, 20);
});

test('levantar (com ou sem tipo) usa janela sem hostsExtra e nunca deixa sair os campos de depósito', async () => {
  for (const tipo of ['levantar', undefined]) {
    const { executar, io, registo, chamadas } = montar({ motor: async () => ({ estado: 'feita', valor: 20, entidade: 'E', referencia: 'R', validade: 'V', codigo: 'C' }) });
    await executar({ ...TAREFA, tipo }, io);
    assert.equal(chamadas.depositar.length, 0);
    assert.deepEqual(chamadas.criarJanela[0][1], { hostsExtra: [] });
    const r = concluido(registo).resultado;
    for (const k of ['entidade', 'referencia', 'validade', 'codigo']) assert.ok(!(k in r) || r[k] === undefined, k);
  }
});

test('tipo desconhecido falha na fase tipo sem pedir a credencial', async () => {
  const { executar, io, registo, chamadas } = montar();
  await executar({ ...TAREFA, tipo: 'transferir' }, io);
  assert.ok(!registo.some(x => x.api));
  assert.equal(chamadas.criarJanela.length, 0);
  assert.equal(concluido(registo).estado, 'falhada');
  assert.equal(concluido(registo).resultado.fase, 'tipo');
});

// ---------- browser partilhado pelo casino ----------

test('a janela é a do casino e o logout leva o driver, o casino e o fluxo', async () => {
  const { executar, io, chamadas } = montar();
  await executar(TAREFA, io);
  assert.equal(chamadas.criarJanela[0][0], 'placard');
  assert.deepEqual(chamadas.sair, [[{ id: 'driver' }, 'placard', null]]);
});

test('logout que falha ou rebenta não muda o resultado da tarefa', async () => {
  for (const sair of [async () => ({ estado: 'falhada', fase: 'logout' }), async () => { throw new Error('x'); }]) {
    const { executar, io, registo } = montar({ sair });
    await executar(TAREFA, io);
    assert.equal(concluido(registo).estado, 'feita');
    assert.ok(registo.some(x => x.janela === 'fechar'));
  }
});

test('logout preso: ao fim do teto fecha e conclui na mesma', async () => {
  const tempos = [];
  const { executar, io, registo } = montar({
    sair: () => new Promise(() => {}),
    relogio: { setTimeoutFn: (f, ms) => { tempos.push(ms); if (ms < TEMPO_MAX_REAL_MS) setImmediate(f); return tempos.length; }, clearTimeoutFn: () => {} }
  });
  await executar(TAREFA, io);
  assert.ok(tempos.some(ms => ms < TEMPO_MAX_REAL_MS), 'tem teto próprio');
  assert.equal(concluido(registo).estado, 'feita');
});

test('motor que não acabou (tempo esgotado) ou rebentou: não mexe na sessão', async () => {
  let disparar;
  const preso = montar({
    motor: () => new Promise(() => {}),
    relogio: { setTimeoutFn: (f) => { disparar = f; return 1; }, clearTimeoutFn: () => {} }
  });
  const fim = preso.executar(TAREFA, preso.io);
  await new Promise(r => setImmediate(r));
  disparar();
  await fim;
  assert.equal(preso.chamadas.sair.length, 0);
  const rebentou = montar({ motor: async () => { throw new Error('x'); } });
  await rebentou.executar(TAREFA, rebentou.io);
  assert.equal(rebentou.chamadas.sair.length, 0);
});

// ---------- data de nascimento (Betclic) ----------

const NASC = vetor.nascimento;
const BETCLIC = { ...TAREFA, casino: 'Betclic' };
const { nascimentoCifrado: _semUso, ...ENTREGA_SEM_DATA } = ENTREGA;

// Corre o executor até ao fim em cada desfecho e devolve o que o motor viu e o que ficou registado.
async function emCadaDesfecho(fn) {
  const desfechos = {
    feita: async () => ({ estado: 'feita', saldo: 30, valor: 20 }),
    falhada: async () => ({ estado: 'falhada', fase: 'login', motivo: 'Login recusado' }),
    excecao: async (d, pedido) => { throw new Error(`rebentou com ${pedido.credencial.nascimento}`); },
    tempo: () => new Promise(() => {})
  };
  for (const [nome, corpo] of Object.entries(desfechos)) {
    let disparar;
    let visto;
    let pedidoVisto;
    const relogio = nome === 'tempo' ? { setTimeoutFn: (f) => { disparar = f; return 1; }, clearTimeoutFn: () => {} } : {};
    const { executar, io, registo } = montar({
      relogio,
      motor: async (d, pedido, aoPasso) => { visto = pedido.credencial.nascimento; pedidoVisto = pedido; await aoPasso('a-entrar'); return corpo(d, pedido); }
    });
    const p = executar(BETCLIC, io);
    if (nome === 'tempo') { await new Promise(r => setImmediate(r)); disparar(); }
    await p;
    await fn(nome, { visto, pedido: pedidoVisto, registo });
  }
}

test('Betclic com nascimentoCifrado: o motor recebe a data decifrada na credencial', async () => {
  let dentro;
  const { executar, io, chamadas } = montar({ motor: async (d, pedido) => { dentro = pedido.credencial.nascimento; return { estado: 'feita' }; } });
  await executar(BETCLIC, io);
  assert.equal(chamadas.levantar[0][1].casino, 'betclic');
  assert.equal(dentro, NASC);
});

test('sem nascimentoCifrado o motor recebe nascimento null', async () => {
  let dentro = 'por-ler';
  const { executar, io, registo } = montar({ resposta: ENTREGA_SEM_DATA, motor: async (d, pedido) => { dentro = pedido.credencial.nascimento; return { estado: 'feita' }; } });
  await executar(BETCLIC, io);
  assert.equal(dentro, null);
  assert.equal(concluido(registo).estado, 'feita');
});

test('nascimentoCifrado estragado: falhada na fase credencial, sem janela nem motor', async () => {
  const tag = Buffer.from(ENTREGA.nascimentoCifrado.tag, 'base64'); tag[0] ^= 1;
  const estragada = { ...ENTREGA, nascimentoCifrado: { ...ENTREGA.nascimentoCifrado, tag: tag.toString('base64') } };
  const { executar, io, registo, chamadas } = montar({ resposta: estragada });
  await executar(BETCLIC, io);
  const c = concluido(registo);
  assert.equal(c.estado, 'falhada');
  assert.deepEqual(c.resultado, { fase: 'credencial', motivo: 'Não foi possível abrir a credencial' });
  assert.equal(chamadas.criarJanela.length, 0);
  assert.equal(chamadas.levantar.length, 0);
  assert.ok(!JSON.stringify(registo).includes(SENHA));
});

test('feita, falhada, exceção e tempo esgotado: a data e a password ficam limpas no fim', async () => {
  await emCadaDesfecho((nome, { visto, pedido }) => {
    assert.equal(visto, NASC, `${nome}: o motor recebeu a data`);
    assert.equal(pedido.credencial.nascimento, null, `${nome}: data limpa`);
    assert.equal(pedido.credencial.password, null, `${nome}: password limpa`);
  });
});

test('a data não sai em resultado, progresso, mensagem das falhas nem no objeto do concluir', async () => {
  await emCadaDesfecho((nome, { visto, registo }) => {
    assert.equal(visto, NASC, `${nome}: o motor recebeu a data`);
    assert.ok(registo.some(x => x.io === 'progresso'), `${nome}: houve progresso`);
    assert.ok(!JSON.stringify(registo).includes(NASC), `${nome}: data fora do registo`);
    assert.ok(!JSON.stringify(concluido(registo)).includes(NASC), `${nome}: data fora do concluir`);
  });
});

test('mesmo que o motor devolva a credencial ou a data, o concluir só leva os campos conhecidos', async () => {
  for (const tipo of ['levantar', 'depositar']) {
    const { executar, io, registo } = montar({
      motor: async (d, pedido) => ({ estado: 'falhada', fase: 'login', nascimento: pedido.credencial.nascimento, credencial: { ...pedido.credencial }, extra: `data ${pedido.credencial.nascimento}` })
    });
    await executar({ ...BETCLIC, tipo, parametros: { valor: 20 } }, io);
    const c = concluido(registo);
    assert.equal(c.resultado.fase, 'login');
    assert.ok(!JSON.stringify(c).includes(NASC), tipo);
    assert.ok(!JSON.stringify(c).includes(SENHA), tipo);
  }
});

// Cifra como a API (services/operacoes/cifraEntrega.js) para a chave do vetor, com o AAD do código.
function cifrarCodigo(codigo, tarefaId) {
  const crypto = require('node:crypto');
  const PKCS8 = Buffer.from('302e020100300506032b656e04220420', 'hex');
  const privada = crypto.createPrivateKey({ key: Buffer.concat([PKCS8, Buffer.from(vetor.privada, 'base64')]), format: 'der', type: 'pkcs8' });
  const publica = crypto.createPublicKey(privada);
  const efemero = crypto.generateKeyPairSync('x25519');
  const epk = efemero.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
  const segredo = crypto.diffieHellman({ privateKey: efemero.privateKey, publicKey: publica });
  const chave = Buffer.from(crypto.hkdfSync('sha256', segredo, epk, 'bci-entrega-v1', 32));
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', chave, iv);
  c.setAAD(Buffer.from(`${tarefaId}:codigo`));
  const cifrado = Buffer.concat([c.update(codigo, 'utf8'), c.final()]);
  return { epk: epk.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), cifrado: cifrado.toString('base64') };
}

function comCodigo({ leituras, pedido = 200, deveParar }) {
  const registo = [];
  let recebido;
  const base = `/users/me/devices/D1/tarefas/${TAREFA.tarefaId}`;
  const api = {
    post: async (rota, corpo) => {
      registo.push({ post: rota, corpo });
      if (rota.endsWith('/credenciais')) return { status: 200, corpo: { result: { data: ENTREGA } } };
      return { status: pedido, corpo: { result: { data: { estado: 'a-espera' } } } };
    },
    get: async (rota) => { registo.push({ get: rota }); return leituras.shift() ?? { status: 200, corpo: { result: { data: { estado: 'a-espera' } } } }; }
  };
  const io = {
    iniciar: async () => {}, progresso: async (p) => registo.push({ progresso: p }), concluir: async () => {},
    esperar: async (ms) => registo.push({ esperar: ms })
  };
  const executar = criarExecutorReal({
    api, raiz: (d) => `/users/me/devices/${d}`,
    criarJanela: () => ({ driver: {}, fechar: () => {} }),
    levantar: async (driver, p) => { recebido = await p.pedirCodigo({ repetido: false }); return { estado: 'ensaio' }; },
    depositar: async () => ({ estado: 'ensaio' }),
    sair: async () => null
  });
  return { correr: () => executar(TAREFA, io, { deviceId: 'D1', privada: async () => vetor.privada, deveParar }), registo, base, recebido: () => recebido };
}

test('pedirCodigo: avisa a API, espera e devolve o código decifrado', async () => {
  const pronto = { status: 200, corpo: { result: { data: { estado: 'pronto', entrega: cifrarCodigo('482915', TAREFA.tarefaId) } } } };
  const c = comCodigo({ leituras: [undefined, pronto] });
  await c.correr();
  assert.equal(c.recebido(), '482915');
  assert.ok(c.registo.some(x => x.post === `${c.base}/codigo` && x.corpo.repetido === false));
  assert.equal(c.registo.filter(x => x.get === `${c.base}/codigo`).length, 2);
  assert.ok(c.registo.some(x => x.progresso === 'a-esperar-codigo'));
});

test('pedirCodigo: um código cifrado para outra tarefa não abre', async () => {
  const outro = { status: 200, corpo: { result: { data: { estado: 'pronto', entrega: cifrarCodigo('482915', TAREFA.tarefaId + 1) } } } };
  const c = comCodigo({ leituras: [outro] });
  await c.correr();
  assert.equal(c.recebido(), null);
});

test('pedirCodigo: pedido recusado, expirado ou tarefa perdida dá null sem esperar o tempo todo', async () => {
  const recusado = comCodigo({ leituras: [], pedido: 409 });
  await recusado.correr();
  assert.equal(recusado.recebido(), null);
  assert.ok(!recusado.registo.some(x => x.get));

  const expirado = comCodigo({ leituras: [{ status: 200, corpo: { result: { data: { estado: 'expirado' } } } }] });
  await expirado.correr();
  assert.equal(expirado.recebido(), null);
  assert.equal(expirado.registo.filter(x => x.get).length, 1);

  const perdida = comCodigo({ leituras: [{ status: 404, corpo: null }] });
  await perdida.correr();
  assert.equal(perdida.recebido(), null);
});

test('pedirCodigo: sem resposta, desiste ao fim de 5 minutos de leituras', async () => {
  const c = comCodigo({ leituras: [] });
  await c.correr();
  assert.equal(c.recebido(), null);
  const esperado = c.registo.filter(x => x.esperar).reduce((s, x) => s + x.esperar, 0);
  assert.equal(esperado, 5 * 60 * 1000);
});

test('pedirCodigo: consentimento retirado a meio: pára de esperar', async () => {
  let c = null;
  c = comCodigo({ leituras: [], deveParar: () => !!c && c.registo.filter(x => x.get).length >= 3 });
  await c.correr();
  assert.equal(c.recebido(), null);
  assert.equal(c.registo.filter(x => x.get).length, 3);
});

test('pedirCodigo: a app a fechar deixa de esperar pelo dono', async () => {
  const c = comCodigo({ leituras: [] });
  const ctx = { deviceId: 'D1', privada: async () => vetor.privada, aFechar: () => c.registo.filter(x => x.get).length >= 2 };
  // O mesmo executor, com o contexto da app a fechar.
  const executar = criarExecutorReal({
    api: { post: async (r) => (r.endsWith('/credenciais') ? { status: 200, corpo: { result: { data: ENTREGA } } } : { status: 200, corpo: {} }),
      get: async (r) => { c.registo.push({ get: r }); return { status: 200, corpo: { result: { data: { estado: 'a-espera' } } } }; } },
    raiz: (d) => `/users/me/devices/${d}`, criarJanela: () => ({ driver: {}, fechar: () => {} }),
    levantar: async (driver, p) => ({ estado: 'ensaio', motivo: String(await p.pedirCodigo()) }),
    depositar: async () => ({ estado: 'ensaio' }), sair: async () => null
  });
  let fim;
  await executar(TAREFA, { iniciar: async () => {}, concluir: async (e, r) => { fim = r; }, esperar: async () => {} }, ctx);
  assert.equal(fim.motivo, 'null');
  assert.equal(c.registo.filter(x => x.get).length, 2);
});
