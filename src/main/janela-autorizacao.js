'use strict';

/**
 * A JANELA QUE PERGUNTA SE AUTORIZAS — da aplicação, e não do Windows.
 *
 * Era um `dialog.showMessageBox`: funcionava, mas era uma caixa cinzenta do
 * sistema no meio de uma aplicação com cara própria. Passou a ser uma janela
 * desenhada por nós.
 *
 * O QUE A CAIXA DO SISTEMA DAVA DE GRAÇA, E QUE AQUI TEM DE SER FEITO À MÃO
 *
 * A confirmação é a única coisa entre "um site disparou bciadmin://" e "esse
 * site abriu sessão de ADMIN". A caixa nativa garantia, sem esforço, que
 * nenhuma página a conseguia responder. Uma janela nossa só garante o mesmo se:
 *
 * - **A página vem do disco.** A janela principal carrega páginas da rede, e
 *   um "Autorizar" desenhado lá podia ser carregado por qualquer script que lá
 *   corresse. Esta carrega src/autorizacao/confirmar.html, instalado com a
 *   aplicação, e não navega para mais lado nenhum.
 *
 * - **Não partilha nada com a janela principal.** Sessão própria em memória
 *   (`partition` sem `persist:`) e preload próprio, que só expõe "ler o pedido"
 *   e "responder". O token de admin não está ao alcance desta página.
 *
 * - **Só esta janela responde, e só uma vez.** O processo principal compara o
 *   remetente com o webContents desta janela; uma resposta vinda de qualquer
 *   outro lado é ignorada.
 *
 * - **Tudo o que não seja um "sim" explícito é um "não".** Fechar, Escape, o
 *   tempo acabar, a janela rebentar.
 *
 * - **O "sim" não pode chegar cedo demais.** Um site escolhe o momento em que a
 *   janela aparece, e pode fazê-la surgir debaixo de um clique que ia para
 *   outro sítio. A página só acende o botão um instante depois de ter foco; e
 *   aqui volta a verificar-se, para o caso de a resposta chegar por outro
 *   caminho.
 *
 * - **Uma de cada vez.** Um site a disparar o esquema em repetição não empilha
 *   janelas: enquanto houver uma aberta, as seguintes são recusadas.
 */

const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { DEBUG } = require('./config');

/** Um "sim" que chegue antes disto, contado desde que a janela ficou visível, não conta. */
const ATRASO_MINIMO_MS = 600;

/** Ninguém respondeu: é um "não". */
const TEMPO_MAXIMO_MS = 2 * 60 * 1000;

/** Uma sessão só desta janela, em memória. Sem `persist:`, morre com a aplicação. */
const PARTICAO = 'autorizacao-app';

let pendente = null;

/**
 * Os canais registam-se uma vez, e respondem SÓ à janela do pedido em curso.
 * `e.sender` é quem mandou; comparar com o webContents da janela é o que impede
 * outra página qualquer da aplicação de responder por ela.
 */
let canaisRegistados = false;
function registarCanais() {
  if (canaisRegistados) return;
  canaisRegistados = true;

  ipcMain.handle('autorizacao:estado', (e) => {
    if (!pendente || e.sender !== pendente.janela.webContents) return null;
    return pendente.dados;
  });

  ipcMain.on('autorizacao:responder', (e, sim) => {
    if (!pendente || e.sender !== pendente.janela.webContents) return;

    if (sim === true && pendente.dados.tipo === 'confirmar') {
      const desde = pendente.visivelDesde;
      if (!desde || Date.now() - desde < ATRASO_MINIMO_MS) {
        DEBUG && console.log('[AUTORIZACAO] resposta cedo demais, ignorada');
        return;
      }
    }

    terminar(sim === true);
  });
}

function terminar(resultado) {
  if (!pendente) return;
  const { janela, resolver, temporizador } = pendente;
  pendente = null;

  clearTimeout(temporizador);
  if (!janela.isDestroyed()) janela.destroy();
  resolver(resultado);
}

/**
 * A janela é filha da principal só quando a principal está à vista. Minimizada
 * ou escondida na bandeja, uma filha modal ficava escondida com ela — e o
 * pedido chegava a quem está a olhar para o browser, não para a aplicação.
 */
function paiVisivel(janelaPrincipal) {
  return janelaPrincipal &&
    !janelaPrincipal.isDestroyed() &&
    janelaPrincipal.isVisible() &&
    !janelaPrincipal.isMinimized()
    ? janelaPrincipal
    : null;
}

/**
 * Mostra a janela e espera pela resposta.
 *
 * `dados.tipo` é 'confirmar' (Recusar / Autorizar), 'info' ou 'erro' (só
 * Fechar). Devolve `true` apenas para um "Autorizar" de um pedido 'confirmar'.
 */
function mostrar(dados, { janelaPrincipal = null } = {}) {
  registarCanais();

  if (pendente) {
    // Já há uma aberta. Traz-se essa para a frente e esta é recusada.
    if (!pendente.janela.isDestroyed()) pendente.janela.focus();
    DEBUG && console.log('[AUTORIZACAO] já havia uma janela aberta; pedido recusado');
    return Promise.resolve(false);
  }

  return new Promise((resolver) => {
    const pai = paiVisivel(janelaPrincipal);

    const janela = new BrowserWindow({
      // Com folga: a mensagem de erro vem da API e não se sabe o tamanho. Se
      // não couber, é o texto que ganha scroll — os botões ficam sempre à vista.
      width: 440,
      height: dados.tipo === 'confirmar' ? 372 : 300,
      useContentSize: true,
      parent: pai || undefined,
      modal: !!pai,
      show: false,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: false,
      center: true,
      title: 'Autorizar o navegador',
      backgroundColor: '#1a1a24',
      webPreferences: {
        preload: path.join(__dirname, '..', 'autorizacao', 'preload.js'),
        partition: PARTICAO,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        spellcheck: false,
        devTools: !app.isPackaged
      }
    });

    janela.setMenu(null);

    // Não sai do ficheiro local. Nem por navegação, nem por janela nova.
    janela.webContents.on('will-navigate', (e) => e.preventDefault());
    janela.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    pendente = {
      janela,
      resolver,
      dados: { ...dados },
      visivelDesde: null,
      temporizador: setTimeout(() => {
        DEBUG && console.log('[AUTORIZACAO] sem resposta a tempo; recusado');
        terminar(false);
      }, TEMPO_MAXIMO_MS)
    };

    janela.once('ready-to-show', () => {
      if (janela.isDestroyed()) return;
      janela.show();
      janela.focus();
      if (pendente && pendente.janela === janela) pendente.visivelDesde = Date.now();
    });

    // Fechar por qualquer via é recusar.
    janela.on('closed', () => {
      if (pendente && pendente.janela === janela) terminar(false);
    });
    janela.webContents.on('render-process-gone', () => {
      if (pendente && pendente.janela === janela) terminar(false);
    });

    janela.loadFile(path.join(__dirname, '..', 'autorizacao', 'confirmar.html'))
      .catch((erro) => {
        DEBUG && console.log('[AUTORIZACAO] falha a abrir a janela:', erro.message);
        if (pendente && pendente.janela === janela) terminar(false);
      });
  });
}

module.exports = {
  mostrar,
  ATRASO_MINIMO_MS,
  TEMPO_MAXIMO_MS,
  PARTICAO
};
