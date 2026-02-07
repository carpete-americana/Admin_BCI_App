# BCi Admin App

Aplicação desktop de administração para o sistema BCi, desenvolvida com Electron.

## Requisitos

- Node.js 18+
- npm 9+

## Instalação

```bash
npm install
```

## Desenvolvimento

```bash
npm start
```

## Build

### Windows

```bash
npm run build:win
```

### macOS

```bash
npm run build:mac
```

### Linux

```bash
npm run build:linux
```

## Estrutura do Projeto

```
Admin App/
├── src/
│   ├── main/           # Processo principal do Electron
│   │   ├── index.js    # Entry point
│   │   ├── config.js   # Configurações
│   │   ├── cache.js    # Sistema de cache
│   │   ├── window.js   # Gestão de janelas
│   │   ├── security.js # CSP e segurança
│   │   ├── tray.js     # System tray
│   │   ├── updater.js  # Auto-atualizações
│   │   └── ...
│   ├── preload/        # Scripts de preload (context bridge)
│   └── renderer/       # Interface do utilizador
├── public/             # Ficheiros HTML estáticos
├── js/                 # Módulos JavaScript partilhados
├── assets/             # Recursos (ícones, imagens)
├── build/              # Ficheiros de build (ícones)
└── icons/              # Ícones da aplicação
```

## Funcionalidades Admin

- **Painel de Controlo** - Visão geral do sistema
- **Gestão de Utilizadores** - Criar, editar, remover utilizadores
- **Gestão de Casinos** - Administrar casinos e contas
- **Transações** - Histórico e gestão de transações
- **Relatórios** - Análises e exportações
- **Configurações** - Definições do sistema

## Segurança

- Encriptação AES-256-GCM com IV aleatório por operação
- Context Isolation ativado
- Node Integration desativado
- Content Security Policy configurado
- Auto-atualizações via GitHub Releases

## Licença

Proprietary - BCi Business Solutions
