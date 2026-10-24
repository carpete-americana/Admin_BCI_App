// Fonte única dos casinos: domínios, seletores e fluxos fixos. Corre no service worker, no content script, nas páginas da extensão e nos testes.
(() => {
  const SELETORES_GENERICOS = {
    username: [
      'input[name="username"]',
      'input[name="email"]',
      'input[name="login"]',
      'input[name="user"]',
      'input[name="userId"]',
      'input[type="email"]',
      'input[autocomplete="username"]',
      'input[autocomplete="email"]',
      '#username',
      '#email',
      '#login-username',
      '#user',
      'input[type="text"][tabindex="1"]',
      'input[placeholder*="tilizador"]',
      'input[placeholder*="sername"]',
      'input[placeholder*="mail"]',
      'input[placeholder*="login"]'
    ],
    password: [
      'input[name="password"]',
      'input[type="password"]',
      '#password',
      '#login-password',
      'input[autocomplete="current-password"]',
      'input[placeholder*="assword"]',
      'input[placeholder*="alavra"]',
      'form input[type="password"]'
    ]
  };

  const SELETORES_PLACARD = {
    username: ['input[name="userName"]', 'input[aria-label="Nome de utilizador"]', 'input[placeholder="Nome de utilizador"]', '#username'],
    password: ['input[name="password"]', 'input[type="password"]', '#password']
  };

  const CASINOS = {
    betano: {
      nome: 'Betano',
      dominios: ['betano.pt'],
      cor: '#1a8b4e',
      logo: 'icons/casinos/betano.png',
      seletores: {
        username: ['#username', 'input[id="username"]', 'input[name="username"][data-qa="input"]', 'input[name="username"]', 'input[aria-label="username"]', 'input[data-qa="input"][type="text"]'],
        password: ['#password', 'input[id="password"]', 'input[name="Password"]', 'input[name="password"]', 'input[type="password"][data-qa="input"]', 'input[type="password"]', 'input[autocomplete="current-password"]']
      },
      popups: [{ label: 'Confirmação de telefone', dismissTexts: ['fazer mais tarde', 'mais tarde'], selector: 'button[data-qa="cancel_phone-confirmation_button"]' }]
    },
    bwin: {
      nome: 'Bwin',
      dominios: ['bwin.pt'],
      cor: '#f5c518',
      logo: 'icons/casinos/bwin.png',
      seletores: {
        username: ['input[name="username"]', 'input[name="email"]', 'input[type="email"]', 'input[type="text"][autocomplete="username"]', '#username', 'input[placeholder*="tilizador"]', 'input[placeholder*="sername"]'],
        password: ['input[name="password"]', 'input[type="password"]', '#password', 'input[placeholder*="assword"]']
      }
    },
    betclic: {
      nome: 'Betclic',
      dominios: ['betclic.pt'],
      cor: '#d4213d',
      logo: 'icons/casinos/betclic.png',
      seletores: {
        username: ['input[name="username"]', 'input[name="email"]', 'input[name="login"]', 'input[type="email"]', 'input[type="text"][autocomplete="username"]', 'input[placeholder*="tilizador"]', 'input[placeholder*="mail"]'],
        password: ['input[name="password"]', 'input[type="password"]', 'input[placeholder*="assword"]']
      },
      logout: {
        accountUrl: 'https://www.betclic.pt/account',
        loginUrl: 'https://www.betclic.pt/login',
        logoutSuccessUrl: 'https://www.betclic.pt',
        postLogoutUrl: 'https://www.betclic.pt/login',
        logoutTexts: ['sair'],
        confirmTexts: ['sim']
      },
      popups: [{ label: 'Confirmação de telefone', dismissTexts: ['mais tarde'], selector: 'button[data-qa="cancel_phone-confirmation_button"]' }],
      sessao: {
        com: ['a.header_walletBalance', 'a[href="/account"]', '[data-qa="paymentUserTotalBalance"]'],
        sem: ['[data-qa="commonSignInButton"]']
      },
      posLogin: { nascimento: { campo: '[data-qa="birthdate"]', botao: '[data-qa="validate_birthdate_button"]' } },
      levantar: {
        inicio: 'https://www.betclic.pt/',
        url: 'https://pay.betclic.pt/withdraw/',
        caixaHost: 'pay.betclic.pt',
        montante: '[data-qa="withdraw-amount-input-field"]',
        saldo: '[data-qa="withdraw-remaining-amount-limits"]',
        metodo: '[data-qa="payment-mean-banktransfer-wrapper"]',
        metodoMarca: '.icon_checkSmall',
        iban: '[data-qa="payment-mean-subtext"]',
        // O único is-primary da página é «Levantar N €»; o texto fica de recurso.
        botao: 'button.btn.is-primary',
        botaoTexto: ['levantar'],
        fecharTexto: ['feito'],
        textosSucesso: ['pedido confirmado'],
        // O modal de sucesso pode ter linhas de ajuda por perto: vê-se primeiro.
        sucessoPrimeiro: true,
        // Só frases vistas no site; palavras soltas apanhavam linhas de ajuda.
        textosErro: ['estamos com problemas', 'tenta mais tarde'],
        urlsErro: ['/withdraw/error/']
      },
      // O botão real está dentro do elemento data-qa; só o cartão escolhido tem .icon_checkSmall.
      depositar: {
        inicio: 'https://www.betclic.pt/',
        url: 'https://pay.betclic.pt/deposit/',
        caixaHost: 'pay.betclic.pt',
        montante: ['[data-qa="deposit-amount-input-field"]'],
        metodo: ['[data-qa="payment-mean-multibanco-wrapper"]'],
        metodoExato: true,
        metodoMarca: '.icon_checkSmall',
        botao: ['[data-qa="deposit-continue-btn"] button'],
        botaoRotulo: ['continuar'],
        referencia: { entidade: '#deposit-multibanco-entity', referencia: '#deposit-multibanco-reference', montante: '#deposit-multibanco-amount' },
        validadeTexto: 'válida por um período de (\\d+) horas?',
        textosErro: ['estamos com problemas', 'tenta mais tarde'],
        urlsErro: ['/deposit/error/']
      }
    },
    placard: {
      nome: 'Placard',
      dominios: ['placard.pt', 'jogossantacasa.pt'],
      cor: '#003d7a',
      logo: 'icons/casinos/placard.png',
      seletores: SELETORES_PLACARD,
      erros: ['[class*="ErrorMessage__error"]'],
      // O menu da conta está sempre no DOM, escondido por opacidade; o botão clica-se direto e não pede confirmação.
      logout: { seletorSair: '#sportsLogoutBtnDesktop, button.logout-link', confirmTexts: [] },
      // «Dados Pessoais» › «Detalhes Pessoais», para saber de quem é uma sessão iniciada fora da extensão.
      identificar: { menu: '#accPersonalBtnD', detalhes: '#personalChild1D, a[href$="/detalhes-pessoais"]', url: 'https://www.placard.pt/detalhes-pessoais' },
      // O formulário é um iframe da Nuvei; SEPA e o IBAN da pessoa já vêm escolhidos.
      levantar: {
        url: 'https://www.placard.pt/levantar',
        saldo: '.cms-balance-withdrawable_balance',
        caixaHost: 'secure.safecharge.com',
        montante: '#item_amount_1',
        botao: '#continueButton',
        metodo: '.pm-logo.apmgw_sepa_payouts',
        iban: '.upm-logo.apmgw_sepa_payouts',
        textosSucesso: ['sucesso', 'foi submetido', 'foi registado', 'foi efetuado', 'pedido de levantamento', 'success'],
        textosErro: ['erro', 'recusad', 'falhou', 'insuficiente', 'mínimo', 'minimo', 'máximo', 'maximo', 'não foi possível', 'declined', 'error']
      },
      // Depósito por Multibanco: o caixa devolve entidade e referência para pagar depois. Os seletores são a melhor leitura do site e
      // ficam todos aqui; o resto (método, código, botão, referência) também se acha por texto.
      depositar: {
        url: 'https://www.placard.pt/depositar',
        caixaHost: 'secure.safecharge.com',
        // A referência abre noutra janela, noutro domínio da Nuvei (sibs.html).
        hostsExtra: ['cdn.safecharge.com'],
        metodo: ['li[data-value="apmgw_MULTIBANCO" i]', '.pm-logo.apmgw_multibanco', '.pm-logo[class*="multibanco" i]'],
        metodoTexto: ['multibanco'],
        montante: ['#item_amount_1', 'input[name="item_amount_1"]'],
        // Só no frame do caixa: noutros sítios um campo numérico qualquer não é o montante.
        montanteGenerico: ['input[inputmode="decimal"]', 'input[type="number"]', 'input[type="text"][class*="amount" i]'],
        // O campo só aparece depois de marcar «Tem um Código Promocional?»; aceita 15 caracteres e o caixa marca-o como válido ou inválido.
        abrirCodigoCaixa: '#show_promo_code',
        codigoValidacao: '#promoCode_validation',
        codigoMax: 15,
        codigo: ['#promoCode', 'input[name="promoCode"]', 'input[name*="promo" i]', 'input[id*="promo" i]', 'input[placeholder*="promo" i]', 'input[placeholder*="código" i]', 'input[name*="voucher" i]', 'input[name*="bonus" i]'],
        rotuloCodigo: ['código promocional', 'codigo promocional', 'voucher'],
        // Só rótulos: «promo» solto apanhava «Promoções» no menu do site.
        abrirCodigo: ['código promocional', 'codigo promocional', 'tem um código', 'tens um código'],
        aplicar: ['aplicar', 'validar', 'adicionar', 'apply'],
        botao: ['#continueButton'],
        botaoTexto: ['depositar', 'depósito', 'deposito', 'continuar', 'pagar', 'confirmar', 'gerar referência', 'gerar referencia'],
        textosErro: ['erro', 'recusad', 'falhou', 'insuficiente', 'mínimo', 'minimo', 'máximo', 'maximo', 'limite', 'não foi possível', 'declined', 'error'],
        textosErroCodigo: ['inválid', 'invalid', 'expirad', 'não existe', 'nao existe', 'não é válid', 'não encontrad', 'já utilizad', 'já foi utilizad', 'not valid', 'not found']
      }
    },
    lebull: {
      nome: 'Lebull',
      dominios: ['lebull.pt'],
      cor: '#ff6b00',
      logo: 'icons/casinos/lebull.png',
      seletores: {
        username: ['input[name="username"]', 'input[name="email"]', 'input[type="email"]', 'input[type="text"][autocomplete="username"]', 'input[placeholder*="tilizador"]', 'input[placeholder*="mail"]'],
        password: ['input[name="password"]', 'input[type="password"]', 'input[placeholder*="assword"]']
      }
    },
    solverde: {
      nome: 'Solverde',
      dominios: ['solverde.pt'],
      cor: '#009651',
      logo: 'icons/casinos/solverde.png',
      seletores: {
        username: ['input[name="username"]', 'input[name="email"]', 'input[type="email"]', 'input[type="text"][name*="user"]', 'input[placeholder*="tilizador"]'],
        password: ['input[name="password"]', 'input[type="password"]']
      }
    },
    esconline: {
      nome: 'ESC Online',
      dominios: ['estorilsolcasinos.pt'],
      cor: '#1e3a5f',
      logo: 'icons/casinos/esc.png',
      seletores: {
        username: ['input[name="username"]', 'input[name="email"]', 'input[type="email"]', 'input[type="text"][autocomplete="username"]', 'input[placeholder*="tilizador"]'],
        password: ['input[name="password"]', 'input[type="password"]']
      }
    }
  };

  // Casinos sem fluxo próprio: procura um botão de sair na página atual.
  const LOGOUT_GENERICO = {
    logoutTexts: ['terminar sessão', 'terminar sessao', 'sair da conta', 'sair', 'logout', 'log out', 'sign out', 'desconectar', 'desligar'],
    confirmTexts: ['sim', 'yes', 'confirmar', 'confirm', 'ok']
  };

  const TEXTOS_GATILHO_LOGIN = ['entrar', 'login', 'iniciar sessão', 'iniciar sess', 'sign in', 'log in'];

  // Só existe com sessão iniciada; procura-se em botões e ligações, não em texto de promoções.
  const TEXTOS_SESSAO_INICIADA = ['depositar'];

  // Elementos de erro do site; só contam se o texto disser que o login falhou.
  const SELETORES_ERRO_GENERICOS = ['[role="alert"]', '[class*="error" i]', '[class*="erro" i]'];

  // Para chegar ao «Terminar sessão» quando está dentro do menu da conta.
  const SELETORES_MENU_CONTA = [
    '[aria-label*="minha conta" i]', '[aria-label*="account" i]', '[aria-label*="perfil" i]',
    '[class*="avatar" i]', '[class*="account-menu" i]', '[class*="header-user" i]',
    '[class*="myaccount" i]', '[data-qa*="account" i]', '[data-testid*="account" i]'
  ];
  const TEXTOS_MENU_CONTA = ['a minha conta', 'minha conta', 'o meu perfil', 'perfil'];

  const TEXTOS_BOTAO_ENTRAR = [
    'entrar', 'aceder', 'iniciar sessão', 'iniciar sess', 'login',
    'sign in', 'log in', 'submit', 'autenticar', 'confirmar',
    'continuar', 'continue', 'enter', 'acessar'
  ];

  const SELETORES_BOTAO_ENTRAR = [
    'button[data-qa="submitLoginButton"]',
    'button[type="submit"]',
    'input[type="submit"]',
    'button[data-qa="login-button"]',
    'button[data-qa="submit"]',
    'button[name="login"]',
    'button[name="submit"]',
    '#login-button',
    '#loginButton',
    '#btnLogin',
    '.login-button',
    '.btn-login',
    'form button:not([type="button"])',
    'form input[type="submit"]'
  ];

  const ALIASES = {
    esconline: ['esc', 'esconline', 'esc-online'],
    placard: ['placard', 'santacasa', 'jogossantacasa']
  };

  function casinoDoUrl(url) {
    if (typeof url !== 'string') return null;
    let host;
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:') return null;
      host = u.hostname.toLowerCase();
    } catch (e) {
      return null;
    }
    for (const [chave, c] of Object.entries(CASINOS)) {
      if (c.dominios.some(d => host === d || host.endsWith('.' + d))) return chave;
    }
    return null;
  }

  function contaPertenceAoCasino(conta, chave) {
    const nome = (conta?.casino_name || '').toLowerCase().replace(/\s+/g, '');
    if (!nome || !chave) return false;
    if (nome.includes(chave)) return true;
    return (ALIASES[chave] || []).some(a => nome.includes(a));
  }

  function seletoresDe(chave) {
    const proprios = CASINOS[chave]?.seletores;
    if (!proprios) return SELETORES_GENERICOS;
    const juntar = (a, b) => [...new Set([...a, ...b])];
    return {
      username: juntar(proprios.username, SELETORES_GENERICOS.username),
      password: juntar(proprios.password, SELETORES_GENERICOS.password)
    };
  }

  const lista = (str) => {
    if (!str) return null;
    const l = String(str).split(',').map(s => s.trim()).filter(Boolean);
    return l.length ? l : null;
  };

  // Junta o fluxo fixo com a linha do painel; o painel só substitui os campos preenchidos.
  function fluxoEfetivo(chave, linhasPainel) {
    const fixo = CASINOS[chave]?.logout || null;
    const linha = (linhasPainel || []).find(l => contaPertenceAoCasino(l, chave));

    // Havendo popups no painel, substituem os fixos por inteiro.
    const popupsPainel = linha?.extra_popups?.length
      ? linha.extra_popups.filter(p => p.active !== 0 && p.active !== false).map(p => ({
          label: p.label,
          dismissTexts: lista(p.dismiss_texts) || [],
          selector: p.selector || null
        }))
      : null;
    const extraPopups = popupsPainel || CASINOS[chave]?.popups || [];
    const label = CASINOS[chave]?.nome || linha?.casino_name || chave;
    const posLogin = CASINOS[chave]?.posLogin || null;

    if (!linha) return fixo ? { label, ...fixo, extraPopups, posLogin } : { label, extraPopups, posLogin };

    return {
      label,
      accountUrl: linha.account_url || fixo?.accountUrl || null,
      loginUrl: linha.login_url || fixo?.loginUrl || null,
      logoutSuccessUrl: linha.logout_success_url || fixo?.logoutSuccessUrl || null,
      postLogoutUrl: linha.post_logout_url || fixo?.postLogoutUrl || null,
      logoutTexts: lista(linha.logout_texts) || fixo?.logoutTexts || null,
      confirmTexts: lista(linha.confirm_texts) || fixo?.confirmTexts || null,
      seletorSair: fixo?.seletorSair || null,
      loginTriggerTexts: lista(linha.login_trigger_texts),
      extraPopups,
      posLogin
    };
  }

  function sessaoDe(chave) {
    const s = CASINOS[chave]?.sessao;
    return { com: s?.com || [], sem: s?.sem || [] };
  }

  // 'dd/mm/aaaa' ou null. O mysql2 dá o DATE como meia-noite local e o JSON leva-o em UTC: com hora, contam os componentes locais.
  function dataParaCampo(valor) {
    let ano, mes, dia;
    const eData = Object.prototype.toString.call(valor) === '[object Date]';
    if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor)) {
      [ano, mes, dia] = valor.split('-').map(Number);
    } else if (eData || (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?$/.test(valor))) {
      const d = new Date(valor);
      if (Number.isNaN(d.getTime())) return null;
      [ano, mes, dia] = [d.getFullYear(), d.getMonth() + 1, d.getDate()];
    } else {
      return null;
    }
    const real = new Date(ano, mes - 1, dia);
    if (real.getFullYear() !== ano || real.getMonth() !== mes - 1 || real.getDate() !== dia) return null;
    const dois = (n) => String(n).padStart(2, '0');
    return `${dois(dia)}/${dois(mes)}/${ano}`;
  }

  function seletoresErroDe(chave) {
    return [...(CASINOS[chave]?.erros || []), ...SELETORES_ERRO_GENERICOS];
  }

  const normalizar = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
  const digitos = (t) => String(t || '').replace(/\D/g, '').slice(-9);

  /**
   * A conta do casino a que pertencem os dados pessoais lidos no site: email igual ao username, ou nome e apelido.
   * Com vários do mesmo nome devolve-os em candidatas, para desempatar pelo telemóvel do perfil.
   */
  function contaPelosDados(contas, dados, chave) {
    const doCasino = (contas || []).filter(c => contaPertenceAoCasino(c, chave));
    const email = normalizar(dados?.email);
    const porEmail = email && doCasino.filter(c => normalizar(c.account_username) === email);
    if (porEmail?.length === 1) return { conta: porEmail[0], candidatas: porEmail };
    const nome = normalizar(dados?.nome).split(' ')[0];
    const apelidos = normalizar(dados?.apelido).split(' ').filter(Boolean);
    if (!nome || !apelidos.length) return { conta: null, candidatas: [] };
    const candidatas = doCasino.filter(c => {
      const partes = normalizar(c.full_name).split(' ');
      return partes[0] === nome && partes.at(-1) === apelidos.at(-1) && apelidos.every(a => partes.includes(a));
    });
    return { conta: candidatas.length === 1 ? candidatas[0] : null, candidatas };
  }

  const mesmoTelefone = (a, b) => digitos(a).length === 9 && digitos(a) === digitos(b);

  function shortName(nome) {
    if (!nome) return '';
    const partes = nome.trim().split(/\s+/);
    if (partes.length <= 2) return nome.trim();
    return `${partes[0]} ${partes[partes.length - 1]}`;
  }

  const BCI_CASINOS = {
    CASINOS, SELETORES_GENERICOS, LOGOUT_GENERICO, TEXTOS_GATILHO_LOGIN, TEXTOS_BOTAO_ENTRAR, SELETORES_BOTAO_ENTRAR,
    TEXTOS_SESSAO_INICIADA, SELETORES_MENU_CONTA, TEXTOS_MENU_CONTA,
    casinoDoUrl, contaPertenceAoCasino, seletoresDe, seletoresErroDe, fluxoEfetivo, sessaoDe, dataParaCampo, shortName, contaPelosDados, mesmoTelefone
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = BCI_CASINOS;
  else globalThis.BCI_CASINOS = BCI_CASINOS;
})();
