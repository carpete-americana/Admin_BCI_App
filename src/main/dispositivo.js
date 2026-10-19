'use strict';

/**
 * Operações automáticas neste computador: consentimento, chave do dispositivo, sinal, arranque com o Windows
 * e (fase 2) as tarefas simuladas que o servidor entrega na resposta do sinal.
 * Igual ao da User App (repositórios separados, sem pacote partilhado): mudar um obriga a mudar o outro.
 * Sem `require('electron')`: tudo vem por dependências, para testar com node --test.
 */

const crypto = require('node:crypto');
const { VERSAO_TEXTO, TITULO, TEXTO_CONSENTIMENTO, BOTOES } = require('./dispositivo-texto');
const executorFicticio = require('./executorFicticio');

const SINAL_MS = 2 * 60 * 1000;
const RAIZ = '/users/me/devices';
// O servidor só entrega tarefas a quem declara saber fazê-las.
const CAPACIDADES = ['tarefas-v1'];
const VISTAS_MAX = 50;

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
  const { api, lerToken, storage, safeStorage, app, dialog, tray, versoes, randomUUID } = deps;
  const definirIntervalo = deps.setIntervalFn || setInterval;
  const limparIntervalo = deps.clearIntervalFn || clearInterval;
  const executor = deps.executor || executorFicticio.executar;
  const esperar = deps.esperar || ((ms) => new Promise(r => setTimeout(r, ms)));
  const aleatorio = deps.aleatorio || Math.random;
  const registar = deps.registar || ((m, extra) => console.warn(m, extra || ''));
  let intervalo = null;
  // O arranque do Windows só se reescreve quando muda (o cliente pode tê-lo desligado lá): esta marca diz que o desligámos nós.
  let arranqueSuspenso = false;
  // Uma tarefa de cada vez; as já vistas não voltam a correr (o servidor repete-a no sinal até ela começar).
  let execucao = null;
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

    const { response } = await dialog.showMessageBox({
      type: 'question', title: TITULO, message: TITULO, detail: TEXTO_CONSENTIMENTO,
      buttons: BOTOES, defaultId: 1, cancelId: 1, noLink: true
    });
    if (response !== 0) return { ok: false, motivo: 'cancelado' };

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
        electronVersao: versoes.electron, autostart: true, versao: VERSAO_TEXTO, capacidades: CAPACIDADES
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
    const novo = { ...reg, consentido: false, revogarPendente: pendente };
    await storage.setItem(s.chave, novo);
    aplicar(novo);
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
    const novo = { ...reg, consentido: false };
    await storage.setItem(s.chave, novo);
    aplicar(novo);
  }

  /** Um sinal: confirma ao servidor que este computador está ligado e aplica o que ele responder. */
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

      const r = await api.post(`${RAIZ}/${reg.deviceId}/sinal`, { appVersao: app.getVersion(), electronVersao: versoes.electron, autostart: reg.autostart !== false, capacidades: CAPACIDADES });
      if (r.status === 401 || r.status === 403) return suspender();
      if (r.status === 404) return desligarLocal(s, reg);
      if (r.status !== 200) return;
      const d = dadosDe(r);
      if (d?.consentimentoValido === false) {
        // Desligado no servidor ou conta suspensa pode passar: o consentimento fica e o sinal continua.
        if (d.motivo === 'desligado' || d.motivo === 'conta') return suspender();
        return desligarLocal(s, reg);
      }
      tray.setOperacoes(true);
      if (arranqueSuspenso) {
        arranqueSuspenso = false;
        aplicarArranque(reg.autostart !== false);
      }
      if (d?.tarefa) tratarTarefa(reg.deviceId, d.tarefa);
    } catch (e) {
      // Sem rede ou erro do servidor: tenta-se no ciclo seguinte.
    }
  }

  /** Lança a tarefa sem esperar por ela. Só simuladas: esta versão não sabe fazer tarefas reais. */
  function tratarTarefa(deviceId, tarefa) {
    const id = Number(tarefa.tarefaId);
    if (!Number.isInteger(id) || id <= 0 || execucao || vistas.includes(id)) return;
    vistas.push(id);
    if (vistas.length > VISTAS_MAX) vistas.shift();
    if (tarefa.simulada !== true) {
      registar('Tarefa não simulada ignorada: esta versão da app só faz simulações', { tarefaId: id });
      return;
    }
    const base = `${RAIZ}/${deviceId}/tarefas/${id}`;
    const io = {
      iniciar: async () => {
        const r = await api.post(`${base}/iniciar`, {});
        if (r.status !== 200) throw new Error(`iniciar recusado (${r.status})`);
      },
      concluir: async (estado, resultado) => {
        await api.post(`${base}/concluir`, { estado, resultado });
      },
      esperar,
      aleatorio
    };
    execucao = Promise.resolve()
      .then(() => executor(tarefa, io))
      .catch(e => registar('Tarefa não concluída', { tarefaId: id, erro: e.message }))
      .finally(() => { execucao = null; });
  }

  function iniciar() {
    if (intervalo) return;
    intervalo = definirIntervalo(sinal, SINAL_MS);
    sinal();
  }

  function parar() {
    if (intervalo) limparIntervalo(intervalo);
    intervalo = null;
  }

  /** Logout: o arranque automático desliga-se, mas o consentimento fica (volta a valer no próximo login). */
  function aoTerminarSessao() {
    arranqueSuspenso = true;
    aplicarArranque(false);
    tray.setOperacoes(false);
  }

  // aguardarTarefa: para os testes e para o fecho da app esperarem pela tarefa em curso.
  return { iniciar, parar, estado, aceitar, revogar, definirArranque, aoTerminarSessao, aguardarTarefa: () => execucao || Promise.resolve() };
}

/** O arranque com o Windows passa --oculto: a janela fica criada mas escondida (o tray abre-a). */
const arrancarOculto = (argv) => Array.isArray(argv) && argv.includes('--oculto');

module.exports = { criarDispositivo, gerarParDeChaves, userIdDoToken, arrancarOculto, SINAL_MS };
