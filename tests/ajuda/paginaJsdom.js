'use strict';

/**
 * Driver do motor sobre jsdom. As chamadas atravessam como no executeJavaScript: só texto, por isso a função
 * e os argumentos vão serializados. `esperar` conta e não espera.
 */

const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { correrNaPagina, FICHEIRO_PAGINA, SCRIPT_LEVANTAR } = require('../../src/main/levantar');

const PAGINA = fs.readFileSync(FICHEIRO_PAGINA, 'utf8');
const fixture = (nome) => fs.readFileSync(path.join(__dirname, '..', 'fixtures', `${nome}.html`), 'utf8');
const VAZIA = '<!doctype html><html><body></body></html>';

// O jsdom não faz layout: tamanho zero só para o que está escondido por hidden ou display.
function simularLayout(window) {
  window.Element.prototype.getBoundingClientRect = function () {
    for (let n = this; n && n.nodeType === 1; n = n.parentElement) {
      if (n.hidden || window.getComputedStyle(n).display === 'none') {
        return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0 };
      }
    }
    return { width: 100, height: 20, top: 10, left: 10, right: 110, bottom: 30, x: 10, y: 10 };
  };
}

function abrirJanela(html, url, preparar) {
  const consola = new VirtualConsole();
  consola.on('jsdomError', (e) => { if (!/Not implemented/.test(e.message)) console.error(e); });
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: consola });
  simularLayout(dom.window);
  dom.window.eval(PAGINA);
  dom.window.eval(SCRIPT_LEVANTAR);
  preparar?.(dom.window);
  return dom.window;
}

const correr = (w, nome, args) => w.eval(`(${correrNaPagina})(...${JSON.stringify([nome, ...args])})`);

/**
 * paginas: { [url]: página | () => página }, com página = { html | fixture, caixa?: html, preparar?(w), preparaCaixa?(w) }.
 * aoChamar(nome, driver) corre depois de cada chamada à página (deixa o teste trocar o ecrã); falhar(nome) true rebenta a chamada.
 * As chamadas às janelas novas registam-se e falham como `janelas:<nome>`.
 */
function criarDriver({ paginas = {}, aoChamar, falhar = () => false } = {}) {
  const chamadas = [];
  let esperas = 0;
  let atual = null;
  let frame = null;
  let caixa = null;
  const janelas = [];

  const d = {
    chamadas,
    get esperas() { return esperas; },
    get janela() { return frame; },
    get caixa() { return caixa; },
    get janelas() { return janelas; },
    nomes: () => chamadas.map(c => c.nome),

    // Janela que o caixa abre depois do clique (ex. sibs.html da Nuvei); `nome` é uma fixture.
    abrirJanela(nome, url = 'https://cdn.safecharge.com/sibs.html') {
      janelas.push(abrirJanela(fixture(nome), url));
    },

    abrir(url) {
      const resolvida = paginas[url];
      const p = (typeof resolvida === 'function' ? resolvida() : resolvida) || { html: VAZIA };
      atual = url;
      frame = abrirJanela(p.fixture ? fixture(p.fixture) : p.html, url, p.preparar);
      caixa = p.caixa ? abrirJanela(p.caixa, 'https://secure.safecharge.com/ppp/pppadapter.do', p.preparaCaixa) : null;
    },

    async url() { chamadas.push({ nome: 'url' }); return atual; },
    async navegar(url) {
      chamadas.push({ nome: 'navegar', args: [url] });
      if (falhar('navegar')) throw new Error('navegar rebentou');
      d.abrir(url);
    },
    async esperar() { esperas++; },
    async naPagina(nome, ...args) {
      chamadas.push({ nome, args });
      if (falhar(nome)) throw new Error(`${nome} rebentou com ${JSON.stringify(args)}`);
      const r = correr(frame, nome, args);
      aoChamar?.(nome, d);
      return r;
    },
    async naCaixa(nome, ...args) {
      chamadas.push({ nome, args });
      if (falhar(nome)) throw new Error(`${nome} rebentou`);
      const r = caixa ? correr(caixa, nome, args) : null;
      aoChamar?.(nome, d);
      return r ?? null;
    },
    async naJanelasNovas(nome, ...args) {
      chamadas.push({ nome: `janelas:${nome}`, args });
      if (falhar(`janelas:${nome}`)) throw new Error(`${nome} rebentou nas janelas`);
      for (const w of janelas) {
        const r = correr(w, nome, args);
        if (r != null) return r;
      }
      return null;
    }
  };
  return d;
}

module.exports = { criarDriver, fixture };
