'use strict';

/** Executor fictício da fase 2: inicia, espera e conclui conforme parametros.simular, sem casino nem rede. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { executar } = require('../src/main/executorFicticio');

function io({ aleatorio = 0.5 } = {}) {
  const chamadas = [];
  return {
    chamadas,
    iniciar: async () => { chamadas.push(['iniciar']); },
    concluir: async (estado, resultado) => { chamadas.push(['concluir', estado, resultado]); },
    esperar: async (ms) => { chamadas.push(['esperar', ms]); },
    aleatorio: () => aleatorio
  };
}

const tarefa = (parametros = {}) => ({ tarefaId: 1, simulada: true, parametros });

test('ok (omissão): inicia, espera 5 a 20 s e conclui «feita»', async () => {
  for (const [a, ms] of [[0, 5000], [1, 20000], [0.5, 12500]]) {
    const x = io({ aleatorio: a });
    await executar(tarefa(), x);
    assert.deepEqual(x.chamadas, [['iniciar'], ['esperar', ms], ['concluir', 'feita', { simulado: true, motivo: 'Simulação' }]]);
  }
});

test('ensaio troca «feita» por «ensaio»', async () => {
  const x = io();
  await executar(tarefa({ simular: 'ok', ensaio: true }), x);
  assert.equal(x.chamadas.at(-1)[1], 'ensaio');
});

test('falha → falhada; captcha → saltada com o motivo', async () => {
  const f = io();
  await executar(tarefa({ simular: 'falha' }), f);
  assert.equal(f.chamadas.at(-1)[1], 'falhada');
  assert.equal(f.chamadas.at(-1)[2].simulado, true);
  const c = io();
  await executar(tarefa({ simular: 'captcha' }), c);
  assert.deepEqual(c.chamadas.at(-1), ['concluir', 'saltada', { simulado: true, motivo: 'verificação de humano' }]);
});

test('sem-resposta inicia mas nunca conclui', async () => {
  const x = io();
  await executar(tarefa({ simular: 'sem-resposta' }), x);
  assert.deepEqual(x.chamadas.map(c => c[0]), ['iniciar', 'esperar']);
});

test('se iniciar falha, não espera nem conclui', async () => {
  const x = io();
  x.iniciar = async () => { throw new Error('409'); };
  await assert.rejects(executar(tarefa(), x));
  assert.equal(x.chamadas.length, 0);
});
