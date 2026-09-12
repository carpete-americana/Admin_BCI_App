'use strict';

/**
 * A página da janela de autorização. Só mostra e responde: quem decide o que
 * a resposta vale é o processo principal (ver src/main/janela-autorizacao.js).
 *
 * Todo o texto entra com textContent. A mensagem de erro vem da API, e nada que
 * venha de fora é HTML aqui dentro.
 */
(async () => {
  const cartao = document.getElementById('cartao');
  const titulo = document.getElementById('titulo');
  const texto = document.getElementById('texto');
  const destino = document.getElementById('destino');
  const destinoValor = document.getElementById('destinoValor');
  const aviso = document.getElementById('aviso');
  const btnRecusar = document.getElementById('btnRecusar');
  const btnAutorizar = document.getElementById('btnAutorizar');

  const estado = await window.bciAutorizacao.estado();
  if (!estado) {
    // Não há pedido nenhum para esta janela. Não se mostra nada a meio.
    window.bciAutorizacao.responder(false);
    return;
  }

  cartao.dataset.tipo = estado.tipo;
  titulo.textContent = estado.titulo;
  texto.textContent = estado.texto;

  if (estado.destino) {
    destinoValor.textContent = estado.destino;
    destino.hidden = false;
  }
  if (estado.aviso) {
    aviso.textContent = estado.aviso;
    aviso.hidden = false;
  }

  btnRecusar.textContent = estado.tipo === 'confirmar' ? 'Recusar' : 'Fechar';

  let respondido = false;
  function responder(sim) {
    if (respondido) return;
    respondido = true;
    window.bciAutorizacao.responder(sim === true);
  }

  btnRecusar.addEventListener('click', () => responder(false));
  btnAutorizar.addEventListener('click', () => {
    if (!btnAutorizar.disabled) responder(true);
  });

  // Escape recusa. Enter NÃO autoriza: o foco começa no Recusar, e é esse que
  // o Enter carrega — quem carrega em Enter sem ler está a dizer que não.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      responder(false);
    }
  });

  btnRecusar.focus();

  if (estado.tipo !== 'confirmar') return;

  // ------------------------------------------------------------------
  // O "AUTORIZAR" SÓ SE ACENDE UM INSTANTE DEPOIS DE A JANELA TER FOCO.
  //
  // Qualquer site consegue fazer esta janela aparecer, e consegue escolher o
  // MOMENTO: enquanto a pessoa está a clicar noutra coisa, a janela surge
  // debaixo do cursor e o clique cai no botão errado. É o mesmo truque que os
  // browsers travam nos pedidos de permissão, e da mesma maneira: um atraso,
  // que recomeça sempre que a janela perde o foco.
  //
  // O processo principal volta a verificar o tempo do lado de lá, para o caso
  // de alguma coisa conseguir mandar a resposta sem passar por este botão.
  // ------------------------------------------------------------------
  const ATRASO_MS = 900;
  let temporizador = null;

  function armar() {
    btnAutorizar.disabled = true;
    clearTimeout(temporizador);
    temporizador = setTimeout(() => { btnAutorizar.disabled = false; }, ATRASO_MS);
  }

  window.addEventListener('focus', armar);
  window.addEventListener('blur', () => {
    clearTimeout(temporizador);
    btnAutorizar.disabled = true;
  });

  if (document.hasFocus()) armar();
})();
