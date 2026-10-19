'use strict';

/** Cliente HTTP do processo principal para a API de dados. Só usa o token da sessão e aborta ao fim do tempo limite. */

function criarApi({ baseUrl, lerToken, guardarToken = null, fetchFn = fetch, tempoLimiteMs = 10000 }) {
  async function pedir(metodo, caminho, corpo) {
    const token = await lerToken();
    if (!token) return { status: 401, corpo: null };
    const controlo = new AbortController();
    const temporizador = setTimeout(() => controlo.abort(), tempoLimiteMs);
    try {
      const res = await fetchFn(baseUrl + caminho, {
        method: metodo,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        signal: controlo.signal
      });
      // A API renova a sessão no cabeçalho; sem isto, com a janela escondida, o token acabava por caducar.
      const renovado = res.headers?.get?.('X-Sessao-Renovada');
      if (renovado && guardarToken) {
        try { await guardarToken(renovado); } catch (e) { /* a resposta segue; tenta-se no pedido seguinte */ }
      }
      return { status: res.status, corpo: await res.json().catch(() => null) };
    } finally {
      clearTimeout(temporizador);
    }
  }
  return {
    get: (caminho) => pedir('GET', caminho),
    post: (caminho, corpo) => pedir('POST', caminho, corpo),
    del: (caminho) => pedir('DELETE', caminho)
  };
}

module.exports = { criarApi };
