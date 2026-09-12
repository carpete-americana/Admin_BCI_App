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
 *   3. Nós perguntamos à pessoa se autoriza, numa janela desta aplicação.
 *   4. Autorizada, trocamos a nossa sessão por um código de uso único na API.
 *   5. Abrimos o painel nesse código.
 *   6. A página troca o código por uma sessão, provando ser dona do segredo.
 *
 * AS TRÊS REGRAS QUE SEGURAM ISTO
 *
 * - **O destino é nosso, nunca da ligação.** Ver `painelUrl()` abaixo: na
 *   aplicação instalada é sempre produção, sem excepção. Um site qualquer
 *   consegue disparar `bciadmin://` — é assim para todos os esquemas próprios
 *   — mas o código que daí sair vai sempre parar ao painel verdadeiro, nunca a
 *   um endereço que o atacante escolha. Sem isto, o fluxo inteiro seria uma
 *   forma de entregar a sessão a quem pedisse.
 *
 * - **Ninguém autoriza por ti.** O passo 3 é uma janela da aplicação, com a
 *   página instalada no disco e sessão própria, que diz o que se está a
 *   autorizar. O pior que um site consegue é fazê-la aparecer. As garantias
 *   estão em janela-autorizacao.js.
 *
 * - **Só o desafio viaja.** O que vem na ligação é o RESUMO de um segredo, e
 *   mais nada. Não aceitamos endereços, nem nomes de servidor, nem tokens.
 */

const { app, shell } = require('electron');
const janelaAutorizacao = require('./janela-autorizacao');
const { API_CONFIG, DEBUG } = require('./config');

/** O esquema que o instalador regista. Ver `build.protocols` no package.json. */
const ESQUEMA = 'bciadmin';

/** PARA ONDE O CÓDIGO VAI, na aplicação instalada. */
const PAINEL_PRODUCAO = 'https://admin.bcibizz.pt';

/**
 * O destino do código.
 *
 * NUNCA VEM DA LIGAÇÃO, e é essa a defesa que sustenta o fluxo todo: um site
 * qualquer consegue disparar `bciadmin://`, mas o código que daí sair vai
 * sempre parar ao painel que ESTA APLICAÇÃO escolher.
 *
 * EMPACOTADA, É SEMPRE PRODUÇÃO. Sem variável de ambiente, sem definição, sem
 * excepção — quem tiver a aplicação instalada não tem por onde a apontar a
 * outro sítio, e nem sequer alguém com acesso ao ambiente da máquina.
 *
 * A correr a partir do código, aceita-se `BCI_PAINEL_URL`. Sem isso, testar
 * esta funcionalidade em desenvolvimento é impossível: a aplicação falava com
 * produção, onde a rota só existe depois de publicada, e respondia 404.
 */
function painelUrl() {
  if (app.isPackaged) return PAINEL_PRODUCAO;

  const alternativo = String(process.env.BCI_PAINEL_URL || '').trim().replace(/\/+$/, '');
  return alternativo || PAINEL_PRODUCAO;
}

/**
 * A API NÃO VIVE NO DOMÍNIO DO PAINEL, e assumir que sim custou um 404.
 *
 * O painel está em `admin.bcibizz.pt` e a API em `bcibizz.pt/api` — uma só
 * API a servir os dois sites. É a mesma regra que `Admin Website/js/api-config.js`
 * já seguia; este ficheiro é que a estava a inventar.
 *
 * São dois endereços com papéis diferentes, e não se derivam um do outro:
 * `painelUrl()` é PARA ONDE O CÓDIGO VAI (e é a defesa do fluxo), este é A QUEM
 * SE PEDE o código.
 */
const API_PRODUCAO = 'https://bcibizz.pt/api';

function apiUrl() {
  if (app.isPackaged) return API_PRODUCAO;

  // Em desenvolvimento a API responde na própria origem do site, atrás do
  // proxy — tal como no browser.
  const alternativo = String(process.env.BCI_PAINEL_URL || '').trim().replace(/\/+$/, '');
  return alternativo ? `${alternativo}/api` : API_PRODUCAO;
}

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

/** Só o anfitrião do painel, para a janela: o endereço inteiro é ruído. */
function anfitriaoDoPainel() {
  try { return new URL(painelUrl()).host; }
  catch (e) { return painelUrl(); }
}

/**
 * A janela que pergunta. É da aplicação e não do Windows — e as garantias que
 * a caixa nativa dava de graça estão todas refeitas em janela-autorizacao.js:
 * página do disco, sessão isolada, só aquela janela responde, "Recusar" por
 * omissão, e o "Autorizar" não aceita um clique cedo demais.
 */
async function pedirAutorizacao(janelaPrincipal) {
  return janelaAutorizacao.mostrar({
    tipo: 'confirmar',
    titulo: 'Abrir sessão no navegador?',
    texto: 'O painel pediu para entrar com a conta que tens aberta nesta aplicação.',
    destino: anfitriaoDoPainel(),
    aviso: 'Se não foste tu que pediste, recusa.'
  }, { janelaPrincipal });
}

/**
 * Troca a sessão desta aplicação por um código de uso único.
 *
 * O token vem de quem chama (o processo principal lê-o do armazenamento
 * encriptado). Se não houver sessão aqui, não há nada a autorizar.
 */
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

  // O destino é o nosso, com o código no FRAGMENTO e não na query: um
  // fragmento não é enviado ao servidor nem entra nos registos dele.
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
