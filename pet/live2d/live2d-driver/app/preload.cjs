'use strict'
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('l2dPet', {
  ready: () => ipcRenderer.send('pet:ready'),
  fatal: (message) => ipcRenderer.send('pet:fatal', String(message)),
  catalog: (json) => ipcRenderer.send('l2d:catalog', json),
  state: (json) => ipcRenderer.send('l2d:state', json),
  result: (id, result) => ipcRenderer.send('l2d:result', id, result),
  onCommand: (callback) => ipcRenderer.on('l2d:command', (_event, id, payload) => callback(id, payload)),
  dragStart: (point) => ipcRenderer.send('pet:drag-start', point),
  dragMove: (point) => ipcRenderer.send('pet:drag-move', point),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  onDragSettled: (callback) => ipcRenderer.on('pet:drag-settled', () => callback()),
  touch: (payload) => ipcRenderer.invoke('pet:touch', payload),
  say: (text) => ipcRenderer.invoke('pet:say', { text }),
})
