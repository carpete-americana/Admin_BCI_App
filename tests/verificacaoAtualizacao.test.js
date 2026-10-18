'use strict';

/** O instalador só corre vindo do GitHub e com o SHA-256 da release (A-01). Um .exe adulterado é recusado. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const V = require('../src/main/verificacaoAtualizacao');

const URL_ASSET = 'https://github.com/carpete-americana/Admin_BCI_App/releases/download/v2.2.0/BCI.Admin-Setup-1.2.0.exe';
const URL_FICHEIRO = 'https://release-assets.githubusercontent.com/github-production-release-asset/1/abc?sp=r';
const CONTEUDO = Buffer.from('MZ instalador de teste '.repeat(1000));
const SHA = crypto.createHash('sha256').update(CONTEUDO).digest('hex');

const pastaTemp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bci-upd-'));

/** fetch falso: cada URL responde com um redirecionamento ou com o conteúdo. */
function servidor(rotas) {
  const pedidos = [];
  const fetchFn = async (url, opcoes) => {
    pedidos.push({ url, opcoes });
    const r = rotas[url];
    if (!r) return new Response('não existe', { status: 404 });
    if (r.para) return new Response(null, { status: 302, headers: { location: r.para } });
    return new Response(r.corpo, { status: 200, headers: { 'content-length': String(r.corpo.length) } });
  };
  return { fetchFn, pedidos };
}

test('só aceita assets das releases do carpete-americana no github.com, por https', () => {
  assert.equal(V.urlInicialPermitido(URL_ASSET), true);
  assert.equal(V.urlInicialPermitido(URL_ASSET.replace('https:', 'http:')), false);
  assert.equal(V.urlInicialPermitido(URL_ASSET.replace('carpete-americana', 'outro')), false);
  assert.equal(V.urlInicialPermitido('https://github.com.evil.pt/carpete-americana/x/releases/download/a.exe'), false);
  assert.equal(V.urlInicialPermitido('https://bcibizz.pt/BCI-Setup.exe'), false);
  assert.equal(V.urlInicialPermitido('https://user@github.com/carpete-americana/x/releases/download/a.exe'), false);
  assert.equal(V.urlDeSaltoPermitido(URL_FICHEIRO), true);
  assert.equal(V.urlDeSaltoPermitido('https://objects.githubusercontent.com/x'), true);
  assert.equal(V.urlDeSaltoPermitido('https://evil.githubusercontent.com.pt/x'), false);
});

test('um asset sem sha256 (Frontend API antiga) ou com nome estranho é recusado antes de descarregar', () => {
  const bom = { name: 'BCI.Admin-Setup-1.2.0.exe', downloadUrl: URL_ASSET, sha256: SHA };
  assert.equal(V.motivoParaRecusar(bom), null);
  assert.match(V.motivoParaRecusar({ ...bom, sha256: undefined }), /não traz verificação/);
  assert.match(V.motivoParaRecusar({ ...bom, sha256: 'abc' }), /não traz verificação/);
  assert.match(V.motivoParaRecusar({ ...bom, name: 'x" & calc & ".exe' }), /nome inválido/);
  assert.match(V.motivoParaRecusar({ ...bom, name: '..\..\BCI.exe' }), /nome inválido/);
  assert.match(V.motivoParaRecusar({ ...bom, downloadUrl: 'https://evil.pt/a.exe' }), /não vem das releases/);
});

test('descarrega seguindo o redirecionamento do GitHub e devolve o SHA-256 do que chegou', async () => {
  const destino = path.join(pastaTemp(), 'i.exe');
  const { fetchFn, pedidos } = servidor({ [URL_ASSET]: { para: URL_FICHEIRO }, [URL_FICHEIRO]: { corpo: CONTEUDO } });
  const progresso = [];
  const r = await V.descarregar(URL_ASSET, destino, { fetchFn, aoProgresso: (p) => progresso.push(p.percent) });
  assert.equal(r.sha256, SHA);
  assert.equal(r.bytes, CONTEUDO.length);
  assert.deepEqual(fs.readFileSync(destino), CONTEUDO);
  assert.equal(pedidos.every(p => p.opcoes.redirect === 'manual'), true, 'os redirecionamentos seguem-se à mão');
  assert.equal(progresso.at(-1), 100);
});

test('um redirecionamento para fora do GitHub é recusado e não descarrega nada', async () => {
  const destino = path.join(pastaTemp(), 'i.exe');
  const { fetchFn, pedidos } = servidor({ [URL_ASSET]: { para: 'https://evil.pt/i.exe' }, 'https://evil.pt/i.exe': { corpo: CONTEUDO } });
  await assert.rejects(V.descarregar(URL_ASSET, destino, { fetchFn }), /Redirecionamento recusado para evil\.pt/);
  assert.equal(pedidos.length, 1);
  assert.equal(fs.existsSync(destino), false);
});

test('um instalador adulterado não passa na confirmação; o original passa', async () => {
  const pasta = pastaTemp();
  const ficheiro = path.join(pasta, 'i.exe');
  fs.writeFileSync(ficheiro, CONTEUDO);
  await V.confirmarInstalador(ficheiro, SHA.toUpperCase());
  const adulterado = Buffer.from(CONTEUDO);
  adulterado[10] ^= 1;
  fs.writeFileSync(ficheiro, adulterado);
  await assert.rejects(V.confirmarInstalador(ficheiro, SHA), /não corresponde ao publicado/);
  await assert.rejects(V.confirmarInstalador(ficheiro, null), /Sem SHA-256/);
});

test('o updater recusa antes de descarregar e confirma o ficheiro antes de o executar', () => {
  const fonte = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'updater.js'), 'utf8');
  assert.match(fonte, /motivoParaRecusar\(winAsset\)/);
  const confirma = fonte.indexOf('await confirmarInstalador(finalInstallerPath');
  const executa = fonte.indexOf('cscript.exe');
  assert.ok(confirma > 0 && confirma < executa, 'a confirmação vem antes de executar');
  assert.doesNotMatch(fonte, /fetch\(winAsset\.downloadUrl\)/, 'o download passa pelo verificador');
});
