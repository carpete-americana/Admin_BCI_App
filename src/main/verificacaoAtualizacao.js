'use strict';

/**
 * O instalador só corre se vier das releases do GitHub e o SHA-256 bater com o da release (A-01).
 * O sha256 vem do /check-update da Frontend API (o `digest` do asset). Igual na User App e na Admin App.
 */

const crypto = require('crypto');
const fs = require('fs');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');

const DONO = 'carpete-americana';
// O GitHub redireciona os downloads para um destes; release-assets é o atual, objects o antigo.
const HOSTS_DOS_FICHEIROS = new Set(['release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
const MAX_SALTOS = 5;

function lerUrl(url) {
  try { return new URL(url); } catch { return null; }
}

/** O endereço do asset: https://github.com/carpete-americana/<repo>/releases/download/… */
function urlInicialPermitido(url) {
  const u = lerUrl(url);
  return !!u && u.protocol === 'https:' && u.hostname === 'github.com' && !u.username && !u.port
    && new RegExp(`^/${DONO}/[A-Za-z0-9._-]+/releases/download/`, 'i').test(u.pathname);
}

/** Cada redirecionamento tem de ficar no GitHub. */
function urlDeSaltoPermitido(url) {
  const u = lerUrl(url);
  if (!u || u.protocol !== 'https:' || u.username || u.port) return false;
  return HOSTS_DOS_FICHEIROS.has(u.hostname) || urlInicialPermitido(url);
}

function sha256Valido(h) {
  return typeof h === 'string' && /^[0-9a-f]{64}$/i.test(h);
}

/** O nome vai para um caminho e para o script VBS que o corre: só letras, números, ponto, hífen, espaço e _. */
function nomeDeInstaladorValido(nome) {
  return typeof nome === 'string' && nome.length <= 120 && /^[A-Za-z0-9][A-Za-z0-9._ -]*\.exe$/.test(nome) && !nome.includes('..');
}

/** Recusa o asset antes de descarregar; devolve a mensagem para a pessoa, ou null se serve. */
function motivoParaRecusar(asset) {
  if (!asset) return 'Instalador não encontrado';
  if (!nomeDeInstaladorValido(asset.name)) return 'O instalador tem um nome inválido';
  if (!urlInicialPermitido(asset.downloadUrl)) return 'O instalador não vem das releases do BCI no GitHub';
  // Uma Frontend API antiga não manda o sha256: sem ele não se instala.
  if (!sha256Valido(asset.sha256)) return 'Esta atualização não traz verificação. Instala a versão nova a partir do site.';
  return null;
}

/**
 * Descarrega para `destino` seguindo os redirecionamentos à mão, um a um verificados.
 * @returns {Promise<{ sha256: string, bytes: number }>}
 */
async function descarregar(url, destino, { fetchFn = fetch, aoProgresso = () => {} } = {}) {
  if (!urlInicialPermitido(url)) throw new Error('Endereço do instalador recusado');
  let atual = url;
  let response;
  for (let salto = 0; ; salto++) {
    response = await fetchFn(atual, { redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    if (salto >= MAX_SALTOS) throw new Error('Demasiados redirecionamentos');
    const seguinte = new URL(response.headers.get('location') || '', atual).toString();
    if (!urlDeSaltoPermitido(seguinte)) throw new Error(`Redirecionamento recusado para ${lerUrl(seguinte)?.hostname || 'endereço inválido'}`);
    atual = seguinte;
  }
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

  const total = parseInt(response.headers.get('content-length'), 10) || 0;
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  const contar = new Transform({
    transform(pedaco, _enc, feito) {
      hash.update(pedaco);
      bytes += pedaco.length;
      aoProgresso({ transferred: bytes, total, percent: total ? Math.round((bytes / total) * 100) : 0 });
      feito(null, pedaco);
    }
  });
  await pipeline(Readable.fromWeb(response.body), contar, fs.createWriteStream(destino));
  return { sha256: hash.digest('hex'), bytes };
}

async function sha256DoFicheiro(caminho) {
  const hash = crypto.createHash('sha256');
  for await (const pedaco of fs.createReadStream(caminho)) hash.update(pedaco);
  return hash.digest('hex');
}

/** Lança se o ficheiro não tiver o SHA-256 esperado. Chama-se mesmo antes de o executar. */
async function confirmarInstalador(caminho, esperado) {
  if (!sha256Valido(esperado)) throw new Error('Sem SHA-256 esperado');
  const obtido = await sha256DoFicheiro(caminho);
  if (obtido !== esperado.toLowerCase()) {
    throw new Error('O instalador descarregado não corresponde ao publicado');
  }
}

module.exports = {
  urlInicialPermitido, urlDeSaltoPermitido, sha256Valido, nomeDeInstaladorValido,
  motivoParaRecusar, descarregar, sha256DoFicheiro, confirmarInstalador
};
