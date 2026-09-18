'use strict';

/**
 * Abre sessão no painel do browser a partir desta app (código de autorização com PKCE e esquema bciadmin://).
 * O destino do código é fixo nesta app, a pessoa confirma numa janela da app, e da ligação só se aceita o challenge.
 */

const { app, shell } = require('electron');
const janelaAutorizacao = require('./janela-autorizacao');
const { API_CONFIG, DEBUG } = require('./config');

/** O esquema que o instalador regista. Ver `build.protocols` no package.json. */
const ESQUEMA = 'bciadmin';

/** Destino do código na app instalada. */
const PAINEL_PRODUCAO = 'https://admin.bcibizz.pt';

/**
 * Destino do código. Nunca vem da ligação.
 * Instalada, é sempre produção; a correr do código aceita BCI_PAINEL_URL.
 */
function painelUrl() {
  if (app.isPackaged) return PAINEL_PRODUCAO;

  const alternativo = String(process.env.BCI_PAINEL_URL || '').trim().replace(/\/+$/, '');
  return alternativo || PAINEL_PRODUCAO;
}

/** A API está em bcibizz.pt/api, não no domínio do painel. */
const API_PRODUCAO = 'https://bcibizz.pt/api';

function apiUrl() {
  if (app.isPackaged) return API_PRODUCAO;

  // Em desenvolvimento a API responde na origem do site, atrás do proxy.
  const alternativo = String(process.env.BCI_PAINEL_URL || '').trim().replace(/\/+$/, '');
  return alternativo ? `${alternativo}/api` : API_PRODUCAO;
}

/** Um resumo tem 64 caracteres hexadecimais. */
function ehResumo(valor) {
  return typeof valor === 'string' && /^[a-f0-9]{64}$/i.test(valor);
}

/**
 * Tira o desafio de uma ligação `bciadmin://autorizar?challenge=...`.
 * Devolve `null` a tudo o que não seja exatamente isso.
 */
function lerPedido(url) {
  if (typeof url !== 'string') return null;

  let alvo;
  try {
    alvo = new URL(url);
  } catch (e) {
    return null;
  }

  if (alvo.protocol !== `${ESQUEMA}:`) return null;

  // bciadmin://autorizar dá host e bciadmin:///autorizar dá pathname; o Windows usa os dois.
  const accao = (alvo.hostname || alvo.pathname.replace(/^\/+/, '')).toLowerCase();
  if (accao !== 'autorizar') return null;

  const challenge = alvo.searchParams.get('challenge');
  if (!ehResumo(challenge)) return null;

  return { challenge: challenge.toLowerCase() };
}

/** A ligação chega como um argumento da linha de comandos, no Windows. */
function procurarNosArgumentos(argv) {
  if (!Array.isArray(argv)) return null;
  for (const arg of argv) {
    const pedido = lerPedido(arg);
    if (pedido) return pedido;
  }
  return null;
}

/** Regista a app como dona do esquema. O instalador já o faz; isto repara registos alterados e serve o desenvolvimento. */
function registarEsquema() {
  try {
    if (app.isPackaged) {
      app.setAsDefaultProtocolClient(ESQUEMA);
      return;
    }
    // Sem empacotar, o executável é o do Electron e o script vai por argumento.
    app.setAsDefaultProtocolClient(ESQUEMA, process.execPath, [require('path').resolve(process.argv[1] || '.')]);
  } catch (erro) {
    DEBUG && console.log('[AUTORIZACAO] falha a registar o esquema:', erro.message);
  }
}

function anfitriaoDoPainel() {
  try { return new URL(painelUrl()).host; }
  catch (e) { return painelUrl(); }
}

/** Pergunta numa janela da app (ver janela-autorizacao.js). */
async function pedirAutorizacao(janelaPrincipal) {
  return janelaAutorizacao.mostrar({
    tipo: 'confirmar',
    titulo: 'Abrir sessão no navegador?',
    texto: 'O painel pediu para entrar com a conta que tens aberta nesta aplicação.',
    destino: anfitriaoDoPainel(),
    aviso: 'Se não foste tu que pediste, recusa.'
  }, { janelaPrincipal });
}

/** Troca a sessão desta app por um código de uso único. */
async function pedirCodigo(token, challenge) {
  const resposta = await fetch(`${apiUrl()}/auth/app-authorization`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ challenge })
  });

  const corpo = await resposta.json().catch(() => null);
  if (!resposta.ok) {
    const mensagem = (corpo && corpo.message) || `Erro ${resposta.status}`;
    return { ok: false, mensagem };
  }

  const codigo = corpo?.data?.codigo || corpo?.result?.data?.codigo;
  if (!codigo) return { ok: false, mensagem: 'A API não devolveu nenhum código.' };

  return { ok: true, codigo };
}

/** lerToken vem de fora para os testes o poderem substituir. */
async function tratarPedido(pedido, { janelaPrincipal, lerToken } = {}) {
  if (!pedido) return { ok: false, motivo: 'PEDIDO_INVALIDO' };

  const token = await lerToken();
  if (!token) {
    await janelaAutorizacao.mostrar({
      tipo: 'info',
      titulo: 'Entra primeiro na aplicação',
      texto: 'Para abrires o painel no navegador, precisas de ter sessão iniciada aqui.'
    }, { janelaPrincipal });
    return { ok: false, motivo: 'SEM_SESSAO' };
  }

  if (!await pedirAutorizacao(janelaPrincipal)) {
    DEBUG && console.log('[AUTORIZACAO] recusada pela pessoa');
    return { ok: false, motivo: 'RECUSADO' };
  }

  const r = await pedirCodigo(token, pedido.challenge);
  if (!r.ok) {
    await janelaAutorizacao.mostrar({
      tipo: 'erro',
      titulo: 'Não foi possível autorizar',
      texto: r.mensagem
    }, { janelaPrincipal });
    return { ok: false, motivo: 'API_FALHOU' };
  }

  // O código vai no fragmento, que não é enviado ao servidor.
  const destino = `${painelUrl()}/#autorizar=${encodeURIComponent(r.codigo)}`;
  await shell.openExternal(destino);

  return { ok: true };
}

module.exports = {
  ESQUEMA,
  PAINEL_PRODUCAO,
  API_PRODUCAO,
  painelUrl,
  apiUrl,
  ehResumo,
  lerPedido,
  procurarNosArgumentos,
  registarEsquema,
  tratarPedido
};
