'use strict';

/**
 * Motor de depósito por Multibanco portado de background/fluxos.js da extensão. Fala com a página pelo driver
 * { naPagina, naCaixa, naJanelasNovas, navegar, url, esperar }, como o levantar.js.
 */

const C = require('./vendor/casinos.js');
const { entrar, abrirCaixa, seguro, falhada, verificar } = require('./sessaoCasino');

const LIMITES = { preparar: 60, codigo: 40, validarCodigo: 12, resultado: 90 };

/** Euros inteiros; o valor da conta já vem resolvido em parametros.valor. Devolve { valor } ou { saltar }. */
function valorDoDeposito(parametros) {
  const p = parametros || {};
  const valor = Math.floor(Number(p.valor) || 0);
  if (valor < (p.minimo || 1)) return { saltar: `Abaixo do mínimo (${valor} €)` };
  return { valor };
}

/** O código promocional da conta (a API já escolheu entre o do lote e o da conta); vazio é sem código. */
function codigoDoDeposito(parametros) {
  return String(parametros?.codigo ?? '').trim().slice(0, 60);
}

/** Onde o caixa pode abrir uma janela nova (a referência, ou o próprio caixa vindo do menu): o domínio do caixa (e subdomínios) e os hostsExtra. */
function hostsExtraDe(casino, tipo = 'depositar') {
  const cfg = C.CASINOS[casino]?.[tipo];
  // Sem hostsExtra tudo corre na janela da conta: não há janela noutro domínio para autorizar.
  if (!cfg?.hostsExtra?.length) return [];
  // secure.safecharge.com → safecharge.com: o caixa abre review.do e a referência vem noutro subdomínio (cdn).
  // Um caixa no domínio do próprio casino (pay.betclic.pt) fica como está, para não abrir o site inteiro.
  const doCasino = (C.CASINOS[casino].dominios || []).some(d => cfg.caixaHost === d || cfg.caixaHost?.endsWith(`.${d}`));
  const dominio = !doCasino && cfg?.caixaHost?.split('.').length > 2 ? cfg.caixaHost.split('.').slice(1).join('.') : cfg?.caixaHost;
  const hosts = [dominio, ...(cfg?.hostsExtra || [])].filter(Boolean);
  return [...new Set(hosts)].filter((h, _i, todos) => !todos.some(o => o !== h && h.endsWith(`.${o}`)));
}

/**
 * Uma conta. Pede a referência Multibanco; quem a paga é uma pessoa, depois.
 * Depois de carregar em Depositar qualquer dúvida é `verificar` (pode haver uma referência gerada); antes é `falhada`.
 */
async function depositarDaConta(driver, { casino, fluxo, credencial, parametros, ensaio, deveParar }, aoPasso) {
  const cfg = C.CASINOS[casino]?.depositar;
  if (!cfg) return falhada('casino', 'Este casino não tem depósito automático');
  const conta = valorDoDeposito(parametros);
  if (conta.saltar) return { estado: 'saltada', motivo: conta.saltar };
  const valor = conta.valor;
  const codigo = codigoDoDeposito(parametros) || null;
  const extra = { valor, codigo };
  if (codigo && cfg.codigoMax && codigo.length > cfg.codigoMax) {
    return falhada('codigo', `O código tem mais de ${cfg.codigoMax} caracteres, o máximo que o caixa aceita`, extra);
  }

  if (codigo && !cfg.codigo && !cfg.abrirCodigoCaixa) return falhada('codigo', 'Este casino não aceita código promocional', extra);

  const passo = async (nome, info) => { await seguro(() => aoPasso?.(nome, info), null); };
  const est = { confirmado: false };
  const parado = () => { try { return deveParar?.() === true; } catch (e) { return false; } };
  const PARADO = 'O consentimento foi retirado: parou antes de Depositar';

  try {
    if (parado()) return falhada('parado', PARADO);
    await passo('a-entrar');
    const semEntrar = await entrar(driver, casino, fluxo, credencial);
    if (semEntrar) return semEntrar;

    if (parado()) return falhada('parado', PARADO);
    await passo('a-abrir');
    const semCaixa = await abrirCaixa(driver, casino, cfg);
    if (semCaixa) return semCaixa;

    if (parado()) return falhada('parado', PARADO, extra);
    await passo('a-preencher', extra);
    // Repete enquanto o caixa carrega ou valida; só o último motivo conta.
    let prep = null;
    for (let i = 0; i < LIMITES.preparar; i++) {
      prep = await seguro(() => driver.naCaixa('prepararDeposito', cfg, valor), null) ?? prep;
      if (prep?.ok) break;
      await driver.esperar(250);
    }
    if (!prep) return falhada('caixa', 'O caixa não abriu', extra);
    if (!prep.ok) return falhada('caixa', prep.motivo || 'O caixa não aceitou o valor', extra);

    if (codigo) {
      if (parado()) return falhada('parado', PARADO, extra);
      await passo('a-codigo', extra);
      let aplicado = null;
      for (let i = 0; i < LIMITES.codigo; i++) {
        aplicado = await seguro(() => driver.naCaixa('aplicarCodigo', cfg, codigo), null) ?? aplicado;
        if (aplicado?.ok) break;
        await driver.esperar(250);
      }
      if (!aplicado?.ok) return falhada('codigo', aplicado?.motivo || 'Não encontrei o campo do código promocional', extra);
      // O caixa valida o código passado um instante; uma recusa ignorada perdia o bónus sem ninguém ver.
      let validade = null;
      for (let i = 0; i < LIMITES.validarCodigo && validade !== 'valido'; i++) {
        await driver.esperar(250);
        validade = await seguro(() => driver.naCaixa('estadoDoCodigo', cfg), null);
        if (validade == null && i >= 4) break;
      }
      if (validade === 'invalido') return falhada('codigo', 'O caixa marcou o código promocional como inválido', extra);
      const recusa = await seguro(() => driver.naCaixa('erroDoCodigo', cfg), null);
      if (recusa) return falhada('codigo', `Código promocional recusado: ${recusa}`, extra);
      // O montante pode ter sido limpo ao aplicar o código.
      const outra = await seguro(() => driver.naCaixa('prepararDeposito', cfg, valor), null);
      if (outra && !outra.ok) return falhada('caixa', outra.motivo || 'O caixa perdeu o montante depois do código', extra);
    }
    if (ensaio || parametros?.ensaio) return { estado: 'ensaio', valor, codigo, motivo: 'Ensaio: não carregou em Depositar' };

    await passo('a-depositar', extra);
    if (parado()) return falhada('parado', PARADO, extra);
    // Marcado antes do clique: se a chamada rebentar não se sabe se o botão foi premido.
    est.confirmado = true;
    if (!await driver.naCaixa('confirmarDeposito', cfg)) {
      est.confirmado = false;
      return falhada('depositar', 'O botão Depositar não respondeu', extra);
    }
    for (let i = 0; i < LIMITES.resultado; i++) {
      await driver.esperar(500);
      const r = await seguro(() => driver.naCaixa('resultadoDeposito', cfg), null);
      const ref = r?.estado === 'referencia' ? r : await seguro(() => driver.naJanelasNovas('lerReferenciaMB'), null);
      if (ref?.entidade && ref?.referencia) {
        const referencia = String(ref.referencia).replace(/[\s.]/g, '');
        return {
          // O valor é o que o PC escreveu no caixa; o montante lido na página não conta.
          estado: 'feita', valor, codigo, entidade: String(ref.entidade), referencia, validade: ref.validade || null,
          motivo: `Entidade ${ref.entidade} · Referência ${referencia}`
        };
      }
      // Os textos de erro também apanham o mínimo e o máximo do caixa: a referência pode ter sido gerada.
      if (r?.estado === 'erro') return verificar('caixa', r.texto, extra);
    }
    // Sem referência lida o casino pode tê-la gerado: pára para não pedir outra por cima.
    return verificar('resultado', 'Não consegui ler a referência — vê no casino e copia-a à mão', extra);
  } catch (e) {
    return est.confirmado
      ? verificar('erro', 'Erro depois de carregar em Depositar — vê no casino se a referência foi gerada', extra)
      : falhada('erro', 'Erro inesperado no depósito', extra);
  }
}

module.exports = { depositarDaConta, valorDoDeposito, codigoDoDeposito, hostsExtraDe };
