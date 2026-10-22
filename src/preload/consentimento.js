const { ipcRenderer } = require('electron');

// A janela do consentimento não expõe nada à página: monta o texto e responde ela própria. O texto entra só por textContent.
window.addEventListener('DOMContentLoaded', () => {
  const q = new URLSearchParams(location.search);
  const doc = document;
  doc.title = q.get('titulo') || '';
  doc.getElementById('titulo').textContent = q.get('titulo') || '';
  const corpo = doc.getElementById('texto');
  // Linhas com «•» seguidas formam uma lista; o parágrafo depois de uma lista é a nota final.
  let lista = null;
  let depoisDaLista = false;
  for (const linha of (q.get('texto') || '').split('\n')) {
    if (!linha.trim()) continue;
    if (linha.startsWith('•')) {
      if (!lista) lista = corpo.appendChild(doc.createElement('ul'));
      const li = doc.createElement('li');
      li.textContent = linha.replace(/^•\s*/, '');
      lista.appendChild(li);
      continue;
    }
    if (lista) depoisDaLista = true;
    lista = null;
    const p = doc.createElement('p');
    p.textContent = linha;
    if (depoisDaLista) p.className = 'nota';
    corpo.appendChild(p);
  }
  const aceitar = doc.getElementById('aceitar');
  const recusar = doc.getElementById('recusar');
  aceitar.textContent = q.get('aceitar') || 'Aceito';
  recusar.textContent = q.get('recusar') || 'Agora não';
  aceitar.addEventListener('click', () => ipcRenderer.send('consentimento:responder', true));
  recusar.addEventListener('click', () => ipcRenderer.send('consentimento:responder', false));
  aceitar.focus();
});
