const { ipcRenderer } = require('electron');

// A janela do consentimento não expõe nada à página: monta o texto e responde ela própria. O texto entra só por textContent.
window.addEventListener('DOMContentLoaded', () => {
  const q = new URLSearchParams(location.search);
  const doc = document;
  doc.title = q.get('titulo') || '';
  doc.getElementById('titulo').textContent = q.get('titulo') || '';
  const corpo = doc.getElementById('texto');
  for (const linha of (q.get('texto') || '').split('\n')) {
    if (!linha.trim()) continue;
    const p = doc.createElement('p');
    p.textContent = linha;
    if (linha.startsWith('•')) p.className = 'item';
    corpo.appendChild(p);
  }
  const aceitar = doc.getElementById('aceitar');
  const recusar = doc.getElementById('recusar');
  aceitar.textContent = q.get('aceitar') || 'Aceito';
  recusar.textContent = q.get('recusar') || 'Agora não';
  aceitar.addEventListener('click', () => ipcRenderer.send('consentimento:responder', true));
  recusar.addEventListener('click', () => ipcRenderer.send('consentimento:responder', false));
  // No pedido, Enter não aceita: o foco fica em «Agora não».
  (q.get('modo') === 'pedido' ? recusar : aceitar).focus();
});
