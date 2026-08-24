/**
 * Error log capture + report builder.
 * Loaded first so it can hook console before other scripts log.
 * Exposed as window.NLErrorLog (contextIsolation is disabled in this app).
 */
(function(){
    const MAX_LINES = 500
    const buffer = []
    let lastError = null

    function ts(){
        return new Date().toISOString()
    }

    function push(line){
        buffer.push(line)
        if(buffer.length > MAX_LINES){
            buffer.splice(0, buffer.length - MAX_LINES)
        }
    }

    function stringifyArg(a){
        if(typeof a === 'string') return a
        if(a instanceof Error) return (a.stack || (a.name + ': ' + a.message))
        try { return JSON.stringify(a) } catch(e) { return String(a) }
    }

    // Hook console methods so winston (which prints via console) is captured.
    const methods = ['log', 'info', 'warn', 'error', 'debug']
    methods.forEach(function(m){
        const original = console[m] ? console[m].bind(console) : function(){}
        console[m] = function(){
            try {
                const parts = Array.prototype.slice.call(arguments).map(stringifyArg)
                push('[' + ts() + '] [' + m.toUpperCase() + '] ' + parts.join(' '))
            } catch(e) { /* never let logging break the app */ }
            return original.apply(console, arguments)
        }
    })

    function setLastError(info){
        lastError = {
            time: ts(),
            title: (info && info.title) || '',
            desc: (info && info.desc) || '',
            err: (info && info.err) || null,
            context: (info && info.context) || {}
        }
    }

    function buildReport(){
        const e = lastError || { time: ts(), title: '(エラー情報なし)', desc: '', err: null, context: {} }
        const lines = []
        lines.push('==== 沼ぽてランチャー エラーレポート ====')
        lines.push('生成時刻: ' + e.time)
        Object.keys(e.context).forEach(function(k){
            lines.push(k + ': ' + e.context[k])
        })
        lines.push('')
        lines.push('---- エラー概要 ----')
        lines.push(e.title || '(タイトルなし)')
        if(e.desc) lines.push(e.desc)
        lines.push('')
        lines.push('---- エラー詳細 ----')
        if(e.err){
            lines.push('name: ' + (e.err.name || ''))
            lines.push('message: ' + (e.err.message || ''))
            if(e.err.displayable) lines.push('displayable: ' + e.err.displayable)
            lines.push('stack:')
            lines.push(e.err.stack || '(スタックなし)')
        } else {
            lines.push('(エラーオブジェクトなし)')
        }
        lines.push('')
        lines.push('---- 直近ログ ----')
        if(buffer.length === 0){
            lines.push('(ログなし)')
        } else {
            buffer.forEach(function(l){ lines.push(l) })
        }
        return lines.join('\n')
    }

    window.NLErrorLog = {
        pushLine: push,
        setLastError: setLastError,
        getLastError: function(){ return lastError },
        buildReport: buildReport,
        getBuffer: function(){ return buffer.slice() }
    }
})()
