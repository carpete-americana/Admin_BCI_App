'use strict';

/**
 * Abrir sessão no painel do browser a partir desta aplicação.
 *
 * PARA QUE SERVE
 *
 * A extensão de autofill precisa de um token de admin e vai buscá-lo à sessão
 * aberta no painel, no browser. Isso obrigava a escrever a palavra-passe e o
 * código de 2FA outra vez, já com sessão aberta aqui.
 *
 * O FLUXO (código de autorização do OAuth, com esquema de ligação próprio)
 *
 *   1. A página de login do painel gera um segredo, guarda-o, e abre
 *      `bciadmin://autorizar?challenge=<resumo do segredo>`.
 *   2. O Windows lança (ou acorda) esta aplicação com esse endereço.
 *   3. Nós perguntamos à pessoa se autoriza, numa janela nativa.
 *   4. Autorizada, trocamos a nossa sessão por um código de uso único na API.
 *   5. Abrimos o painel nesse código.
 *   6. A página troca o código por uma sessão, provando ser dona do segredo.
 *
 * AS TRÊS REGRAS QUE SEGURAM ISTO
 *
 * - **O destino é nosso, nunca da ligação.** `PAINEL_URL` está fixo aqui. Um
 *   site qualquer consegue disparar `bciadmin://` — é assim para todos os
 *   esquemas próprios — mas o código que daí sair vai sempre parar ao painel
 *   verdadeiro, nunca a um endereço que o atacante escolha. Sem isto, o fluxo
 *   inteiro seria uma forma de entregar a sessão a quem pedisse.
 *
 * - **Ninguém autoriza por ti.** O passo 3 é uma janela nativa, modal, que diz
 *   o que se está a autorizar. O pior que um site consegue é fazê-la aparecer.
 *
 * - **Só o desafio viaja.** O que vem na ligação é o RESUMO de um segredo, e
 *   mais nada. Não aceitamos endereços, nem nomes de servidor, nem tokens.
 */

const { app, dialog, shell } = require('electron');
const { API_CONFIG, DEBUG } = require('./config');

/** O esquema que o instalador regista. Ver `build.protocols` no package.json. */
const ESQUEMA = 'bciadmin';

/**
 * PARA ONDE O CÓDIGO VAI. Fixo, e a leitura mais importante deste ficheiro.
 * Nunca vem da ligação, nem de configuração, nem do que a API responder.
 */
const PAINEL_URL = 'https://admin.bcibizz.pt';

/** A API vive no mesmo domínio do painel, atrás do proxy. */
const API_URL = `${PAINEL_URL}/api`;

/** Um resumo tem 64 hexadecimais. Tudo o resto é lixo e não segue. */
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

  // `bciadmin://autorizar` dá host "autorizar"; `bciadmin:///autorizar` dá
  // pathname. Aceitam-se os dois, porque o Windows não é consistente.
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

/**
 * Regista esta aplicação como dona do esquema.
 *
 * O instalador faz isto de vez; aqui é para quem corre a partir do código, e
 * para reparar um registo que outra coisa tenha roubado.
 */
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

/**
 * A janela que pergunta. Nativa e modal de propósito: uma página web dentro da
 * aplicação seria mais bonita e mais fácil de imitar.
 *
 * O botão por omissão é o de recusar, e o de cancelar também — quem carrega em
 * Enter sem ler está a dizer que não.
 */
async function pedirAutorizacao(janelaPrincipal) {
  const { response } = await dialog.showMessageBox(janelaPrincipal || null, {
    type: 'question',
    buttons: ['Não autorizar', 'Autorizar'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: 'Autorizar o navegador',
    message: 'Abrir sessão no painel, no teu navegador?',
    detail:
      'Um pedido de entrada no painel de administração chegou do teu navegador.\n\n' +
      'Se foste tu que carregaste em "Entrar com a aplicação", autoriza. ' +
      'Se não estavas à espera disto, recusa.\n\n' +
      'A sessão é aberta em ' + PAINEL_URL
  });

  return response === 1;
}

/**
 * Troca a sessão desta aplicação por um código de uso único.
 *
 * O token vem de quem chama (o processo principal lê-o do armazenamento
 * encriptado). Se não houver sessão aqui, não há nada a autorizar.
 */
async function pedirCodigo(token, challenge) {
  const resposta = await fetch(`${API_URL}/auth/app-authorization`, {
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

/**
 * O caminho todo, do pedido à abertura do browser.
 *
 * `lerToken` é passado de fora para este ficheiro não precisar de saber como o
 * armazenamento funciona — e para os testes o poderem trocar.
 */
async function tratarPedido(pedido, { janelaPrincipal, lerToken } = {}) {
  if (!pedido) return { ok: false, motivo: 'PEDIDO_INVALIDO' };

  const token = await lerToken();
  if (!token) {
    await dialog.showMessageBox(janelaPrincipal || null, {
      type: 'info',
      title: 'Sem sessão',
      message: 'Entra primeiro nesta aplicação.',
      detail: 'Para abrires sessão no navegador, precisas de ter sessão aqui.'
    });
    return { ok: false, motivo: 'SEM_SESSAO' };
  }

  if (!await pedirAutorizacao(janelaPrincipal)) {
    DEBUG && console.log('[AUTORIZACAO] recusada pela pessoa');
    return { ok: false, motivo: 'RECUSADO' };
  }

  const r = await pedirCodigo(token, pedido.challenge);
  if (!r.ok) {
    await dialog.showMessageBox(janelaPrincipal || null, {
      type: 'error',
      title: 'Não foi possível autorizar',
      message: 'Não foi possível abrir a sessão no navegador.',
      detail: r.mensagem
    });
    return { ok: false, motivo: 'API_FALHOU' };
  }

  // O destino é o nosso, com o código no FRAGMENTO e não na query: um
  // fragmento não é enviado ao servidor nem entra nos registos dele.
  const destino = `${PAINEL_URL}/#autorizar=${encodeURIComponent(r.codigo)}`;
  await shell.openExternal(destino);

  return { ok: true };
}

module.exports = {
  ESQUEMA,
  PAINEL_URL,
  API_URL,
  ehResumo,
  lerPedido,
  procurarNosArgumentos,
  registarEsquema,
  tratarPedido
};
