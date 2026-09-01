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
        const el = document.getElementById(overlayHandlerContent).getElementsByClassName('overlayKeybindEnter')[0]
        if(el) el.click()
    }
}
/**
 * Overlay keydown handler for a dismissable overlay.
 *
 * @param {KeyboardEvent} e The keydown event.
 */
function overlayKeyDismissableHandler (e){
    if(e.key === 'Enter'){
        const el = document.getElementById(overlayHandlerContent).getElementsByClassName('overlayKeybindEnter')[0]
        if(el) el.click()
    } else if(e.key === 'Escape'){
        const el = document.getElementById(overlayHandlerContent).getElementsByClassName('overlayKeybindEsc')[0]
        if(el) el.click()
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
        const cfi = document.getElementById('customFilterInput')
        if(cfi) cfi.value = ''
        populateCustomInstanceListings()
    } else {
        if(off) off.setAttribute('selected', '')
        if(cus) cus.removeAttribute('selected')
        if(officialList) officialList.style.display = ''
        if(customList) customList.style.display = 'none'
        if(filter) filter.style.display = ''
    }
}

let _dragCid = null
function populateCustomInstanceListings(){
    const el = document.getElementById('customInstanceListScrollable')
    if(!el) return
    // Allow wheel scrolling while dragging (native drag suppresses normal scroll).
    if(!el._dragWheelBound){
        el._dragWheelBound = true
        el.addEventListener('wheel', (e) => {
            if(_dragCid){ el.scrollTop += e.deltaY; e.preventDefault() }
        }, { passive: false })
        // Edge auto-scroll while dragging near the top/bottom of the list.
        el.addEventListener('dragover', (e) => {
            if(!_dragCid) return
            const rect = el.getBoundingClientRect()
            const margin = 40
            if(e.clientY < rect.top + margin) el.scrollTop -= 14
            else if(e.clientY > rect.bottom - margin) el.scrollTop += 14
        })
    }
    const selected = ConfigManager.getSelectedServer()
    // Favorites pinned on top (stable sort keeps array order within each group).
    const instances = ConfigManager.getCustomInstances().slice().sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0))
    if(instances.length === 0){
        el.innerHTML = '<div style="grid-column:1 / -1;width:100%;text-align:center;opacity:0.7">まだ自作パックがありません</div>'
        return
    }
    let html = ''
    for(const ins of instances){
        const loaderLabel = ins.loader === 'vanilla' ? 'バニラ' : `${ins.loader} ${ins.loaderVersion}`
        const nameEsc = (ins.name || '無題の構成').replace(/</g, '&lt;')
        html += `<div class="customInstanceListing" cid="${ins.id}" draggable="true" ${ins.id === selected ? 'selected' : ''}>
            <div class="customInstanceInfo">
                <div class="customInstanceNameRow">
                    <button class="customFavorite ${ins.favorite ? 'on' : ''}" cid="${ins.id}" type="button" title="お気に入り">${ins.favorite ? '★' : '☆'}</button>
                    <div class="customInstanceName">${nameEsc}</div>
                </div>
                <div class="customInstanceMeta">${ins.minecraftVersion} / ${loaderLabel}</div>
            </div>
            <div class="customInstanceActions">
                ${ins.modpackSource ? `<button class="customModpackVersion" cid="${ins.id}" type="button">版変更</button>` : ''}
                <button class="customRename" cid="${ins.id}" type="button">改名</button>
                <button class="customShare" cid="${ins.id}" type="button">共有</button>
                <button class="customOpenFolder" cid="${ins.id}" type="button">フォルダ</button>
                <button class="customDelete" cid="${ins.id}" type="button">削除</button>
            </div>
        </div>`
    }
    el.innerHTML = html
    setCustomInstanceHandlers()
    applyCustomInstanceFilter()
}

/**
 * Filter the custom instance listings by name using the 絞り込み input.
 */
function applyCustomInstanceFilter(){
    const inp = document.getElementById('customFilterInput')
    const value = inp ? kanaToHira(inp.value.toLowerCase()) : ''
    Array.from(document.getElementsByClassName('customInstanceListing')).forEach(row => {
        const nameEl = row.getElementsByClassName('customInstanceName')[0]
        const name = nameEl ? kanaToHira(nameEl.textContent.toLowerCase()) : ''
        row.style.display = name.indexOf(value) >= 0 ? '' : 'none'
    })
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
            // If we switched instance from within Settings (e.g. the Mod tab's switch-server
            // button), refresh the settings tab so the Mod list reflects the new instance.
            if(typeof getCurrentView === 'function' && getCurrentView() === VIEWS.settings && typeof animateSettingsTabRefresh === 'function'){
                animateSettingsTabRefresh()
            }
        }
    })
    // Rename an instance inline
    Array.from(document.getElementsByClassName('customRename')).forEach(b => {
        // If the row is already being renamed, pressing 改名 again should close (commit) it.
        // mousedown fires before the input's blur, so remember the edit state here.
        b.onmousedown = () => {
            const r = document.querySelector(`.customInstanceListing[cid="${b.getAttribute('cid')}"]`)
            const ne = r && r.getElementsByClassName('customInstanceName')[0]
            b._suppress = !!(ne && ne.getElementsByTagName('input').length > 0)
        }
        b.onclick = (e) => {
            e.stopPropagation()
            const cid = b.getAttribute('cid')
            const row = document.querySelector(`.customInstanceListing[cid="${cid}"]`)
            const nameEl = row && row.getElementsByClassName('customInstanceName')[0]
            if(!nameEl) return
            const openInput = nameEl.getElementsByTagName('input')[0]
            // Already editing (flag from mousedown, or input still open) → commit & close, don't reopen.
            if(b._suppress || openInput){ b._suppress = false; if(openInput) openInput.blur(); return }
            const cur = nameEl.textContent
            const input = document.createElement('input')
            input.type = 'text'; input.value = cur; input.className = 'customRenameInput'
            input.onclick = (ev) => ev.stopPropagation()
            let done = false
            const commit = (save) => {
                if(done) return
                done = true
                const val = input.value.trim()
                if(save && val && val !== cur){
                    ConfigManager.updateCustomInstance(cid, { name: val }); ConfigManager.save()
                    nameEl.textContent = val
                    if(ConfigManager.getSelectedServer() === cid){
                        const sb = document.getElementById('server_selection_button')
                        if(sb) sb.innerHTML = '&#8226; ' + val
                    }
                } else {
                    nameEl.textContent = cur
                }
            }
            input.onkeydown = (ev) => { if(ev.key === 'Enter'){ ev.preventDefault(); commit(true) } else if(ev.key === 'Escape'){ ev.preventDefault(); commit(false) } }
            input.onblur = () => commit(true)
            nameEl.textContent = ''
            nameEl.appendChild(input)
            input.focus(); input.select()
        }
    })
    // Share an instance as a code
    Array.from(document.getElementsByClassName('customShare')).forEach(b => {
        b.onclick = (e) => { e.stopPropagation(); openShareCode(b.getAttribute('cid')) }
    })
    // Favorite toggle (pins to top)
    Array.from(document.getElementsByClassName('customFavorite')).forEach(b => {
        b.onclick = (e) => {
            e.stopPropagation()
            const cid = b.getAttribute('cid')
            const ins = ConfigManager.getCustomInstance(cid)
            ConfigManager.updateCustomInstance(cid, { favorite: !(ins && ins.favorite) })
            ConfigManager.save()
            populateCustomInstanceListings()
        }
    })
    // Drag-and-drop reorder
    Array.from(document.getElementsByClassName('customInstanceListing')).forEach(row => {
        row.addEventListener('dragstart', (e) => {
            _dragCid = row.getAttribute('cid')
            row.classList.add('dragging')
            try { e.dataTransfer.effectAllowed = 'move' } catch(err){ /* ignore */ }
        })
        row.addEventListener('dragend', () => {
            row.classList.remove('dragging')
            Array.from(document.getElementsByClassName('customInstanceListing')).forEach(r => r.classList.remove('dragover'))
            _dragCid = null
        })
        row.addEventListener('dragover', (e) => {
            if(!_dragCid) return
            e.preventDefault()
            try { e.dataTransfer.dropEffect = 'move' } catch(err){ /* ignore */ }
            if(row.getAttribute('cid') !== _dragCid) row.classList.add('dragover')
        })
        row.addEventListener('dragleave', () => row.classList.remove('dragover'))
        row.addEventListener('drop', (e) => {
            e.preventDefault()
            const targetCid = row.getAttribute('cid')
            if(_dragCid && targetCid && _dragCid !== targetCid){
                // Drop on the right half of the target = insert after it (lets a
                // left-column item move into the right column, and vice versa).
                const rect = row.getBoundingClientRect()
                const after = (e.clientX - rect.left) > rect.width / 2
                ConfigManager.moveCustomInstance(_dragCid, targetCid, after)
                ConfigManager.save()
                populateCustomInstanceListings()
            }
        })
    })
    // Change modpack version (modpack-derived instances only)
    Array.from(document.getElementsByClassName('customModpackVersion')).forEach(b => {
        b.onclick = (e) => {
            e.stopPropagation()
            openModpackVersionChange(b.getAttribute('cid'))
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
            setOverlayContent(
                '削除しますか？',
                `「${(ins && ins.name) || '無題の構成'}」を一覧から削除します。<br><br>` +
                '<label style="cursor:pointer;font-size:13px;"><input type="checkbox" id="deleteFolderChk" style="margin-right:6px;vertical-align:middle;">インスタンスのフォルダ（Mod・設定など）もゴミ箱に移動する</label>',
                '削除する',
                'キャンセル'
            )
            setOverlayHandler(async () => {
                const chk = document.getElementById('deleteFolderChk')
                const delFolder = !!(chk && chk.checked)
                ConfigManager.removeCustomInstance(cid)
                if(ConfigManager.getSelectedServer() === cid){
                    ConfigManager.setSelectedServer(null)
                }
                ConfigManager.save()
                if(delFolder){
                    try {
                        const { SHELL_OPCODE } = require('./assets/js/ipcconstants')
                        const dir = require('path').join(ConfigManager.getInstanceDirectory(), cid)
                        if(require('fs-extra').existsSync(dir)){
                            await _ipc.invoke(SHELL_OPCODE.TRASH_ITEM, dir)
                        }
                    } catch(err){
                        console.warn('Failed to move instance folder to trash', err)
                    }
                }
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
    const _lvfReset = document.getElementById('customCreateLoaderVersionField')
    if(_lvfReset) _lvfReset.style.display = 'none'
    const _lveReset = document.getElementById('customCreateLoaderVersion')
    if(_lveReset) _lveReset.innerHTML = '<option value="">選択してください</option>'
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
    const loaderVerField = document.getElementById('customCreateLoaderVersionField')
    const loaderVerEl = document.getElementById('customCreateLoaderVersion')
    async function refreshLoaderVersions(){
        if(!loaderEl) return
        if(loaderEl.value === 'fabric'){
            if(loaderVerField) loaderVerField.style.display = ''
            if(loaderVerEl) loaderVerEl.innerHTML = '<option value="">読み込み中...</option>'
            try {
                const mc = document.getElementById('customCreateMcVersion').value
                const list = await window.NLCustomVersions.fetchFabricLoaderVersions(mc)
                if(list.length === 0){
                    if(loaderVerEl) loaderVerEl.innerHTML = '<option value="">このMC版はFabric非対応</option>'
                } else if(loaderVerEl){
                    loaderVerEl.innerHTML = list.map(v => `<option value="${v.version}">${v.version}${v.stable ? '' : ' (beta)'}</option>`).join('')
                }
            } catch(e){ if(loaderVerEl) loaderVerEl.innerHTML = '<option value="">取得失敗</option>' }
        } else if(loaderEl.value === 'forge'){
            if(loaderVerField) loaderVerField.style.display = ''
            const mc = document.getElementById('customCreateMcVersion').value
            if(!mc){ if(loaderVerEl) loaderVerEl.innerHTML = '<option value="">先にMinecraftバージョンを選択</option>'; return }
            if(loaderVerEl) loaderVerEl.innerHTML = '<option value="">読み込み中...</option>'
            try {
                const list = await window.NLCustomVersions.fetchForgeVersions(mc)
                if(list.length === 0){
                    if(loaderVerEl) loaderVerEl.innerHTML = '<option value="">このMC版に対応するForgeがありません</option>'
                } else if(loaderVerEl){
                    loaderVerEl.innerHTML = list.map(v => {
                        const tag = v.recommended ? ' (推奨)' : (v.latest ? ' (最新)' : '')
                        return `<option value="${v.version}">${v.version}${tag}</option>`
                    }).join('')
                    const def = list.find(v => v.recommended) || list.find(v => v.latest)
                    if(def) loaderVerEl.value = def.version
                }
            } catch(e){ if(loaderVerEl) loaderVerEl.innerHTML = '<option value="">取得失敗</option>' }
        } else {
            if(loaderVerField) loaderVerField.style.display = 'none'
        }
    }
    if(loaderEl) loaderEl.onchange = refreshLoaderVersions
    const mcEl2 = document.getElementById('customCreateMcVersion')
    if(mcEl2) mcEl2.onchange = () => { if(loaderEl && (loaderEl.value === 'fabric' || loaderEl.value === 'forge')) refreshLoaderVersions() }
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
    let loaderVersion = ''
    if(loader === 'fabric' || loader === 'forge'){
        loaderVersion = document.getElementById('customCreateLoaderVersion').value
        if(!loaderVersion){
            setOverlayContent('未選択', 'ローダーのバージョンを選んでください。', 'OK')
            setOverlayHandler(null); toggleOverlay(true); return
        }
    }
    const instance = {
        schema: 1,
        id: _genInstanceId(),
        name,
        minecraftVersion: mc,
        loader,
        loaderVersion,
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

{
    const cfi = document.getElementById('customFilterInput')
    if(cfi) cfi.addEventListener('input', () => applyCustomInstanceFilter())
}




// --- Modpack import (Modrinth .mrpack / CurseForge zip -> custom instance) ---
let currentModpackSource = 'modrinth'
function _mpApi(source){ return source === 'curseforge' ? window.NLCurseForge : window.NLModrinth }
function _projectUrl(source, hit){
    if(!hit) return ''
    if(source === 'curseforge') return hit.websiteUrl || ''
    return hit.slug ? ('https://modrinth.com/project/' + hit.slug) : ''
}
// Show the modpack import progress panel (ESC disabled, cancel button). Returns
// { token, onProgress, cleanup }.
function _modpackProgressUI(name){
    const results = document.getElementById('modpackResults')
    const progress = document.getElementById('modpackProgress')
    const closeBtn = document.getElementById('modpackCancel')
    if(results) results.style.display = 'none'
    if(closeBtn) closeBtn.style.display = 'none'
    if(progress) progress.style.display = ''
    document.getElementById('modpackProgressTitle').textContent = '導入中: ' + name
    document.getElementById('modpackProgressText').textContent = ''
    const inner = document.querySelector('#modpackProgress .modpackBarInner')
    if(inner) inner.style.width = '0%'
    toggleOverlay(true, false, 'modpackContent') // non-dismissable: ESC disabled
    const token = { cancelled: false }
    const cancelBtn = document.getElementById('modpackCancelBtn')
    cancelBtn.disabled = false; cancelBtn.textContent = 'キャンセル'
    cancelBtn.onclick = () => { token.cancelled = true; cancelBtn.disabled = true; cancelBtn.textContent = 'キャンセル中...' }
    const onProgress = (i, n) => {
        const pct = n > 0 ? Math.floor(i / n * 100) : 0
        if(inner) inner.style.width = pct + '%'
        document.getElementById('modpackProgressText').textContent = i + ' / ' + n
    }
    const cleanup = () => {
        if(progress) progress.style.display = 'none'
        if(results) results.style.display = ''
        if(closeBtn) closeBtn.style.display = ''
    }
    return { token, onProgress, cleanup }
}
function _mpSetSource(source){
    currentModpackSource = source
    const bar = document.getElementById('modpackSourceToggle')
    if(bar){ Array.from(bar.children).forEach(b => { if(b.getAttribute('data-source') === source) b.setAttribute('selected', ''); else b.removeAttribute('selected') }) }
}
async function openModpackSearch(){
    _mpSetSource('modrinth')
    document.getElementById('modpackSearchInput').value = ''
    document.getElementById('modpackResults').innerHTML = ''
    toggleOverlay(true, true, 'modpackContent')
    runModpackSearch()
}

async function runModpackSearch(){
    const source = currentModpackSource
    const q = document.getElementById('modpackSearchInput').value.trim()
    const results = document.getElementById('modpackResults')
    if(source === 'curseforge' && !window.NLCurseForge.hasKey()){
        results.innerHTML = '<div style="opacity:0.7">CurseForge利用不可（APIキー未設定）</div>'
        return
    }
    results.innerHTML = '<div style="opacity:0.7">検索中...</div>'
    try {
        const hits = await _mpApi(source).searchModpacks(q)
        if(hits.length === 0){ results.innerHTML = '<div style="opacity:0.7">見つかりませんでした</div>'; return }
        results.innerHTML = ''
        for(const h of hits){
            const row = document.createElement('div')
            row.className = 'modrinthResult'
            const icon = h.iconUrl ? `<img src="${_mrEsc(h.iconUrl)}">` : '<img>'
            row.innerHTML = `${icon}
                <div class="modrinthResultInfo">
                    <div class="modrinthResultTitle">${_mrEsc(h.title)}</div>
                    <div class="modrinthResultMeta">${_mrEsc(h.author)} ・ DL ${Number(h.downloads||0).toLocaleString()}</div>
                </div>
                <div class="modrinthActions"><button class="modrinthAddButton" type="button">選択</button></div>`
            const btn = row.getElementsByClassName('modrinthAddButton')[0]
            btn.onclick = () => openModpackVersions(h, { source })
            const titleEl = row.getElementsByClassName('modrinthResultTitle')[0]
            const url = _projectUrl(source, h)
            if(titleEl && url){ titleEl.classList.add('clickableTitle'); titleEl.onclick = () => { try { require('electron').shell.openExternal(url) } catch(e){ /* ignore */ } } }
            results.appendChild(row)
        }
    } catch(err){
        results.innerHTML = '<div style="opacity:0.7">' + (err.message || '検索に失敗しました') + '</div>'
    }
}

let _mpVersions = null
async function openModpackVersions(hit, opts){
    opts = opts || {}
    const results = document.getElementById('modpackResults')
    results.innerHTML = '<div style="opacity:0.7">バージョン取得中...</div>'
    const source = opts.source || 'modrinth'
    try {
        _mpVersions = await _mpApi(source).getModpackVersions(hit.projectId)
    } catch(e){ results.innerHTML = '<div style="opacity:0.7">' + (e.message || '取得失敗') + '</div>'; return }
    if(!_mpVersions || _mpVersions.length === 0){ results.innerHTML = '<div style="opacity:0.7">導入可能なバージョンがありません</div>'; return }
    // Unique MC versions in newest-first encounter order.
    const mcSet = []
    for(const v of _mpVersions){ for(const g of v.gameVersions){ if(!mcSet.includes(g)) mcSet.push(g) } }
    // Preselect the MC of the current version (change mode).
    let initMc = mcSet[0]
    if(opts.currentVersionId){
        const cur = _mpVersions.find(v => v.versionId === opts.currentVersionId)
        if(cur && cur.gameVersions.length && mcSet.includes(cur.gameVersions[0])) initMc = cur.gameVersions[0]
    }
    const importLabel = opts.importLabel || '導入'
    const showName = !opts.currentVersionId
    const nameField = showName ? `<label>名前</label><input type="text" id="modpackNameInput" value="${_mrEsc(hit.title || '')}">` : ''
    results.innerHTML = `
        <div class="modpackVersionPanel">
            <div class="modpackVersionTitle">${_mrEsc(hit.title)}</div>
            ${nameField}
            <label>Minecraftバージョン</label>
            <select id="modpackMcSelect">${mcSet.map(m => `<option value="${_mrEsc(m)}"${m === initMc ? ' selected' : ''}>${_mrEsc(m)}</option>`).join('')}</select>
            <label>modpackバージョン</label>
            <select id="modpackVerSelect"></select>
            <div class="modpackVersionActions">
                <button id="modpackImportBtn" type="button">${_mrEsc(importLabel)}</button>
                <button id="modpackBackBtn" type="button">戻る</button>
            </div>
        </div>`
    const titleEl2 = results.getElementsByClassName('modpackVersionTitle')[0]
    const purl = _projectUrl(source, hit)
    if(titleEl2 && purl){ titleEl2.classList.add('clickableTitle'); titleEl2.onclick = () => { try { require('electron').shell.openExternal(purl) } catch(e){ /* ignore */ } } }
    const mcSel = document.getElementById('modpackMcSelect')
    const verSel = document.getElementById('modpackVerSelect')
    function fillVers(){
        const mc = mcSel.value
        const matching = _mpVersions.filter(v => v.gameVersions.includes(mc))
        verSel.innerHTML = matching.map((v, idx) => {
            const cur = opts.currentVersionId && v.versionId === opts.currentVersionId ? ' (現在)' : ''
            const ld = v.loaders && v.loaders.length ? (' (' + _mrEsc(v.loaders.join('/')) + ')') : ''
            return `<option value="${idx}">${_mrEsc(v.versionNumber)}${ld}${cur}</option>`
        }).join('')
        verSel._matching = matching
        // Preselect current version if present.
        if(opts.currentVersionId){
            const ci = matching.findIndex(v => v.versionId === opts.currentVersionId)
            if(ci >= 0) verSel.value = String(ci)
        }
    }
    fillVers()
    mcSel.onchange = fillVers
    document.getElementById('modpackBackBtn').onclick = () => { if(opts.onBack) opts.onBack(); else runModpackSearch() }
    document.getElementById('modpackImportBtn').onclick = () => {
        const matching = verSel._matching || []
        const chosen = matching[Number(verSel.value)]
        if(!chosen) return
        if(opts.onImport) opts.onImport(chosen)
        else importModpackVersion(hit, chosen, source)
    }
}

function _modpackFinishNotice(res){
    if(res.failed && res.failed.length){
        setOverlayContent('一部のMODを取得できませんでした', res.failed.slice(0, 10).join('\n') + (res.failed.length > 10 ? '\n…' : ''), 'OK')
        setOverlayHandler(() => { toggleServerSelection(true).then(() => setServerTab('custom')) })
        toggleOverlay(true)
    } else {
        toggleServerSelection(true).then(() => setServerTab('custom'))
    }
}

async function importModpackVersion(hit, version, source){
    const nameEl = document.getElementById('modpackNameInput')
    const nameOverride = nameEl ? nameEl.value.trim() : ''
    const ui = _modpackProgressUI(nameOverride || hit.title || 'modpack')
    try {
        const res = await window.NLModpack.importModpack(source || 'modrinth', hit, version.file, ui.onProgress, ui.token, nameOverride)
        ui.cleanup()
        _modpackFinishNotice(res)
    } catch(err){
        ui.cleanup()
        if(err && err.message === '__cancelled__'){
            toggleOverlay(true, true, 'modpackContent'); runModpackSearch()
        } else {
            setOverlayContent('取り込み失敗', err.message || '不明なエラー', 'OK'); setOverlayHandler(null); toggleOverlay(true)
        }
    }
}

// Open the version picker for an already-imported modpack instance (update/downgrade).
function openModpackVersionChange(instanceId){
    const ins = ConfigManager.getCustomInstance(instanceId)
    const src = ins && ins.modpackSource
    if(!src || (src.provider !== 'modrinth' && src.provider !== 'curseforge')){ return }
    toggleOverlay(true, true, 'modpackContent')
    openModpackVersions({ projectId: src.projectId, title: ins.name || 'modpack' }, {
        source: src.provider || 'modrinth',
        currentVersionId: src.versionId,
        importLabel: '適用',
        onImport: (version) => changeModpackVersion(instanceId, version),
        onBack: () => { toggleServerSelection(true).then(() => setServerTab('custom')) }
    })
}

async function changeModpackVersion(instanceId, version){
    const ins = ConfigManager.getCustomInstance(instanceId)
    const ui = _modpackProgressUI((ins && ins.name) || 'modpack')
    try {
        const res = await window.NLModpack.changeModpackVersion(instanceId, version.file, ui.onProgress, ui.token)
        ui.cleanup()
        _modpackFinishNotice(res)
    } catch(err){
        ui.cleanup()
        if(err && err.message === '__cancelled__'){
            setOverlayContent('キャンセルしました', '一部のみ適用されています。', 'OK')
            setOverlayHandler(() => { toggleServerSelection(true).then(() => setServerTab('custom')) }); toggleOverlay(true)
        } else {
            setOverlayContent('変更に失敗しました', err.message || '不明なエラー', 'OK'); setOverlayHandler(null); toggleOverlay(true)
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const mpBtn = document.getElementById('customModpackButton')
    if(mpBtn) mpBtn.addEventListener('click', () => openModpackSearch())
    const mpSearch = document.getElementById('modpackSearchButton')
    if(mpSearch) mpSearch.addEventListener('click', () => runModpackSearch())
    const mpInput = document.getElementById('modpackSearchInput')
    if(mpInput) mpInput.addEventListener('keydown', (e) => { if(e.key === 'Enter'){ e.preventDefault(); e.stopPropagation(); runModpackSearch() } })
    const mpCancel = document.getElementById('modpackCancel')
    if(mpCancel) mpCancel.addEventListener('click', () => _backToServerCustom())
    const mpToggle = document.getElementById('modpackSourceToggle')
    if(mpToggle){
        Array.from(mpToggle.children).forEach(b => {
            b.addEventListener('click', () => { _mpSetSource(b.getAttribute('data-source')); runModpackSearch() })
        })
    }
})

// --- Share / receive launch configs ---
function openShareCode(cid){
    const unknown = window.NLShare.collectUnknownJars(cid)
    const proceed = (includeRaw) => {
        try {
            const built = window.NLShare.buildShareCode(cid, includeRaw)
            const ta = document.getElementById('shareCodeText')
            ta.value = built.code
            ta.dataset.url = built.url
            toggleOverlay(true, true, 'shareCodeContent')
        } catch(err){ setOverlayContent('共有失敗', _mrEsc(err.message || '不明なエラー'), 'OK'); setOverlayHandler(null); toggleOverlay(true) }
    }
    if(unknown.length){
        setOverlayContent('出所不明のMOD', '出所不明のMOD（' + unknown.length + '件）も共有しますか？\n' + _mrEsc(unknown.map(u => u.name).slice(0, 15).join('\n')), 'はい', 'いいえ')
        setOverlayHandler(() => proceed(true))
        setDismissHandler(() => proceed(false))
        toggleOverlay(true, true)
    } else {
        proceed(false)
    }
}

function openShareImport(){
    const ta = document.getElementById('shareImportText')
    if(ta) ta.value = ''
    const st = document.getElementById('shareImportStatus')
    if(st) st.textContent = ''
    const btn = document.getElementById('shareImportBtn')
    if(btn) btn.disabled = false
    toggleOverlay(true, true, 'shareImportContent')
}

async function runShareImport(){
    let payload
    try { payload = window.NLShare.decodeShareCode(document.getElementById('shareImportText').value) }
    catch(err){ setOverlayContent('コードエラー', _mrEsc(err.message || 'コードが不正です'), 'OK'); setOverlayHandler(null); toggleOverlay(true); return }
    const doImport = async (includeRaw) => {
        toggleOverlay(true, false, 'shareImportContent') // ESC off during import
        const status = document.getElementById('shareImportStatus')
        const btn = document.getElementById('shareImportBtn')
        if(btn) btn.disabled = true
        if(status) status.textContent = '取り込み中...'
        try {
            const res = await window.NLShare.importShareCode(payload, { includeRaw }, (i, n) => { if(status) status.textContent = 'MOD ' + i + ' / ' + n })
            if(res.failed && res.failed.length){
                setOverlayContent('一部のMODを取得できませんでした', _mrEsc(res.failed.slice(0, 10).join('\n')), 'OK')
                setOverlayHandler(() => { toggleServerSelection(true).then(() => setServerTab('custom')) }); toggleOverlay(true)
            } else {
                await toggleServerSelection(true); setServerTab('custom')
            }
        } catch(err){
            if(btn) btn.disabled = false
            setOverlayContent('取り込み失敗', _mrEsc(err.message || '不明なエラー'), 'OK'); setOverlayHandler(null); toggleOverlay(true)
        }
    }
    if(Array.isArray(payload.rawMods) && payload.rawMods.length){
        setOverlayContent('出所不明のMOD', '出所不明のMOD（' + payload.rawMods.length + '件）をダウンロードしますか？\n' + _mrEsc(payload.rawMods.map(r => r.name).slice(0, 15).join('\n')), 'はい', 'いいえ')
        setOverlayHandler(() => doImport(true))
        setDismissHandler(() => doImport(false))
        toggleOverlay(true, true)
    } else {
        doImport(false)
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const rb = document.getElementById('customReceiveButton')
    if(rb) rb.addEventListener('click', () => openShareImport())
    const cp = document.getElementById('shareCodeCopy')
    if(cp) cp.addEventListener('click', () => { try { require('electron').clipboard.writeText(document.getElementById('shareCodeText').value) } catch(e){ /* ignore */ } })
    const cpu = document.getElementById('shareCodeCopyUrl')
    if(cpu) cpu.addEventListener('click', () => { try { require('electron').clipboard.writeText(document.getElementById('shareCodeText').dataset.url || '') } catch(e){ /* ignore */ } })
    const scc = document.getElementById('shareCodeCancel')
    if(scc) scc.addEventListener('click', () => _backToServerCustom())
    const sib = document.getElementById('shareImportBtn')
    if(sib) sib.addEventListener('click', () => runShareImport())
    const sic = document.getElementById('shareImportCancel')
    if(sic) sic.addEventListener('click', () => _backToServerCustom())
})

// Return from a custom-tab sub-overlay (modpack/share) back to the 自作 list.
function _backToServerCustom(){
    toggleServerSelection(true).then(() => setServerTab('custom'))
}
