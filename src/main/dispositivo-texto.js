'use strict';

// Sobe quando o texto muda: o servidor guarda a versão aceite e pede de novo se for outra.
const VERSAO_TEXTO = 2;

const TITULO = 'Operações automáticas neste computador';

// Rascunho para aprovação do André antes de se publicar. Igual ao da User App: a versão tem de coincidir.
const TEXTO_CONSENTIMENTO = [
  'Ao aceitar, o BCI pode usar este computador, em segundo plano e sem janelas, enquanto a aplicação estiver aberta, para fazer login e operar contas de casino (depósitos e levantamentos) de outros clientes e do próprio BCI.',
  '',
  '• As credenciais chegam só ao processo da aplicação, nunca são mostradas, e tu não vês nem escolhes as contas.',
  '• A aplicação regista quando este computador está ligado, a versão do sistema e da aplicação, e um identificador cifrado do computador (para não lhe dar mais trabalho do que o combinado).',
  '• Podes ligar ou desligar o arranque com o Windows e revogar isto a qualquer momento, em Definições.',
  '',
  'Só deves aceitar se concordares.'
].join('\n');

const BOTOES = ['Aceito', 'Cancelar'];

// Aviso ao abrir a app, uma vez por versão do texto; «Ver o pedido» abre o diálogo acima.
const AVISO = {
  titulo: 'Operações automáticas',
  mensagem: 'O BCI pode usar este computador para operações automáticas',
  detalhe: 'Só acontece se aceitares. Vês o pedido completo antes de decidir, e podes mudar de ideias em Definições a qualquer momento.',
  botoes: ['Ver o pedido', 'Agora não']
};

module.exports = { VERSAO_TEXTO, TITULO, TEXTO_CONSENTIMENTO, BOTOES, AVISO };
