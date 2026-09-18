'use strict';

/** Testes da superfície IPC; a verificação está em ferramentas/testes/ipcElectron.js. */

const { test } = require('node:test');
const path = require('node:path');
const { registarTestes } = require('../../ferramentas/testes/ipcElectron');

registarTestes(test, 'Admin App', path.join(__dirname, '..'));
