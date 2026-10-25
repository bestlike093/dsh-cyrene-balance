const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('pet', {
  report: (payload) => ipcRenderer.invoke('pet:status', payload),
  bounds: () => ipcRenderer.invoke('pet:bounds'),
  windowState: () => ipcRenderer.invoke('pet:window-state'),
  setZoom: (value) => ipcRenderer.invoke('pet:set-zoom', value),
  setInteractive: (value) => ipcRenderer.invoke('pet:set-interactive', value),
  setExtraHeight: (value) => ipcRenderer.invoke('pet:extra-height', value),
  dragStart: () => ipcRenderer.invoke('pet:drag-start'),
  dragEnd: () => ipcRenderer.invoke('pet:drag-end'),
  command: (payload) => ipcRenderer.invoke('pet:command', payload),
  hide: () => ipcRenderer.invoke('pet:hide'),
  quit: () => ipcRenderer.invoke('pet:quit'),
  onLive: (callback) => {
    ipcRenderer.on('pet:live', (_event, data) => callback(data))
  },
  onZoom: (callback) => {
    ipcRenderer.on('pet:zoom', (_event, value) => callback(value))
  },
  onCursor: (callback) => {
    ipcRenderer.on('pet:cursor', (_event, point) => callback(point))
  },
})
