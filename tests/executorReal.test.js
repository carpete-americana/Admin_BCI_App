'use strict';

/** O executor real com dependências falsas: a ordem das chamadas, o que cada estado devolve e que a password nunca sai. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { criarExecutorReal, TEMPO_MAX_REAL_MS } = require('../src/main/executorReal');
const vetor = require('./fixtures/entrega-vetor.json');

const SENHA = vetor.texto;
const TAREFA = { tarefaId: vetor.tarefaId, accountId: 7, casino: 'Placard', parametros: { modo: 'igual', valor: 20, minimo: 10 } };
const ENTREGA = { ...vetor.entrega, username: 'joao', fluxo: null };

function montar({ status = 200, motor, resposta, relogio = {} } = {}) {
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
  const chamadas = { criarJanela: [], levantar: [] };
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
    ...relogio
  });
  const ctx = { deviceId: 'D1', privada: async () => vetor.privada };
  return { executar: (tarefa, io) => executar(tarefa, io, ctx), io, registo, chamadas };
}

const concluido = (registo) => registo.find(x => x.io === 'concluir');

test('ordem: iniciar, credenciais, janela, motor, fechar, concluir', async () => {
  const { executar, io, registo } = montar();
  await executar(TAREFA, io);
  const ordem = registo.filter(x => x.io !== 'progresso').map(x => x.io || x.api || x.janela || x.motor);
  assert.deepEqual(ordem, ['iniciar', `/users/me/devices/D1/tarefas/${TAREFA.tarefaId}/credenciais`, 'criar', 'levantar', 'fechar', 'concluir']);
});

test('o progresso chega pela ordem do motor', async () => {
  const { executar, io, registo } = montar();
  await executar(TAREFA, io);
  assert.deepEqual(registo.filter(x => x.io === 'progresso').map(x => x.p), ['a-entrar', 'a-abrir', 'a-ler-saldo', 'a-preencher', 'a-levantar']);
});

test('cada estado do motor chega ao concluir só com os 4 últimos dígitos do IBAN', async () => {
  for (const estado of ['feita', 'ensaio', 'saltada', 'falhada', 'verificar']) {
    const { executar, io, registo } = montar({
      motor: async () => ({ estado, saldo: 30, valor: 20, iban: 'PT50 0000 0000 0000 0000 0154', motivo: 'm', fase: 'caixa' })
    });
    await executar(TAREFA, io);
    const c = concluido(registo);
    assert.equal(c.estado, estado);
    assert.equal(c.resultado.ibanFim, '0154');
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
