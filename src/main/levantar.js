'use strict';

/**
 * Motor de levantamento portado de background/fluxos.js da extensão. Fala com a página por um driver
 * { naPagina, naCaixa, navegar, url, esperar }, para correr contra jsdom nos testes.
 */

const path = require('node:path');
const C = require('./vendor/casinos.js');

const FICHEIRO_PAGINA = path.join(__dirname, 'vendor', 'pagina.js');

// Lado da página: o preencher do pagina.js quer um elemento, que não atravessa o executeJavaScript.
const SCRIPT_LEVANTAR = `(() => {
  globalThis.__bciLevantar = {
    preencherLogin(seletores, username, password) {
      const P = globalThis.__bciPagina;
      const pw = P.encontrarCampo(seletores.password);
      const user = P.encontrarCampo(seletores.username) || P.usernamePerto(pw);
      return { username: !!user && P.preencher(user, username), password: !!pw && P.preencher(pw, password) };
    }
  };
})();`;

// Serializada para a página: não pode usar nada de fora.
function correrNaPagina(nome, ...args) {
  const f = (globalThis.__bciLevantar || {})[nome] || globalThis.__bciPagina[nome];
  return f(...args);
}

const LIMITES = { sessao: 20, entrar: 60, saldo: 40, preparar: 60, resultado: 60, popups: 15 };

/** Chave de casinos.js a partir do nome da conta («Placard» → placard); null se o nome não for exato. */
function chaveDoNome(nome) {
  // Sem aproximações: o alias «esc» apanhava «Desconhecido», e aqui um engano mexe em dinheiro.
  const limpo = String(nome || '').trim().toLowerCase();
  if (!limpo) return null;
  return Object.keys(C.CASINOS).find(k => C.CASINOS[k].nome.toLowerCase() === limpo || k === limpo.replace(/\s+/g, '')) || null;
}

/** «Deixar» leva os cêntimos; os outros modos euros inteiros. Devolve { valor } ou { saltar }. */
function valorDoLevantamento(parametros, saldo) {
  const p = parametros || {};
  // Em cêntimos: 50.64 - 30 dá 20.640000000000001 em vírgula flutuante.
  const valor = p.modo === 'deixar'
    ? (Math.round(saldo * 100) - Math.round((Number(p.deixar) || 0) * 100)) / 100
    : Math.floor(Number(p.valor) || 0);
  if (p.modo !== 'deixar' && valor > saldo) return { saltar: `Saldo insuficiente (${saldo} €)` };
  if (valor < (p.minimo || 1)) return { saltar: p.modo === 'deixar' ? `Fica abaixo do mínimo (saldo ${saldo} €)` : `Abaixo do mínimo (${valor} €)` };
  return { valor };
}

// As mensagens são sempre as nossas: o texto de uma exceção do driver pode trazer os argumentos, password incluída.
const falhada = (fase, motivo, extra) => ({ estado: 'falhada', fase, motivo, ...extra });
const verificar = (fase, motivo, extra) => ({ estado: 'verificar', fase, motivo, ...extra });

// Uma navegação a meio rebenta a chamada; conta como «ainda não».
async function seguro(fn, omissao) {
  try { return await fn(); } catch (e) { return omissao; }
}

// Cada conta tem a sua partição: uma sessão iniciada é sempre desta conta, por isso não há logout.
async function entrar(driver, chave, fluxoPainel, credencial) {
  const cfg = C.CASINOS[chave];
  const s = C.seletoresDe(chave);
  const fluxo = C.fluxoEfetivo(chave, fluxoPainel ? [{ ...fluxoPainel, casino_name: cfg.nome }] : []);
  const doCasino = async () => C.casinoDoUrl(await driver.url()) === chave;

  await driver.navegar(fluxo.loginUrl || cfg.levantar.url);
  if (!await doCasino()) return falhada('casino', 'A página aberta não é do casino da conta');

  let pronto = false;
  let gatilho = false;
  for (let i = 0; i < LIMITES.sessao && !pronto; i++) {
    const sessao = await seguro(() => driver.naPagina('estadoSessao', s, C.TEXTOS_SESSAO_INICIADA), '?');
    if (sessao === 'com') return null;
    pronto = await seguro(() => driver.naPagina('camposProntos', s), false);
    if (pronto) break;
    // Alguns sites só criam os campos depois de clicar em Entrar.
    if (sessao === 'sem' && !gatilho) {
      gatilho = true;
      await seguro(() => driver.naPagina('clicarPorTexto', fluxo.loginTriggerTexts || C.TEXTOS_GATILHO_LOGIN), false);
    }
    await driver.esperar(300);
  }
  if (!pronto) return falhada('login', 'A página de login não abriu');

  await seguro(() => driver.naPagina('fecharAvisoDeSaida'), false);
  if (!await doCasino()) return falhada('casino', 'O site mudou a meio do login');
  const feito = await driver.naPagina('preencherLogin', s, credencial.username, credencial.password);
  if (!feito?.username && !feito?.password) return falhada('login', 'Não foi possível preencher o login');

  // O botão só fica ativo depois da validação do site.
  await driver.esperar(500);
  const botao = { seletores: C.SELETORES_BOTAO_ENTRAR, textos: C.TEXTOS_BOTAO_ENTRAR };
  for (let i = 0; i < 10; i++) {
    if (await seguro(() => driver.naPagina('clicarEntrar', botao), false)) break;
    await driver.esperar(200);
  }

  const opcoes = { seletoresErro: C.seletoresErroDe(chave), textosSessao: C.TEXTOS_SESSAO_INICIADA };
  let estado = null;
  for (let i = 0; i < LIMITES.entrar; i++) {
    await driver.esperar(500);
    estado = await seguro(() => driver.naPagina('estadoLogin', s, opcoes), null);
    if (estado?.estado === 'entrou') break;
    if (estado?.estado === 'falhou') return falhada('login', estado.erro || 'O site recusou o login');
    // Não há pessoa na janela: a verificação de humano pára a conta, sem mais cliques.
    if (await seguro(() => driver.naPagina('captchaPendente'), false)) {
      return verificar('captcha', 'O site pede a verificação de humano — a conta ficou por entrar');
    }
  }
  if (estado?.estado !== 'entrou') return falhada('login', 'O login ficou por confirmar');

  if (fluxo.extraPopups?.length) {
    for (let i = 0; i < LIMITES.popups; i++) {
      if (await seguro(() => driver.naPagina('fecharPopups', fluxo.extraPopups), false)) break;
      await driver.esperar(100);
    }
  }
  return null;
}

/**
 * Uma conta. `casino` é a chave de casinos.js e `fluxo` a linha de login do painel (ou null).
 * Depois de carregar em Levantar qualquer dúvida é `verificar`; antes é `falhada`.
 * `deveParar()` verdadeiro (consentimento retirado) pára entre passos; depois de Levantar já não se pára.
 */
async function levantarDaConta(driver, { casino, fluxo, credencial, parametros, ensaio, deveParar }, aoPasso) {
  const cfg = C.CASINOS[casino]?.levantar;
  if (!cfg) return falhada('casino', 'Este casino não tem levantamento automático');
  const passo = async (nome, extra) => { await seguro(() => aoPasso?.(nome, extra), null); };
  const est = { confirmado: false, saldo: undefined, valor: undefined };
  const parado = () => { try { return deveParar?.() === true; } catch (e) { return false; } };
  const PARADO = 'O consentimento foi retirado: parou antes de Levantar';

  try {
    if (parado()) return falhada('parado', PARADO);
    await passo('a-entrar');
    const semEntrar = await entrar(driver, casino, fluxo, credencial);
    if (semEntrar) return semEntrar;

    if (parado()) return falhada('parado', PARADO);
    await passo('a-abrir');
    await driver.navegar(cfg.url);

    await passo('a-ler-saldo');
    for (let i = 0; i < LIMITES.saldo && est.saldo == null; i++) {
      est.saldo = await seguro(() => driver.naPagina('lerSaldo', cfg.saldo), null) ?? undefined;
      if (est.saldo == null) await driver.esperar(250);
    }
    if (est.saldo == null) return falhada('saldo', 'Não foi possível ler o saldo');

    const conta = valorDoLevantamento(parametros, est.saldo);
    if (conta.saltar) return { estado: 'saltada', saldo: est.saldo, motivo: conta.saltar };
    est.valor = conta.valor;

    if (parado()) return falhada('parado', PARADO, { saldo: est.saldo });
    await passo('a-preencher', { saldo: est.saldo, valor: est.valor });
    // Repete enquanto o caixa carrega ou valida; só o último motivo conta.
    let prep = null;
    for (let i = 0; i < LIMITES.preparar; i++) {
      prep = await seguro(() => driver.naCaixa('prepararLevantamento', cfg, est.valor), null) ?? prep;
      if (prep?.ok) break;
      await driver.esperar(250);
    }
    if (!prep) return falhada('caixa', 'O caixa não abriu', { saldo: est.saldo });
    if (!prep.ok) return falhada('caixa', prep.motivo || 'O caixa não aceitou o valor', { saldo: est.saldo, valor: est.valor });
    if (ensaio || parametros?.ensaio) {
      return { estado: 'ensaio', saldo: est.saldo, valor: est.valor, iban: prep.iban, motivo: 'Ensaio: não carregou em Levantar' };
    }

    if (parado()) return falhada('parado', PARADO, { saldo: est.saldo, valor: est.valor });
    await passo('a-levantar');
    // Marcado antes do clique: se a chamada rebentar não se sabe se o botão foi premido.
    est.confirmado = true;
    if (!await driver.naCaixa('confirmarLevantamento', cfg)) {
      est.confirmado = false;
      return falhada('levantar', 'O botão Levantar não respondeu', { saldo: est.saldo, valor: est.valor });
    }
    for (let i = 0; i < LIMITES.resultado; i++) {
      await driver.esperar(500);
      const r = await seguro(() => driver.naCaixa('resultadoLevantamento', cfg), null);
      if (r?.estado === 'sucesso') return { estado: 'feita', saldo: est.saldo, valor: est.valor, iban: prep.iban, motivo: r.texto };
      if (r?.estado === 'erro') return falhada('caixa', r.texto, { saldo: est.saldo, valor: est.valor });
    }
    // Sem resposta clara pode ter saído dinheiro: pára para não seguir às cegas.
    return verificar('resultado', 'O caixa não confirmou — vê no casino se o levantamento ficou feito', { saldo: est.saldo, valor: est.valor });
  } catch (e) {
    const extra = { saldo: est.saldo, valor: est.valor };
    return est.confirmado
      ? verificar('erro', 'Erro depois de carregar em Levantar — vê no casino se ficou feito', extra)
      : falhada('erro', 'Erro inesperado no levantamento', extra);
  }
}

module.exports = { levantarDaConta, valorDoLevantamento, chaveDoNome, correrNaPagina, FICHEIRO_PAGINA, SCRIPT_LEVANTAR };
