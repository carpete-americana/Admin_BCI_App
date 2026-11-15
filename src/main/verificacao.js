'use strict';

/**
 * Lê a verificação (KYC) da conta sem abrir o formulário: entra, bloqueia o host do formulário e lê só o src do iframe
 * ou um ecrã conhecido. O link nunca vai a progresso nem a motivos; só sai no resultado, que a API cifra.
 */

const C = require('./vendor/casinos.js');
const { entrar, seguro, falhada, verificar } = require('./sessaoCasino');

// Repetido do lerVerificacao: o resultado da página não se aceita sem voltar a validar.
const LINK_RE = /^https:\/\/forms\.kycaid\.com\/[A-Za-z0-9]{20,64}$/;
// 40 voltas de 250 ms: até 10 s pelo iframe ou por um ecrã.
const LIMITE_LEITURA = 40;
const ESTADOS = ['precisa', 'feita', 'em-analise', 'recusada'];
const PARADO = 'Mandaram parar (um admin ou o consentimento retirado): parou antes de ler a verificação';

async function verificarConta(driver, { casino, fluxo, credencial, deveParar, pedirCodigo }, aoPasso) {
  const cfg = C.CASINOS[casino]?.verificacao;
  if (!cfg) return falhada('casino', 'Este casino não tem leitura da verificação');
  // Sem bloqueio o formulário carregava na janela e o link contava como aberto: uma app antiga nem navega.
  if (typeof driver?.bloquear !== 'function') return verificar('verificacao', 'Esta versão da app não consegue bloquear o formulário da verificação');
  const passo = async (nome) => { await seguro(() => aoPasso?.(nome), null); };
  const parado = () => { try { return deveParar?.() === true; } catch (e) { return false; } };

  try {
    if (parado()) return falhada('parado', PARADO);
    // Antes de qualquer navegação: um redirecionamento depois do login também não pode abrir o formulário.
    try { await driver.bloquear(cfg.bloquear); } catch (e) { return falhada('bloqueio', 'Não foi possível bloquear o formulário da verificação'); }

    await passo('a-entrar');
    const semEntrar = await entrar(driver, casino, fluxo, credencial, { pedirCodigo });
    if (semEntrar) return semEntrar;

    if (parado()) return falhada('parado', PARADO);
    await passo('a-abrir');
    await driver.navegar(cfg.url);
    for (let i = 0; i < LIMITE_LEITURA; i++) {
      const r = await seguro(() => driver.naPagina('lerVerificacao', cfg), null);
      const expirado = r?.expirado === true ? { expirado: true } : {};
      if (r?.estado === 'precisa' && typeof r.link === 'string' && LINK_RE.test(r.link)) {
        return { estado: 'ensaio', verificacao: 'precisa', link: r.link, ...expirado, motivo: 'Verificação lida' };
      }
      if (r?.estado && r.estado !== 'precisa' && ESTADOS.includes(r.estado)) {
        return { estado: 'ensaio', verificacao: r.estado, ...expirado, motivo: typeof r.motivo === 'string' ? r.motivo.slice(0, 160) : 'Verificação lida' };
      }
      await driver.esperar(250);
    }
    return verificar('verificacao', 'Ecrã da verificação não reconhecido');
  } catch (e) {
    return falhada('erro', 'Erro inesperado ao ler a verificação');
  }
}

module.exports = { verificarConta };
