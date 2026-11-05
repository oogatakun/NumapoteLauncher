// Preload for the launch log window (sandboxed, context isolated): the page only gets these calls.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('launchLog', {
    getBacklog: () => ipcRenderer.invoke('launchlog-get'),
    onInit: (fn) => ipcRenderer.on('launchlog-init', (event, lines) => fn(lines)),
    onAppend: (fn) => ipcRenderer.on('launchlog-append', (event, lines) => fn(lines)),
    copy: () => ipcRenderer.invoke('launchlog-copy'),
    save: () => ipcRenderer.invoke('launchlog-save')
})
