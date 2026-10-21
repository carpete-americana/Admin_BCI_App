'use strict';

/** Login no casino partilhado pelos motores de levantamento e de depósito; fala com a página por um driver. */

const C = require('./vendor/casinos.js');

const LIMITES_LOGIN = { sessao: 20, entrar: 60, popups: 15 };

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
  for (let i = 0; i < LIMITES_LOGIN.sessao && !pronto; i++) {
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
  for (let i = 0; i < LIMITES_LOGIN.entrar; i++) {
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
    for (let i = 0; i < LIMITES_LOGIN.popups; i++) {
      if (await seguro(() => driver.naPagina('fecharPopups', fluxo.extraPopups), false)) break;
      await driver.esperar(100);
    }
  }
  return null;
}

module.exports = { entrar, seguro, falhada, verificar, LIMITES_LOGIN };
