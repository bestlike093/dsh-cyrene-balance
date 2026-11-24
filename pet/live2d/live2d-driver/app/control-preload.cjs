'use strict'
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('l2dControl', {
  info: () => ipcRenderer.invoke('ctl:info'),
  catalog: () => ipcRenderer.invoke('ctl:catalog'),
  pickModel: () => ipcRenderer.invoke('ctl:pick-model'),
  applyModel: (dir) => ipcRenderer.invoke('ctl:apply-model', dir),
  command: (payload) => ipcRenderer.invoke('ctl:command', payload),
  resize: (width, height) => ipcRenderer.invoke('ctl:resize', width, height),
  topmost: (on) => ipcRenderer.invoke('ctl:topmost', on),
  petVisible: (on) => ipcRenderer.invoke('ctl:pet-visible', on),
  openDoc: () => ipcRenderer.invoke('ctl:open-doc'),
  tellCapability: () => ipcRenderer.invoke('ctl:tell-capability'),
  sendPersona: () => ipcRenderer.invoke('ctl:send-persona'),
  quit: () => ipcRenderer.invoke('ctl:quit'),
})
