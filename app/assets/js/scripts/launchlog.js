/**
 * Launch log: while a launch is running, forwards the captured console output (launcher steps and the
 * game's own stdout/stderr) to the launch log window that the main process opens.
 * Exposed as window.NLLaunchLog. Needs errorlog.js to be loaded first.
 */
(function(){
    const { ipcRenderer } = require('electron')

    const FLUSH_MS = 80
    let unsubscribe = null
    let pending = []
    let timer = null

    function flush(){
        timer = null
        if(pending.length === 0) return
        const lines = pending
        pending = []
        ipcRenderer.send('launchlog-lines', lines)
    }

    function onLine(line){
        pending.push(line)
        if(timer == null) timer = setTimeout(flush, FLUSH_MS)
    }

    function start(){
        if(!window.NLErrorLog || typeof window.NLErrorLog.subscribe !== 'function') return
        if(unsubscribe) unsubscribe()
        pending = []
        ipcRenderer.send('launchlog-open')
        unsubscribe = window.NLErrorLog.subscribe(onLine)
    }

    window.NLLaunchLog = { start: start }
})()
