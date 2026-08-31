'use strict';

/**
 * A superfície que esta app abre ao renderer.
 *
 * A verificação em si vive em ferramentas/testes/, partilhada com os outros
 * componentes que têm a mesma regra. Aqui só se diz QUE pastas verificar — a
 * regra é uma só, e é isso que impede as cópias de divergirem.
 *
 * Antes, isto corria a partir da suite da API: um ficheiro deste componente
 * fazia a API falhar. Funcionava, mas punha o alarme no sítio errado.
 */

const { test } = require('node:test');
const path = require('node:path');
const { registarTestes } = require('../../ferramentas/testes/ipcElectron');

registarTestes(test, 'Admin App', path.join(__dirname, '..'));
