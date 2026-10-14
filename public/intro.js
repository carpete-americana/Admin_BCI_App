// Intro do painel de admin no #initial-loader: a do site de utilizador (Website/js/intro.js) com as cores do painel.
// Igual em Admin Website/js/intro.js e Admin App/public/intro.js. O arranque chama window.bciIntro.terminar().
(() => {
    const raiz = document.getElementById('initial-loader');
    if (!raiz) return;
    // Janelas destacadas da Admin App abrem uma página só; a intro ali só atrasava.
    if (new URLSearchParams(location.search).get('detached') === 'true') return;

    const reduzido = matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Fim da linha de carregamento no CSS (1.5s + .9s).
    const T_INTRO = reduzido ? 0 : 2400;

    // Paths do logo (assets/icons/icon.svg). O buraco do "b" entra como segundo subpath, com evenodd.
    const B = 'M279 159h180v173l180 1 24 2 28 4 21 5 21 6 17 6 23 10 24 12 21 13 32 24 12 11 8 7 12 12 7 8 10 12 9 13 12 19 9 15 13 26 11 30 6 23 5 27 2 23v44l-2 27-4 23-9 34-7 19-15 31-14 24-12 17-10 13-9 10-12 13-13 13-11 9-15 12-19 13-13 8-27 14-26 11-31 10-30 7-31 4-12 1h-47l-26-3-31-6-25-7-29-11-26-12-25-14-12-8-14-10-16-13-16-15-10-10-7-8-11-13-14-19-12-19-15-29-7-16-11-33-5-22-3-17-2-31v-174h178v-137l-1-38h-178l-1-67v-106z'
        + 'M467 507h163l26 3 19 5 16 6 21 11 16 12 10 9 12 12 10 13 8 14 10 21 6 23 3 19 1 14-4 27-6 23-9 19-8 14-13 16-10 11-14 11-11 8-14 8-19 8-20 6-16 3-10 1h-22l-14-1-28-7-13-5-20-10-14-10-11-9-16-16-10-13-10-17-7-16-6-20-3-17-2-25v-150z';
    const QUADRADO = 'M279 159h180v45l-1 128-17 1h-162l-1-67v-106z';
    // Letras de assets/images/bci-extended.png, vectorizadas (a fonte da marca não existe como fonte).
    const LETRAS = 'M306.0 74.8 305.2 76.0 305.2 288.0 305.7 289.0 309.0 289.4 423.0 289.4 439.0 288.6 453.0 286.3 464.0 283.1 472.0 279.3 480.0 273.3 485.5 267.0 488.1 263.0 491.6 255.0 493.4 249.0 495.3 233.0 495.3 226.0 494.4 218.0 491.3 208.0 489.2 204.0 485.0 198.0 476.0 189.7 463.7 182.0 473.6 175.0 480.3 169.0 483.7 165.0 489.4 156.0 491.6 151.0 493.3 145.0 494.4 133.0 492.7 116.0 491.1 110.0 488.2 103.0 485.4 98.0 482.3 94.0 476.0 88.0 469.8 84.0 465.0 81.7 453.0 77.7 441.0 75.7 421.0 74.6ZM608.0 75.0 597.0 75.8 585.0 78.0 572.0 81.8 559.0 87.8 550.0 93.9 541.3 102.0 533.7 112.0 529.0 120.4 524.8 130.0 519.9 148.0 517.7 164.0 516.8 176.0 516.8 195.0 518.5 211.0 520.8 223.0 524.9 236.0 529.0 244.8 532.6 251.0 537.0 257.2 546.3 267.0 554.0 273.0 559.0 276.0 565.0 279.2 575.0 283.2 592.0 287.3 612.0 289.3 692.0 289.2 692.9 287.0 692.9 253.0 692.0 251.8 614.0 251.7 605.0 251.3 599.0 250.4 593.0 249.0 589.0 247.4 585.0 245.3 581.0 242.1 577.9 239.0 575.0 234.9 571.1 227.0 568.1 215.0 566.6 203.0 566.2 185.0 566.9 170.0 569.6 152.0 572.6 142.0 577.3 132.0 583.3 124.0 588.1 120.0 595.0 115.9 601.0 113.6 610.0 111.9 620.0 111.4 691.0 111.4 692.5 111.0 692.9 110.0 692.9 76.0 692.0 74.7ZM727.0 74.7 726.1 76.0 726.1 80.0 726.1 288.0 726.6 289.0 728.0 289.4 772.0 289.2 773.0 288.7 773.3 287.0 773.4 76.0 773.0 75.1 772.0 74.7ZM351.0 113.2 350.3 114.0 350.3 158.0 350.4 162.0 351.0 162.5 423.0 162.4 429.0 161.3 435.0 159.3 439.6 156.0 443.3 151.0 445.1 145.0 445.5 141.0 445.4 134.0 444.7 130.0 443.4 126.0 440.8 122.0 436.5 118.0 432.0 115.7 425.0 113.7 417.0 113.3ZM351.0 200.6 350.3 202.0 350.3 205.0 350.3 248.0 350.3 250.0 351.0 251.2 417.0 251.3 426.0 250.5 432.0 249.1 439.0 245.2 442.0 241.9 444.5 237.0 446.0 231.0 446.3 227.0 446.1 222.0 444.8 216.0 441.7 210.0 438.0 206.3 434.0 203.8 428.0 201.7 421.0 200.7Z';
    // Linha central do "b", do topo da haste à ponta da barra; desenhada na máscara, revela o logo.
    const TRACO = 'M373 470V668A250 250 0 1 0 625 418H440';

    raiz.innerHTML = `
        <div class="bi-luz bi-luz-1"></div>
        <div class="bi-luz bi-luz-2"></div>
        <div class="bi-centro">
            <div class="bi-lockup" role="img" aria-label="BCI">
                <svg class="bi-marca" viewBox="272 152 700 850" aria-hidden="true">
                    <defs>
                        <mask id="biRevela" maskUnits="userSpaceOnUse" x="0" y="0" width="1180" height="1184">
                            <path class="bi-traco" d="${TRACO}" pathLength="100"/>
                            <rect x="270" y="150" width="200" height="182" fill="#000"/>
                            <rect class="bi-lasca" x="458" y="332" width="19" height="178" fill="#000"/>
                        </mask>
                    </defs>
                    <path class="bi-b" d="${B}" fill-rule="evenodd" mask="url(#biRevela)"/>
                    <path class="bi-quadrado" d="${QUADRADO}"/>
                </svg>
                <svg class="bi-palavra" viewBox="305 74 470 216" aria-hidden="true"><path d="${LETRAS}" fill-rule="evenodd"/></svg>
            </div>
            <span class="bi-admin">Admin</span>
            <div class="bi-linha"><i></i></div>
        </div>`;

    const css = document.createElement('style');
    css.textContent = `
        /* Cores do painel (--bg-dark, --primary, --primary-light, --text-primary). */
        #initial-loader {
            --bi-fundo: #0f0f14; --bi-logo: #f1f1f4; --bi-quadrado: #6366f1; --bi-claro: #818cf8;
            --bi-luz-1: rgba(99, 102, 241, .28); --bi-luz-2: rgba(67, 56, 202, .32); --bi-trilho: rgba(241, 241, 244, .1);
            position: fixed; inset: 0; z-index: 999999; overflow: hidden;
            display: grid; place-items: center;
            background: var(--bi-fundo); opacity: 1 !important;
        }
        /* Como o .admin-indicator da barra lateral. */
        .bi-admin {
            margin: -22px 0 -14px; padding: 4px 12px; border-radius: 12px;
            background: rgba(99, 102, 241, .1); border: 1px solid rgba(99, 102, 241, .25); color: var(--bi-claro);
            font: 700 .68rem/1.2 'Inter', system-ui, sans-serif; letter-spacing: .18em; text-transform: uppercase;
            opacity: 0; transform: translateY(8px);
            animation: bi-etiqueta .6s cubic-bezier(.2, .7, .2, 1) 1.75s forwards;
        }
        #initial-loader:not(.bi-tocar), #initial-loader:not(.bi-tocar) * { animation-play-state: paused !important; }

        .bi-luz { position: absolute; border-radius: 50%; pointer-events: none; }
        .bi-luz-1 {
            width: 70vmax; height: 70vmax; right: -25vmax; bottom: -35vmax;
            background: radial-gradient(circle, var(--bi-luz-1), transparent 62%);
            animation: bi-deriva-1 7s ease-in-out infinite alternate;
        }
        .bi-luz-2 {
            width: 65vmax; height: 65vmax; left: -25vmax; top: -32vmax;
            background: radial-gradient(circle, var(--bi-luz-2), transparent 62%);
            animation: bi-deriva-2 8s ease-in-out infinite alternate;
        }

        .bi-centro { position: relative; display: flex; flex-direction: column; align-items: center; gap: 46px; }
        .bi-lockup { display: flex; align-items: flex-end; gap: 9px; }

        /* Começa ao centro; desliza para a esquerda quando a palavra entra (meia largura da palavra + espaço). */
        .bi-marca {
            width: 61px; height: 74px; overflow: visible; transform: translateX(68px);
            animation: bi-desliza .85s cubic-bezier(.76, 0, .24, 1) 1.3s forwards;
        }
        .bi-quadrado {
            fill: var(--bi-quadrado); transform-box: fill-box; transform-origin: 50% 50%;
            transform: scale(0) rotate(-90deg);
            animation: bi-surge .75s cubic-bezier(.34, 1.56, .64, 1) .2s forwards;
        }
        .bi-b, .bi-palavra { fill: var(--bi-logo); }
        /* O traço da haste vai até x=473 e mostrava um fio solto do topo da barriga (x 458–473); some quando a barra final lá chega. */
        .bi-lasca { animation: bi-some 0s linear 1.32s forwards; }
        .bi-traco {
            fill: none; stroke: #fff; stroke-width: 200;
            stroke-dasharray: 100; stroke-dashoffset: 100;
            animation: bi-desenha .8s cubic-bezier(.65, 0, .35, 1) .62s forwards;
        }

        /* Anda colada ao logo e vai-se mostrando da esquerda: a palavra sai de dentro dele. */
        /* Proporções do bci-extended.png: letras da altura do b sem o quadrado, 9px de intervalo. */
        .bi-palavra {
            width: 126px; height: 58px; overflow: visible; transform: translateX(68px); clip-path: inset(-20% 100% -20% 0);
            animation: bi-desenrola .85s cubic-bezier(.76, 0, .24, 1) 1.3s forwards;
        }

        .bi-linha {
            position: relative; width: 212px; height: 2px; border-radius: 2px; overflow: hidden;
            background: var(--bi-trilho); opacity: 0;
            animation: bi-aparece .4s ease-out 1.5s forwards;
        }
        .bi-linha i {
            position: absolute; inset: 0; border-radius: 2px; transform-origin: 0 50%; transform: scaleX(0);
            background: linear-gradient(90deg, var(--bi-quadrado), var(--bi-claro));
            animation: bi-enche .9s cubic-bezier(.4, 0, .2, 1) 1.5s forwards;
        }
        /* À espera da página: a ponta pulsa até ela estar pronta. */
        .bi-espera .bi-linha::after {
            content: ''; position: absolute; top: 0; bottom: 0; width: 60px;
            background: linear-gradient(90deg, transparent, rgba(255, 255, 255, .9), transparent);
            animation: bi-brilho 1.1s ease-in-out infinite;
        }
        .bi-pronto .bi-linha i {
            animation: bi-enche .9s cubic-bezier(.4, 0, .2, 1) 1.5s forwards, bi-completa .35s cubic-bezier(.4, 0, .2, 1) forwards;
        }
        .bi-pronto .bi-linha::after { display: none; }

        .bi-saida .bi-centro { animation: bi-sobe .55s cubic-bezier(.5, 0, .75, 0) forwards; }
        #initial-loader.bi-saida {
            pointer-events: none;
            animation: bi-cortina .9s cubic-bezier(.76, 0, .24, 1) .12s forwards;
        }

        @keyframes bi-surge { to { transform: scale(1) rotate(0deg); } }
        @keyframes bi-desenha { to { stroke-dashoffset: 0; } }
        @keyframes bi-some { to { opacity: 0; } }
        @keyframes bi-desliza { to { transform: translateX(0); } }
        @keyframes bi-desenrola { to { transform: translateX(0); clip-path: inset(-20% 0 -20% 0); } }
        @keyframes bi-aparece { to { opacity: 1; } }
        @keyframes bi-etiqueta { to { opacity: 1; transform: none; } }
        @keyframes bi-enche { to { transform: scaleX(.86); } }
        @keyframes bi-completa { from { transform: scaleX(.86); } to { transform: scaleX(1); } }
        @keyframes bi-brilho { from { left: -60px; } to { left: 212px; } }
        @keyframes bi-sobe { to { transform: translateY(-28px); opacity: 0; } }
        @keyframes bi-cortina {
            to { transform: translateY(-100%); border-radius: 0 0 50% 50% / 0 0 14vh 14vh; }
        }
        @keyframes bi-deriva-1 { to { transform: translate(-6vmax, -5vmax) scale(1.08); } }
        @keyframes bi-deriva-2 { to { transform: translate(5vmax, 4vmax) scale(1.1); } }

        @media (max-width: 380px) { .bi-centro { transform: scale(.85); } }
        @media (prefers-reduced-motion: reduce) {
            #initial-loader *, #initial-loader { animation-duration: .01ms !important; animation-delay: 0s !important; }
            #initial-loader.bi-saida { animation: bi-esvai .3s ease-out forwards !important; }
            @keyframes bi-esvai { to { opacity: 0; } }
        }`;
    document.head.appendChild(css);

    let introFeita;
    const intro = new Promise(r => { introFeita = r; });
    let inicio = 0;

    function tocar() {
        if (inicio) return;
        inicio = performance.now();
        raiz.classList.add('bi-tocar');
        setTimeout(() => { introFeita(); raiz.classList.add('bi-espera'); }, T_INTRO);
    }

    // Num separador aberto em segundo plano, a animação espera que a pessoa o veja.
    if (document.visibilityState === 'visible') tocar();
    else document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') tocar();
    });

    let saida = null;

    // A página só aparece depois de a animação ter corrido até ao fim.
    function terminar() {
        if (saida) return saida;
        tocar();
        saida = intro.then(() => new Promise(resolve => {
            raiz.classList.add('bi-pronto');
            setTimeout(() => {
                raiz.classList.add('bi-saida');
                setTimeout(resolve, 150);
                setTimeout(() => { raiz.remove(); css.remove(); }, 1150);
            }, reduzido ? 0 : 380);
        }));
        return saida;
    }

    window.bciIntro = { terminar };
})();
