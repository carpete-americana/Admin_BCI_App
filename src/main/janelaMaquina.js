'use strict';

/**
 * «Mostrar a janela das operações» vale para o computador: as duas apps leem o mesmo ficheiro, porque a fila pode dar a conta
 * a qualquer uma delas. Não é segredo, por isso fica fora do registo cifrado. Cópia igual na outra app.
 */

const fs = require('node:fs');
const path = require('node:path');

function criarJanelaMaquina({ pasta, fsMod = fs }) {
  const ficheiro = path.join(pasta, 'janela.json');
  return {
    /** true/false se já se escolheu neste computador; null se nunca. */
    async ler() {
      try {
        const v = JSON.parse(await fsMod.promises.readFile(ficheiro, 'utf8'))?.visivel;
        return typeof v === 'boolean' ? v : null;
      } catch (e) {
        return null;
      }
    },
    async gravar(visivel) {
      await fsMod.promises.mkdir(pasta, { recursive: true });
      await fsMod.promises.writeFile(ficheiro, JSON.stringify({ visivel: visivel === true }));
    }
  };
}

module.exports = { criarJanelaMaquina };
