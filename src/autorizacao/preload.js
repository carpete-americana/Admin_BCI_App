'use strict';

/**
 * O preload da janela de autorização. Dá à página DUAS coisas e mais nenhuma:
 * ler o pedido que tem de mostrar, e responder sim ou não.
 *
 * Não é o preload da janela principal, de propósito: esse expõe o
 * armazenamento, onde vive o token de admin. Esta janela não precisa de o ver,
 * e não o vê.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bciAutorizacao', {
  estado: () => ipcRenderer.invoke('autorizacao:estado'),
  responder: (sim) => ipcRenderer.send('autorizacao:responder', sim === true)
});
