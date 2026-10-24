'use strict';

/** Login no casino partilhado pelos motores de levantamento e de depósito; fala com a página por um driver. */

const C = require('./vendor/casinos.js');

const LIMITES_LOGIN = { sessao: 20, entrar: 60, popups: 15, cliquesExtra: 4 };

// As mensagens são sempre as nossas: o texto de uma exceção do driver pode trazer os argumentos, password incluída.
const falhada = (fase, motivo, extra) => ({ estado: 'falhada', fase, motivo, ...extra });
const verificar = (fase, motivo, extra) => ({ estado: 'verificar', fase, motivo, ...extra });

// Uma navegação a meio rebenta a chamada; conta como «ainda não».
async function seguro(fn, omissao) {
  try { return await fn(); } catch (e) { return omissao; }
}

const fluxoDe = (chave, fluxoPainel) => C.fluxoEfetivo(chave, fluxoPainel ? [{ ...fluxoPainel, casino_name: C.CASINOS[chave].nome }] : []);

/**
 * Termina a sessão aberta, como a extensão: null quando confirmou que não há sessão, falhada('logout') se não conseguiu.
 * O browser é partilhado pelas contas do casino, por isso nunca se entra por cima de uma sessão que não se viu acabar.
 */
async function sair(driver, chave, fluxoPainel) {
  const s = C.seletoresDe(chave);
  const fluxo = fluxoDe(chave, fluxoPainel);
  const sessao = () => seguro(() => driver.naPagina('estadoSessao', s, C.TEXTOS_SESSAO_INICIADA, C.sessaoDe(chave)), '?');
  const cookies = () => recusarCookies(driver, chave);
  const esperarSaida = async (tentativas) => {
    for (let i = 0; i < tentativas; i++) {
      await seguro(() => driver.naPagina('fecharAvisoDeSaida'), false);
      if (await sessao() === 'sem') return true;
      await driver.esperar(400);
    }
    return false;
  };
  const clicarSair = async (plano) => {
    const textos = plano.logoutTexts?.length ? plano.logoutTexts : C.LOGOUT_GENERICO.logoutTexts;
    for (let i = 0; i < 24; i++) {
      await cookies();
      if (await seguro(() => driver.naPagina('passoLogout', plano, 'logout'), false)) return true;
      if (i === 2 || i === 10) await seguro(() => driver.naPagina('abrirMenuConta', C.SELETORES_MENU_CONTA, C.TEXTOS_MENU_CONTA), false);
      if (i === 18 && await seguro(() => driver.naPagina('clicarEscondidoPorTexto', textos), false)) return true;
      await driver.esperar(150);
    }
    return false;
  };
  const confirmar = async (plano, exato) => {
    for (let i = 0; i < 24; i++) {
      if (await seguro(() => driver.naPagina('passoLogout', plano, 'confirmar', { exato }), false)) return true;
      await driver.esperar(100);
    }
    return false;
  };
  // Só se salta o logout com a certeza de que não há sessão: sem «Depositar» e com o caminho para entrar à vista.
  if (await sessao() === 'sem') return null;

  if (fluxo.accountUrl) {
    await seguro(() => driver.navegar(fluxo.accountUrl), null);
    const clicou = await clicarSair(fluxo);
    if (!clicou || (fluxo.confirmTexts?.length && !await confirmar(fluxo, false))) {
      return falhada('logout', 'Não foi possível terminar a sessão da conta anterior');
    }
    if (fluxo.postLogoutUrl) {
      if (fluxo.logoutSuccessUrl) {
        for (let i = 0; i < 20 && !String(await seguro(() => driver.url(), '')).startsWith(fluxo.logoutSuccessUrl); i++) await driver.esperar(250);
      }
      await seguro(() => driver.navegar(fluxo.postLogoutUrl), null);
    }
  } else {
    // Sair e confirmar em chamadas separadas: o clique pode navegar.
    const plano = fluxo.seletorSair ? fluxo : C.LOGOUT_GENERICO;
    if (!await clicarSair(plano)) return falhada('logout', 'Não foi encontrado o botão de terminar a sessão da conta anterior');
    if (plano.confirmTexts?.length) await confirmar(plano, plano === C.LOGOUT_GENERICO);
    // Recarregar logo podia cortar o pedido de logout a meio: primeiro espera que a sessão acabe sozinha.
    if (await esperarSaida(15)) return null;
    const atual = await seguro(() => driver.url(), null);
    if (atual) await seguro(() => driver.navegar(atual), null);
  }
  if (await esperarSaida(20)) return null;
  return falhada('logout', 'A sessão da conta anterior não terminou');
}

// O banner pode aparecer a qualquer momento (carrega depois da página): quem espera chama-o a cada volta.
const recusarCookies = (driver, chave) => (C.CASINOS[chave]?.cookies
  ? seguro(() => driver.naPagina('recusarCookies', C.CASINOS[chave].cookies), false)
  : Promise.resolve(false));

// O browser é do casino, não da conta: uma sessão aberta pode ser de outra conta e termina-se antes de entrar.
async function entrar(driver, chave, fluxoPainel, credencial) {
  const cfg = C.CASINOS[chave];
  const s = C.seletoresDe(chave);
  const fluxo = fluxoDe(chave, fluxoPainel);
  const doCasino = async () => C.casinoDoUrl(await driver.url()) === chave;

  await driver.navegar(fluxo.loginUrl || cfg.levantar.url);
  if (!await doCasino()) return falhada('casino', 'A página aberta não é do casino da conta');

  let pronto = false;
  let gatilho = false;
  let saiu = false;
  for (let i = 0; i < LIMITES_LOGIN.sessao && !pronto; i++) {
    await recusarCookies(driver, chave);
    const sessao = await seguro(() => driver.naPagina('estadoSessao', s, C.TEXTOS_SESSAO_INICIADA, C.sessaoDe(chave)), '?');
    if (sessao === 'com') {
      if (saiu) return falhada('logout', 'A sessão da conta anterior continua aberta');
      const r = await sair(driver, chave, fluxoPainel);
      if (r) return r;
      saiu = true;
      await driver.navegar(fluxo.loginUrl || cfg.levantar.url);
      if (!await doCasino()) return falhada('casino', 'A página aberta não é do casino da conta');
      continue;
    }
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
  await recusarCookies(driver, chave);
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

  const opcoes = { seletoresErro: C.seletoresErroDe(chave), textosSessao: C.TEXTOS_SESSAO_INICIADA, seletoresSessao: C.sessaoDe(chave).com, textosErro: cfg.textosErroLogin || [] };
  let estado = null;
  let cliquesExtra = 0;
  let preenchimentosExtra = 0;
  let validouEm = null;
  // Como a extensão: a verificação anti-robô costuma acabar sozinha em segundos, e o site só segue com outro clique em Entrar.
  for (let i = 0; i < LIMITES_LOGIN.entrar; i++) {
    await driver.esperar(500);
    // Um banner que chegue depois do clique tapa o formulário: recusa-se e volta a clicar em Entrar.
    if (await recusarCookies(driver, chave)) await seguro(() => driver.naPagina('clicarEntrar', botao), false);
    estado = await seguro(() => driver.naPagina('estadoLogin', s, opcoes), null);
    if (estado?.estado === 'entrou') break;
    if (estado?.estado === 'falhou') return falhada('login', estado.erro || 'O site recusou o login');
    // Na Betclic a sessão só aparece depois dos ecrãs da data de nascimento e do telemóvel; a data só vai para o site do casino.
    if (estado?.estado === 'aguardar' && fluxo.posLogin && await seguro(doCasino, false)) {
      const passo = await seguro(() => driver.naPagina('passosPosLogin', fluxo.posLogin, {
        nascimento: credencial.nascimento ?? null, popups: fluxo.extraPopups, validado: validouEm != null
      }), null);
      if (passo === 'sem-nascimento') return falhada('login', 'A Betclic pede a data de nascimento e a conta não a tem');
      if (passo === 'validou') validouEm = i;
      // Um só clique em Validar por login; o ecrã ainda lá ~5 s depois é recusa.
      if (passo === 'nascimento-pendente' && i - validouEm >= 10) return falhada('login', 'A Betclic não aceitou a data de nascimento');
    }
    if (estado?.estado === 'aguardar' && estado.noFormulario && i >= 7 && (i - 7) % 8 === 0 && cliquesExtra < LIMITES_LOGIN.cliquesExtra) {
      // Nunca a meio da verificação: o clique recomeçava-a.
      if (await seguro(() => driver.naPagina('captchaPendente'), true)) continue;
      if (await seguro(() => driver.naPagina('passwordVazia', s), false)) {
        if (preenchimentosExtra < 2 && await doCasino()) {
          preenchimentosExtra++;
          await seguro(() => driver.naPagina('preencherLogin', s, credencial.username, credencial.password), null);
        }
        continue;
      }
      if (await seguro(() => driver.naPagina('clicarEntrar', botao), false)) cliquesExtra++;
    }
  }
  if (estado?.estado !== 'entrou') {
    // Só ao fim da espera: não há pessoa na janela para a fazer.
    if (await seguro(() => driver.naPagina('captchaPendente'), false)) {
      return verificar('captcha', 'O site pede a verificação de humano — a conta ficou por entrar');
    }
    return falhada('login', 'O login ficou por confirmar');
  }

  if (fluxo.extraPopups?.length) {
    for (let i = 0; i < LIMITES_LOGIN.popups; i++) {
      if (await seguro(() => driver.naPagina('fecharPopups', fluxo.extraPopups), false)) break;
      await driver.esperar(100);
    }
  }
  return null;
}

module.exports = { entrar, sair, seguro, falhada, verificar, recusarCookies, LIMITES_LOGIN };
