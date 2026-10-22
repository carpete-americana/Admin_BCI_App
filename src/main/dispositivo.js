'use strict';

/**
 * Operações automáticas neste computador: consentimento, chave do dispositivo, sinal, arranque com o Windows
 * e as tarefas simuladas que o servidor entrega na resposta do sinal: soltas (servidor antigo) ou em pacotes, conta a conta.
 * Sem `require('electron')`: tudo vem por dependências, para testar com node --test.
 * Igual ao da User App (repositórios separados, sem pacote partilhado): mudar um obriga a mudar o outro.
 */

const crypto = require('node:crypto');
const { VERSAO_TEXTO, TITULO, TEXTO_CONSENTIMENTO, BOTOES } = require('./dispositivo-texto');
const executorFicticio = require('./executorFicticio');
const { TEMPO_MAX_REAL_MS } = require('./executorReal');

const SINAL_MS = 2 * 60 * 1000;
// O servidor diz quando quer o sinal seguinte (proximoSinalSeg); limitado a isto.
const SINAL_MIN_SEG = 5;
const SINAL_MAX_SEG = 300;
const TERMINAR_MAX_MS = 60 * 1000;
const RAIZ = '/users/me/devices';
// O servidor só entrega tarefas a quem declara saber fazê-las.
const CAPACIDADES = ['tarefas-v1', 'pacotes-v1', 'levantar-v1', 'depositar-v1'];
const CAPACIDADES_REAIS = ['levantar-v1', 'depositar-v1'];
const VISTAS_MAX = 50;
const CONCLUIR_TENTATIVAS = 4;
// O identificador da máquina só vai com o consentimento do texto que fala dele.
const VERSAO_COM_MAQUINA = 2;

/** AAAA-MM-DD na hora local: o pedido repete-se uma vez por dia do utilizador. */
const diaLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Par X25519 em base64 (32 bytes cada); a privada nunca sai do processo principal. */
function gerarParDeChaves() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  return {
    publica: publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64'),
    privada: privateKey.export({ type: 'pkcs8', format: 'der' }).subarray(-32).toString('base64')
  };
}

/** O id do JWT, sem verificar: só serve de chave do registo local. */
function userIdDoToken(token) {
  try {
    const id = Number(JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString()).id);
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch (e) {
    return null;
  }
}

const dadosDe = (r) => r?.corpo?.result?.data ?? r?.corpo?.data ?? null;

function criarDispositivo(deps) {
  const { api, lerToken, storage, safeStorage, app, pedirConsentimento, tray, versoes, randomUUID } = deps;
  const agendarFn = deps.setTimeoutFn || setTimeout;
  const desagendarFn = deps.clearTimeoutFn || clearTimeout;
  const lerMaquina = deps.maquinaId || (() => Promise.resolve(null));
  const executor = deps.executor || executorFicticio.executar;
  // Sem executorReal as contas reais não correm: o pacote pára e larga o resto.
  const executorReal = deps.executorReal || null;
  const limparParticoes = deps.limparParticoes || (async () => 0);
  // Sem Chrome nem Edge o PC não anuncia levantamentos nem depósitos reais, e a fila não lhos entrega.
  const capacidades = () => (deps.contasReais && !deps.contasReais() ? CAPACIDADES.filter(c => !CAPACIDADES_REAIS.includes(c)) : CAPACIDADES);
  const aguardarLimite = deps.aguardarLimite || ((ms) => {
    let t;
    const p = new Promise(r => { t = setTimeout(r, ms); });
    return { p, cancelar: () => clearTimeout(t) };
  });
  const esperar = deps.esperar || ((ms) => new Promise(r => setTimeout(r, ms)));
  const aleatorio = deps.aleatorio || Math.random;
  const registar = deps.registar || ((m, extra) => console.warn(m, extra || ''));
  const janelaVisivel = deps.janelaVisivel || (() => true);
  const agora = deps.agora || (() => new Date());
  let aPerguntar = null;
  let temporizador = null;
  let ligado = false;
  // Sem resposta do servidor, o sinal seguinte vem ao mesmo ritmo do último.
  let intervaloSeg = SINAL_MS / 1000;
  let aTerminar = false;
  let acordarPausa = null;
  // O que o computador diz no sinal que está a fazer; o painel mostra-o.
  let estadoPc = { pc: 'livre' };
  // O arranque do Windows só se reescreve quando muda (o cliente pode tê-lo desligado lá): esta marca diz que o desligámos nós.
  let arranqueSuspenso = false;
  // Uma tarefa de cada vez; as já vistas não voltam a correr (o servidor repete-a no sinal até ela começar).
  let execucao = null;
  // Uma conta real a decorrer: o fecho da app espera por ela mais do que por uma simulada.
  let contaReal = false;
  // Consentimento retirado com trabalho a meio: a conta real pára antes de Levantar e o pacote não segue.
  let parado = false;
  const vistas = [];

  const chaveDe = (userId) => `dispositivo:${userId}`;

  async function sessao() {
    const userId = userIdDoToken(await lerToken());
    return userId ? { userId, chave: chaveDe(userId) } : null;
  }

  async function ler(chave) {
    return (await storage.getItem(chave)) || null;
  }

  function aplicarArranque(ligado) {
    app.setLoginItemSettings({ openAtLogin: !!ligado, args: ligado ? ['--oculto'] : [] });
  }

  /** Sem sessão ou com a funcionalidade suspensa: desliga o arranque e o tray, uma vez, sem tocar no consentimento. */
  function suspender() {
    if (arranqueSuspenso) return;
    arranqueSuspenso = true;
    aplicarArranque(false);
    tray.setOperacoes(false);
  }

  /** Estado local → arranque e tray. */
  function aplicar(reg) {
    const ativo = !!reg?.consentido;
    arranqueSuspenso = false;
    aplicarArranque(ativo && reg.autostart !== false);
    tray.setOperacoes(ativo);
  }

  async function configDoServidor() {
    try {
      const r = await api.get(`${RAIZ}/config`);
      const d = r.status === 200 ? dadosDe(r) : null;
      return d ? { ativo: d.ativo === true, versaoConsentimento: Number(d.versaoConsentimento) } : null;
    } catch (e) {
      return null;
    }
  }

  async function estado() {
    const s = await sessao();
    const vazio = { disponivel: false, consentido: false, autostart: false, versaoConsentimento: null };
    if (!s) return vazio;
    const cfg = await configDoServidor();
    if (!cfg) return vazio;
    const reg = await ler(s.chave);
    const consentido = !!reg?.consentido && reg.versao === cfg.versaoConsentimento;
    return { disponivel: cfg.ativo, consentido, autostart: consentido && reg.autostart !== false, versaoConsentimento: cfg.versaoConsentimento };
  }

  async function aceitar() {
    const s = await sessao();
    if (!s) return { ok: false, motivo: 'sem-sessao' };
    const cfg = await configDoServidor();
    if (!cfg) return { ok: false, motivo: 'rede' };
    if (!cfg.ativo) return { ok: false, motivo: 'desligado' };
    if (cfg.versaoConsentimento !== VERSAO_TEXTO) return { ok: false, motivo: 'app-desatualizada' };
    if (!safeStorage.isEncryptionAvailable()) return { ok: false, motivo: 'sem-cifra' };

    const aceite = await pedirConsentimento({ modo: 'pedido', titulo: TITULO, texto: TEXTO_CONSENTIMENTO, botoes: BOTOES });
    if (!aceite) return { ok: false, motivo: 'cancelado' };

    // A chave e o deviceId mantêm-se entre revogações: o servidor não deixa trocar a chave de um deviceId.
    let reg = await ler(s.chave);
    if (!reg?.deviceId) {
      const par = gerarParDeChaves();
      reg = {
        deviceId: randomUUID(), chavePublica: par.publica,
        privadaCifrada: safeStorage.encryptString(par.privada).toString('base64'),
        autostart: true, consentido: false, versao: 0, revogarPendente: false
      };
    }

    let r;
    try {
      r = await api.post(RAIZ, {
        deviceId: reg.deviceId, chavePublica: reg.chavePublica, so: versoes.so, appVersao: app.getVersion(),
        electronVersao: versoes.electron, autostart: true, versao: VERSAO_TEXTO, capacidades: capacidades(), maquinaId: await lerMaquina()
      });
    } catch (e) {
      return { ok: false, motivo: 'rede' };
    }
    if (r.status === 409) return { ok: false, motivo: 'versao' };
    if (r.status !== 200) return { ok: false, motivo: 'erro' };

    reg = { ...reg, consentido: true, versao: VERSAO_TEXTO, autostart: true, revogarPendente: false };
    await storage.setItem(s.chave, reg);
    aplicar(reg);
    return { ok: true };
  }

  /**
   * Ao abrir a app: com a funcionalidade ligada e sem consentimento válido, mostra o pedido, no máximo uma vez por dia.
   * Marca-se só neste computador (nada vai à API antes de aceitar); sem sessão, janela escondida ou sem rede não marca.
   */
  function perguntarSeFaltar() {
    if (!aPerguntar) aPerguntar = perguntar().finally(() => { aPerguntar = null; });
    return aPerguntar;
  }

  async function perguntar() {
    const nao = { mostrado: false };
    if (!janelaVisivel()) return nao;
    const s = await sessao();
    if (!s) return nao;
    const cfg = await configDoServidor();
    if (!cfg?.ativo || cfg.versaoConsentimento !== VERSAO_TEXTO) return nao;
    const reg = await ler(s.chave);
    if (reg?.consentido && reg.versao === VERSAO_TEXTO) return nao;
    const hoje = diaLocal(agora());
    if (reg?.perguntadoEm === hoje) return nao;

    await storage.setItem(s.chave, { ...(reg || {}), perguntadoEm: hoje });
    const r = await aceitar();
    return { mostrado: true, aceite: r.ok };
  }

  async function revogar() {
    const s = await sessao();
    const reg = s && await ler(s.chave);
    if (!reg?.deviceId) return { ok: true };
    // Localmente já fica desligado; se o servidor não responder, repete-se no sinal seguinte.
    let pendente = false;
    try {
      const r = await api.del(`${RAIZ}/${reg.deviceId}`);
      // Só 200 e 404 confirmam; o resto repete-se no sinal seguinte.
      pendente = r.status !== 200 && r.status !== 404;
    } catch (e) {
      pendente = true;
    }
    parado = true;
    const novo = { ...reg, consentido: false, revogarPendente: pendente };
    await storage.setItem(s.chave, novo);
    aplicar(novo);
    await apagarBrowsers();
    return { ok: true };
  }

  async function definirArranque(ligado) {
    const s = await sessao();
    const reg = s && await ler(s.chave);
    if (typeof ligado !== 'boolean' || !reg?.consentido) return { ok: false };
    await storage.setItem(s.chave, { ...reg, autostart: ligado });
    aplicarArranque(ligado);
    return { ok: true };
  }

  async function desligarLocal(s, reg) {
    parado = true;
    const novo = { ...reg, consentido: false };
    await storage.setItem(s.chave, novo);
    aplicar(novo);
  }

  /** Um sinal: confirma ao servidor que este computador está ligado e aplica o que ele responder. Devolve o proximoSinalSeg pedido. */
  async function sinal() {
    try {
      const s = await sessao();
      if (!s) return;
      const reg = await ler(s.chave);
      if (!reg?.deviceId) return;

      if (reg.revogarPendente) {
        const r = await api.del(`${RAIZ}/${reg.deviceId}`);
        if (r.status === 200 || r.status === 404) await storage.setItem(s.chave, { ...reg, revogarPendente: false });
        return;
      }
      if (!reg.consentido) return;

      const r = await api.post(`${RAIZ}/${reg.deviceId}/sinal`, {
        appVersao: app.getVersion(), electronVersao: versoes.electron, autostart: reg.autostart !== false,
        capacidades: capacidades(), ...(reg.versao >= VERSAO_COM_MAQUINA && { maquinaId: await lerMaquina() }), estado: estadoPc
      });
      if (r.status === 401 || r.status === 403) return suspender();
      if (r.status === 404) { await apagarBrowsers(); return desligarLocal(s, reg); }
      if (r.status !== 200) return;
      const d = dadosDe(r);
      if (d?.consentimentoValido === false) {
        // Desligado no servidor ou conta suspensa pode passar: o consentimento e os browsers das contas ficam.
        if (d.motivo === 'desligado' || d.motivo === 'conta') return suspender();
        await apagarBrowsers();
        return desligarLocal(s, reg);
      }
      tray.setOperacoes(true);
      if (arranqueSuspenso) {
        arranqueSuspenso = false;
        aplicarArranque(reg.autostart !== false);
      }
      if (d?.pacote) tratarPacote(reg.deviceId, d.pacote);
      else if (d?.tarefa) tratarTarefa(reg.deviceId, d.tarefa);
      return d?.proximoSinalSeg;
    } catch (e) {
      // Sem rede ou erro do servidor: tenta-se no ciclo seguinte.
    }
  }

  function esquecer(chave) {
    const i = vistas.indexOf(chave);
    if (i >= 0) vistas.splice(i, 1);
  }

  /** As rotas de uma tarefa para o executor; `aoIniciar` corre quando o servidor aceita o início. */
  function ioDe(deviceId, id, chave, aoIniciar = () => {}) {
    const base = `${RAIZ}/${deviceId}/tarefas/${id}`;
    return {
      iniciar: async (estimativaSeg) => {
        let r;
        try {
          r = await api.post(`${base}/iniciar`, estimativaSeg > 0 ? { estimativaSeg: Math.round(estimativaSeg) } : {});
        } catch (e) {
          esquecer(chave);
          throw e;
        }
        if (r.status !== 200) {
          // Recusa definitiva (4xx) não se repete; falha do servidor repete-se no sinal seguinte.
          if (r.status >= 500) esquecer(chave);
          throw new Error(`iniciar recusado (${r.status})`);
        }
        estadoPc = { pc: 'a-trabalhar', tarefaId: id };
        aoIniciar();
      },
      // Só informativo para o painel: nunca atrasa nem interrompe a tarefa.
      progresso: async (passo, restanteSeg) => {
        estadoPc = { pc: 'a-trabalhar', tarefaId: id, passo, restanteSeg: Math.round(restanteSeg) };
        try { await api.post(`${base}/progresso`, { passo, restanteSeg: Math.round(restanteSeg) }); } catch (e) { /* o painel fica com o passo anterior */ }
      },
      // O resultado é o que mais custa perder: repete-se com pausa se a rede ou o servidor falharem.
      concluir: async (estado, resultado) => {
        for (let i = 0; i < CONCLUIR_TENTATIVAS; i++) {
          try {
            const r = await api.post(`${base}/concluir`, { estado, resultado });
            if (r.status === 200 || (r.status >= 400 && r.status < 500 && r.status !== 429)) return;
          } catch (e) { /* tenta outra vez */ }
          if (i < CONCLUIR_TENTATIVAS - 1) await esperar(2000 * (i + 1));
        }
        registar('Resultado da tarefa não entregue', { tarefaId: id });
      },
      esperar,
      aleatorio
    };
  }

  /** A chave privada decifrada, só para o executor real; nunca fica guardada aqui. */
  async function privadaDecifrada() {
    const s = await sessao();
    const reg = s && await ler(s.chave);
    if (!reg?.privadaCifrada) throw new Error('sem chave');
    return safeStorage.decryptString(Buffer.from(reg.privadaCifrada, 'base64'));
  }

  /** O browser de cada conta apaga-se quando o consentimento acaba; com uma conta a meio, só quando ela acabar. */
  async function apagarBrowsers() {
    const limpar = async () => {
      try { await limparParticoes(); } catch (e) { registar('Não foi possível apagar os browsers das contas', { erro: e.message }); }
    };
    if (execucao) { execucao.finally(limpar); return; }
    await limpar();
  }

  /** Lança a tarefa sem esperar por ela. Só simuladas: esta versão não sabe fazer tarefas reais. */
  function tratarTarefa(deviceId, tarefa) {
    const id = Number(tarefa.tarefaId);
    // Com o lease na chave, a mesma tarefa devolvida à fila e atribuída outra vez a este PC volta a correr.
    const chave = `${id}@${tarefa.leaseAte || ''}`;
    if (!Number.isInteger(id) || id <= 0 || execucao || aTerminar || vistas.includes(chave)) return;
    vistas.push(chave);
    if (vistas.length > VISTAS_MAX) vistas.shift();
    if (tarefa.simulada !== true) {
      registar('Tarefa não simulada ignorada: esta versão da app só faz simulações', { tarefaId: id });
      return;
    }
    execucao = Promise.resolve()
      .then(() => executor(tarefa, ioDe(deviceId, id, chave)))
      .catch(e => registar('Tarefa não concluída', { tarefaId: id, erro: e.message }))
      .finally(() => { execucao = null; estadoPc = { pc: aTerminar ? 'a-terminar' : 'livre' }; });
  }

  /** O pacote corre conta a conta, com uma pausa ao acaso entre elas. O que não chegar a começar volta à fila. */
  function tratarPacote(deviceId, pacote) {
    const id = Number(pacote.pacoteId);
    const chave = `p${id}`;
    if (!Number.isInteger(id) || id <= 0 || execucao || aTerminar || vistas.includes(chave)) return;
    vistas.push(chave);
    if (vistas.length > VISTAS_MAX) vistas.shift();
    parado = false;
    execucao = correrPacote(deviceId, id, Array.isArray(pacote.contas) ? pacote.contas : [], pacote.pausaSeg)
      .catch(e => registar('Pacote não concluído', { pacoteId: id, erro: e.message }))
      .finally(() => { execucao = null; estadoPc = { pc: aTerminar ? 'a-terminar' : 'livre' }; });
  }

  /** Pausa entre contas; o fecho da app acorda-a logo. */
  function pausa(ms) {
    return Promise.race([esperar(ms), new Promise(r => { acordarPausa = r; })]).finally(() => { acordarPausa = null; });
  }

  async function correrPacote(deviceId, pacoteId, contas, pausaSeg) {
    const [min, max] = Array.isArray(pausaSeg) ? pausaSeg.map(n => Math.max(0, Number(n) || 0)) : [30, 120];
    let iniciadas = 0;
    // Pausa só depois de uma conta que correu: as recusadas (pacote cancelado, conta entregue a outra) passam logo.
    let pausar = false;
    for (const t of contas) {
      if (aTerminar || parado) break;
      const tarefaId = Number(t.tarefaId);
      // A meio quando a app fechou: não se retoma, o servidor passa-a a «por verificar».
      if (t.estado === 'a-decorrer') { iniciadas++; continue; }
      const real = t.simulada !== true;
      if (real && !executorReal) {
        registar('Conta real sem executor: o pacote pára', { tarefaId });
        break;
      }
      if (pausar) {
        const s = min + aleatorio() * Math.max(0, max - min);
        estadoPc = { pc: 'em-pausa', proximaEmSeg: Math.round(s) };
        await pausa(s * 1000);
        if (aTerminar || parado) break;
      }
      estadoPc = { pc: 'a-trabalhar', tarefaId };
      pausar = false;
      const io = ioDe(deviceId, tarefaId, `${tarefaId}@p${pacoteId}`, () => { iniciadas++; pausar = true; });
      contaReal = real;
      try {
        await (real ? executorReal(t, io, { deviceId, privada: privadaDecifrada, deveParar: () => parado }) : executor(t, io));
      } catch (e) {
        registar('Conta do pacote não concluída', { tarefaId, erro: e.message });
      } finally {
        contaReal = false;
      }
    }
    // Contas que não começaram (recusadas, saltadas, app a fechar): sem isto, o pacote prendia a máquina.
    if (iniciadas < contas.length) {
      try { await api.post(`${RAIZ}/${deviceId}/pacotes/${pacoteId}/largar`, {}); } catch (e) { /* sem sinal, o servidor interrompe-o sozinho */ }
    }
  }

  function agendar(seg) {
    if (!ligado) return;
    if (seg != null && Number.isFinite(Number(seg))) intervaloSeg = Math.min(SINAL_MAX_SEG, Math.max(SINAL_MIN_SEG, Number(seg)));
    if (temporizador) desagendarFn(temporizador);
    temporizador = agendarFn(async () => { temporizador = null; agendar(await sinal()); }, intervaloSeg * 1000);
  }

  function iniciar() {
    if (ligado) return;
    ligado = true;
    agendar();
    sinal().then(seg => { if (seg != null) agendar(seg); });
  }

  function parar() {
    ligado = false;
    if (temporizador) desagendarFn(temporizador);
    temporizador = null;
  }

  /** Fecho da app: acaba a conta atual (no máximo 60 s; 10 min se for real), não começa outra e larga o resto do pacote. */
  async function terminar() {
    aTerminar = true;
    estadoPc = { pc: 'a-terminar' };
    acordarPausa?.();
    await sinal();
    if (execucao) {
      const limite = aguardarLimite(contaReal ? TEMPO_MAX_REAL_MS : TERMINAR_MAX_MS);
      await Promise.race([execucao, limite.p]);
      limite.cancelar();
    }
    parar();
  }

  /** Logout: o arranque automático desliga-se, mas o consentimento fica (volta a valer no próximo login). */
  function aoTerminarSessao() {
    arranqueSuspenso = true;
    aplicarArranque(false);
    tray.setOperacoes(false);
  }

  // aguardarTarefa: para os testes e para o fecho da app esperarem pela tarefa em curso.
  return {
    iniciar, parar, terminar, estado, aceitar, revogar, definirArranque, aoTerminarSessao, perguntarSeFaltar,
    aguardarTarefa: () => execucao || Promise.resolve(), ocupado: () => !!execucao
  };
}

/** O arranque com o Windows passa --oculto: a janela fica criada mas escondida (o tray abre-a). */
const arrancarOculto = (argv) => Array.isArray(argv) && argv.includes('--oculto');

module.exports = { criarDispositivo, gerarParDeChaves, userIdDoToken, arrancarOculto, SINAL_MS };
