'use strict';

/**
 * Executor real de uma conta: pede a credencial, abre a janela escondida, corre o motor e conclui.
 * A password só existe aqui, em memória, entre decifrar e entregar ao motor: nunca vai a registos, a `io` nem à janela.
 */

const { decifrarEntrega } = require('./entregaCifra');
const { chaveDoNome } = require('./levantar');

const TEMPO_MAX_REAL_MS = 10 * 60 * 1000;
// Estimativa do que falta em cada passo, para o painel; o limite duro é o tempo máximo.
const RESTANTE_SEG = { 'a-entrar': 120, 'a-abrir': 75, 'a-ler-saldo': 60, 'a-preencher': 40, 'a-levantar': 20 };
const ESTADOS = ['feita', 'ensaio', 'saltada', 'falhada', 'verificar'];

// Só os 4 últimos dígitos do IBAN saem da app.
function ibanFim(iban) {
  const fim = String(iban || '').replace(/\D/g, '').slice(-4);
  return /^\d{1,4}$/.test(fim) ? fim : undefined;
}

function resultadoDe(r) {
  // Um estado que o motor não conhece é dúvida, não falha: pode ter havido dinheiro a mexer.
  const estado = ESTADOS.includes(r?.estado) ? r.estado : 'verificar';
  const resultado = { saldo: r?.saldo, valor: r?.valor, ibanFim: ibanFim(r?.iban), motivo: r?.motivo, fase: r?.fase };
  if (estado === 'feita' && r?.motivo) resultado.textoCaixa = r.motivo;
  return { estado, resultado };
}

/**
 * `raiz(deviceId)` dá a rota do dispositivo; o contexto `ctx = { deviceId, privada() }` traz a chave privada em base64 (só aqui é lida).
 * Devolve (tarefa, io, ctx) => Promise<void>, com a forma do executor fictício.
 */
function criarExecutorReal({ api, raiz, criarJanela, levantar, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout }) {
  return async function executar(tarefa, io, ctx) {
    const id = Number(tarefa.tarefaId);
    await io.iniciar(150);

    const casino = chaveDoNome(tarefa.casino);
    if (!casino) return io.concluir('falhada', { fase: 'casino', motivo: 'Casino não reconhecido' });

    let dados;
    try {
      const r = await api.post(`${raiz(ctx.deviceId)}/tarefas/${id}/credenciais`, {});
      if (r.status !== 200) {
        return io.concluir('falhada', { fase: 'credencial', motivo: `Credencial recusada (${r.status})` });
      }
      dados = r.corpo?.result?.data ?? r.corpo?.data;
    } catch (e) {
      return io.concluir('falhada', { fase: 'credencial', motivo: 'Não foi possível pedir a credencial' });
    }

    const credencial = { username: dados?.username, password: null };
    try {
      credencial.password = decifrarEntrega(await ctx.privada(), id, dados);
    } catch (e) {
      return io.concluir('falhada', { fase: 'credencial', motivo: 'Não foi possível abrir a credencial' });
    }

    let janela = null;
    let temporizador = null;
    let terminado = false;
    let r;
    try {
      janela = criarJanela(Number(tarefa.accountId));
      const limite = new Promise((resolve) => {
        temporizador = setTimeoutFn(() => resolve({ estado: 'verificar', fase: 'tempo', motivo: 'Passou o tempo máximo — vê no casino se ficou feito' }), TEMPO_MAX_REAL_MS);
      });
      const motor = levantar(janela.driver, {
        casino, fluxo: dados.fluxo ?? null, credencial, parametros: tarefa.parametros || {}, ensaio: !!tarefa.parametros?.ensaio
      }, async (passo) => {
        if (!terminado) await io.progresso?.(passo, RESTANTE_SEG[passo] ?? 60);
      });
      r = await Promise.race([motor, limite]);
    } catch (e) {
      r = { estado: 'falhada', fase: 'janela', motivo: 'Não foi possível abrir a janela do casino' };
    } finally {
      terminado = true;
      credencial.password = null;
      if (temporizador) clearTimeoutFn(temporizador);
      janela?.fechar();
    }

    const { estado, resultado } = resultadoDe(r);
    return io.concluir(estado, resultado);
  };
}

module.exports = { criarExecutorReal, TEMPO_MAX_REAL_MS };
