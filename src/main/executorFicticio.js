'use strict';

/**
 * Executor fictício (fase 2): prova o circuito da fila sem abrir casinos, sem credenciais e sem dinheiro.
 * `parametros.simular` escolhe o desfecho; «sem-resposta» nunca conclui, para o servidor passar a tarefa a «verificar».
 * Cópia igual na Admin App: mudar um obriga a mudar o outro.
 */

async function executar(tarefa, io) {
  const p = tarefa?.parametros || {};
  await io.iniciar();
  await io.esperar(5000 + io.aleatorio() * 15000);
  switch (p.simular || 'ok') {
    case 'falha':
      return io.concluir('falhada', { simulado: true, motivo: 'Simulação de falha' });
    case 'captcha':
      return io.concluir('saltada', { simulado: true, motivo: 'verificação de humano' });
    case 'sem-resposta':
      return;
    default:
      return io.concluir(p.ensaio ? 'ensaio' : 'feita', { simulado: true, motivo: 'Simulação' });
  }
}

module.exports = { executar };
