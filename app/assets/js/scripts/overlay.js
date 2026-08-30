/**
 * Script for overlay.ejs
 */

const _ipc = require('electron').ipcRenderer

/* Overlay Wrapper Functions */

/**
 * Check to see if the overlay is visible.
 *
 * @returns {boolean} Whether or not the overlay is visible.
 */
function isOverlayVisible(){
    return document.getElementById('main').hasAttribute('overlay')
}

let overlayHandlerContent

/**
 * Overlay keydown handler for a non-dismissable overlay.
 *
 * @param {KeyboardEvent} e The keydown event.
 */
function overlayKeyHandler (e){
    if(e.key === 'Enter' || e.key === 'Escape'){
        document.getElementById(overlayHandlerContent).getElementsByClassName('overlayKeybindEnter')[0].click()
    }
}
/**
 * Overlay keydown handler for a dismissable overlay.
 *
 * @param {KeyboardEvent} e The keydown event.
 */
function overlayKeyDismissableHandler (e){
    if(e.key === 'Enter'){
        document.getElementById(overlayHandlerContent).getElementsByClassName('overlayKeybindEnter')[0].click()
    } else if(e.key === 'Escape'){
        document.getElementById(overlayHandlerContent).getElementsByClassName('overlayKeybindEsc')[0].click()
    }
}

/**
 * Bind overlay keydown listeners for escape and exit.
 *
 * @param {boolean} state Whether or not to add new event listeners.
 * @param {string} content The overlay content which will be shown.
 * @param {boolean} dismissable Whether or not the overlay is dismissable
 */
function bindOverlayKeys(state, content, dismissable){
    overlayHandlerContent = content
    document.removeEventListener('keydown', overlayKeyHandler)
    document.removeEventListener('keydown', overlayKeyDismissableHandler)
    if(state){
        if(dismissable){
            document.addEventListener('keydown', overlayKeyDismissableHandler)
        } else {
            document.addEventListener('keydown', overlayKeyHandler)
        }
    }
}

/**
 * Toggle the visibility of the overlay.
 *
 * @param {boolean} toggleState True to display, false to hide.
 * @param {boolean} dismissable Optional. True to show the dismiss option, otherwise false.
 * @param {string} content Optional. The content div to be shown.
 */
function toggleOverlay(toggleState, dismissable = false, content = 'overlayContent'){
    if(toggleState == null){
        toggleState = !document.getElementById('main').hasAttribute('overlay')
    }
    if(typeof dismissable === 'string'){
        content = dismissable
        dismissable = false
    }
    bindOverlayKeys(toggleState, content, dismissable)
    if(toggleState){
        document.getElementById('main').setAttribute('overlay', true)
        // Make things untabbable.
        $('#main *').attr('tabindex', '-1')
        $('#' + content).parent().children().hide()
        $('#' + content).show()
        if(dismissable){
            $('#overlayDismiss').show()
        } else {
            $('#overlayDismiss').hide()
        }
        $('#overlayContainer').fadeIn({
            duration: 250,
            start: () => {
                if(getCurrentView() === VIEWS.settings){
                    document.getElementById('settingsContainer').style.backgroundColor = 'transparent'
                }
            }
        })
    } else {
        document.getElementById('main').removeAttribute('overlay')
        // Make things tabbable.
        $('#main *').removeAttr('tabindex')
        $('#overlayContainer').fadeOut({
            duration: 250,
            start: () => {
                if(getCurrentView() === VIEWS.settings){
                    document.getElementById('settingsContainer').style.backgroundColor = 'rgba(0, 0, 0, 0.50)'
                }
            },
            complete: () => {
                $('#' + content).parent().children().hide()
                $('#' + content).show()
                if(dismissable){
                    $('#overlayDismiss').show()
                } else {
                    $('#overlayDismiss').hide()
                }
            }
        })
    }
}

async function toggleServerSelection(toggleState){
    await prepareServerSelectionList()
    toggleOverlay(toggleState, true, 'serverSelectContent')
}

/**
 * Set the content of the overlay.
 *
 * @param {string} title Overlay title text.
 * @param {string} description Overlay description text.
 * @param {string} acknowledge Acknowledge button text.
 * @param {string} dismiss Dismiss button text.
 */
function setOverlayContent(title, description, acknowledge, dismiss = Lang.queryJS('overlay.dismiss')){
    document.getElementById('overlayTitle').innerHTML = title
    document.getElementById('overlayDesc').innerHTML = description
    document.getElementById('overlayAcknowledge').innerHTML = acknowledge
    document.getElementById('overlayDismiss').innerHTML = dismiss
    // Reset the error-log export button; only showLaunchFailure re-enables it.
    setLogExportVisible(false)
}

/**
 * Show or hide the error-log export button (only meaningful on error overlays).
 * @param {boolean} visible
 */
function setLogExportVisible(visible){
    const btn = document.getElementById('overlayLogExport')
    if(btn) btn.style.display = visible ? '' : 'none'
}

function _nlErrorLogTimestamp(){
    const d = new Date()
    const p = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

(function bindLogExport(){
    const btn = document.getElementById('overlayLogExport')
    if(!btn) return
    btn.addEventListener('click', async () => {
        let content = ''
        try {
            content = (window.NLErrorLog && typeof window.NLErrorLog.buildReport === 'function')
                ? window.NLErrorLog.buildReport()
                : '(ログモジュールが利用できません)'
        } catch(e) {
            content = '(レポート生成に失敗しました: ' + (e && e.message) + ')'
        }
        const fileName = `numapote-error-${_nlErrorLogTimestamp()}.log`
        try {
            const res = await _ipc.invoke('save-error-log', content, fileName)
            if(res && res.success){
                setOverlayContent('保存しました', 'エラーログを保存しました:<br>' + res.path, 'フォルダを開く', 'OK')
                setOverlayHandler(() => { _ipc.invoke('show-item-in-folder', res.path); toggleOverlay(false) })
                setDismissHandler(null)
                toggleOverlay(true, true)
            } else if(res && res.canceled){
                // 何もしない（保存キャンセル）
            } else {
                setOverlayContent('保存に失敗しました', (res && res.error) ? res.error : '不明なエラーです。', 'OK')
                setOverlayHandler(null)
                toggleOverlay(true)
            }
        } catch(err) {
            setOverlayContent('保存に失敗しました', err.message || '不明なエラーです。', 'OK')
            setOverlayHandler(null)
            toggleOverlay(true)
        }
    })
})()

/**
 * Set the onclick handler of the overlay acknowledge button.
 * If the handler is null, a default handler will be added.
 *
 * @param {function} handler
 */
function setOverlayHandler(handler){
    if(handler == null){
        document.getElementById('overlayAcknowledge').onclick = () => {
            toggleOverlay(false)
        }
    } else {
        document.getElementById('overlayAcknowledge').onclick = handler
    }
}

/**
 * Set the onclick handler of the overlay dismiss button.
 * If the handler is null, a default handler will be added.
 *
 * @param {function} handler
 */
function setDismissHandler(handler){
    if(handler == null){
        document.getElementById('overlayDismiss').onclick = () => {
            toggleOverlay(false)
        }
    } else {
        document.getElementById('overlayDismiss').onclick = handler
    }
}

/* Server Select View */

document.getElementById('serverSelectConfirm').addEventListener('click', async () => {
    const listings = document.getElementsByClassName('serverListing')
    document.getElementById('filterInput').value = ''
    for(let i=0; i<listings.length; i++){
        if(listings[i].hasAttribute('selected')){
            const serv = (await DistroAPI.getDistribution()).getServerById(listings[i].getAttribute('servid'))
            updateSelectedServer(serv)
            // refreshServerStatus(true)
            toggleOverlay(false)
            return
        }
    }
    // None are selected? Not possible right? Meh, handle it.
    if(listings.length > 0){
        const serv = (await DistroAPI.getDistribution()).getServerById(listings[0].getAttribute('servid'))
        updateSelectedServer(serv)
        toggleOverlay(false)
    }
})

document.getElementById('accountSelectConfirm').addEventListener('click', async () => {
    const listings = document.getElementsByClassName('accountListing')
    for(let i=0; i<listings.length; i++){
        if(listings[i].hasAttribute('selected')){
            const authAcc = ConfigManager.setSelectedAccount(listings[i].getAttribute('uuid'))
            ConfigManager.save()
            updateSelectedAccount(authAcc)
            if(getCurrentView() === VIEWS.settings) {
                await prepareSettings()
            }
            toggleOverlay(false)
            validateSelectedAccount()
            return
        }
    }
    // None are selected? Not possible right? Meh, handle it.
    if(listings.length > 0){
        const authAcc = ConfigManager.setSelectedAccount(listings[0].getAttribute('uuid'))
        ConfigManager.save()
        updateSelectedAccount(authAcc)
        if(getCurrentView() === VIEWS.settings) {
            await prepareSettings()
        }
        toggleOverlay(false)
        validateSelectedAccount()
    }
})

// Bind server select cancel button.
document.getElementById('serverSelectCancel').addEventListener('click', () => {
    document.getElementById('filterInput').value = ''
    toggleOverlay(false)
})

document.getElementById('accountSelectCancel').addEventListener('click', () => {
    $('#accountSelectContent').fadeOut(250, () => {
        $('#overlayContent').fadeIn(250)
    })
})

document.getElementById('filterInput').addEventListener('input', async (e) => {
    let value = kanaToHira(document.getElementById('filterInput').value.toLowerCase())
    const distro = await DistroAPI.getDistribution()
    const servers = distro.servers

    let searchedList = []

    servers.forEach((server) => {
        let serverName = kanaToHira(removeOrderNumber(server.rawServer.name).toLowerCase())
        if (serverName.indexOf(value) >= 0) {
            searchedList.push(server)
        }
    })
    createServerHtml(searchedList)
    setServerListingHandlers()
})

/**
 * カタカナをひらがなに変換
 * */
function kanaToHira(str) {
    return str.replace(/[\u30a1-\u30f6]/g, function(match) {
        let chr = match.charCodeAt(0) - 0x60
        return String.fromCharCode(chr)
    })
}

function setServerListingHandlers(){
    const listings = Array.from(document.getElementsByClassName('serverListing'))
    listings.map((val) => {
        val.onclick = e => {
            if(val.hasAttribute('selected')){
                return
            }
            const cListings = document.getElementsByClassName('serverListing')
            for(let i=0; i<cListings.length; i++){
                if(cListings[i].hasAttribute('selected')){
                    cListings[i].removeAttribute('selected')
                }
            }
            val.setAttribute('selected', '')
            document.activeElement.blur()
        }
    })
}

function setAccountListingHandlers(){
    const listings = Array.from(document.getElementsByClassName('accountListing'))
    listings.map((val) => {
        val.onclick = e => {
            if(val.hasAttribute('selected')){
                return
            }
            const cListings = document.getElementsByClassName('accountListing')
            for(let i=0; i<cListings.length; i++){
                if(cListings[i].hasAttribute('selected')){
                    cListings[i].removeAttribute('selected')
                }
            }
            val.setAttribute('selected', '')
            document.activeElement.blur()
        }
    })
}

async function populateServerListings(){
    const distro = await DistroAPI.getDistribution()
    const servers = distro.servers
    createServerHtml(servers)
}

let activeServerTab = 'official'

function setServerTab(tab){
    activeServerTab = tab
    const off = document.getElementById('serverTabOfficial')
    const cus = document.getElementById('serverTabCustom')
    const officialList = document.getElementById('serverSelectListScrollable')
    const customList = document.getElementById('customInstanceList')
    const filter = document.getElementById('filterControls')
    if(tab === 'custom'){
        if(cus) cus.setAttribute('selected', '')
        if(off) off.removeAttribute('selected')
        if(officialList) officialList.style.display = 'none'
        if(customList) customList.style.display = ''
        if(filter) filter.style.display = 'none'
        populateCustomInstanceListings()
    } else {
        if(off) off.setAttribute('selected', '')
        if(cus) cus.removeAttribute('selected')
        if(officialList) officialList.style.display = ''
        if(customList) customList.style.display = 'none'
        if(filter) filter.style.display = ''
    }
}

function populateCustomInstanceListings(){
    const el = document.getElementById('customInstanceListScrollable')
    if(!el) return
    const instances = ConfigManager.getCustomInstances()
    const selected = ConfigManager.getSelectedServer()
    if(instances.length === 0){
        el.innerHTML = '<div style="width:100%;text-align:center;opacity:0.7">まだ自作パックがありません</div>'
        return
    }
    let html = ''
    for(const ins of instances){
        const loaderLabel = ins.loader === 'vanilla' ? 'バニラ' : `${ins.loader} ${ins.loaderVersion}`
        const nameEsc = (ins.name || '無題の構成').replace(/</g, '&lt;')
        html += `<div class="customInstanceListing" cid="${ins.id}" ${ins.id === selected ? 'selected' : ''}>
            <div>
                <div class="customInstanceName">${nameEsc}</div>
                <div class="customInstanceMeta">${ins.minecraftVersion} / ${loaderLabel}</div>
            </div>
            <div class="customInstanceActions">
                <button class="customOpenFolder" cid="${ins.id}" type="button">フォルダ</button>
                <button class="customDelete" cid="${ins.id}" type="button">削除</button>
            </div>
        </div>`
    }
    el.innerHTML = html
    setCustomInstanceHandlers()
}

function setCustomInstanceHandlers(){
    // Select an instance (click on the row, not on action buttons).
    Array.from(document.getElementsByClassName('customInstanceListing')).forEach(row => {
        row.onclick = (e) => {
            if(e.target.closest('.customInstanceActions')) return
            const cid = row.getAttribute('cid')
            ConfigManager.setSelectedServer(cid)
            ConfigManager.save()
            const cur = document.querySelector('.customInstanceListing[selected]')
            if(cur) cur.removeAttribute('selected')
            row.setAttribute('selected', '')
            if(typeof setLaunchEnabled === 'function'){ setLaunchEnabled(true) }
            const btn = document.getElementById('server_selection_button')
            const ins = ConfigManager.getCustomInstance(cid)
            if(btn && ins) btn.innerHTML = '&#8226; ' + (ins.name || '無題の構成')
            toggleOverlay(false)
        }
    })
    // Open folder
    Array.from(document.getElementsByClassName('customOpenFolder')).forEach(b => {
        b.onclick = async (e) => {
            e.stopPropagation()
            const cid = b.getAttribute('cid')
            const dir = require('path').join(ConfigManager.getInstanceDirectory(), cid)
            try { require('fs-extra').ensureDirSync(dir) } catch(err) { /* ignore */ }
            const res = await _ipc.invoke('open-folder', dir)
            if(res && !res.success){
                setOverlayContent('フォルダを開けません', (res && res.error) ? res.error : '不明なエラーです。', 'OK')
                setOverlayHandler(null)
                toggleOverlay(true)
            }
        }
    })
    // Delete
    Array.from(document.getElementsByClassName('customDelete')).forEach(b => {
        b.onclick = (e) => {
            e.stopPropagation()
            const cid = b.getAttribute('cid')
            const ins = ConfigManager.getCustomInstance(cid)
            setOverlayContent('削除しますか？', `「${(ins && ins.name) || '無題の構成'}」を一覧から削除します。`, '削除する', 'キャンセル')
            setOverlayHandler(() => {
                ConfigManager.removeCustomInstance(cid)
                if(ConfigManager.getSelectedServer() === cid){
                    ConfigManager.setSelectedServer(null)
                }
                ConfigManager.save()
                toggleServerSelection(true).then(() => setServerTab('custom'))
            })
            setDismissHandler(null)
            toggleOverlay(true, true)
        }
    })
}

async function openCustomInstanceCreate(){
    // Reset fields
    const nameEl = document.getElementById('customCreateName')
    const mcEl = document.getElementById('customCreateMcVersion')
    const loaderEl = document.getElementById('customCreateLoader')
    if(nameEl) nameEl.value = ''
    if(loaderEl) loaderEl.value = 'vanilla'
    if(mcEl) mcEl.innerHTML = '<option value="">読み込み中...</option>'
    toggleOverlay(true, 'customCreateContent')
    // Load versions
    try {
        const versions = await window.NLCustomVersions.fetchReleaseVersions()
        if(mcEl){
            mcEl.innerHTML = versions.map(v => `<option value="${v.id}">${v.id}</option>`).join('')
        }
    } catch(err){
        if(mcEl) mcEl.innerHTML = '<option value="">取得失敗</option>'
        setOverlayContent('エラー', 'バージョン一覧の取得に失敗しました。ネットワークを確認してください。', 'OK')
        setOverlayHandler(null)
        toggleOverlay(true)
    }
}

function _genInstanceId(){
    return 'custom-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
}

document.getElementById('customCreateConfirm').addEventListener('click', () => {
    const name = (document.getElementById('customCreateName').value || '').trim() || '無題の構成'
    const mc = document.getElementById('customCreateMcVersion').value
    const loader = document.getElementById('customCreateLoader').value || 'vanilla'
    if(!mc){
        setOverlayContent('未選択', 'Minecraftバージョンを選んでください。', 'OK')
        setOverlayHandler(null)
        toggleOverlay(true)
        return
    }
    const instance = {
        schema: 1,
        id: _genInstanceId(),
        name,
        minecraftVersion: mc,
        loader,               // M1 は 'vanilla' のみ
        loaderVersion: '',
        created: Date.now(),
        lastPlayed: null
    }
    ConfigManager.addCustomInstance(instance)
    ConfigManager.save()
    // 戻って自作タブを表示
    toggleServerSelection(true).then(() => setServerTab('custom'))
})

document.getElementById('customCreateCancel').addEventListener('click', () => {
    toggleServerSelection(true).then(() => setServerTab('custom'))
})

function createServerHtml(servers) {
    // ソート
    let sortedServers = sortServers(servers)
    const giaSel = ConfigManager.getSelectedServer()
    let htmlString = ''

    if (sortedServers.length < 1) {
        htmlString += '<div style="width:375px;text-align:center">該当パックなし</div>'
    } else {
        for(const serv of sortedServers){
            const serverName = removeOrderNumber(serv.rawServer.name)
            htmlString += `<button class="serverListing" servid="${serv.rawServer.id}" ${serv.rawServer.id === giaSel ? 'selected' : ''}>
                ${generateIcon(serv.rawServer.icon, serverName)}
                <div class="serverListingDetails">
                    <span class="serverListingName">${removeOrderNumber(serverName)}</span>
                </div>
            </button>`
        }
    }

    document.getElementById('serverSelectListScrollable').innerHTML = htmlString
}

/**
 * サーバー情報をもとにアイコンのHTMLタグを生成する
 * */
function generateIcon(iconPath, packName) {
    let colorNumber = String(packName.length).slice(-1)
    let colorClass = `iconColor${colorNumber}`
    if (iconPath) {
        return `<img class="serverListingImg" src="${iconPath}"/>`
    } else {
        let iconChar = packName.charAt(0)
        return `<div class="altIconContainer">
            <div class="altIcon ${colorClass}">
                <div class="altIconChar">
                        ${iconChar}
                </div>
            </div>
        </div>`
    }
}

/**
 * サーバー情報をソートする
 * */
function sortServers(servers) {
    let sortableList = []
    let notSotableList = []

    servers.forEach((server) => {
        let orderReg = /^%\d*%/

        if (!orderReg.test(server.rawServer.name)) {
            notSotableList.push(server)
        } else {
            sortableList.push(server)
        }
    })

    sortableList.sort((a, b) => {
        let orderA = getOrder(a.rawServer.name)
        let orderB = getOrder(b.rawServer.name)

        if (orderA < orderB) {
            return -1
        }
        return 1
    })

    return sortableList.concat(notSotableList)
}

/**
 * サーバー名からオーダー番号を取得する
 * */
function getOrder(serverName) {
    let order = serverName.split('%')[1]

    if (isNaN(order)) {
        return null
    }

    return parseInt(order)
}

function populateAccountListings(){
    const accountsObj = ConfigManager.getAuthAccounts()
    const accounts = Array.from(Object.keys(accountsObj), v=>accountsObj[v])
    let htmlString = ''
    for(let i=0; i<accounts.length; i++){
        htmlString += `<button class="accountListing" uuid="${accounts[i].uuid}" ${i===0 ? 'selected' : ''}>
            <img src="https://mc-heads.net/head/${accounts[i].uuid}/40">
            <div class="accountListingName">${accounts[i].displayName}</div>
        </button>`
    }
    document.getElementById('accountSelectListScrollable').innerHTML = htmlString

}

async function prepareServerSelectionList(){
    await populateServerListings()
    setServerListingHandlers()
}

/**
 * Apply the server list layout (single or two column).
 * @param {string} layout 'single' or 'two'
 */
function applyServerLayout(layout){
    const el = document.getElementById('serverSelectListScrollable')
    const toggle = document.getElementById('serverLayoutToggle')
    if(!el || !toggle) return
    if(layout === 'single'){
        el.classList.add('single-column')
        toggle.innerText = '1列'
    } else {
        el.classList.remove('single-column')
        toggle.innerText = '2列'
    }
}

function initServerLayout(){
    const toggle = document.getElementById('serverLayoutToggle')
    const el = document.getElementById('serverSelectListScrollable')
    if(!toggle || !el) return
    const stored = localStorage.getItem('serverListLayout') || 'two'
    applyServerLayout(stored === 'single' ? 'single' : 'two')
    toggle.addEventListener('click', () => {
        const cur = localStorage.getItem('serverListLayout') === 'single' ? 'single' : 'two'
        const next = cur === 'single' ? 'two' : 'single'
        localStorage.setItem('serverListLayout', next)
        applyServerLayout(next === 'single' ? 'single' : 'two')
    })
}

// Ensure layout is applied when preparing the list and on load
document.addEventListener('DOMContentLoaded', () => {
    initServerLayout()
})

function prepareAccountSelectionList(){
    populateAccountListings()
    setAccountListingHandlers()
}

/**
 * Window Select View
 */
async function populateWindowListings(){
    try {
        const res = await _ipc.invoke('list-windows')
        if(!res || !res.success){
            // Show a friendly error
            setOverlayContent('ウィンドウ一覧の取得に失敗しました', res && res.message ? res.message : 'この機能は利用できません。', 'OK')
            setOverlayHandler(null)
            toggleOverlay(true)
            return
        }
        const wins = res.windows || []
        let htmlString = ''
        if(wins.length < 1){
            htmlString = '<div style="width:375px;text-align:center">ウィンドウが見つかりません</div>'
        } else {
            for(const w of wins){
                const title = (w.title || '').replace(/</g, '&lt;')
                htmlString += `<button class="windowListing" hwnd="${w.handle}" title="${title}">
                    <div class="windowListingDetails">
                        <span class="windowListingName">${title || '(無題)'}</span>
                        <span class="windowListingProcess">PID: ${w.processId || 'N/A'}</span>
                    </div>
                </button>`
            }
        }
        document.getElementById('windowSelectListScrollable').innerHTML = htmlString
    } catch (err) {
        console.warn('populateWindowListings failed', err)
        setOverlayContent('エラー', 'ウィンドウ一覧の取得中にエラーが発生しました。', 'OK')
        setOverlayHandler(null)
        toggleOverlay(true)
    }
}

function setWindowListingHandlers(){
    const listings = Array.from(document.getElementsByClassName('windowListing'))
    listings.map((val) => {
        val.onclick = e => {
            if(val.hasAttribute('selected')){
                return
            }
            const cListings = document.getElementsByClassName('windowListing')
            for(let i=0; i<cListings.length; i++){
                if(cListings[i].hasAttribute('selected')){
                    cListings[i].removeAttribute('selected')
                }
            }
            val.setAttribute('selected', '')
            document.activeElement.blur()
        }
    })
}

async function toggleWindowSelection(toggleState){
    await populateWindowListings()
    setWindowListingHandlers()
    toggleOverlay(toggleState, true, 'windowSelectContent')
}

function getSelectedWindowHwnd(){
    const listings = document.getElementsByClassName('windowListing')
    for(let i=0; i<listings.length; i++){
        if(listings[i].hasAttribute('selected')){
            return listings[i].getAttribute('hwnd')
        }
    }
    return null
}

async function applyWindowMode(mode){
    const hwnd = getSelectedWindowHwnd()
    if(hwnd == null){
        setOverlayContent('未選択', 'ウィンドウを選択してください。', 'OK')
        setOverlayHandler(null)
        toggleOverlay(true)
        return
    }
    let error = null
    try {
        const res = await _ipc.invoke('apply-window-mode', hwnd, mode)
        if(!(res && res.success)){
            error = res && res.message ? res.message : '操作に失敗しました。'
        }
    } catch (err) {
        error = err.message || '不明なエラーが発生しました。'
    }
    if(error){
        setOverlayContent('失敗', error, 'OK')
        setOverlayHandler(null)
        toggleOverlay(true)
    }
    // Success: keep the window-selection overlay open (no message, no close).
}

document.getElementById('windowMaximizeButton').addEventListener('click', () => {
    applyWindowMode('maximize')
})

document.getElementById('windowMinimizeButton').addEventListener('click', () => {
    applyWindowMode('restore')
})

document.getElementById('windowSelectCancel').addEventListener('click', () => {
    document.getElementById('windowFilterInput').value = ''
    toggleOverlay(false)
})

document.getElementById('windowFilterInput').addEventListener('input', async (e) => {
    let value = document.getElementById('windowFilterInput').value.toLowerCase()
    const listings = Array.from(document.getElementsByClassName('windowListing'))
    listings.forEach(listing => {
        const title = (listing.getAttribute('title')||'').toLowerCase()
        if(title.indexOf(value) >= 0){
            listing.style.display = ''
        } else {
            listing.style.display = 'none'
        }
    })
})

{
    const off = document.getElementById('serverTabOfficial')
    const cus = document.getElementById('serverTabCustom')
    if(off) off.addEventListener('click', () => setServerTab('official'))
    if(cus) cus.addEventListener('click', () => setServerTab('custom'))
}

{
    const createBtn = document.getElementById('customInstanceCreateButton')
    if(createBtn) createBtn.addEventListener('click', () => openCustomInstanceCreate())
}

