// Funções que correm na página do casino (content script e executeScript do motor). Recebem seletores e textos por argumento.
(() => {
  if (globalThis.__bciPagina) return;

  const ESCONDIDO = (el) => {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return rect.width === 0 || rect.height === 0 || style.display === 'none' || style.visibility === 'hidden';
  };

  // Estrito apanha campos em menus fechados (max-height:0 + overflow:hidden); permissivo serve para botões, onde .click() funciona na mesma.
  function isVisible(el, { permissivo = false } = {}) {
    if (!el) return false;
    if (ESCONDIDO(el)) return false;
    if (permissivo) return true;
    if (getComputedStyle(el).opacity === '0' || el.type === 'hidden') return false;

    let node = el.parentElement;
    for (let i = 0; i < 8 && node; i++) {
      const s = getComputedStyle(node);
      if (s.overflow === 'hidden' || s.overflowY === 'hidden') {
        const maxH = parseFloat(s.maxHeight);
        if (!isNaN(maxH) && maxH < 2) return false;
        if (node.getBoundingClientRect().height < 2) return false;
      }
      if (s.pointerEvents === 'none') return false;
      node = node.parentElement;
    }
    return true;
  }

  // O que a pessoa vê no ecrã: um menu escondido por opacidade continua com tamanho, mas não conta.
  function vistoPeloUtilizador(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    if (r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) return false;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    }
    return true;
  }

  function encontrarCampo(seletores) {
    for (const seletor of seletores || []) {
      let elementos;
      try { elementos = document.querySelectorAll(seletor); } catch (e) { continue; }
      for (const el of elementos) if (isVisible(el)) return el;
    }
    return null;
  }

  // Último recurso: o campo de texto visível no mesmo formulário da password.
  function usernamePerto(password) {
    if (!password) return null;
    const caixa = password.closest('form') || password.parentElement?.closest('div, section') || document.body;
    const candidatos = caixa.querySelectorAll('input[type="text"], input[type="email"], input:not([type])');
    for (const el of candidatos) if (el !== password && isVisible(el)) return el;
    return null;
  }

  function preencher(input, valor) {
    if (!input || !valor) return false;
    input.focus();
    input.click();
    // Setter nativo, para React e Angular darem pela alteração.
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, valor);
    for (const tipo of ['input', 'change']) input.dispatchEvent(new Event(tipo, { bubbles: true, cancelable: true }));
    for (const tipo of ['keydown', 'keyup', 'keypress']) input.dispatchEvent(new KeyboardEvent(tipo, { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    return input.value === valor;
  }

  const textoDe = (el) => (el.textContent || el.value || el.getAttribute('aria-label') || '').toLowerCase().trim();

  // exato=true compara o texto inteiro: «sim» apanhava «Simulador».
  function clicarPorTexto(textos, { exato = false, permissivo = true } = {}) {
    const alvos = (textos || []).map(t => t.toLowerCase());
    const candidatos = document.querySelectorAll('button, a, [role="button"], [role="menuitem"], [onclick], input[type="button"], input[type="submit"]');
    for (const el of candidatos) {
      const texto = textoDe(el);
      if (!texto) continue;
      const bate = exato ? alvos.includes(texto) : alvos.some(t => texto.includes(t));
      if (bate && !el.disabled && isVisible(el, { permissivo })) {
        el.click();
        return true;
      }
    }
    return false;
  }

  // Entrar por outro caminho: «Aceder com uma chave de acesso» abria o diálogo de passkey do Windows.
  const OUTRO_ACESSO = /chave de acesso|passkey|google|apple|facebook/;

  // Percorre todos os elementos de cada seletor: na Betclic há um submit escondido antes do botão certo.
  // O certo à vista mas desativado (o site ainda valida) espera: o recurso por texto apanhava outro botão.
  function clicarEntrar({ seletores, textos }) {
    let desativado = false;
    for (const seletor of seletores || []) {
      let candidatos;
      try { candidatos = document.querySelectorAll(seletor); } catch (e) { continue; }
      for (const btn of candidatos) {
        if (!isVisible(btn)) continue;
        if (btn.disabled) { desativado = true; continue; }
        btn.click();
        return true;
      }
    }
    if (desativado) return false;
    const alvos = (textos || []).map(t => t.toLowerCase());
    for (const btn of document.querySelectorAll('button, input[type="submit"], a[role="button"], [role="button"]')) {
      if (btn.disabled || !isVisible(btn) || OUTRO_ACESSO.test(textoDe(btn))) continue;
      if (alvos.some(t => textoDe(btn).includes(t))) { btn.click(); return true; }
    }
    return false;
  }

  function camposProntos(seletores) {
    return !!(encontrarCampo(seletores.username) || encontrarCampo(seletores.password));
  }

  // Angular com SSR (Betclic): os campos chegam no HTML do servidor e a hidratação repõe-nos vazios; acaba quando não sobra nenhum [ngh].
  function paginaHidratada() {
    return !document.querySelector('[ngh]');
  }

  // «Obrigatório» fica de fora: aparece enquanto o site valida e não quer dizer que o login falhou.
  const PALAVRAS_ERRO = [
    'incorret', 'errad', 'inválid', 'invalid', 'incorrect', 'wrong', 'falhou', 'failed',
    'bloquead', 'não foi possível', 'tenta novamente', 'try again', 'insere novamente', 'enter again'
  ];

  // Botões e ligações curtos: «Depositar» numa promoção não conta.
  function temTextoEmBotao(textos) {
    const alvos = (textos || []).map(t => t.toLowerCase());
    for (const el of document.querySelectorAll('button, a, [role="button"]')) {
      const texto = textoDe(el);
      if (texto && texto.length <= 40 && alvos.some(t => texto.includes(t)) && vistoPeloUtilizador(el)) return true;
    }
    return false;
  }

  function erroVisivel(seletoresErro) {
    for (const seletor of seletoresErro || []) {
      let elementos;
      try { elementos = document.querySelectorAll(seletor); } catch (e) { continue; }
      for (const el of elementos) {
        const texto = (el.textContent || '').trim();
        if (!texto || texto.length > 300 || !vistoPeloUtilizador(el)) continue;
        if (PALAVRAS_ERRO.some(k => texto.toLowerCase().includes(k))) return texto.slice(0, 200);
      }
    }
    return null;
  }

  const algumVisivel = (seletores) => seletores.some(s => [...document.querySelectorAll(s)].some(vistoPeloUtilizador));

  // Erros num modal sem classe de erro (Betclic): procura-se a frase no texto visível da página.
  function textoDeErroVisivel(textos) {
    if (!textos?.length) return null;
    // innerText ignora o texto escondido; o jsdom dos testes não o tem.
    const pagina = semAcentos(document.body?.innerText ?? document.body?.textContent ?? '');
    return textos.some(t => pagina.includes(semAcentos(t))) ? 'O site recusou o e-mail ou a palavra-passe' : null;
  }

  // Recusa o banner de cookies (a opção mais privada): por cima do formulário, o clique em Entrar não chegava ao site.
  function recusarCookies(cfg) {
    let caixa = null;
    try { caixa = cfg?.contentor && document.querySelector(cfg.contentor); } catch (e) { return false; }
    if (!caixa) return false;
    const alvos = (cfg.textos || []).map(semAcentos);
    for (const el of caixa.querySelectorAll('button, a, [role="button"]')) {
      if (alvos.includes(semAcentos(compacto(el.textContent))) && vistoPeloUtilizador(el)) { el.click(); return true; }
    }
    return false;
  }

  // Só falha com uma mensagem de erro do site; sem ela, e sem sinal de sessão, espera (verificação anti-robô, carregamento).
  function estadoLogin(seletores, { seletoresErro = [], textosSessao = [], seletoresSessao = [], textosErro = [] } = {}) {
    const noFormulario = !!(encontrarCampo(seletores.username) && encontrarCampo(seletores.password));
    const erro = erroVisivel(seletoresErro) || textoDeErroVisivel(textosErro);
    if (erro) return { estado: 'falhou', erro, noFormulario };
    if (algumVisivel(seletoresSessao) || temTextoEmBotao(textosSessao)) return { estado: 'entrou', erro: null, noFormulario };
    return { estado: 'aguardar', erro: null, noFormulario };
  }

  const GATILHOS_EXATOS = ['entrar', 'iniciar sessão', 'login', 'log in'];

  // «sem» exige ver o caminho para entrar: um campo solto de email não chega.
  function estadoSessao(seletores, textosSessao, sessao = { com: [], sem: [] }) {
    if (algumVisivel(sessao.com) || temTextoEmBotao(textosSessao)) return 'com';
    if (algumVisivel(sessao.sem)) return 'sem';
    const botaoEntrar = [...document.querySelectorAll('button, a, [role="button"]')]
      .some(el => GATILHOS_EXATOS.includes(textoDe(el)) && vistoPeloUtilizador(el));
    const formulario = !!(encontrarCampo(seletores.username) && encontrarCampo(seletores.password));
    return botaoEntrar || formulario ? 'sem' : '?';
  }

  const eFechar = (el) => /close|fechar/i.test(`${el.className} ${el.id} ${el.getAttribute('aria-label') || ''}`);

  function abrirMenuConta(seletores, textos) {
    for (const seletor of seletores || []) {
      let candidatos;
      try { candidatos = document.querySelectorAll(seletor); } catch (e) { continue; }
      for (const el of candidatos) {
        if (!eFechar(el) && vistoPeloUtilizador(el)) { el.click(); return true; }
      }
    }
    const alvos = (textos || []).map(t => t.toLowerCase());
    for (const el of document.querySelectorAll('button, a, [role="button"], span, div')) {
      if (alvos.includes(textoDe(el)) && !eFechar(el) && vistoPeloUtilizador(el)) { el.click(); return true; }
    }
    return false;
  }

  // Último recurso: o item do menu fechado continua no DOM e o clique dispara o handler na mesma.
  function clicarEscondidoPorTexto(textos) {
    const alvos = (textos || []).map(t => t.toLowerCase());
    // Ligações e botões antes de li: o handler costuma estar no elemento de dentro.
    for (const seletor of ['button, a, [role="button"], [role="menuitem"]', 'li, [onclick]']) {
      for (const el of document.querySelectorAll(seletor)) {
        if (alvos.includes(textoDe(el))) { el.click(); return true; }
      }
    }
    return false;
  }

  // Uma passagem; quem chama repete enquanto o popup pode aparecer.
  function fecharPopups(popups) {
    for (const popup of popups || []) {
      if (popup.selector) {
        try {
          const btn = document.querySelector(popup.selector);
          if (btn && isVisible(btn, { permissivo: true })) { btn.click(); return true; }
        } catch (e) { /* seletor inválido: tenta por texto */ }
      }
      if (popup.dismissTexts?.length && clicarPorTexto(popup.dismissTexts)) return true;
    }
    return false;
  }

  // Uma ação por chamada, entre o login e a sessão aparecer; o site pode reformatar a máscara, daí comparar só dígitos.
  // Com validado (o motor já carregou em Validar) só diz se o ecrã da data continua: reenviar a data pode bloquear a conta.
  function passosPosLogin(posLogin, { nascimento = null, popups = [], validado = false } = {}) {
    const passo = posLogin?.nascimento;
    const campo = passo ? encontrarCampo([passo.campo]) : null;
    if (campo) {
      if (validado) return 'nascimento-pendente';
      if (!nascimento) return 'sem-nascimento';
      const digitos = (t) => String(t || '').replace(/\D/g, '');
      if (digitos(campo.value) !== digitos(nascimento)) { preencher(campo, nascimento); return 'nascimento'; }
      let botao = null;
      try { botao = document.querySelector(passo.botao); } catch (e) { /* seletor inválido */ }
      if (!botao || botao.disabled || botao.getAttribute('aria-disabled') === 'true' || !isVisible(botao, { permissivo: true })) return null;
      botao.click();
      return 'validou';
    }
    return fecharPopups(popups) ? 'popup' : null;
  }

  const TOKENS_CAPTCHA = 'input[name="cf-turnstile-response"], textarea[name="g-recaptcha-response"], textarea[name="h-captcha-response"], input[name*="captcha" i], textarea[name*="captcha" i]';
  const WIDGETS_CAPTCHA = 'iframe[src*="turnstile" i], iframe[src*="challenges.cloudflare" i], iframe[src*="recaptcha" i], iframe[src*="hcaptcha" i], iframe[src*="captcha" i]';

  // A verificação de humano deixa um token no formulário quando acaba; sem token ainda está a decorrer.
  // Um hCaptcha/reCAPTCHA invisível (Betclic: contentor com 0 px) só desafia depois do envio: o token vazio dele não conta.
  function captchaPendente() {
    const tokens = [...document.querySelectorAll(TOKENS_CAPTCHA)]
      .filter(t => t.name === 'cf-turnstile-response' || vistoPeloUtilizador(t.parentElement));
    if (tokens.length) return tokens.every(t => !String(t.value || '').trim());
    return [...document.querySelectorAll(WIDGETS_CAPTCHA)].some(vistoPeloUtilizador);
  }

  const FRASES_SAIDA = ['sessão terminou', 'sessao terminou', 'sessão expirou', 'sessão foi terminada', 'terminou a sessão', 'session ended', 'session expired', 'logged out'];
  const BOTOES_AVISO = ['ok', 'fechar', 'continuar', 'entendi', 'aceitar'];

  // Aviso «A sua sessão terminou» depois do logout: bloqueia o login até alguém carregar no OK dele (e só dele).
  function fecharAvisoDeSaida() {
    for (const el of document.querySelectorAll('p, span, div, h1, h2, h3, h4')) {
      const texto = (el.textContent || '').trim().toLowerCase();
      if (!texto || texto.length > 200 || !FRASES_SAIDA.some(f => texto.includes(f)) || !vistoPeloUtilizador(el)) continue;
      let caixa = el;
      for (let i = 0; i < 6 && caixa; i++, caixa = caixa.parentElement) {
        const botao = [...caixa.querySelectorAll('button, a, [role="button"]')]
          .find(b => BOTOES_AVISO.includes(textoDe(b)) && vistoPeloUtilizador(b));
        if (botao) { botao.click(); return true; }
      }
    }
    return false;
  }

  const DIALOGOS = '[role="dialog"], [role="alertdialog"], [class*="modal" i], [class*="dialog" i], [class*="popup" i], [class*="confirm" i]';

  // seletorSair clica direto, mesmo escondido; a confirmação só procura dentro de um diálogo (um «OK» solto é de outra coisa).
  function passoLogout({ logoutTexts, confirmTexts, seletorSair }, fase, { exato = true } = {}) {
    if (fase === 'logout') {
      if (seletorSair) {
        let botao = null;
        try { botao = document.querySelector(seletorSair); } catch (e) { /* seletor inválido */ }
        if (botao) { botao.click(); return true; }
      }
      return clicarPorTexto(logoutTexts?.length ? logoutTexts : ['sair']);
    }
    const alvos = (confirmTexts || []).map(t => t.toLowerCase());
    if (!alvos.length) return false;
    for (const caixa of document.querySelectorAll(DIALOGOS)) {
      if (!vistoPeloUtilizador(caixa)) continue;
      for (const el of caixa.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]')) {
        const texto = textoDe(el);
        const bate = exato ? alvos.includes(texto) : alvos.some(t => texto.includes(t));
        if (bate && !el.disabled && vistoPeloUtilizador(el)) { el.click(); return true; }
      }
    }
    return false;
  }

  // Abre a página dos dados pessoais pelo menu da conta; o link existe no DOM mesmo com o menu fechado.
  function abrirDetalhesPessoais({ menu, detalhes }) {
    try {
      const botao = menu && document.querySelector(menu);
      if (botao && botao.getAttribute('aria-expanded') !== 'true') botao.click();
      const link = detalhes && document.querySelector(detalhes);
      if (link) { link.click(); return true; }
    } catch (e) { /* seletor inválido */ }
    return false;
  }

  const CAMPOS_PESSOAIS = {
    nome: ['nome', 'primeiro nome'], apelido: ['apelido', 'último nome', 'ultimo nome'], telemovel: ['telemóvel', 'telemovel', 'telefone'],
    email: ['email', 'e-mail'], morada: ['morada'], codigoPostal: ['código postal', 'codigo postal'], localidade: ['localidade']
  };

  // Lê o formulário pelos rótulos (os ids são gerados); null enquanto Nome e Apelido não tiverem valor.
  function lerDetalhesPessoais() {
    const dados = {};
    for (const label of document.querySelectorAll('label')) {
      const rotulo = (label.textContent || '').trim().toLowerCase();
      const chave = Object.keys(CAMPOS_PESSOAIS).find(k => CAMPOS_PESSOAIS[k].includes(rotulo));
      if (!chave || dados[chave]) continue;
      const campo = label.control || (label.htmlFor && document.getElementById(label.htmlFor)) || label.parentElement?.querySelector('input');
      const valor = String(campo?.value || '').trim();
      if (valor) dados[chave] = valor;
    }
    return dados.nome && dados.apelido ? dados : null;
  }

  // «1.234,56 €», «30.00 €» ou «1,234.56 €»: o último separador é decimal se tiver 1 ou 2 casas depois; os outros são milhares.
  function numeroEmEuros(texto) {
    const limpo = String(texto || '').replace(/[^\d,.]/g, '');
    if (!/\d/.test(limpo)) return null;
    const m = limpo.match(/^(.*)[.,](\d{1,2})$/);
    const inteiro = (m ? m[1] : limpo).replace(/[.,]/g, '');
    const n = Number(`${inteiro || '0'}.${m ? m[2] : '0'}`);
    return Number.isFinite(n) ? n : null;
  }

  // null sem saldo à vista.
  function lerSaldo(seletor) {
    for (const el of document.querySelectorAll(seletor)) {
      const n = numeroEmEuros(el.textContent);
      if (n != null) return n;
    }
    return null;
  }

  // Corre em todos os frames; só o do caixa responde, os outros devolvem null.
  const noCaixa = (cfg) => location.hostname === cfg.caixaHost && document.querySelector(cfg.montante);

  // true quando o campo do montante já está no frame do caixa; null nos outros frames.
  function caixaPronto(cfg) {
    return location.hostname === cfg.caixaHost && [].concat(cfg.montante || []).some(s => document.querySelector(s)) ? true : null;
  }

  // ok:false não é definitivo: o caixa valida o montante e redesenha o formulário depois de escolher o SEPA, e o motor volta a chamar.
  function prepararLevantamento(cfg, valor) {
    const montante = noCaixa(cfg);
    if (!montante) return null;
    const marca = cfg.metodoMarca;
    const el = document.querySelector(cfg.metodo);
    const metodo = marca ? el : el?.closest('li');
    if (!metodo) return { ok: false, motivo: marca ? 'O caixa não tem levantamento por transferência' : 'O caixa não tem levantamento por SEPA' };
    if (!(marca ? metodo.querySelector(marca) : metodo.classList.contains('selected'))) {
      metodo.click();
      return { ok: false, motivo: marca ? 'O caixa não ficou com a transferência escolhida' : 'O caixa não ficou com o SEPA escolhido' };
    }
    const iban = marca
      ? metodo.querySelector(cfg.iban)
      : [...document.querySelectorAll(cfg.iban)].map(e => e.closest('li')).find(li => li?.classList.contains('selected'));
    if (!iban) return { ok: false, motivo: 'Sem IBAN escolhido no caixa' };
    // Cêntimos com ponto; relido depois, porque um caixa que tire o ponto levantaria cem vezes mais.
    const texto = Number.isInteger(valor) ? String(valor) : Number(valor).toFixed(2);
    if (montante.value !== texto) preencher(montante, texto);
    const escrito = numeroEmEuros(montante.value);
    if (escrito !== Number(valor)) return { ok: false, motivo: `O caixa ficou com «${montante.value}» em vez de ${texto} €` };
    const botao = botaoDoCaixa(cfg);
    if (!botao) return { ok: false, motivo: 'Sem botão de levantar' };
    // Na Betclic o IBAN vem mascarado com asteriscos: só contam os dígitos.
    const fim = (iban.textContent || '').replace(marca ? /\D/g : /\s+/g, '').slice(-4);
    if (botao.disabled) return { ok: false, motivo: avisoDoCaixa() || `O botão Levantar não ativou com ${valor} €` };
    return { ok: true, iban: fim ? `…${fim}` : null, motivo: null };
  }

  function confirmarLevantamento(cfg) {
    if (!noCaixa(cfg)) return null;
    const botao = botaoDoCaixa(cfg);
    if (!botao || botao.disabled) return false;
    botao.click();
    return true;
  }

  // Fecha o aviso de sucesso quando o site o deixa aberto por cima do caixa.
  function fecharResultadoLevantamento(cfg) {
    if (location.hostname !== cfg.caixaHost) return false;
    const alvos = (cfg.fecharTexto || []).map(semAcentos);
    const botao = [...document.querySelectorAll('button, [role="button"]')]
      .find(b => alvos.some(a => semAcentos(compacto(textoDe(b))) === a) && vistoPeloUtilizador(b));
    if (!botao) return false;
    botao.click();
    return true;
  }

  const MENSAGENS = '[role="alert"], .alert, [class*="message" i], [class*="error" i], [class*="success" i], [class*="result" i], h1, h2, h3, h4, p';

  // O que o caixa escreve junto ao montante (mínimo, máximo, saldo); null sem nada à vista.
  function avisoDoCaixa() {
    for (const el of document.querySelectorAll('[role="alert"], [class*="error" i], [class*="invalid" i], [class*="warning" i]')) {
      const texto = (el.textContent || '').trim().replace(/\s+/g, ' ');
      if (texto && texto.length <= 200 && vistoPeloUtilizador(el)) return texto;
    }
    return null;
  }

  // Depois do clique: o caixa troca o formulário por uma mensagem; sem ela continua a aguardar.
  function resultadoLevantamento(cfg) {
    if (location.hostname !== cfg.caixaHost) return null;
    if ((cfg.urlsErro || []).some(u => location.pathname.includes(u))) return { estado: 'erro', texto: 'O site mostrou um erro técnico' };
    const sucesso = (cfg.textosSucesso || []).map(t => t.toLowerCase());
    const erro = (cfg.textosErro || []).map(t => t.toLowerCase());
    const mensagens = [...document.querySelectorAll(MENSAGENS)]
      .map(el => ({ el, texto: (el.textContent || '').trim() }))
      .filter(({ el, texto }) => texto && texto.length <= 300 && vistoPeloUtilizador(el));
    if (cfg.sucessoPrimeiro) {
      const ok = mensagens.find(({ texto }) => sucesso.some(k => texto.toLowerCase().includes(k)));
      if (ok) return { estado: 'sucesso', texto: ok.texto.slice(0, 160) };
    }
    for (const { texto } of mensagens) {
      const t = texto.toLowerCase();
      if (erro.some(k => t.includes(k))) return { estado: 'erro', texto: texto.slice(0, 160) };
      if (sucesso.some(k => t.includes(k))) return { estado: 'sucesso', texto: texto.slice(0, 160) };
    }
    return { estado: 'aguardar' };
  }

  // ---------- depósito por Multibanco ----------

  const semAcentos = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const compacto = (t) => String(t || '').replace(/\s+/g, ' ').trim();

  // Montante do caixa: seletores do casino; os genéricos só no frame do caixa.
  function campoMontante(cfg) {
    const listas = [cfg.montante || []];
    if (location.hostname === cfg.caixaHost) listas.push(cfg.montanteGenerico || []);
    for (const lista of listas) {
      for (const seletor of lista) {
        let el = null;
        try { el = [...document.querySelectorAll(seletor)].find(e => isVisible(e)); } catch (e) { /* seletor inválido */ }
        if (el) return el;
      }
    }
    return null;
  }

  const MARCAS_ESCOLHIDO = /(^|[\s_-])(selected|active|checked|chosen)($|[\s_-])/i;

  function estaEscolhido(el) {
    if (!el) return false;
    if (MARCAS_ESCOLHIDO.test(el.className || '')) return true;
    if (el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-checked') === 'true') return true;
    return !!el.querySelector?.('input:checked');
  }

  // O item do método de pagamento: pelo logótipo do casino ou, em último caso, por um texto curto.
  function itemDoMetodo(cfg) {
    for (const seletor of cfg.metodo || []) {
      let el = null;
      try { el = document.querySelector(seletor); } catch (e) { /* seletor inválido */ }
      if (el && cfg.metodoExato) return el;
      if (el) return el.closest('li, button, label, [role="radio"], [role="tab"], [role="button"]') || el;
    }
    const alvos = (cfg.metodoTexto || []).map(semAcentos);
    for (const el of document.querySelectorAll('li, button, label, [role="radio"], [role="tab"], [role="button"]')) {
      const t = semAcentos(compacto(el.textContent));
      if (t && t.length <= 60 && alvos.some(a => t.includes(a)) && vistoPeloUtilizador(el)) return el;
    }
    return null;
  }

  // Só se clica no método uma vez por frame.
  const METODO_CLICADO = '__bciMetodoClicado';

  // Na Betclic o MB WAY vem escolhido e o botão dele pede logo o pagamento no telemóvel da pessoa.
  function bloqueioDoDeposito(cfg, metodo, botao) {
    if (cfg.metodoMarca && !metodo?.querySelector(cfg.metodoMarca)) return 'O caixa ainda não escolheu o Multibanco';
    const rotulos = (cfg.botaoRotulo || []).map(semAcentos);
    if (rotulos.length && !rotulos.some(r => semAcentos(textoDe(botao)).includes(r))) return 'O botão do caixa não é o de continuar';
    return null;
  }

  // ok:false não é definitivo: o caixa redesenha o formulário depois de escolher o método e o motor volta a chamar.
  function prepararDeposito(cfg, valor) {
    const montante = campoMontante(cfg);
    const metodo = itemDoMetodo(cfg);
    if (!montante && !metodo) return null;
    if (location.hostname !== cfg.caixaHost && !montante) return null;
    if (cfg.metodoMarca) {
      if (!metodo) return { ok: false, motivo: 'O caixa não tem depósito por Multibanco' };
      if (!metodo.querySelector(cfg.metodoMarca)) { metodo.click(); return { ok: false, motivo: 'O caixa ainda não escolheu o Multibanco' }; }
    } else if (metodo && !globalThis[METODO_CLICADO]) {
      // Clica sempre, mesmo já escolhido: o caixa só monta o formulário do Multibanco depois do clique.
      globalThis[METODO_CLICADO] = true;
      metodo.click();
      return { ok: false, motivo: 'O caixa ainda não escolheu o Multibanco' };
    }
    if (!cfg.metodoMarca && !metodo && !globalThis[METODO_CLICADO]) return { ok: false, motivo: 'O caixa não tem depósito por Multibanco' };
    if (!montante) return { ok: false, motivo: 'O caixa não mostrou o campo do montante' };
    const texto = Number.isInteger(valor) ? String(valor) : Number(valor).toFixed(2);
    if (montante.value !== texto) preencher(montante, texto);
    const escrito = numeroEmEuros(montante.value);
    if (escrito !== Number(valor)) return { ok: false, motivo: `O caixa ficou com «${montante.value}» em vez de ${texto} €` };
    const botao = botaoDeDeposito(cfg);
    if (!botao) return { ok: false, motivo: 'Sem botão de depositar' };
    const bloqueio = bloqueioDoDeposito(cfg, metodo, botao);
    if (bloqueio) return { ok: false, motivo: bloqueio };
    if (botao.disabled) return { ok: false, motivo: avisoDoCaixa() || `O botão Depositar não ativou com ${valor} €` };
    return { ok: true, motivo: null };
  }

  // cfg.botao: seletor ou lista deles; senão o botão visível pelo texto (cfg.botaoTexto).
  function botaoDoCaixa(cfg) {
    for (const seletor of [].concat(cfg.botao || [])) {
      let el = null;
      try { el = document.querySelector(seletor); } catch (e) { /* seletor inválido */ }
      if (el) return el;
    }
    const alvos = (cfg.botaoTexto || []).map(semAcentos);
    return [...document.querySelectorAll('button, input[type="submit"], [role="button"]')]
      .find(b => alvos.some(a => semAcentos(textoDe(b)).includes(a)) && vistoPeloUtilizador(b)) || null;
  }

  const botaoDeDeposito = botaoDoCaixa;

  function confirmarDeposito(cfg) {
    if (!campoMontante(cfg)) return null;
    const botao = botaoDeDeposito(cfg);
    if (!botao || botao.disabled || bloqueioDoDeposito(cfg, itemDoMetodo(cfg), botao)) return false;
    botao.click();
    return true;
  }

  // A caixa «Tem um Código Promocional?» tem o mesmo rótulo e não é o campo.
  const eCampoDeTexto = (el) => el?.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|hidden)$/.test(el.type);

  function campoDoCodigo(cfg) {
    for (const seletor of cfg.codigo || []) {
      let el = null;
      try { el = [...document.querySelectorAll(seletor)].find(e => eCampoDeTexto(e) && isVisible(e)); } catch (e) { /* seletor inválido */ }
      if (el) return el;
    }
    const rotulos = (cfg.rotuloCodigo || []).map(semAcentos);
    for (const label of document.querySelectorAll('label')) {
      const t = semAcentos(compacto(label.textContent));
      if (!t || t.length > 50 || !rotulos.some(r => t.includes(r))) continue;
      const campo = label.control || (label.htmlFor && document.getElementById(label.htmlFor)) || label.parentElement?.querySelector('input');
      if (eCampoDeTexto(campo) && isVisible(campo)) return campo;
    }
    return null;
  }

  // Escreve o código promocional e carrega no «Aplicar» ao lado, se houver. null: este frame não tem o campo nem como o abrir.
  function aplicarCodigo(cfg, codigo) {
    const campo = campoDoCodigo(cfg);
    if (!campo) {
      // O campo está atrás de «Tem um Código Promocional?»: marca-se uma vez (clicar outra vez desmarcava).
      const caixaMarcar = cfg.abrirCodigoCaixa && document.querySelector(cfg.abrirCodigoCaixa);
      if (caixaMarcar) {
        if (caixaMarcar.checked) return { ok: false, motivo: 'O campo do código promocional não apareceu' };
        caixaMarcar.click();
        return { ok: false, motivo: 'A abrir o campo do código promocional' };
      }
      // Sem a caixa conhecida: só rótulos (um texto solto apanharia «Promoções» no menu).
      const alvos = (cfg.abrirCodigo || []).map(semAcentos);
      const abre = [...document.querySelectorAll('label')]
        .find(el => { const t = semAcentos(compacto(el.textContent)); return t && t.length <= 60 && alvos.some(a => t.includes(a)) && vistoPeloUtilizador(el); });
      if (!abre) return null;
      abre.click();
      return { ok: false, motivo: 'A abrir o campo do código promocional' };
    }
    if (campo.value !== codigo && !preencher(campo, codigo)) return { ok: false, motivo: 'O campo do código promocional não aceitou o código' };
    const aplicar = (cfg.aplicar || []).map(semAcentos);
    let caixa = campo.parentElement;
    for (let i = 0; i < 3 && caixa; i++, caixa = caixa.parentElement) {
      const botao = [...caixa.querySelectorAll('button, [role="button"], input[type="button"], a')]
        .find(b => aplicar.some(a => semAcentos(textoDe(b)) === a || semAcentos(textoDe(b)).startsWith(a)) && !b.disabled && vistoPeloUtilizador(b));
      if (botao) {
        if (!campo.dataset.bciAplicado) { campo.dataset.bciAplicado = '1'; botao.click(); }
        return { ok: true, aplicado: true };
      }
    }
    return { ok: true, aplicado: false };
  }

  // Se o caixa marcou o código como válido: 'valido', 'invalido', ou null quando não tem indicador.
  function estadoDoCodigo(cfg) {
    const marca = cfg.codigoValidacao && document.querySelector(cfg.codigoValidacao);
    if (!marca) return null;
    if (marca.classList.contains('valid_field')) return 'valido';
    return marca.classList.contains('invalid_field') ? 'invalido' : null;
  }

  // O que o caixa diz sobre o código depois de aplicado; null sem recusa à vista.
  function erroDoCodigo(cfg) {
    const alvos = (cfg.textosErroCodigo || []).map(semAcentos);
    for (const el of document.querySelectorAll('[role="alert"], [class*="error" i], [class*="invalid" i], [class*="message" i], [class*="warning" i], small, span, p')) {
      const t = compacto(el.textContent);
      if (!t || t.length > 200 || !vistoPeloUtilizador(el)) continue;
      if (alvos.some(a => semAcentos(t).includes(a))) return t.slice(0, 160);
    }
    return null;
  }

  // Texto da página, sem scripts e com um espaço entre elementos.
  function textoDaPagina() {
    if (!document.body) return '';
    const partes = [];
    const passeio = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => /^(SCRIPT|STYLE|NOSCRIPT)$/.test(n.parentElement?.tagName || '') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    for (let n = passeio.nextNode(); n; n = passeio.nextNode()) partes.push(n.nodeValue);
    return compacto(partes.join(' '));
  }

  const dataIso = (d, m, a) => `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  // A página em inglês escreve 10/19/2026, 8:58 PM (mês primeiro); em português, 19/10/2026. Só uma hora AM/PM ou um número acima de 12 decide.
  function dataDaReferencia(x, y, ano, americana) {
    const [a, b] = [Number(x), Number(y)];
    if (a > 12) return dataIso(a, b, ano);
    if (b > 12) return dataIso(b, a, ano);
    return americana ? dataIso(b, a, ano) : dataIso(a, b, ano);
  }

  /** Entidade, referência, montante e validade de um texto com uma referência Multibanco; null sem entidade e referência. */
  function extrairReferenciaMB(texto) {
    const t = compacto(texto);
    // «Entidade (Nuvei Limited para Placard.pt*): 50410»: o rótulo pode ter texto antes do número.
    const entidade = t.match(/entidade\D{0,80}?(\d{5})(?!\d)/i)?.[1];
    const referencia = t.match(/refer[eê]ncia\D{0,40}?(\d{3}[\s.]?\d{3}[\s.]?\d{3})(?!\d)/i)?.[1]?.replace(/\D/g, '');
    if (!entidade || !referencia) return null;
    const montante = numeroEmEuros(t.match(/(?:montante|valor)\D{0,20}?(\d+(?:[.,]\d{1,2})?)\s*€?/i)?.[1]);
    const v = t.match(/(?:v[aá]lid\w*|expira\w*|expir\w*|at[eé]|prazo|limite)\D{0,40}?(?:(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})|(\d{4})-(\d{2})-(\d{2}))([^]{0,20})/i);
    const validade = v ? (v[4] ? `${v[4]}-${v[5]}-${v[6]}` : dataDaReferencia(v[1], v[2], v[3], /[ap]\.?m\b/i.test(v[7] || ''))) : null;
    return { entidade, referencia, montante, validade };
  }

  /** Dia local (AAAA-MM-DD) de agora mais as horas que o texto indica; null sem elas. */
  function validadeDeHoras(texto, padrao, agora = new Date()) {
    let m = null;
    try { m = padrao && compacto(texto).match(new RegExp(padrao, 'i')); } catch (e) { /* padrão inválido */ }
    const horas = Number(m?.[1]);
    if (!Number.isFinite(horas)) return null;
    const d = new Date(agora.getTime() + horas * 3600e3);
    return dataIso(d.getDate(), d.getMonth() + 1, d.getFullYear());
  }

  // Os valores do modal da Betclic estão em .value de campos só de leitura, fora do texto da página.
  function referenciaDosCampos(cfg) {
    const valor = (seletor) => {
      let el = null;
      try { el = seletor && document.querySelector(seletor); } catch (e) { /* seletor inválido */ }
      return el && isVisible(el, { permissivo: true }) ? String(el.value || '').replace(/\s+/g, '') : '';
    };
    const entidade = valor(cfg.referencia.entidade);
    const referencia = valor(cfg.referencia.referencia);
    if (!/^\d{4,10}$/.test(entidade) || !/^\d{6,20}$/.test(referencia)) return null;
    return { entidade, referencia, montante: numeroEmEuros(valor(cfg.referencia.montante)), validade: validadeDeHoras(textoDaPagina(), cfg.validadeTexto) };
  }

  // Corre em todos os frames: só o que mostra a referência responde.
  function lerReferenciaMB(cfg) {
    return (cfg?.referencia && referenciaDosCampos(cfg)) || extrairReferenciaMB(textoDaPagina());
  }

  // Depois do clique: a referência, uma recusa do caixa ou ainda nada. Só olha para o frame do caixa.
  function resultadoDeposito(cfg) {
    const ref = lerReferenciaMB(cfg);
    if (ref) return { estado: 'referencia', ...ref };
    if (location.hostname !== cfg.caixaHost) return null;
    if ((cfg.urlsErro || []).some(u => location.pathname.includes(u))) return { estado: 'erro', texto: 'O site mostrou um erro técnico' };
    const erro = (cfg.textosErro || []).map(semAcentos);
    for (const el of document.querySelectorAll('[role="alert"], [class*="error" i], [class*="invalid" i], h1, h2, h3, h4, p')) {
      const texto = compacto(el.textContent);
      if (!texto || texto.length > 300 || !vistoPeloUtilizador(el)) continue;
      if (erro.some(k => semAcentos(texto).includes(k))) return { estado: 'erro', texto: texto.slice(0, 160) };
    }
    return { estado: 'aguardar' };
  }

  globalThis.__bciPagina = {
    abrirDetalhesPessoais, lerDetalhesPessoais, lerSaldo, caixaPronto, prepararLevantamento, confirmarLevantamento, resultadoLevantamento, fecharResultadoLevantamento, botaoDoCaixa,
    prepararDeposito, confirmarDeposito, aplicarCodigo, erroDoCodigo, estadoDoCodigo, lerReferenciaMB, extrairReferenciaMB, validadeDeHoras, resultadoDeposito,
    isVisible, vistoPeloUtilizador, encontrarCampo, usernamePerto, preencher, clicarPorTexto, clicarEntrar,
    camposProntos, paginaHidratada, estadoLogin, estadoSessao, recusarCookies, fecharPopups, passosPosLogin, fecharAvisoDeSaida, captchaPendente, passoLogout, abrirMenuConta, clicarEscondidoPorTexto
  };
})();
