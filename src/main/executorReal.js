'use strict';

/**
 * Executor real de uma conta: pede a credencial, abre a janela escondida, corre o motor e conclui.
 * A password e a data de nascimento só existem aqui, em memória, entre decifrar e entregar ao motor: nunca vão a registos, a `io` nem à janela.
 */

const { decifrarEntrega, decifrarNascimento } = require('./entregaCifra');
const { chaveDoNome } = require('./levantar');
const { hostsExtraDe } = require('./depositar');
const { sair: sairDoCasino } = require('./sessaoCasino');

// Cabe o login, dois pedidos de código ao dono da conta (5 min cada) e o caixa.
const TEMPO_MAX_REAL_MS = 20 * 60 * 1000;
// O servidor só aceita a resposta do dono nos 6 minutos a seguir ao pedido.
const ESPERA_CODIGO_MS = 5 * 60 * 1000;
const INTERVALO_CODIGO_MS = 4000;
// O logout no fim não pode prender o PC; se não acabar, a tarefa seguinte termina a sessão antes de entrar.
const TEMPO_MAX_SAIR_MS = 45 * 1000;
// Estimativa do que falta em cada passo, para o painel; o limite duro é o tempo máximo.
const RESTANTE_SEG = { 'a-entrar': 120, 'a-abrir': 75, 'a-ler-saldo': 60, 'a-preencher': 40, 'a-levantar': 20, 'a-esperar-codigo': ESPERA_CODIGO_MS / 1000 };
const ESTADOS = ['feita', 'ensaio', 'saltada', 'falhada', 'verificar'];

// Só os 4 últimos dígitos do IBAN saem da app.
function ibanFim(iban) {
  const fim = String(iban || '').replace(/\D/g, '').slice(-4);
  return /^\d{1,4}$/.test(fim) ? fim : undefined;
}

function resultadoDe(r, tipo) {
  // Um estado que o motor não conhece é dúvida, não falha: pode ter havido dinheiro a mexer.
  const estado = ESTADOS.includes(r?.estado) ? r.estado : 'verificar';
  if (tipo === 'depositar') {
    const { entidade, referencia, validade, codigo, motivo, fase } = r || {};
    return { estado, resultado: { valor: r?.valor, entidade, referencia, validade, codigo, motivo, fase } };
  }
  const resultado = { saldo: r?.saldo, freebets: r?.freebets, valor: r?.valor, ibanFim: ibanFim(r?.iban), motivo: r?.motivo, fase: r?.fase };
  if (estado === 'feita' && r?.motivo) resultado.textoCaixa = r.motivo;
  return { estado, resultado };
}

/**
 * `raiz(deviceId)` dá a rota do dispositivo; o contexto `ctx = { deviceId, privada(), deveParar(), aFechar() }` traz a chave privada em base64 (só aqui é lida)
 * e diz se é para parar (consentimento retirado ou um admin) ou se a app está a fechar.
 * Devolve (tarefa, io, ctx) => Promise<void>, com a forma do executor fictício.
 */
function criarExecutorReal({ api, raiz, criarJanela, levantar, depositar, sair = sairDoCasino, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout }) {
  return async function executar(tarefa, io, ctx) {
    const id = Number(tarefa.tarefaId);
    await io.iniciar(150);

    const casino = chaveDoNome(tarefa.casino);
    if (!casino) return io.concluir('falhada', { fase: 'casino', motivo: 'Casino não reconhecido' });

    // Tarefas da fase 3 podem não ter tipo: são levantamentos.
    const tipo = tarefa.tipo ?? 'levantar';
    if (tipo !== 'depositar' && tipo !== 'levantar') return io.concluir('falhada', { fase: 'tipo', motivo: 'Tipo de tarefa desconhecido' });
    const motorDoTipo = tipo === 'depositar' ? depositar : levantar;

    if (ctx.deveParar?.() === true) return io.concluir('falhada', { fase: 'parado', motivo: 'Mandaram parar antes de começar' });

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

    const credencial = { username: dados?.username, password: null, nascimento: null };
    try {
      const privada = await ctx.privada();
      credencial.password = decifrarEntrega(privada, id, dados);
      credencial.nascimento = decifrarNascimento(privada, id, dados);
    } catch (e) {
      credencial.password = null;
      credencial.nascimento = null;
      return io.concluir('falhada', { fase: 'credencial', motivo: 'Não foi possível abrir a credencial' });
    }

    let janela = null;
    let temporizador = null;
    let terminado = false;
    const esperar = io.esperar || ((ms) => new Promise((resolve) => setTimeoutFn(resolve, ms)));
    const base = `${raiz(ctx.deviceId)}/tarefas/${id}`;
    // O casino mandou um código por SMS ao dono da conta: a API avisa-o e o código volta cifrado para este PC. null se não chegou.
    // A app a fechar também desiste: senão o fecho esperava pelos minutos do dono.
    const desistir = () => terminado || ctx.deveParar?.() === true || ctx.aFechar?.() === true;
    const pedirCodigo = async ({ repetido = false } = {}) => {
      if (desistir()) return null;
      await io.progresso?.('a-esperar-codigo', ESPERA_CODIGO_MS / 1000);
      try {
        const r = await api.post(`${base}/codigo`, { repetido: !!repetido });
        if (r.status !== 200) return null;
      } catch (e) {
        return null;
      }
      for (let i = 0; i < ESPERA_CODIGO_MS / INTERVALO_CODIGO_MS; i++) {
        await esperar(INTERVALO_CODIGO_MS);
        if (desistir()) return null;
        let r;
        try { r = await api.get(`${base}/codigo`); } catch (e) { continue; }
        if (r.status >= 400 && r.status < 500 && r.status !== 429) return null;
        const d = r.corpo?.result?.data ?? r.corpo?.data;
        if (d?.estado === 'expirado') return null;
        if (r.status === 200 && d?.entrega) {
          try { return decifrarEntrega(await ctx.privada(), `${id}:codigo`, d.entrega); } catch (e) { return null; }
        }
      }
      return null;
    };
    let r;
    let acabou = false;
    try {
      janela = await criarJanela(casino, { hostsExtra: hostsExtraDe(casino, tipo) });
      const limite = new Promise((resolve) => {
        temporizador = setTimeoutFn(() => resolve({ estado: 'verificar', fase: 'tempo', motivo: 'Passou o tempo máximo — vê no casino se ficou feito' }), TEMPO_MAX_REAL_MS);
      });
      const motor = motorDoTipo(janela.driver, {
        casino, fluxo: dados.fluxo ?? null, credencial, parametros: tarefa.parametros || {}, ensaio: !!tarefa.parametros?.ensaio,
        deveParar: () => ctx.deveParar?.() === true, pedirCodigo
      }, async (passo) => {
        if (!terminado) await io.progresso?.(passo, RESTANTE_SEG[passo] ?? 60);
      });
      r = await Promise.race([motor.then((x) => { acabou = true; return x; }), limite]);
    } catch (e) {
      r = { estado: 'falhada', fase: 'janela', motivo: 'Não foi possível abrir a janela do casino' };
    } finally {
      terminado = true;
      credencial.password = null;
      credencial.nascimento = null;
      if (temporizador) clearTimeoutFn(temporizador);
      // O browser é partilhado pelas contas do casino: não fica aberta a sessão desta. Com o motor ainda a correr (tempo esgotado) não se mexe.
      if (janela && acabou) {
        let fim;
        const teto = new Promise((resolve) => { fim = setTimeoutFn(resolve, TEMPO_MAX_SAIR_MS); });
        await Promise.race([Promise.resolve().then(() => sair(janela.driver, casino, dados.fluxo ?? null)).catch(() => null), teto]);
        clearTimeoutFn(fim);
      }
      await janela?.fechar();
    }

    const { estado, resultado } = resultadoDe(r, tipo);
    return io.concluir(estado, resultado);
  };
}

module.exports = { criarExecutorReal, TEMPO_MAX_REAL_MS, ESPERA_CODIGO_MS };
