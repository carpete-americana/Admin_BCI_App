// A janela não tem barra do sistema: minimizar, maximizar e fechar desenhados pelo BCi.
// No cabeçalho quando o há (shell), no canto nos outros ecrãs. Igual na User App e na Admin App.
(function () {
    var api = window.electronAPI && window.electronAPI.janela;
    if (!api) return;
    // No Mac ficam os semáforos do sistema; só se lhes abre espaço na barra lateral.
    if (api.plataforma === 'darwin') { document.documentElement.classList.add('janela-mac'); return; }
    if (/[?&]detached=true/.test(location.search)) return;

    var SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
    var ICONES = {
        minimizar: SVG + '<path d="M3.5 8h9"/></svg>',
        maximizar: SVG + '<rect x="3.5" y="3.5" width="9" height="9" rx="2"/></svg>',
        restaurar: SVG + '<rect x="3" y="5.5" width="7.5" height="7.5" rx="1.8"/><path d="M5.5 3.5h5a2 2 0 0 1 2 2v5"/></svg>',
        fechar: SVG + '<path d="m4 4 8 8M12 4l-8 8"/></svg>'
    };

    var CSS = '' +
        '.bci-janela { display: flex; align-items: center; gap: 4px; -webkit-app-region: no-drag;' +
        '  --bj-icone: #475569; --bj-hover: rgba(15, 23, 42, .07); --bj-linha: rgba(15, 23, 42, .1); }' +
        '.bci-janela.escuro { --bj-icone: #c7c9d1; --bj-hover: rgba(255, 255, 255, .08); --bj-linha: rgba(255, 255, 255, .1); }' +
        '.main-header .bci-janela { margin-left: 4px; padding-left: 14px; border-left: 1px solid var(--bj-linha); height: 30px; }' +
        '.bci-janela.solta { position: fixed; top: 14px; right: 14px; z-index: 1000000; }' +
        '.bci-janela.solta.escuro { --bj-icone: #ffffff; --bj-hover: rgba(255, 255, 255, .14); }' +
        '.bci-janela.solta svg { stroke-width: 1.8; }' +
        '.bci-janela button { appearance: none; border: 0; margin: 0; padding: 0; width: 34px; height: 34px; border-radius: 10px;' +
        '  display: grid; place-items: center; background: transparent; color: var(--bj-icone); cursor: pointer;' +
        '  transition: background .15s ease, color .15s ease, transform .1s ease; }' +
        '.bci-janela button svg { width: 15px; height: 15px; }' +
        '.bci-janela button:hover { background: var(--bj-hover); }' +
        '.bci-janela button:active { transform: scale(.92); }' +
        '.bci-janela button:focus-visible { outline: 2px solid #6366f1; outline-offset: 1px; }' +
        '.bci-janela .bj-fechar:hover { background: #ef4444; color: #fff; }' +
        '.main-header.com-janela { padding-right: 14px; }' +
        '.bci-arrastar { position: fixed; top: 0; left: 0; right: 0; height: 40px; z-index: 999999; -webkit-app-region: drag; }';

    function hex(cor) {
        var m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(cor || '');
        if (!m || (m[4] !== undefined && Number(m[4]) < 0.5)) return null;
        return [Number(m[1]), Number(m[2]), Number(m[3])];
    }

    function escura(c) { return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) < 150; }

    // A primeira camada com cor; num degradê (o login) conta a primeira cor dele.
    function corDe(el) {
        var estilo = getComputedStyle(el);
        return hex(estilo.backgroundColor) || hex(estilo.backgroundImage);
    }

    function botao(acao, rotulo, icone, classe) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = classe || '';
        b.title = rotulo;
        b.setAttribute('aria-label', rotulo);
        b.innerHTML = icone;
        b.addEventListener('click', function () { api[acao](); });
        return b;
    }

    function montar() {
        if (document.querySelector('.bci-janela')) return;
        var estilo = document.createElement('style');
        estilo.textContent = CSS;
        document.head.appendChild(estilo);

        var caixa = document.createElement('div');
        caixa.className = 'bci-janela';
        var max = botao('maximizar', 'Maximizar', ICONES.maximizar);
        caixa.appendChild(botao('minimizar', 'Minimizar', ICONES.minimizar));
        caixa.appendChild(max);
        caixa.appendChild(botao('fechar', 'Fechar', ICONES.fechar, 'bj-fechar'));
        var faixa = document.createElement('div');
        faixa.className = 'bci-arrastar';
        faixa.setAttribute('aria-hidden', 'true');

        if (typeof api.aoMaximizar === 'function') {
            api.aoMaximizar(function (sim) {
                max.innerHTML = sim ? ICONES.restaurar : ICONES.maximizar;
                max.title = sim ? 'Restaurar' : 'Maximizar';
                max.setAttribute('aria-label', max.title);
            });
        }

        // No cabeçalho quando está à vista; no login e noutros ecrãs sem ele, no canto e com faixa para arrastar.
        function colocar() {
            var cabecalho = document.querySelector('.main-header');
            var visivel = cabecalho && cabecalho.offsetHeight > 0 && getComputedStyle(cabecalho).display !== 'none';
            if (visivel) {
                cabecalho.classList.add('com-janela');
                var destino = cabecalho.querySelector('.header-right') || cabecalho;
                if (caixa.parentElement !== destino) destino.appendChild(caixa);
                caixa.classList.remove('solta');
                faixa.remove();
            } else {
                if (caixa.parentElement !== document.body) document.body.appendChild(caixa);
                caixa.classList.add('solta');
                if (!faixa.isConnected) document.body.appendChild(faixa);
            }
        }

        // A cor vem do que está mesmo por baixo dos botões (intro, cabeçalho, login).
        function aplicarTom() {
            var r = caixa.getBoundingClientRect();
            var x = Math.max(0, r.left - 6), y = r.top + r.height / 2;
            var camadas = document.elementsFromPoint(x, y);
            for (var i = 0; i < camadas.length; i++) {
                if (caixa.contains(camadas[i]) || camadas[i] === faixa) continue;
                var c = corDe(camadas[i]);
                if (c) return caixa.classList.toggle('escuro', escura(c));
            }
            caixa.classList.remove('escuro');
        }

        function atualizar() { colocar(); aplicarTom(); }

        // Outra vez depois: o fundo pode estar a meio da transição de tema.
        var espera = null;
        function agendar() {
            clearTimeout(espera);
            espera = setTimeout(function () { atualizar(); espera = setTimeout(atualizar, 400); }, 50);
        }
        var obs = new MutationObserver(agendar);
        obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
        obs.observe(document.head, { childList: true });
        obs.observe(document.body, { childList: true, attributes: true, attributeFilter: ['class', 'style'] });
        window.addEventListener('load', agendar);
        window.addEventListener('hashchange', agendar);
        // As páginas mostram e escondem o cabeçalho de muitas maneiras; isto apanha as que escapam.
        setInterval(atualizar, 1500);
        atualizar();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar);
    else montar();
})();
