/**
 * Launch log: the log of one launch of a launch config. It holds what the user asks for with
 * "起動ログを表示する": the launch steps, the Java command, and the game process's own stdout/stderr.
 * It is NOT the launcher's console output. Lines are sent to the log window the main process opens.
 * Exposed as window.NLLaunchLog; every call is a harmless no-op while no launch log is active.
 */
(function(){
    const { ipcRenderer } = require('electron')

    const FLUSH_MS = 80
    // eslint-disable-next-line no-control-regex
    const ANSI_RE = /\u001b\[[0-9;]*m/g
    let active = false
    let pending = []
    let timer = null

    function flush(){
        timer = null
        if(pending.length === 0) return
        const lines = pending
        pending = []
        ipcRenderer.send('launchlog-lines', lines)
    }

    function line(text){
        if(!active) return
        const t = String(text == null ? '' : text).replace(ANSI_RE, '').replace(/\s+$/, '')
        if(t === '') return
        pending.push(t)
        if(timer == null) timer = setTimeout(flush, FLUSH_MS)
    }

    function start(){
        pending = []
        active = true
        ipcRenderer.send('launchlog-open')
    }

    function stop(){
        active = false
        pending = []
    }

    // Follow a spawned game process: its stdout/stderr (split into whole lines) and its exit.
    function attach(proc){
        if(!active || !proc) return
        const hook = function(stream, prefix){
            if(!stream) return
            let rest = ''
            stream.on('data', function(data){
                const parts = (rest + String(data)).split(/\r?\n/)
                rest = parts.pop()
                parts.forEach(function(p){ line(prefix + p) })
            })
            stream.on('end', function(){
                if(rest){ line(prefix + rest); rest = '' }
            })
        }
        hook(proc.stdout, '')
        hook(proc.stderr, '[stderr] ')
        proc.on('close', function(code, signal){
            line('ゲームが終了しました（終了コード: ' + (code == null ? signal : code) + '）')
        })
    }

    window.NLLaunchLog = { start: start, stop: stop, line: line, attach: attach }
})()
