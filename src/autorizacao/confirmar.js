'use strict';

/** Página da janela de autorização: mostra o pedido e envia a resposta. O texto entra sempre por textContent. */
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
    // Sem pedido para esta janela.
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

  // Escape recusa. O foco começa no Recusar, por isso Enter recusa.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      responder(false);
    }
  });

  btnRecusar.focus();

  if (estado.tipo !== 'confirmar') return;

  // O Autorizar só acende um instante depois de a janela ter foco, e apaga ao perdê-lo.
  // Evita que um clique dirigido a outra janela caia aqui; o processo principal volta a verificar o tempo.
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
