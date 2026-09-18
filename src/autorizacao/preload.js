'use strict';

/** Preload da janela de autorização: só lê o pedido e responde. Não expõe o armazenamento com o token. */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bciAutorizacao', {
  estado: () => ipcRenderer.invoke('autorizacao:estado'),
  responder: (sim) => ipcRenderer.send('autorizacao:responder', sim === true)
});
