'use strict';

/** Executor fictício da fase 2: inicia, espera e conclui conforme parametros.simular, sem casino nem rede. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { executar } = require('../src/main/executorFicticio');

function io({ aleatorio = 0.5 } = {}) {
  const chamadas = [];
  return {
    chamadas,
    iniciar: async (est) => { chamadas.push(['iniciar', est]); },
    progresso: async (passo, resto) => { chamadas.push(['progresso', passo, resto]); },
    concluir: async (estado, resultado) => { chamadas.push(['concluir', estado, resultado]); },
    esperar: async (ms) => { chamadas.push(['esperar', ms]); },
    aleatorio: () => aleatorio
  };
}

const tarefa = (parametros = {}) => ({ tarefaId: 1, simulada: true, parametros });

test('ok (omissão): inicia com a estimativa, avisa o progresso em 4 fatias e conclui «feita»', async () => {
  for (const [a, total] of [[0, 5], [1, 20], [0.5, 12.5]]) {
    const x = io({ aleatorio: a });
    await executar(tarefa(), x);
    const esperado = [['iniciar', total]];
    for (let i = 0; i < 4; i++) esperado.push(['progresso', 'a-simular', total * (1 - i / 4)], ['esperar', (total / 4) * 1000]);
    esperado.push(['concluir', 'feita', { simulado: true, motivo: 'Simulação' }]);
    assert.deepEqual(x.chamadas, esperado);
  }
});

test('o restante avisado desce e a espera soma o total', async () => {
  const x = io({ aleatorio: 0.5 });
  await executar(tarefa(), x);
  const restos = x.chamadas.filter(c => c[0] === 'progresso').map(c => c[2]);
  assert.deepEqual(restos, [...restos].sort((a, b) => b - a));
  assert.ok(restos.at(-1) > 0 && restos.at(-1) < restos[0]);
  assert.equal(x.chamadas.filter(c => c[0] === 'esperar').reduce((s, c) => s + c[1], 0), 12500);
});

test('sem io.progresso continua a funcionar', async () => {
  const x = io();
  delete x.progresso;
  await executar(tarefa(), x);
  assert.equal(x.chamadas.at(-1)[1], 'feita');
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
  assert.deepEqual(x.chamadas.map(c => c[0]).filter((c, i, a) => a.indexOf(c) === i), ['iniciar', 'progresso', 'esperar']);
  assert.ok(!x.chamadas.some(c => c[0] === 'concluir'));
});

test('se iniciar falha, não espera nem conclui', async () => {
  const x = io();
  x.iniciar = async () => { throw new Error('409'); };
  await assert.rejects(executar(tarefa(), x));
  assert.equal(x.chamadas.length, 0);
});
