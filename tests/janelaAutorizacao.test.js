'use strict';

// Garantias da janela de confirmação: nenhuma página a pode responder.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const ler = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');

const janela = ler('src', 'main', 'janela-autorizacao.js');
const painel = ler('src', 'main', 'autorizacao-painel.js');
const preload = ler('src', 'autorizacao', 'preload.js');
const html = ler('src', 'autorizacao', 'confirmar.html');
const pagina = ler('src', 'autorizacao', 'confirmar.js');

const semComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('já não há caixa do Windows no fluxo de autorização', () => {
  assert.doesNotMatch(semComentarios(painel), /dialog\./);
  assert.match(painel, /janelaAutorizacao\.mostrar\(/);
});

test('a página vem do disco, e a janela não navega para mais lado nenhum', () => {
  // A janela principal carrega páginas da rede.
  assert.match(janela, /loadFile\(path\.join\(__dirname, '\.\.', 'autorizacao', 'confirmar\.html'\)\)/);
  assert.doesNotMatch(semComentarios(janela), /loadURL\(/);
  assert.match(janela, /'will-navigate', \(e\) => e\.preventDefault\(\)/);
  assert.match(janela, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
});

test('a página não carrega nada de fora nem corre nada inline', () => {
  assert.match(html, /default-src 'none'/);
  assert.match(html, /script-src 'self'/);
  assert.doesNotMatch(html, /<script>(?!\s*<\/script>)/, 'script inline');
  assert.doesNotMatch(html, /\son[a-z]+=/i, 'atributo de evento inline');
  assert.doesNotMatch(html, /https?:\/\//, 'recurso de fora');
});

test('o que está escondido fica mesmo escondido', () => {
  const css = ler('src', 'autorizacao', 'confirmar.css');
  assert.match(css, /\[hidden\] \{ display: none !important; \}/);
});

test('os botões nunca saem da janela: é o texto que ganha scroll', () => {
  const css = ler('src', 'autorizacao', 'confirmar.css');
  const i = css.indexOf('.corpo {');
  const regra = css.slice(i, css.indexOf('}', i));
  assert.match(regra, /overflow-y: auto/);
  assert.match(regra, /min-height: 0/, 'sem isto um filho de flex não encolhe e empurra os botões');
});

test('o texto entra com textContent, nunca como HTML', () => {
  // A mensagem de erro vem da API.
  assert.doesNotMatch(semComentarios(pagina), /innerHTML/);
  assert.match(pagina, /texto\.textContent = estado\.texto/);
});

test('sessão própria em memória, e não a da janela principal', () => {
  assert.match(janela, /partition: PARTICAO/);
  assert.match(janela, /const PARTICAO = '[a-z-]+';/);
  assert.doesNotMatch(janela, /const PARTICAO = 'persist:/, 'uma partição persist: fica no disco');
});

test('isolada: sandbox, contextIsolation, sem Node', () => {
  assert.match(janela, /sandbox: true/);
  assert.match(janela, /contextIsolation: true/);
  assert.match(janela, /nodeIntegration: false/);
  assert.match(janela, /devTools: !app\.isPackaged/, 'ferramentas de programador só fora da instalação');
});

test('o preload expõe duas coisas e mais nenhuma', () => {
  const codigo = semComentarios(preload);
  assert.match(codigo, /exposeInMainWorld\('bciAutorizacao'/);
  const canais = [...codigo.matchAll(/ipcRenderer\.(invoke|send)\('([^']+)'/g)].map(m => m[2]);
  assert.deepEqual(canais.sort(), ['autorizacao:estado', 'autorizacao:responder']);
  assert.doesNotMatch(codigo, /storage|token/i, 'esta página não tem nada que ver com o token');
});

test('a resposta é enviada como booleano estrito', () => {
  // `responder('sim')` ou `responder(1)` não podem valer como um "sim".
  assert.match(preload, /ipcRenderer\.send\('autorizacao:responder', sim === true\)/);
  assert.match(janela, /terminar\(sim === true\)/);
});

test('só a janela do pedido pode ler e responder', () => {
  assert.match(janela, /if \(!pendente \|\| e\.sender !== pendente\.janela\.webContents\) return null;/);
  assert.match(janela, /if \(!pendente \|\| e\.sender !== pendente\.janela\.webContents\) return;/);
});

test('uma resposta só conta uma vez', () => {
  const i = janela.indexOf('function terminar(');
  const corpo = janela.slice(i, janela.indexOf('\n}', i));
  assert.match(corpo, /if \(!pendente\) return;/);
  assert.ok(corpo.indexOf('pendente = null') < corpo.indexOf('resolver(resultado)'),
    'o pedido tem de ser fechado ANTES de se resolver, para uma segunda resposta não entrar');
});

test('uma janela de cada vez: pedidos em repetição são recusados', () => {
  const i = janela.indexOf('function mostrar(');
  const corpo = janela.slice(i, janela.indexOf('return new Promise', i));
  assert.match(corpo, /if \(pendente\)/);
  assert.match(corpo, /return Promise\.resolve\(false\)/);
});

test('fechar, rebentar, ou deixar passar o tempo é recusar', () => {
  assert.match(janela, /janela\.on\('closed',[\s\S]{0,120}terminar\(false\)/);
  assert.match(janela, /'render-process-gone',[\s\S]{0,120}terminar\(false\)/);
  assert.match(janela, /setTimeout\(\(\) => \{[\s\S]{0,160}terminar\(false\)/);
  assert.match(janela, /\.catch\(\(erro\) => \{[\s\S]{0,200}terminar\(false\)/);
});

test('o foco começa no Recusar, Escape recusa, e Enter não autoriza', () => {
  assert.match(pagina, /btnRecusar\.focus\(\)/);
  assert.match(pagina, /e\.key === 'Escape'[\s\S]{0,80}responder\(false\)/);
  assert.doesNotMatch(pagina, /e\.key === 'Enter'[\s\S]{0,80}responder\(true\)/);
  assert.match(html, /id="btnAutorizar" disabled/, 'o Autorizar começa desligado');
});

test('o Autorizar só acende depois de a janela ter foco, e apaga ao perdê-lo', () => {
  // Um site escolhe quando a janela aparece e pode fazê-la surgir debaixo de um clique.
  assert.match(pagina, /const ATRASO_MS = \d{3,4};/);
  assert.match(pagina, /window\.addEventListener\('focus', armar\)/);
  assert.match(pagina, /window\.addEventListener\('blur'[\s\S]{0,80}btnAutorizar\.disabled = true/);
});

test('o processo principal volta a medir o tempo, sem confiar na página', () => {
  const i = janela.indexOf("ipcMain.on('autorizacao:responder'");
  const corpo = janela.slice(i, janela.indexOf('\n  });', i));
  assert.match(corpo, /Date\.now\(\) - desde < ATRASO_MINIMO_MS/);
  assert.match(corpo, /if \(!desde/, 'antes de a janela estar visível, nenhum sim conta');
  assert.match(janela, /pendente\.visivelDesde = Date\.now\(\)/);
});

test('só um pedido do tipo confirmar pode devolver sim', () => {
  // Uma janela de erro ou de informação não pode ser usada para autorizar.
  assert.match(janela, /if \(sim === true && pendente\.dados\.tipo === 'confirmar'\)/);
  assert.match(pagina, /if \(estado\.tipo !== 'confirmar'\) return;/);
});

test('a pasta da janela entra no instalador', () => {
  const pkg = JSON.parse(ler('package.json'));
  const ficheiros = pkg.build?.files || [];
  assert.ok(ficheiros.includes('src/**/*'),
    'sem isto a janela existe no código e não na aplicação instalada');
});
