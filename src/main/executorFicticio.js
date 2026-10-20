'use strict';

/**
 * Executor fictício (fase 2): prova o circuito da fila sem abrir casinos, sem credenciais e sem dinheiro.
 * `parametros.simular` escolhe o desfecho; «sem-resposta» nunca conclui, para o servidor passar a tarefa a «verificar».
 * Avisa o progresso por fatias, para o painel mostrar o que falta mesmo numa simulação.
 * Cópia igual na Admin App: mudar um obriga a mudar o outro.
 */

const FATIAS = 4;

async function executar(tarefa, io) {
  const p = tarefa?.parametros || {};
  const total = 5 + io.aleatorio() * 15;
  await io.iniciar(total);
  // Espera em fatias: cada uma diz ao painel quanto falta.
  for (let i = 0; i < FATIAS; i++) {
    await io.progresso?.('a-simular', total * (1 - i / FATIAS));
    await io.esperar((total / FATIAS) * 1000);
  }
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
