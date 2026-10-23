// Falta de ligação: pílula no topo enquanto se navega, e ecrã próprio quando a página não chegou a carregar.
// CSS próprio de propósito: sem rede, o CSS global pode não ter chegado.

const ICONE_SEM_REDE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h.01"/><path d="M8.5 16.43a5 5 0 0 1 7 0"/><path d="M2 8.82a15 15 0 0 1 4.17-2.65"/><path d="M10.66 5c4.01-.36 8.14.9 11.34 3.76"/><path d="M16.85 11.25a10 10 0 0 1 2.22 1.68"/><path d="M5 13a10 10 0 0 1 5.24-2.76"/><path d="m2 2 20 20"/></svg>';
const ICONE_OK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

const CSS = `
#offline-banner {
  position: fixed; left: 50%; top: calc(env(safe-area-inset-top, 0px) + 12px); z-index: 10060;
  transform: translateX(-50%); max-width: calc(100% - 32px);
  display: flex; align-items: center; gap: 10px; padding: 8px 16px 8px 8px;
  background: rgba(24, 24, 32, 0.94); color: #f4f4f7; border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 999px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.28);
  -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
  font: 500 13px/1.3 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
  animation: ob-entra 0.32s cubic-bezier(0.2, 0.9, 0.3, 1.2);
  pointer-events: none;
}
#offline-banner .ob-icone {
  flex: none; width: 28px; height: 28px; border-radius: 50%;
  display: grid; place-items: center; background: rgba(245, 158, 11, 0.16); color: #fbbf24;
}
#offline-banner .ob-icone svg { width: 15px; height: 15px; }
#offline-banner .ob-texto { display: flex; gap: 6px; align-items: baseline; min-width: 0; white-space: nowrap; }
#offline-banner .ob-texto b { font-weight: 650; }
#offline-banner .ob-texto span { color: #a1a1b0; overflow: hidden; text-overflow: ellipsis; }
#offline-banner .ob-texto span::after { content: ''; display: inline-block; width: 1.2em; text-align: left; animation: ob-pontos 1.4s steps(4) infinite; }
#offline-banner.voltou .ob-icone { background: rgba(34, 197, 94, 0.18); color: #4ade80; }
#offline-banner.sai { animation: ob-sai 0.24s ease forwards; }
@keyframes ob-entra { from { transform: translate(-50%, calc(-100% - 24px)); } }
@keyframes ob-sai { to { opacity: 0; transform: translate(-50%, -14px) scale(0.96); } }
@keyframes ob-pontos { 0% { content: ''; } 25% { content: '.'; } 50% { content: '..'; } 75% { content: '...'; } }

.sn-ecra {
  --sn-fundo: transparent; --sn-texto: #0f172a; --sn-suave: #64748b; --sn-anel: rgba(99, 102, 241, 0.14);
  --sn-circulo: #eef2ff; --sn-icone: #6366f1; --sn-botao2: #f1f5f9; --sn-botao2-texto: #334155;
  min-height: 70vh; padding: 48px 24px; display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center; background: var(--sn-fundo); color: var(--sn-texto);
  font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
  animation: sn-entra 0.35s ease-out;
}
.sn-ecra.escuro {
  --sn-texto: #f4f4f7; --sn-suave: #9898a6; --sn-anel: rgba(129, 140, 248, 0.18);
  --sn-circulo: rgba(99, 102, 241, 0.16); --sn-icone: #a5b4fc; --sn-botao2: rgba(255, 255, 255, 0.06); --sn-botao2-texto: #d4d4dc;
}
.sn-figura { position: relative; width: 132px; height: 132px; display: grid; place-items: center; margin-bottom: 28px; }
.sn-onda { position: absolute; inset: 0; border-radius: 50%; border: 2px solid var(--sn-anel); animation: sn-onda 2.6s ease-out infinite; }
.sn-onda + .sn-onda { animation-delay: 1.3s; }
.sn-circulo { position: relative; width: 84px; height: 84px; border-radius: 50%; display: grid; place-items: center; background: var(--sn-circulo); color: var(--sn-icone); }
.sn-circulo svg { width: 36px; height: 36px; }
.sn-ecra h2 { margin: 0 0 8px; font-size: 22px; font-weight: 700; letter-spacing: -0.01em; color: var(--sn-texto); }
.sn-ecra p { margin: 0 0 24px; max-width: 340px; font-size: 15px; line-height: 1.55; color: var(--sn-suave); }
.sn-acoes { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
.sn-botao {
  appearance: none; border: 0; border-radius: 12px; padding: 12px 22px; min-height: 44px;
  font-family: inherit; font-size: 15px; font-weight: 600; line-height: 1; cursor: pointer;
  background: #6366f1; color: #fff; box-shadow: 0 6px 18px rgba(99, 102, 241, 0.32);
  transition: background 0.15s ease, transform 0.15s ease;
}
.sn-botao:hover { background: #4f46e5; }
.sn-botao:active { transform: scale(0.97); }
.sn-botao.secundario { background: var(--sn-botao2); color: var(--sn-botao2-texto); box-shadow: none; }
.sn-estado { margin-top: 18px; font-size: 13px; color: var(--sn-suave); display: inline-flex; align-items: center; gap: 8px; }
.sn-estado::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: #f59e0b; animation: sn-piscar 1.6s ease-in-out infinite; }
.sn-ecra.abanar .sn-figura { animation: sn-abanar 0.4s ease; }
@keyframes sn-entra { from { transform: translateY(8px); } }
@keyframes sn-onda { from { transform: scale(0.64); opacity: 1; } to { transform: scale(1.15); opacity: 0; } }
@keyframes sn-piscar { 50% { opacity: 0.35; } }
@keyframes sn-abanar { 25% { transform: translateX(-6px); } 75% { transform: translateX(6px); } }
@media (prefers-reduced-motion: reduce) {
  #offline-banner, .sn-ecra, .sn-onda, .sn-estado::before, #offline-banner .ob-texto span::after { animation: none !important; }
}
`;

function garantirEstilos() {
  if (document.getElementById('offline-banner-styles')) return;
  const style = document.createElement('style');
  style.id = 'offline-banner-styles';
  style.textContent = CSS;
  document.head.appendChild(style);
}

let saida = null;

export function showOfflineBanner() {
  garantirEstilos();
  clearTimeout(saida);
  let banner = document.getElementById('offline-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'offline-banner';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');
    document.body.appendChild(banner);
  }
  banner.className = '';
  banner.innerHTML = `<span class="ob-icone">${ICONE_SEM_REDE}</span><span class="ob-texto"><b>Sem internet</b><span>A tentar ligar</span></span>`;
}

export function hideOfflineBanner() {
  const banner = document.getElementById('offline-banner');
  if (!banner || banner.classList.contains('voltou')) return;
  banner.className = 'voltou';
  banner.innerHTML = `<span class="ob-icone">${ICONE_OK}</span><span class="ob-texto"><b>Ligação de volta</b></span>`;
  saida = setTimeout(() => {
    banner.classList.add('sai');
    saida = setTimeout(() => banner.remove(), 240);
  }, 1800);
}

/** Ecrã de página que não carregou por falta de rede; chama aoVoltar quando a ligação regressa. */
export function mostrarSemInternet(alvo, aoVoltar, { escuro } = {}) {
  if (!alvo) return;
  garantirEstilos();
  const tema = escuro ?? (document.documentElement.dataset.theme === 'dark'
    || getComputedStyle(document.documentElement).colorScheme.trim() === 'dark');
  alvo.innerHTML = `
    <div class="sn-ecra${tema ? ' escuro' : ''}">
      <div class="sn-figura"><span class="sn-onda"></span><span class="sn-onda"></span><span class="sn-circulo">${ICONE_SEM_REDE}</span></div>
      <h2>Estás sem internet</h2>
      <p>Assim que a ligação voltar, a página carrega sozinha.</p>
      <div class="sn-acoes"><button type="button" class="sn-botao">Tentar agora</button></div>
      <span class="sn-estado" role="status">À espera de ligação</span>
    </div>`;
  const ecra = alvo.querySelector('.sn-ecra');
  const estado = ecra.querySelector('.sn-estado');
  const voltar = () => {
    window.removeEventListener('online', voltar);
    if (ecra.isConnected) aoVoltar();
  };
  window.addEventListener('online', voltar);
  ecra.querySelector('.sn-botao').addEventListener('click', () => {
    if (navigator.onLine) return voltar();
    estado.textContent = 'Ainda sem ligação';
    ecra.classList.remove('abanar');
    void ecra.offsetWidth;
    ecra.classList.add('abanar');
  });
}
