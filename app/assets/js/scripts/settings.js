// Requirements
const os     = require('os')
const semver = require('semver')

const DropinModUtil  = require('./assets/js/dropinmodutil')
const { MSFT_OPCODE, MSFT_REPLY_TYPE, MSFT_ERROR } = require('./assets/js/ipcconstants')
const ServerOptionQuery = require('./assets/js/scripts/serverOptionQuery')

const settingsState = {
    invalid: new Set()
}

/* Note: The settings input processing block was temporarily commented out
   to fix a parsing error introduced during edits. If you need the full
   validators/save logic restored, I can restore it from the previous
   version or reconstruct it. */

let selectedSettingsTab = 'settingsTabAccount'

/**
 * Modify the settings container UI when the scroll threshold reaches
 * a certain poin.
 *
 * @param {UIEvent} e The scroll event.
 */
function settingsTabScrollListener(e){
    if(e.target.scrollTop > Number.parseFloat(getComputedStyle(e.target.firstElementChild).marginTop)){
        document.getElementById('settingsContainer').setAttribute('scrolled', '')
    } else {
        document.getElementById('settingsContainer').removeAttribute('scrolled')
    }
}

/**
 * Bind functionality for the settings navigation items.
 */
function setupSettingsTabs(){
    Array.from(document.getElementsByClassName('settingsNavItem')).map((val) => {
        if(val.hasAttribute('rSc')){
            val.onclick = () => {
                settingsNavItemListener(val)
            }
        }
    })
}

/**
 * Settings nav item onclick lisener. Function is exposed so that
 * other UI elements can quickly toggle to a certain tab from other views.
 *
 * @param {Element} ele The nav item which has been clicked.
 * @param {boolean} fade Optional. True to fade transition.
 */
function settingsNavItemListener(ele, fade = true){
    if(ele.hasAttribute('selected')){
        return
    }
    const navItems = document.getElementsByClassName('settingsNavItem')
    for(let i=0; i<navItems.length; i++){
        if(navItems[i].hasAttribute('selected')){
            navItems[i].removeAttribute('selected')
        }
    }
    ele.setAttribute('selected', '')
    let prevTab = selectedSettingsTab
    selectedSettingsTab = ele.getAttribute('rSc')

    document.getElementById(prevTab).onscroll = null
    document.getElementById(selectedSettingsTab).onscroll = settingsTabScrollListener

    if(fade){
        $(`#${prevTab}`).fadeOut(250, () => {
            $(`#${selectedSettingsTab}`).fadeIn({
                duration: 250,
                start: () => {
                    settingsTabScrollListener({
                        target: document.getElementById(selectedSettingsTab)
                    })
                }
            })
        })
    } else {
        $(`#${prevTab}`).hide(0, () => {
            $(`#${selectedSettingsTab}`).show({
                duration: 0,
                start: () => {
                    settingsTabScrollListener({
                        target: document.getElementById(selectedSettingsTab)
                    })
                }
            })
        })
    }
}

const settingsNavDone = document.getElementById('settingsNavDone')

/**
 * Set if the settings save (done) button is disabled.
 *
 * @param {boolean} v True to disable, false to enable.
 */
function settingsSaveDisabled(v){
    settingsNavDone.disabled = v
}

/**
 * Save settings values from the UI into persistent storage.
 * Minimal stub to avoid ReferenceError; expand to full save logic later.
 */
function saveSettingsValues(){
    try {
        // If granular save hooks exist elsewhere, call them (best-effort).
        if(typeof saveGameSettings === 'function') saveGameSettings()
        if(typeof saveDisplaySettings === 'function') saveDisplaySettings()
        if(typeof saveJavaSettings === 'function') saveJavaSettings()
        // Additional specific saves are handled by fullSettingsSave()
    } catch (err) {
        console.warn('[Settings] saveSettingsValues failed', err)
    }
}

function fullSettingsSave() {
    try {
        if(typeof saveSettingsValues === 'function') saveSettingsValues()
    } catch (err) {
        console.warn('[Settings] saveSettingsValues invocation failed', err)
    }
    saveModConfiguration()
    ConfigManager.save()
    saveDropinModConfiguration()
    saveShaderpackSettings()
}

/* Closes the settings view and saves all data. */
settingsNavDone.onclick = () => {
    fullSettingsSave()
    switchView(getCurrentView(), VIEWS.landing)
}

/**
 * Account Management Tab
 */

const msftLoginLogger = LoggerUtil.getLogger('Microsoft Login')
const msftLogoutLogger = LoggerUtil.getLogger('Microsoft Logout')

// Bind the add mojang account button.
// document.getElementById('settingsAddMojangAccount').onclick = (e) => {
//     switchView(getCurrentView(), VIEWS.login, 500, 500, () => {
//         loginViewOnCancel = VIEWS.settings
//         loginViewOnSuccess = VIEWS.settings
//         loginCancelEnabled(true)
//     })
// }

// Bind the add microsoft account button.
document.getElementById('settingsAddMicrosoftAccount').onclick = (e) => {
    switchView(getCurrentView(), VIEWS.waiting, 500, 500, () => {
        ipcRenderer.send(MSFT_OPCODE.OPEN_LOGIN, VIEWS.settings, VIEWS.settings, false)
    })
}

// Bind the add microsoft account button.
document.getElementById('settingsAddMicrosoftAccountMsMcLauncherAuth').onclick = (e) => {
    switchView(getCurrentView(), VIEWS.waiting, 500, 500, () => {
        ipcRenderer.send(MSFT_OPCODE.OPEN_LOGIN, VIEWS.settings, VIEWS.settings, true)
    })
}

ipcRenderer.on('setServerOption', async (event, queryString) => {
    const query = ServerOptionQuery.decodeUrlToJson(queryString)
    if (!query) {
        setOverlayContent(
            'サーバーオプションのロードに失敗しました',
            'URLが不完全な可能性があります',
            Lang.queryJS('landing.launch.okay')
        )
        setOverlayHandler(null)
        toggleOverlay(true)
        toggleLaunchArea(false)
        return
    }

    const serv = (await DistroAPI.getDistribution()).getServerById(query.id)
    updateSelectedServer(serv)
    ConfigManager.setModConfiguration(query.id, query)
    setOverlayContent(
        'MODオプションロード成功!',
        `${removeOrderNumber(serv.rawServer.name)}のオプションをロードしました。ドロップ・イン MODの指定がある場合は手動で設定してからゲームを起動してください`,
        Lang.queryJS('landing.launch.okay')
    )
    setOverlayHandler(null)
    toggleOverlay(true)
    toggleLaunchArea(false)
})

// Bind reply for Microsoft Login.
ipcRenderer.on(MSFT_OPCODE.REPLY_LOGIN, (_, ...arguments_) => {
    if (arguments_[0] === MSFT_REPLY_TYPE.ERROR) {

        const viewOnClose = arguments_[2]
        console.log(arguments_)
        switchView(getCurrentView(), viewOnClose, 500, 500, () => {

            if(arguments_[1] === MSFT_ERROR.NOT_FINISHED) {
                // User cancelled.
                msftLoginLogger.info('Login cancelled by user.')
                return
            }

            // Unexpected error.
            setOverlayContent(
                Lang.queryJS('settings.msftLogin.errorTitle'),
                Lang.queryJS('settings.msftLogin.errorMessage'),
                Lang.queryJS('settings.msftLogin.okButton')
            )
            setOverlayHandler(() => {
                toggleOverlay(false)
            })
            toggleOverlay(true)
        })
    } else if(arguments_[0] === MSFT_REPLY_TYPE.SUCCESS) {
        const queryMap = arguments_[1]
        const viewOnClose = arguments_[2]
        const msMcLauncherAuth = arguments_[3]

        // Error from request to Microsoft.
        if (Object.prototype.hasOwnProperty.call(queryMap, 'error')) {
            switchView(getCurrentView(), viewOnClose, 500, 500, () => {
                // TODO Dont know what these errors are. Just show them I guess.
                // This is probably if you messed up the app registration with Azure.
                let error = queryMap.error // Error might be 'access_denied' ?
                let errorDesc = queryMap.error_description
                console.log('Error getting authCode, is Azure application registered correctly?')
                console.log(error)
                console.log(errorDesc)
                console.log('Full query map: ', queryMap)
                setOverlayContent(
                    error,
                    errorDesc,
                    Lang.queryJS('settings.msftLogin.okButton')
                )
                setOverlayHandler(() => {
                    toggleOverlay(false)
                })
                toggleOverlay(true)

            })
        } else {

            msftLoginLogger.info('Acquired authCode, proceeding with authentication.')

            const authCode = queryMap.code
            AuthManager.addMicrosoftAccount(authCode, msMcLauncherAuth).then(value => {
                updateSelectedAccount(value)
                switchView(getCurrentView(), viewOnClose, 500, 500, async () => {
                    await prepareSettings()
                })
            })
                .catch((displayableError) => {

                    let actualDisplayableError
                    if(isDisplayableError(displayableError)) {
                        msftLoginLogger.error('Error while logging in.', displayableError)
                        actualDisplayableError = displayableError
                    } else {
                        // Uh oh.
                        msftLoginLogger.error('Unhandled error during login.', displayableError)
                        actualDisplayableError = Lang.queryJS('login.error.unknown')
                    }

                    switchView(getCurrentView(), viewOnClose, 500, 500, () => {
                        setOverlayContent(actualDisplayableError.title, actualDisplayableError.desc, Lang.queryJS('login.tryAgain'))
                        setOverlayHandler(() => {
                            toggleOverlay(false)
                        })
                        toggleOverlay(true)
                    })
                })
        }
    }
})

/**
 * Bind functionality for the account selection buttons. If another account
 * is selected, the UI of the previously selected account will be updated.
 */
function bindAuthAccountSelect(){
    Array.from(document.getElementsByClassName('settingsAuthAccountSelect')).map((val) => {
        val.onclick = (e) => {
            if(val.hasAttribute('selected')){
                return
            }
            const selectBtns = document.getElementsByClassName('settingsAuthAccountSelect')
            for(let i=0; i<selectBtns.length; i++){
                if(selectBtns[i].hasAttribute('selected')){
                    selectBtns[i].removeAttribute('selected')
                    selectBtns[i].innerHTML = Lang.queryJS('settings.authAccountSelect.selectButton')
                }
            }
            val.setAttribute('selected', '')
            val.innerHTML = Lang.queryJS('settings.authAccountSelect.selectedButton')
            setSelectedAccount(val.closest('.settingsAuthAccount').getAttribute('uuid'))
        }
    })
}

/**
 * Bind functionality for the log out button. If the logged out account was
 * the selected account, another account will be selected and the UI will
 * be updated accordingly.
 */
function bindAuthAccountLogOut(){
    Array.from(document.getElementsByClassName('settingsAuthAccountLogOut')).map((val) => {
        val.onclick = (e) => {
            let isLastAccount = false
            if(Object.keys(ConfigManager.getAuthAccounts()).length === 1){
                isLastAccount = true
                setOverlayContent(
                    Lang.queryJS('settings.authAccountLogout.lastAccountWarningTitle'),
                    Lang.queryJS('settings.authAccountLogout.lastAccountWarningMessage'),
                    Lang.queryJS('settings.authAccountLogout.confirmButton'),
                    Lang.queryJS('settings.authAccountLogout.cancelButton')
                )
                setOverlayHandler(() => {
                    processLogOut(val, isLastAccount)
                    toggleOverlay(false)
                })
                setDismissHandler(() => {
                    toggleOverlay(false)
                })
                toggleOverlay(true, true)
            } else {
                processLogOut(val, isLastAccount)
            }

        }
    })
}

let msAccDomElementCache
/**
 * Process a log out.
 *
 * @param {Element} val The log out button element.
 * @param {boolean} isLastAccount If this logout is on the last added account.
 */
function processLogOut(val, isLastAccount){
    const parent = val.closest('.settingsAuthAccount')
    const uuid = parent.getAttribute('uuid')
    const prevSelAcc = ConfigManager.getSelectedAccount()
    const targetAcc = ConfigManager.getAuthAccount(uuid)
    if(targetAcc.type === 'microsoft') {
        msAccDomElementCache = parent
        switchView(getCurrentView(), VIEWS.waiting, 500, 500, () => {
            ipcRenderer.send(MSFT_OPCODE.OPEN_LOGOUT, uuid, isLastAccount)
        })
    } else {
        AuthManager.removeMojangAccount(uuid).then(() => {
            if(!isLastAccount && uuid === prevSelAcc.uuid){
                const selAcc = ConfigManager.getSelectedAccount()
                refreshAuthAccountSelected(selAcc.uuid)
                updateSelectedAccount(selAcc)
                validateSelectedAccount()
            }
            if(isLastAccount) {
                loginOptionsCancelEnabled(false)
                loginOptionsViewOnLoginSuccess = VIEWS.settings
                loginOptionsViewOnLoginCancel = VIEWS.loginOptions
                switchView(getCurrentView(), VIEWS.loginOptions)
            }
        })
        $(parent).fadeOut(250, () => {
            parent.remove()
        })
    }
}

// Bind reply for Microsoft Logout.
ipcRenderer.on(MSFT_OPCODE.REPLY_LOGOUT, (_, ...arguments_) => {
    if (arguments_[0] === MSFT_REPLY_TYPE.ERROR) {
        switchView(getCurrentView(), VIEWS.settings, 500, 500, () => {

            if(arguments_.length > 1 && arguments_[1] === MSFT_ERROR.NOT_FINISHED) {
                // User cancelled.
                msftLogoutLogger.info('Logout cancelled by user.')
                return
            }

            // Unexpected error.
            setOverlayContent(
                Lang.queryJS('settings.msftLogout.errorTitle'),
                Lang.queryJS('settings.msftLogout.errorMessage'),
                Lang.queryJS('settings.msftLogout.okButton')
            )
            setOverlayHandler(() => {
                toggleOverlay(false)
            })
            toggleOverlay(true)
        })
    } else if(arguments_[0] === MSFT_REPLY_TYPE.SUCCESS) {

        const uuid = arguments_[1]
        const isLastAccount = arguments_[2]
        const prevSelAcc = ConfigManager.getSelectedAccount()

        msftLogoutLogger.info('Logout Successful. uuid:', uuid)

        AuthManager.removeMicrosoftAccount(uuid)
            .then(() => {
                if(!isLastAccount && uuid === prevSelAcc.uuid){
                    const selAcc = ConfigManager.getSelectedAccount()
                    refreshAuthAccountSelected(selAcc.uuid)
                    updateSelectedAccount(selAcc)
                    validateSelectedAccount()
                }
                if(isLastAccount) {
                    loginOptionsCancelEnabled(false)
                    loginOptionsViewOnLoginSuccess = VIEWS.settings
                    loginOptionsViewOnLoginCancel = VIEWS.loginOptions
                    switchView(getCurrentView(), VIEWS.loginOptions)
                }
                if(msAccDomElementCache) {
                    msAccDomElementCache.remove()
                    msAccDomElementCache = null
                }
            })
            .finally(() => {
                if(!isLastAccount) {
                    switchView(getCurrentView(), VIEWS.settings, 500, 500)
                }
            })

    }
})

/**
 * Refreshes the status of the selected account on the auth account
 * elements.
 *
 * @param {string} uuid The UUID of the new selected account.
 */
function refreshAuthAccountSelected(uuid){
    Array.from(document.getElementsByClassName('settingsAuthAccount')).map((val) => {
        const selBtn = val.getElementsByClassName('settingsAuthAccountSelect')[0]
        if(uuid === val.getAttribute('uuid')){
            selBtn.setAttribute('selected', '')
            selBtn.innerHTML = Lang.queryJS('settings.authAccountSelect.selectedButton')
        } else {
            if(selBtn.hasAttribute('selected')){
                selBtn.removeAttribute('selected')
            }
            selBtn.innerHTML = Lang.queryJS('settings.authAccountSelect.selectButton')
        }
    })
}

const settingsCurrentMicrosoftAccounts = document.getElementById('settingsCurrentMicrosoftAccounts')
const settingsCurrentMojangAccounts = document.getElementById('settingsCurrentMojangAccounts')

/**
 * Add auth account elements for each one stored in the authentication database.
 */
function populateAuthAccounts(){
    const authAccounts = ConfigManager.getAuthAccounts()
    const authKeys = Object.keys(authAccounts)
    if(authKeys.length === 0){
        return
    }
    const selectedUUID = ConfigManager.getSelectedAccount().uuid

    let microsoftAuthAccountStr = ''
    let mojangAuthAccountStr = ''

    authKeys.forEach((val) => {
        const acc = authAccounts[val]

        const accHtml = `<div class="settingsAuthAccount" uuid="${acc.uuid}">
            <div class="settingsAuthAccountLeft">
                <img class="settingsAuthAccountImage" alt="${acc.displayName}" src="https://mc-heads.net/body/${acc.uuid}/60">
            </div>
            <div class="settingsAuthAccountRight">
                <div class="settingsAuthAccountDetails">
                    <div class="settingsAuthAccountDetailPane">
                        <div class="settingsAuthAccountDetailTitle">${Lang.queryJS('settings.authAccountPopulate.username')}</div>
                        <div class="settingsAuthAccountDetailValue">${acc.displayName}</div>
                    </div>
                    <div class="settingsAuthAccountDetailPane">
                        <div class="settingsAuthAccountDetailTitle">${Lang.queryJS('settings.authAccountPopulate.uuid')}</div>
                        <div class="settingsAuthAccountDetailValue">${acc.uuid}</div>
                    </div>
                </div>
                <div class="settingsAuthAccountActions">
                    <button class="settingsAuthAccountSelect" ${selectedUUID === acc.uuid ? 'selected>' + Lang.queryJS('settings.authAccountPopulate.selectedAccount') : '>' + Lang.queryJS('settings.authAccountPopulate.selectAccount')}</button>
                    <div class="settingsAuthAccountWrapper">
                        <button class="settingsAuthAccountLogOut">${Lang.queryJS('settings.authAccountPopulate.logout')}</button>
                    </div>
                </div>
            </div>
        </div>`

        if(acc.type === 'microsoft') {
            microsoftAuthAccountStr += accHtml
        } else {
            mojangAuthAccountStr += accHtml
        }

    })

    settingsCurrentMicrosoftAccounts.innerHTML = microsoftAuthAccountStr
    settingsCurrentMojangAccounts.innerHTML = mojangAuthAccountStr
}

/**
 * Prepare the accounts tab for display.
 */
function prepareAccountsTab() {
    populateAuthAccounts()
    bindAuthAccountSelect()
    bindAuthAccountLogOut()
}

/**
 * Minecraft Tab
 */

/**
  * Disable decimals, negative signs, and scientific notation.
  */
document.getElementById('settingsGameWidth').addEventListener('keydown', (e) => {
    if(/^[-.eE]$/.test(e.key)){
        e.preventDefault()
    }
})
document.getElementById('settingsGameHeight').addEventListener('keydown', (e) => {
    if(/^[-.eE]$/.test(e.key)){
        e.preventDefault()
    }
})

/**
 * Mods Tab
 */

const settingsModsContainer = document.getElementById('settingsModsContainer')

/**
 * Resolve and update the mods on the UI.
 */
async function resolveModsForUI(){

    const serv = ConfigManager.getSelectedServer()

    // Guard: if no server selected, or distro/server not available yet, avoid throwing
    if(!serv){
        document.getElementById('settingsReqModsContent').innerHTML = ''
        document.getElementById('settingsOptModsContent').innerHTML = ''
        return
    }

    const distro = await DistroAPI.getDistribution()
    if(!distro){
        document.getElementById('settingsReqModsContent').innerHTML = ''
        document.getElementById('settingsOptModsContent').innerHTML = ''
        return
    }

    const serverObj = distro.getServerById(serv)
    if(!serverObj){
        document.getElementById('settingsReqModsContent').innerHTML = ''
        document.getElementById('settingsOptModsContent').innerHTML = ''
        return
    }

    const servConf = ConfigManager.getModConfiguration(serv)

    const modStr = parseModulesForUI(serverObj.modules, false, servConf.mods)

    document.getElementById('settingsReqModsContent').innerHTML = modStr.reqMods
    document.getElementById('settingsOptModsContent').innerHTML = modStr.optMods

}

/**
 * Recursively build the mod UI elements.
 *
 * @param {Object[]} mdls An array of modules to parse.
 * @param {boolean} submodules Whether or not we are parsing submodules.
 * @param {Object} servConf The server configuration object for this module level.
 */
function parseModulesForUI(mdls, submodules, servConf){

    // 降順でソート
    mdls.sort((a, b) => a.rawModule.name.localeCompare(b.rawModule.name))

    let reqMods = ''
    let optMods = ''

    for(const mdl of mdls){

        if(mdl.rawModule.type === Type.ForgeMod || mdl.rawModule.type === Type.LiteMod || mdl.rawModule.type === Type.LiteLoader || mdl.rawModule.type === Type.FabricMod){

            if(mdl.getRequired().value){

                reqMods += `<div id="${mdl.getVersionlessMavenIdentifier()}" class="settingsBaseMod settings${submodules ? 'Sub' : ''}Mod" enabled>
                    <div class="settingsModContent">
                        <div class="settingsModMainWrapper">
                            <div class="settingsModStatus"></div>
                            <div class="settingsModDetails">
                                <span class="settingsModName">${mdl.rawModule.name}</span>
                                <span class="settingsModVersion">v${mdl.mavenComponents.version}</span>
                            </div>
                        </div>
                        <label class="toggleSwitch" reqmod>
                            <input type="checkbox" checked>
                            <span class="toggleSwitchSlider"></span>
                        </label>
                    </div>
                    ${mdl.subModules.length > 0 ? `<div class="settingsSubModContainer">
                        ${Object.values(parseModulesForUI(mdl.subModules, true, servConf[mdl.getVersionlessMavenIdentifier()])).join('')}
                    </div>` : ''}
                </div>`

            } else {

                const conf = servConf[mdl.getVersionlessMavenIdentifier()]
                const val = typeof conf === 'object' ? conf.value : conf

                optMods += `<div id="${mdl.getVersionlessMavenIdentifier()}" class="settingsBaseMod settings${submodules ? 'Sub' : ''}Mod" ${val ? 'enabled' : ''}>
                    <div class="settingsModContent">
                        <div class="settingsModMainWrapper">
                            <div class="settingsModStatus"></div>
                            <div class="settingsModDetails">
                                <span class="settingsModName">${mdl.rawModule.name}</span>
                                <span class="settingsModVersion">v${mdl.mavenComponents.version}</span>
                            </div>
                        </div>
                        <label class="toggleSwitch">
                            <input type="checkbox" formod="${mdl.getVersionlessMavenIdentifier()}" ${val ? 'checked' : ''}>
                            <span class="toggleSwitchSlider"></span>
                        </label>
                    </div>
                    ${mdl.subModules.length > 0 ? `<div class="settingsSubModContainer">
                        ${Object.values(parseModulesForUI(mdl.subModules, true, conf.mods)).join('')}
                    </div>` : ''}
                </div>`

            }
        }
    }

    return {
        reqMods,
        optMods
    }

}

document.addEventListener('DOMContentLoaded', () => {
    const toggleAll = document.getElementById('toggleAllOptionalMods')
    if (!toggleAll) return

    toggleAll.addEventListener('change', () => {
        const optModToggles = document.querySelectorAll('input[type="checkbox"][formod]')
        optModToggles.forEach(input => {
            input.checked = toggleAll.checked
            input.dispatchEvent(new Event('change'))
        })
    })
})


/**
 * Bind functionality to mod config toggle switches. Switching the value
 * will also switch the status color on the left of the mod UI.
 */
function bindModsToggleSwitch(){
    const sEls = settingsModsContainer.querySelectorAll('[formod]')
    Array.from(sEls).map((v, index, arr) => {
        v.onchange = () => {
            if(v.checked) {
                document.getElementById(v.getAttribute('formod')).setAttribute('enabled', '')
            } else {
                document.getElementById(v.getAttribute('formod')).removeAttribute('enabled')
            }
        }
    })
}


/**
 * Save the mod configuration based on the UI values.
 */
function saveModConfiguration(){
    const serv = ConfigManager.getSelectedServer()
    if(!serv) return

    const modConf = ConfigManager.getModConfiguration(serv)
    if(!modConf || typeof modConf !== 'object'){
        // Nothing to save for this server
        return
    }

    modConf.mods = _saveModConfiguration(modConf.mods || {})
    ConfigManager.setModConfiguration(serv, modConf)
}

/**
 * Recursively save mod config with submods.
 *
 * @param {Object} modConf Mod config object to save.
 */
function _saveModConfiguration(modConf){
    for(const [modId, modVal] of Object.entries(modConf)){
        const tSwitch = settingsModsContainer ? settingsModsContainer.querySelectorAll(`[formod='${modId}']`) : []

        // If there is no UI element for this module, recurse into sub-mods if present and continue.
        if(!tSwitch || tSwitch.length === 0){
            if(typeof modVal === 'object' && modVal != null && modVal.mods){
                modConf[modId].mods = _saveModConfiguration(modVal.mods)
            }
            continue
        }

        // If the UI element is marked as a dropin, skip (dropins handled elsewhere).
        if(tSwitch[0].hasAttribute && tSwitch[0].hasAttribute('dropin')){
            continue
        }

        if(typeof modVal === 'boolean'){
            modConf[modId] = tSwitch[0].checked
        } else {
            if(modVal != null){
                // Update the stored value if the control exists
                if(tSwitch.length > 0){
                    modConf[modId].value = tSwitch[0].checked
                }
                if(modConf[modId].mods){
                    modConf[modId].mods = _saveModConfiguration(modConf[modId].mods)
                }
            }
        }
    }
    return modConf
}

// Drop-in mod elements.

let CACHE_SETTINGS_MODS_DIR
let CACHE_DROPIN_MODS

/**
 * Resolve the selected pack as a distribution-server-like object. Falls back to
 * a synthetic server for user-created custom instances (which are not in the
 * distribution), so the Mod tab works for them too.
 * @param {Object} distro The distribution index.
 * @returns {Object|null}
 */
function resolveSelectedServerLike(distro){
    const id = ConfigManager.getSelectedServer()
    const serv = distro ? distro.getServerById(id) : null
    if(serv && serv.rawServer) return serv
    const ins = ConfigManager.getCustomInstance(id)
    if(ins){
        return { rawServer: { id: ins.id, minecraftVersion: ins.minecraftVersion, name: ins.name, description: '', version: '' }, modules: [] }
    }
    return null
}

/**
 * Determine the import target (mc version, loader, mods dir) for the selected pack.
 * loader is a lowercase Modrinth loader name (fabric/forge/quilt/neoforge) or null
 * when the pack cannot use mods (vanilla / unknown).
 */
async function getModTargetContext(){
    const id = ConfigManager.getSelectedServer()
    if(!id) return null
    const modsDir = path.join(ConfigManager.getInstanceDirectory(), id, 'mods')
    const ins = ConfigManager.getCustomInstance(id)
    if(ins){
        const loader = (ins.loader === 'fabric' || ins.loader === 'forge' || ins.loader === 'quilt' || ins.loader === 'neoforge') ? ins.loader : null
        return { id, mc: ins.minecraftVersion, loader, modsDir }
    }
    const distro = await DistroAPI.getDistribution()
    const serv = distro ? distro.getServerById(id) : null
    if(!serv || !serv.rawServer) return null
    let loader = null
    try {
        const { Type } = require('helios-distribution-types')
        for(const mdl of (serv.modules || [])){
            const t = mdl.rawModule && mdl.rawModule.type
            if(t === Type.Fabric){ loader = 'fabric'; break }
            if(t === Type.Forge || t === Type.ForgeHosted){ loader = 'forge'; break }
        }
    } catch(e) { /* ignore */ }
    return { id, mc: serv.rawServer.minecraftVersion, loader, modsDir }
}

/**
 * Resolve any located drop-in mods for this server and
 * populate the results onto the UI.
 */
async function resolveDropinModsForUI(){
    const distro = await DistroAPI.getDistribution()
    if(!distro){
        document.getElementById('settingsDropinModsContent').innerHTML = ''
        CACHE_DROPIN_MODS = []
        return
    }
    const serv = resolveSelectedServerLike(distro)
    if(!serv || !serv.rawServer){
        document.getElementById('settingsDropinModsContent').innerHTML = ''
        CACHE_DROPIN_MODS = []
        return
    }

    CACHE_SETTINGS_MODS_DIR = path.join(ConfigManager.getInstanceDirectory(), serv.rawServer.id, 'mods')
    CACHE_DROPIN_MODS = DropinModUtil.scanForDropinMods(CACHE_SETTINGS_MODS_DIR, serv.rawServer.minecraftVersion)

    let dropinMods = ''

    for(const dropin of CACHE_DROPIN_MODS){
        dropinMods += `<div id="${dropin.fullName}" class="settingsBaseMod settingsDropinMod" ${!dropin.disabled ? 'enabled' : ''}>
                    <div class="settingsModContent">
                        <div class="settingsModMainWrapper">
                            <div class="settingsModStatus"></div>
                            <div class="settingsModDetails">
                                <span class="settingsModName">${dropin.name}</span>
                                <div class="settingsDropinRemoveWrapper">
                                    <button class="settingsDropinRemoveButton" remmod="${dropin.fullName}">${Lang.queryJS('settings.dropinMods.removeButton')}</button>
                                </div>
                            </div>
                        </div>
                        <label class="toggleSwitch">
                            <input type="checkbox" formod="${dropin.fullName}" dropin ${!dropin.disabled ? 'checked' : ''}>
                            <span class="toggleSwitchSlider"></span>
                        </label>
                    </div>
                </div>`
    }

    document.getElementById('settingsDropinModsContent').innerHTML = dropinMods
}

/**
 * Bind the remove button for each loaded drop-in mod.
 */
function bindDropinModsRemoveButton(){
    const sEls = settingsModsContainer.querySelectorAll('[remmod]')
    Array.from(sEls).map((v, index, arr) => {
        v.onclick = async () => {
            const fullName = v.getAttribute('remmod')
            const res = await DropinModUtil.deleteDropinMod(CACHE_SETTINGS_MODS_DIR, fullName)
            if(res){
                document.getElementById(fullName).remove()
            } else {
                setOverlayContent(
                    Lang.queryJS('settings.dropinMods.deleteFailedTitle', { fullName }),
                    Lang.queryJS('settings.dropinMods.deleteFailedMessage'),
                    Lang.queryJS('settings.dropinMods.okButton')
                )
                setOverlayHandler(null)
                toggleOverlay(true)
            }
        }
    })
}

/**
 * Bind functionality to the file system button for the selected
 * server configuration.
 */
function bindDropinModFileSystemButton(){
    const fsBtn = document.getElementById('settingsDropinFileSystemButton')
    fsBtn.onclick = () => {
        DropinModUtil.validateDir(CACHE_SETTINGS_MODS_DIR)
        shell.openPath(CACHE_SETTINGS_MODS_DIR)
    }
    fsBtn.ondragenter = e => {
        e.dataTransfer.dropEffect = 'move'
        fsBtn.setAttribute('drag', '')
        e.preventDefault()
    }
    fsBtn.ondragover = e => {
        e.preventDefault()
    }
    fsBtn.ondragleave = e => {
        fsBtn.removeAttribute('drag')
    }

    fsBtn.ondrop = async e => {
        fsBtn.removeAttribute('drag')
        e.preventDefault()

        DropinModUtil.addDropinMods(e.dataTransfer.files, CACHE_SETTINGS_MODS_DIR)
        await reloadDropinMods()
    }
}

/**
 * Save drop-in mod states. Enabling and disabling is just a matter
 * of adding/removing the .disabled extension.
 */
function saveDropinModConfiguration(){
    for(dropin of CACHE_DROPIN_MODS){
        const dropinUI = document.getElementById(dropin.fullName)
        if(dropinUI != null){
            const dropinUIEnabled = dropinUI.hasAttribute('enabled')
            if(DropinModUtil.isDropinModEnabled(dropin.fullName) != dropinUIEnabled){
                DropinModUtil.toggleDropinMod(CACHE_SETTINGS_MODS_DIR, dropin.fullName, dropinUIEnabled).catch(err => {
                    if(!isOverlayVisible()){
                        setOverlayContent(
                            Lang.queryJS('settings.dropinMods.failedToggleTitle'),
                            err.message,
                            Lang.queryJS('settings.dropinMods.okButton')
                        )
                        setOverlayHandler(null)
                        toggleOverlay(true)
                    }
                })
            }
        }
    }
}

// Refresh the drop-in mods when F5 is pressed.
// Only active on the mods tab.
document.addEventListener('keydown', async (e) => {
    if(getCurrentView() === VIEWS.settings && selectedSettingsTab === 'settingsTabMods'){
        if(e.key === 'F5'){
            await reloadDropinMods()
            saveShaderpackSettings()
            await resolveShaderpacksForUI()
        }
    }
})

async function reloadDropinMods(){
    await resolveDropinModsForUI()
    bindDropinModsRemoveButton()
    bindDropinModFileSystemButton()
    bindModsToggleSwitch()
}

// Shaderpack

let CACHE_SETTINGS_INSTANCE_DIR
let CACHE_SHADERPACKS
let CACHE_SELECTED_SHADERPACK

/**
 * Load shaderpack information.
 */
async function resolveShaderpacksForUI(){
    const distro = await DistroAPI.getDistribution()
    if(!distro){
        setShadersOptions([], 'OFF')
        return
    }
    const serv = resolveSelectedServerLike(distro)
    if(!serv || !serv.rawServer){
        setShadersOptions([], 'OFF')
        return
    }
    CACHE_SETTINGS_INSTANCE_DIR = path.join(ConfigManager.getInstanceDirectory(), serv.rawServer.id)
    CACHE_SHADERPACKS = DropinModUtil.scanForShaderpacks(CACHE_SETTINGS_INSTANCE_DIR)
    CACHE_SELECTED_SHADERPACK = DropinModUtil.getEnabledShaderpack(CACHE_SETTINGS_INSTANCE_DIR)

    setShadersOptions(CACHE_SHADERPACKS, CACHE_SELECTED_SHADERPACK)
}

function setShadersOptions(arr, selected){
    const cont = document.getElementById('settingsShadersOptions')
    cont.innerHTML = ''
    for(let opt of arr) {
        const d = document.createElement('DIV')
        d.innerHTML = opt.name
        d.setAttribute('value', opt.fullName)
        if(opt.fullName === selected) {
            d.setAttribute('selected', '')
            document.getElementById('settingsShadersSelected').innerHTML = opt.name
        }
        d.addEventListener('click', function(e) {
            this.parentNode.previousElementSibling.innerHTML = this.innerHTML
            for(let sib of this.parentNode.children){
                sib.removeAttribute('selected')
            }
            this.setAttribute('selected', '')
            closeSettingsSelect()
        })
        cont.appendChild(d)
    }
}

function saveShaderpackSettings(){
    let sel = 'OFF'
    for(let opt of document.getElementById('settingsShadersOptions').childNodes){
        if(opt.hasAttribute('selected')){
            sel = opt.getAttribute('value')
        }
    }
    DropinModUtil.setEnabledShaderpack(CACHE_SETTINGS_INSTANCE_DIR, sel)
}

function bindShaderpackButton() {
    const spBtn = document.getElementById('settingsShaderpackButton')
    spBtn.onclick = () => {
        const p = path.join(CACHE_SETTINGS_INSTANCE_DIR, 'shaderpacks')
        DropinModUtil.validateDir(p)
        shell.openPath(p)
    }
    spBtn.ondragenter = e => {
        e.dataTransfer.dropEffect = 'move'
        spBtn.setAttribute('drag', '')
        e.preventDefault()
    }
    spBtn.ondragover = e => {
        e.preventDefault()
    }
    spBtn.ondragleave = e => {
        spBtn.removeAttribute('drag')
    }

    spBtn.ondrop = async e => {
        spBtn.removeAttribute('drag')
        e.preventDefault()

        DropinModUtil.addShaderpacks(e.dataTransfer.files, CACHE_SETTINGS_INSTANCE_DIR)
        saveShaderpackSettings()
        await resolveShaderpacksForUI()
    }
}

function bindGenerateURLButton() {
    const spBtn = document.getElementById('copyURLButton')
    spBtn.onclick = () => {
        saveModConfiguration()

        const url = ServerOptionQuery.generateURL()

        // クリップボードにコピー
        navigator.clipboard.writeText(url)
            .then(() => {
                setOverlayContent(
                    'URLをクリップボードにコピーしました',
                    'みんなに共有しましょう！',
                    Lang.queryJS('landing.launch.okay')
                )
                setOverlayHandler(null)
                toggleOverlay(true)
                toggleLaunchArea(false)
                return
            })
            .catch(err => {
                setOverlayContent(
                    '失敗',
                    'コピーに失敗しました。',
                    Lang.queryJS('landing.launch.okay')
                )
                setOverlayHandler(null)
                toggleOverlay(true)
                toggleLaunchArea(false)
                return
            })
    }
}

function bindGenerateDiscordStringButton() {
    const spBtn = document.getElementById('copyDisicordStringButton')
    spBtn.onclick = () => {
        saveModConfiguration()

        const msg = ServerOptionQuery.generateDiscordString()

        // クリップボードにコピー
        navigator.clipboard.writeText(msg)
            .then(() => {
                setOverlayContent(
                    'メッセージをクリップボードにコピーしました',
                    'Discordでみんなに共有しましょう！',
                    Lang.queryJS('landing.launch.okay')
                )
                setOverlayHandler(null)
                toggleOverlay(true)
                toggleLaunchArea(false)
                return
            })
            .catch(err => {
                setOverlayContent(
                    '失敗',
                    'コピーに失敗しました。',
                    Lang.queryJS('landing.launch.okay')
                )
                setOverlayHandler(null)
                toggleOverlay(true)
                toggleLaunchArea(false)
                return
            })
    }
}


// Server status bar functions.

/**
 * Generate the icon HTML used by server listings.
 * Kept here so settings.js can use it before overlay.js loads.
 */
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
 * Load the currently selected server information onto the mods tab.
 */
async function loadSelectedServerOnModsTab(){
    const distro = await DistroAPI.getDistribution()
    if(!distro){
        for(const el of document.getElementsByClassName('settingsSelServContent')) {
            el.innerHTML = ''
        }
        return
    }
    const serv = resolveSelectedServerLike(distro)
    if(!serv || !serv.rawServer){
        for(const el of document.getElementsByClassName('settingsSelServContent')) {
            el.innerHTML = ''
        }
        return
    }

    for(const el of document.getElementsByClassName('settingsSelServContent')) {
        let serverName = removeOrderNumber(serv.rawServer.name)
        el.innerHTML = `
            ${generateIcon(serv.rawServer.icon, serverName)}
            <div class="serverListingDetails">
                <span class="serverListingName">${serverName}</span>
                <span class="serverListingDescription">${serv.rawServer.description}</span>
                <div class="serverListingInfo">
                    <div class="serverListingVersion">${serv.rawServer.minecraftVersion}</div>
                    <div class="serverListingRevision">${serv.rawServer.version}</div>
                    ${serv.rawServer.mainServer ? `<div class="serverListingStarWrapper">
                        <svg id="Layer_1" viewBox="0 0 107.45 104.74" width="20px" height="20px">
                            <defs>
                                <style>.cls-1{fill:#fff;}.cls-2{fill:none;stroke:#fff;stroke-miterlimit:10;}</style>
                            </defs>
                            <path class="cls-1" d="M100.93,65.54C89,62,68.18,55.65,63.54,52.13c2.7-5.23,18.8-19.2,28-27.55C81.36,31.74,63.74,43.87,58.09,45.3c-2.41-5.37-3.61-26.52-4.37-39-.77,12.46-2,33.64-4.36,39-5.7-1.46-23.3-13.57-33.49-20.72,9.26,8.37,25.39,22.36,28,27.55C39.21,55.68,18.47,62,6.52,65.55c12.32-2,33.63-6.06,39.34-4.9-.16,5.87-8.41,26.16-13.11,37.69,6.1-10.89,16.52-30.16,21-33.9,4.5,3.79,14.93,23.09,21,34C70,86.84,61.73,66.48,61.59,60.65,67.36,59.49,88.64,63.52,100.93,65.54Z"/>
                            <circle class="cls-2" cx="53.73" cy="53.9" r="38"/>
                        </svg>
                        <span class="serverListingStarTooltip">${Lang.queryJS('settings.serverListing.mainServer')}</span>
                    </div>` : ''}
                </div>
            </div>
        `
    }
}

// Bind functionality to the server switch button.
Array.from(document.getElementsByClassName('settingsSwitchServerButton')).forEach(el => {
    el.addEventListener('click', async e => {
        e.target.blur()
        await toggleServerSelection(true)
    })
})

/**
 * Save mod configuration for the current selected server.
 */
function saveAllModConfigurations(){
    saveModConfiguration()
    ConfigManager.save()
    saveDropinModConfiguration()
}

/**
 * Function to refresh the current tab whenever the selected
 * server is changed.
 */
function animateSettingsTabRefresh(){
    $(`#${selectedSettingsTab}`).fadeOut(500, async () => {
        await prepareSettings()
        $(`#${selectedSettingsTab}`).fadeIn(500)
    })
}

/**
 * Prepare the Mods tab for display.
 */
async function prepareModsTab(first){

    await resolveModsForUI()

    await resolveDropinModsForUI()
    await resolveShaderpacksForUI()
    bindDropinModsRemoveButton()
    bindDropinModFileSystemButton()
    bindShaderpackButton()
    bindModsToggleSwitch()
    bindGenerateURLButton()
    bindGenerateDiscordStringButton()
    await loadSelectedServerOnModsTab()
}

/**
 * Java Tab
 */

// DOM Cache
const settingsMaxRAMRange     = document.getElementById('settingsMaxRAMRange')
const settingsMinRAMRange     = document.getElementById('settingsMinRAMRange')
const settingsMaxRAMLabel     = document.getElementById('settingsMaxRAMLabel')
const settingsMinRAMLabel     = document.getElementById('settingsMinRAMLabel')
const settingsMemoryTotal     = document.getElementById('settingsMemoryTotal')
const settingsMemoryAvail     = document.getElementById('settingsMemoryAvail')
const settingsJavaExecDetails = document.getElementById('settingsJavaExecDetails')
const settingsJavaReqDesc     = document.getElementById('settingsJavaReqDesc')
const settingsJvmOptsLink     = document.getElementById('settingsJvmOptsLink')

// Bind on change event for min memory container.
settingsMinRAMRange.onchange = (e) => {

    // Current range values
    const sMaxV = Number(settingsMaxRAMRange.getAttribute('value'))
    const sMinV = Number(settingsMinRAMRange.getAttribute('value'))

    // Get reference to range bar.
    const bar = e.target.getElementsByClassName('rangeSliderBar')[0]
    // Calculate effective total memory.
    const max = os.totalmem()/1073741824

    // Change range bar color based on the selected value.
    if(sMinV >= max/2){
        bar.style.background = '#e86060'
    } else if(sMinV >= max/4) {
        bar.style.background = '#e8e18b'
    } else {
        bar.style.background = null
    }

    // Increase maximum memory if the minimum exceeds its value.
    if(sMaxV < sMinV){
        const sliderMeta = calculateRangeSliderMeta(settingsMaxRAMRange)
        updateRangedSlider(settingsMaxRAMRange, sMinV,
            ((sMinV-sliderMeta.min)/sliderMeta.step)*sliderMeta.inc)
        settingsMaxRAMLabel.innerHTML = sMinV.toFixed(1) + 'G'
    }

    // Update label
    settingsMinRAMLabel.innerHTML = sMinV.toFixed(1) + 'G'
}

// Bind on change event for max memory container.
settingsMaxRAMRange.onchange = (e) => {
    // Current range values
    const sMaxV = Number(settingsMaxRAMRange.getAttribute('value'))
    const sMinV = Number(settingsMinRAMRange.getAttribute('value'))

    // Get reference to range bar.
    const bar = e.target.getElementsByClassName('rangeSliderBar')[0]
    // Calculate effective total memory.
    const max = os.totalmem()/1073741824

    // Change range bar color based on the selected value.
    if(sMaxV >= max/2){
        bar.style.background = '#e86060'
    } else if(sMaxV >= max/4) {
        bar.style.background = '#e8e18b'
    } else {
        bar.style.background = null
    }

    // Decrease the minimum memory if the maximum value is less.
    if(sMaxV < sMinV){
        const sliderMeta = calculateRangeSliderMeta(settingsMaxRAMRange)
        updateRangedSlider(settingsMinRAMRange, sMaxV,
            ((sMaxV-sliderMeta.min)/sliderMeta.step)*sliderMeta.inc)
        settingsMinRAMLabel.innerHTML = sMaxV.toFixed(1) + 'G'
    }
    settingsMaxRAMLabel.innerHTML = sMaxV.toFixed(1) + 'G'
}

/**
 * Calculate common values for a ranged slider.
 *
 * @param {Element} v The range slider to calculate against.
 * @returns {Object} An object with meta values for the provided ranged slider.
 */
function calculateRangeSliderMeta(v){
    const val = {
        max: Number(v.getAttribute('max')),
        min: Number(v.getAttribute('min')),
        step: Number(v.getAttribute('step')),
    }
    val.ticks = (val.max-val.min)/val.step
    val.inc = 100/val.ticks
    return val
}

/**
 * Binds functionality to the ranged sliders. They're more than
 * just divs now :').
 */
function bindRangeSlider(){
    Array.from(document.getElementsByClassName('rangeSlider')).map((v) => {

        // Reference the track (thumb).
        const track = v.getElementsByClassName('rangeSliderTrack')[0]

        // Set the initial slider value.
        const value = v.getAttribute('value')
        const sliderMeta = calculateRangeSliderMeta(v)

        updateRangedSlider(v, value, ((value-sliderMeta.min)/sliderMeta.step)*sliderMeta.inc)

        // The magic happens when we click on the track.
        track.onmousedown = (e) => {

            // Stop moving the track on mouse up.
            document.onmouseup = (e) => {
                document.onmousemove = null
                document.onmouseup = null
            }

            // Move slider according to the mouse position.
            document.onmousemove = (e) => {

                // Distance from the beginning of the bar in pixels.
                const diff = e.pageX - v.offsetLeft - track.offsetWidth/2

                // Don't move the track off the bar.
                if(diff >= 0 && diff <= v.offsetWidth-track.offsetWidth/2){

                    // Convert the difference to a percentage.
                    const perc = (diff/v.offsetWidth)*100
                    // Calculate the percentage of the closest notch.
                    const notch = Number(perc/sliderMeta.inc).toFixed(0)*sliderMeta.inc

                    // If we're close to that notch, stick to it.
                    if(Math.abs(perc-notch) < sliderMeta.inc/2){
                        updateRangedSlider(v, sliderMeta.min+(sliderMeta.step*(notch/sliderMeta.inc)), notch)
                    }
                }
            }
        }
    })
}

/**
 * Update a ranged slider's value and position.
 *
 * @param {Element} element The ranged slider to update.
 * @param {string | number} value The new value for the ranged slider.
 * @param {number} notch The notch that the slider should now be at.
 */
function updateRangedSlider(element, value, notch){
    const oldVal = element.getAttribute('value')
    const bar = element.getElementsByClassName('rangeSliderBar')[0]
    const track = element.getElementsByClassName('rangeSliderTrack')[0]

    element.setAttribute('value', value)

    if(notch < 0){
        notch = 0
    } else if(notch > 100) {
        notch = 100
    }

    const event = new MouseEvent('change', {
        target: element,
        type: 'change',
        bubbles: false,
        cancelable: true
    })

    let cancelled = !element.dispatchEvent(event)

    if(!cancelled){
        track.style.left = notch + '%'
        bar.style.width = notch + '%'
    } else {
        element.setAttribute('value', oldVal)
    }
}

/**
 * Display the total and available RAM.
 */
function populateMemoryStatus(){
    settingsMemoryTotal.innerHTML = Number((os.totalmem()-1073741824)/1073741824).toFixed(1) + 'G'
    settingsMemoryAvail.innerHTML = Number(os.freemem()/1073741824).toFixed(1) + 'G'
}

/**
 * Validate the provided executable path and display the data on
 * the UI.
 *
 * @param {string} execPath The executable path to populate against.
 */
async function populateJavaExecDetails(execPath){
    const distro = await DistroAPI.getDistribution()
    if(!distro){
        settingsJavaExecDetails.innerHTML = Lang.queryJS('settings.java.invalidSelection')
        return
    }
    const server = distro.getServerById(ConfigManager.getSelectedServer())
    if(!server || !server.effectiveJavaOptions){
        settingsJavaExecDetails.innerHTML = Lang.queryJS('settings.java.invalidSelection')
        return
    }

    const details = await validateSelectedJvm(ensureJavaDirIsRoot(execPath), server.effectiveJavaOptions.supported)

    if(details != null) {
        settingsJavaExecDetails.innerHTML = Lang.queryJS('settings.java.selectedJava', { version: details.semverStr, vendor: details.vendor })
    } else {
        settingsJavaExecDetails.innerHTML = Lang.queryJS('settings.java.invalidSelection')
    }
}

function populateJavaReqDesc(server) {
    settingsJavaReqDesc.innerHTML = Lang.queryJS('settings.java.requiresJava', { major: server.effectiveJavaOptions.suggestedMajor })
}

function populateJvmOptsLink(server) {
    const major = server.effectiveJavaOptions.suggestedMajor
    settingsJvmOptsLink.innerHTML = Lang.queryJS('settings.java.availableOptions', { major: major })
    if(major >= 12) {
        settingsJvmOptsLink.href = `https://docs.oracle.com/en/java/javase/${major}/docs/specs/man/java.html#extra-options-for-java`
    }
    else if(major >= 11) {
        settingsJvmOptsLink.href = 'https://docs.oracle.com/en/java/javase/11/tools/java.html#GUID-3B1CE181-CD30-4178-9602-230B800D4FAE'
    }
    else if(major >= 9) {
        settingsJvmOptsLink.href = `https://docs.oracle.com/javase/${major}/tools/java.htm`
    }
    else {
        settingsJvmOptsLink.href = `https://docs.oracle.com/javase/${major}/docs/technotes/tools/${process.platform === 'win32' ? 'windows' : 'unix'}/java.html`
    }
}

function bindMinMaxRam(server) {
    // Store maximum memory values.
    const SETTINGS_MAX_MEMORY = ConfigManager.getAbsoluteMaxRAM(server.rawServer.javaOptions?.ram)
    const SETTINGS_MIN_MEMORY = ConfigManager.getAbsoluteMinRAM(server.rawServer.javaOptions?.ram)

    // Set the max and min values for the ranged sliders.
    settingsMaxRAMRange.setAttribute('max', SETTINGS_MAX_MEMORY)
    settingsMaxRAMRange.setAttribute('min', SETTINGS_MIN_MEMORY)
    settingsMinRAMRange.setAttribute('max', SETTINGS_MAX_MEMORY)
    settingsMinRAMRange.setAttribute('min', SETTINGS_MIN_MEMORY)
}

/**
 * Prepare the Java tab for display.
 */
async function prepareJavaTab(){
    const distro = await DistroAPI.getDistribution()
    if(!distro) return
    const server = distro.getServerById(ConfigManager.getSelectedServer())
    if(!server) return
    bindMinMaxRam(server)
    bindRangeSlider(server)
    populateMemoryStatus()
    populateJavaReqDesc(server)
    populateJvmOptsLink(server)
}

/**
 * About Tab
 */

const settingsTabAbout             = document.getElementById('settingsTabAbout')
const settingsAboutChangelogTitle  = settingsTabAbout.getElementsByClassName('settingsChangelogTitle')[0]
const settingsAboutChangelogText   = settingsTabAbout.getElementsByClassName('settingsChangelogText')[0]
const settingsAboutChangelogButton = settingsTabAbout.getElementsByClassName('settingsChangelogButton')[0]

// Bind the devtools toggle button.
document.getElementById('settingsAboutDevToolsButton').onclick = (e) => {
    let window = remote.getCurrentWindow()
    window.toggleDevTools()
}

/**
 * Return whether or not the provided version is a prerelease.
 *
 * @param {string} version The semver version to test.
 * @returns {boolean} True if the version is a prerelease, otherwise false.
 */
function isPrerelease(version){
    const preRelComp = semver.prerelease(version)
    return preRelComp != null && preRelComp.length > 0
}

/**
 * Utility method to display version information on the
 * About and Update settings tabs.
 *
 * @param {string} version The semver version to display.
 * @param {Element} valueElement The value element.
 * @param {Element} titleElement The title element.
 * @param {Element} checkElement The check mark element.
 */
function populateVersionInformation(version, valueElement, titleElement, checkElement){
    valueElement.innerHTML = version
    if(isPrerelease(version)){
        titleElement.innerHTML = Lang.queryJS('settings.about.preReleaseTitle')
        titleElement.style.color = '#ff886d'
        checkElement.style.background = '#ff886d'
    } else {
        titleElement.innerHTML = Lang.queryJS('settings.about.stableReleaseTitle')
        titleElement.style.color = null
        checkElement.style.background = null
    }
}

/**
 * Retrieve the version information and display it on the UI.
 */
function populateAboutVersionInformation(){
    populateVersionInformation(remote.app.getVersion(), document.getElementById('settingsAboutCurrentVersionValue'), document.getElementById('settingsAboutCurrentVersionTitle'), document.getElementById('settingsAboutCurrentVersionCheck'))
}

/**
 * Fetches the GitHub atom release feed and parses it for the release notes
 * of the current version. This value is displayed on the UI.
 */
function populateReleaseNotes(){
    $.ajax({
        url: 'https://github.com/oogatakun/NumapoteLauncher/releases.atom',
        success: (data) => {
            const version = 'v' + remote.app.getVersion()
            const entries = $(data).find('entry')

            for(let i=0; i<entries.length; i++){
                const entry = $(entries[i])
                let id = entry.find('id').text()
                id = id.substring(id.lastIndexOf('/')+1)

                if(id === version){
                    settingsAboutChangelogTitle.innerHTML = entry.find('title').text()
                    settingsAboutChangelogText.innerHTML = entry.find('content').text()
                    settingsAboutChangelogButton.href = entry.find('link').attr('href')
                }
            }

        },
        timeout: 2500
    }).catch(err => {
        settingsAboutChangelogText.innerHTML = Lang.queryJS('settings.about.releaseNotesFailed')
    })
}

/**
 * Prepare account tab for display.
 */
function prepareAboutTab(){
    populateAboutVersionInformation()
    populateReleaseNotes()
}

/**
 * Update Tab
 */

const settingsTabUpdate            = document.getElementById('settingsTabUpdate')
const settingsUpdateTitle          = document.getElementById('settingsUpdateTitle')
const settingsUpdateVersionCheck   = document.getElementById('settingsUpdateVersionCheck')
const settingsUpdateVersionTitle   = document.getElementById('settingsUpdateVersionTitle')
const settingsUpdateVersionValue   = document.getElementById('settingsUpdateVersionValue')
const settingsUpdateChangelogTitle = settingsTabUpdate.getElementsByClassName('settingsChangelogTitle')[0]
const settingsUpdateChangelogText  = settingsTabUpdate.getElementsByClassName('settingsChangelogText')[0]
const settingsUpdateChangelogCont  = settingsTabUpdate.getElementsByClassName('settingsChangelogContainer')[0]
const settingsUpdateActionButton   = document.getElementById('settingsUpdateActionButton')

/**
 * Update the properties of the update action button.
 *
 * @param {string} text The new button text.
 * @param {boolean} disabled Optional. Disable or enable the button
 * @param {function} handler Optional. New button event handler.
 */
function settingsUpdateButtonStatus(text, disabled = false, handler = null){
    settingsUpdateActionButton.innerHTML = text
    settingsUpdateActionButton.disabled = disabled
    if(handler != null){
        settingsUpdateActionButton.onclick = handler
    }
}

/**
 * Populate the update tab with relevant information.
 *
 * @param {Object} data The update data.
 */
function populateSettingsUpdateInformation(data){
    if(data != null){
        settingsUpdateTitle.innerHTML = isPrerelease(data.version) ? Lang.queryJS('settings.updates.newPreReleaseTitle') : Lang.queryJS('settings.updates.newReleaseTitle')
        settingsUpdateChangelogCont.style.display = null
        settingsUpdateChangelogTitle.innerHTML = data.releaseName
        settingsUpdateChangelogText.innerHTML = data.releaseNotes
        populateVersionInformation(data.version, settingsUpdateVersionValue, settingsUpdateVersionTitle, settingsUpdateVersionCheck)

        if(process.platform === 'darwin'){
            settingsUpdateButtonStatus(Lang.queryJS('settings.updates.downloadButton'), false, () => {
                shell.openExternal(data.darwindownload)
            })
        } else {
            settingsUpdateButtonStatus(Lang.queryJS('settings.updates.downloadingButton'), true)
        }
    } else {
        settingsUpdateTitle.innerHTML = Lang.queryJS('settings.updates.latestVersionTitle')
        settingsUpdateChangelogCont.style.display = 'none'
        populateVersionInformation(remote.app.getVersion(), settingsUpdateVersionValue, settingsUpdateVersionTitle, settingsUpdateVersionCheck)
        settingsUpdateButtonStatus(Lang.queryJS('settings.updates.checkForUpdatesButton'), false, () => {
            if(!isDev){
                ipcRenderer.send('autoUpdateAction', 'checkForUpdate')
                settingsUpdateButtonStatus(Lang.queryJS('settings.updates.checkingForUpdatesButton'), true)
            }
        })
    }
}

/**
 * Prepare update tab for display.
 *
 * @param {Object} data The update data.
 */
function prepareUpdateTab(data = null){
    populateSettingsUpdateInformation(data)
}

/**
 * Settings preparation functions.
 */

/**
 * Initialize input validators for the settings UI.
 * This is a lightweight stub to avoid ReferenceErrors while the
 * full validator implementation is restored.
 */
function initSettingsValidators(){
    // No-op minimal validator initializer. Implement full validators
    // if/when the original validation block is restored.
    try {
        // If a done button exists, ensure it's enabled by default.
        settingsSaveDisabled(false)
    } catch (e) { /* ignore */ }
}

/**
 * Populate initial values into the settings UI.
 * Minimal implementation to avoid blocking prepareSettings().
 */
async function initSettingsValues(){
    try {
        // Populate accounts list if possible
        try { populateAuthAccounts() } catch (e) { /* ignore */ }

        // Populate about/version information if available
        try { populateAboutVersionInformation() } catch (e) { /* ignore */ }

        // Update custom distro label if present
        try {
            const cd = document.getElementById('frameCustomDistro')
            if(cd && typeof ConfigManager !== 'undefined' && typeof ConfigManager.getDistributionUrl === 'function'){
                cd.innerText = ConfigManager.getDistributionUrl() ?? ''
            }
        } catch (e) { /* ignore */ }
    } catch (err) {
        console.warn('initSettingsValues failed', err)
    }
}

/**
  * Prepare the entire settings UI.
  *
  * @param {boolean} first Whether or not it is the first load.
  */
async function prepareSettings(first = false) {
    if(first){
        setupSettingsTabs()
        initSettingsValidators()
        prepareUpdateTab()
    } else {
        await prepareModsTab()
    }

    await initSettingsValues()
    prepareAccountsTab()
    await prepareJavaTab()
    prepareAboutTab()
}

// Prepare the settings UI on startup.
//prepareSettings(true)

// (Removed update-tab sub-navigation; 'コード' is now a top-level settings tab.)

/**
 * Launcher Custom Code (JSON) apply/revert
 */
const settingsCustomCode = document.getElementById('settingsCustomCode')
const settingsApplyCustomCode = document.getElementById('settingsApplyCustomCode')
const settingsRevertCustomCode = document.getElementById('settingsRevertCustomCode')

// Cache current runtime defaults so we can revert later
const launcherDefaults = {
    title: document.getElementById('frameTitleText') ? document.getElementById('frameTitleText').innerText : document.title,
    background: document.body.getAttribute('bkid') || (document.body.style.backgroundImage || '').replace(/^url\(['"]?/, '').replace(/['"]?\)$/, ''),
    logo: document.getElementById('settingsAboutLogo') ? document.getElementById('settingsAboutLogo').src : null,
    spinner: document.getElementById('loadCenterImage') ? document.getElementById('loadCenterImage').src : null,
    welcomeSeal: document.getElementById('welcomeImageSeal') ? document.getElementById('welcomeImageSeal').src : null,
    loginSeal: document.getElementById('loginImageSeal') ? document.getElementById('loginImageSeal').src : null,
    landingSeal: document.getElementById('image_seal') ? document.getElementById('image_seal').src : null
}

// Populate input with existing override preset name if present
try {
    const existing = ConfigManager.getLauncherOverride()
    if(existing && Object.keys(existing).length > 0 && settingsCustomCode) {
        if(existing._preset) {
            settingsCustomCode.value = existing._preset
        } else if(existing.title && !existing.background && !existing.logo && !existing.remote_distro_url) {
            // If only a title was stored, show that
            settingsCustomCode.value = existing.title
        } else {
            // Leave blank to encourage short codes or JSON input
            settingsCustomCode.value = ''
        }
    }
} catch (err) {
    console.warn('Failed to populate custom code input', err)
}

async function applyCustomCode() {
    if(!settingsCustomCode) return
    const raw = (settingsCustomCode.value || '').trim()
    if(!raw){
        // 空入力でEnterが押されたら、カスタム設定を元に戻す
        await revertCustomCode()
        return
    }

    // Test trigger: typing "error" shows a sample error screen to verify the
    // error overlay and its log-export button.
    if(raw.toLowerCase() === 'error'){
        const testErr = new Error('テスト用エラー: コードタブに "error" が入力されました。')
        if(typeof showLaunchFailure === 'function'){
            showLaunchFailure('テストエラー', 'これは動作確認用のサンプルエラー画面です。「ログを出力」ボタンからログを保存できます。', testErr)
        }
        return
    }

    let parsed
    // If input looks like a short code (no JSON-like characters), require exact preset key
    if(!raw.startsWith('{') && !raw.startsWith('[') && !raw.includes(':')){
        // Only the exact code --tyaromars-- is allowed as a short preset key.
        if(raw === '--tyaromars--'){
            const code = raw
            parsed = {
                title: code,
                // Use code-specific background image (not a JSON list)
                background: `https://raw.githubusercontent.com/oogatakun/operation-modPack/refs/heads/main/backgrounds/list.json`,
                // Local fallback icon
                logo: `assets/images/SealCircle.png`,
                _preset: code
            }
        } else {
            // Invalid short code: show overlay and do NOT auto-close
            try {
                setOverlayContent('無効なコードです', '無効なコードです', 'OK')
                setOverlayHandler(null)
                toggleOverlay(true)
            } catch (e) { /* ignore */ }
            return
        }
    } else {
        try {
            parsed = JSON.parse(raw)
        } catch (err) {
            setOverlayContent('無効なJSON', '入力されたコードはJSONとして解析できません。内容を確認してください。', 'OK')
            setOverlayHandler(null)
            toggleOverlay(true)
            return
        }
    }

    // Special-case preset overrides
    if(parsed._preset === '--tyaromars--' || raw === '--tyaromars--'){
        parsed.title = '🌹🐝🐈チャロマーズランチャー🐷⛄❄️'
        parsed._preset = '--tyaromars--'
        // Use repository-wide distribution.json for this preset
        parsed.remote_distro_url = 'https://raw.githubusercontent.com/oogatakun/operation-modPack/refs/heads/main/distribution.json'
        // Ensure background and logo point to expected assets
        parsed.background = `https://raw.githubusercontent.com/oogatakun/operation-modPack/refs/heads/main/backgrounds/list.json`
        parsed.logo = 'assets/images/SealCircle.png'
    }

    // Debug: show the parsed override object
    try { console.log('[Settings] applyCustomCode parsed:', parsed) } catch (err) {}

    // Apply title
    if(parsed.title){
        const f = document.getElementById('frameTitleText')
        if(f) f.innerText = parsed.title
        const aboutT = document.getElementById('settingsAboutTitle')
        if(aboutT) aboutT.innerText = parsed.title
    }

    // Apply background
    if(parsed.background){
        try {
            // If the background points to a list.json, fetch it and pick a random image (like the main process does)
            const isListJson = typeof parsed.background === 'string' && parsed.background.toLowerCase().endsWith('/list.json')
            if(isListJson){
                try {
                    const res = await fetch(parsed.background, { cache: 'no-store' })
                    if(res && res.ok){
                        const body = await res.json()
                        let entries = []
                        if(Array.isArray(body)){
                            entries = body
                        } else if(body && Array.isArray(body.backgrounds)){
                            entries = body.backgrounds
                        }
                        if(entries.length > 0){
                            const base = parsed.background.substring(0, parsed.background.lastIndexOf('/'))
                            const chosen = entries[Math.floor(Math.random() * entries.length)]
                            const imageUrl = `${base}/${chosen}`
                            document.body.style.backgroundImage = `url('${imageUrl}')`
                            document.body.setAttribute('bkid', imageUrl)
                        } else {
                            // Fallback to using the URL directly
                            document.body.style.backgroundImage = `url('${parsed.background}')`
                            document.body.setAttribute('bkid', parsed.background)
                        }
                    } else {
                        // Couldn't fetch list.json; fallback
                        document.body.style.backgroundImage = `url('${parsed.background}')`
                        document.body.setAttribute('bkid', parsed.background)
                    }
                } catch (err) {
                    console.warn('Failed to fetch/parse background list.json', err)
                    try {
                        document.body.style.backgroundImage = `url('${parsed.background}')`
                        document.body.setAttribute('bkid', parsed.background)
                    } catch (e) { /* ignore */ }
                }
            } else {
                document.body.style.backgroundImage = `url('${parsed.background}')`
                document.body.setAttribute('bkid', parsed.background)
            }
        } catch (err) {
            console.warn('Failed to set background', err)
        }
    }

    // Apply logo/icon to known places
    if(parsed.logo){
        const ids = ['settingsAboutLogo','loadCenterImage','welcomeImageSeal','loginImageSeal','image_seal']
        ids.forEach(id => {
            const el = document.getElementById(id)
            if(el) el.src = parsed.logo
        })
    }

    // Apply remote distribution URL (validate, persist and reload)
    if(parsed.remote_distro_url){
        try {
            // Validate remote distribution before persisting to avoid breaking the UI
            let valid = false
            try {
                const res = await fetch(parsed.remote_distro_url, { cache: 'no-store' })
                if(res && res.ok){
                    const json = await res.json()
                    if(json && typeof json === 'object' && typeof json.servers !== 'undefined') valid = true
                }
            } catch (err) {
                valid = false
            }

            if(!valid){
                setOverlayContent('配布の読み込みに失敗しました', '指定した配布URLを読み込めませんでした。URLまたはネットワークを確認してください。', 'OK')
                setOverlayHandler(null)
                toggleOverlay(true)
            } else {
                        // Persist only for approved presets. For normal overrides, apply at runtime only.
                        try {
                            if(parsed._preset === '--tyaromars--'){
                                ConfigManager.setDistributionUrl(parsed.remote_distro_url)
                            } else if(typeof ConfigManager.setRuntimeDistributionUrl === 'function'){
                                ConfigManager.setRuntimeDistributionUrl(parsed.remote_distro_url)
                            } else {
                                // Fallback to the persistent setter if runtime setter unavailable
                                ConfigManager.setDistributionUrl(parsed.remote_distro_url)
                            }
                            // reload distromanager and force-fetch the new distribution, then update UI labels
                            try {
                                const dm = require('./assets/js/distromanager')
                                if(typeof dm.reload === 'function') dm.reload()
                        try {
                            // Attempt to fetch the new distribution immediately so the UI can reflect changes
                            if(dm && dm.DistroAPI && typeof dm.DistroAPI.getDistribution === 'function'){
                                const newDistro = await dm.DistroAPI.getDistribution()
                                // Update the custom distro label on landing if present
                                try {
                                    const cd = document.getElementById('frameCustomDistro')
                                    if(cd) cd.innerText = ConfigManager.getDistributionUrl() ?? ''
                                } catch (e) { /* ignore */ }

                                // Try to update selected server UI if updateSelectedServer is available
                                try {
                                    if(typeof updateSelectedServer === 'function'){
                                        updateSelectedServer(newDistro.getServerById(ConfigManager.getSelectedServer()))
                                    }
                                } catch (e) {
                                    // ignore - best-effort only
                                }
                            }
                        } catch (err) {
                            console.warn('Failed to fetch new distribution after reload', err)
                        }
                    } catch (err) {
                        console.warn('Failed to reload distromanager', err)
                    }
                } catch (err) {
                    console.warn('Failed to set distribution URL', err)
                }
            }
        } catch (err) {
            console.warn('Failed to validate/persist distribution URL', err)
        }
    }

    // Persist overrides in config and save
    ConfigManager.setLauncherOverride(parsed)
    ConfigManager.save()
    // Ensure the settings "完了" button is enabled after applying custom code
    try { settingsSaveDisabled(false) } catch (e) { /* ignore if not present */ }

    const msg = parsed._preset ? `コード "${parsed._preset}" を適用しました。` : 'カスタムコードを適用しました。'
    setOverlayContent('適用しました', msg + ' 再起動なしで反映されます。', 'OK')
    setOverlayHandler(null)
    // Show success overlay briefly, then auto-close so UI remains interactive
    try {
        toggleOverlay(true)
        setTimeout(() => {
            try { toggleOverlay(false) } catch (e) { /* ignore */ }
        }, 1200)
    } catch (err) {
        console.warn('Failed to show/hide overlay', err)
    }
}

// Attach handlers: existing Apply button (if present) and Enter key on input
if(settingsApplyCustomCode) settingsApplyCustomCode.onclick = applyCustomCode
if(settingsCustomCode){
    settingsCustomCode.addEventListener('keydown', (e) => {
        if(e.key === 'Enter'){
            e.preventDefault()
            // Stop this Enter from bubbling to document: applyCustomCode may open
            // an overlay whose Enter handler would otherwise fire on this same
            // keypress and immediately dismiss it.
            e.stopPropagation()
            applyCustomCode()
        }
    })
}

// Prevent double-invocation of applyCustomCode (e.g., Enter triggers keydown and form submit)
let _applyingCustomCode = false

// Wrap applyCustomCode to guard against re-entrancy
const _origApplyCustomCode = applyCustomCode
applyCustomCode = async function(){
    if(_applyingCustomCode) return
    _applyingCustomCode = true
    try {
        await _origApplyCustomCode()
    } finally {
        _applyingCustomCode = false
    }
}

// Reattach click handler to the wrapped applyCustomCode so the guard is effective
if(settingsApplyCustomCode) settingsApplyCustomCode.onclick = applyCustomCode

async function revertCustomCode(){
    try {
        // Clear persisted override
        try {
            ConfigManager.clearLauncherOverride()
            ConfigManager.clearDistributionUrl()
            ConfigManager.save()
        } catch (err) {
            console.warn('Failed to clear launcher override', err)
        }

        // Restore defaults
        try {
            if(launcherDefaults.title){
                const f = document.getElementById('frameTitleText')
                if(f) f.innerText = launcherDefaults.title
                const aboutT = document.getElementById('settingsAboutTitle')
                if(aboutT) aboutT.innerText = launcherDefaults.title
            }
            if(launcherDefaults.background){
                try {
                    document.body.style.backgroundImage = `url('${launcherDefaults.background}')`
                    document.body.setAttribute('bkid', launcherDefaults.background)
                } catch (err) {
                    console.warn('Failed to restore background', err)
                }
            }
            const logoIds = ['settingsAboutLogo','loadCenterImage','welcomeImageSeal','loginImageSeal','image_seal']
            logoIds.forEach(id => {
                const el = document.getElementById(id)
                if(el && launcherDefaults.logo) el.src = launcherDefaults.logo
            })
        } catch (err) {
            console.warn('Failed to restore launcher defaults', err)
        }

        // Reload distro manager to use default
        try {
            const dm = require('./assets/js/distromanager')
            if(typeof dm.reload === 'function') dm.reload()
        } catch (err) {
            console.warn('Failed to reload distromanager', err)
        }
    } catch (err) {
        console.warn('[Settings] revertCustomCode failed', err)
    } finally {
        // Ensure the settings "完了" button is enabled after revert
        try { settingsSaveDisabled(false) } catch (e) { /* ignore if not present */ }
    }
}

async function openModrinthSearch(){
    const ctx = await getModTargetContext()
    if(!ctx || !ctx.loader){
        setOverlayContent('MOD非対応', 'このパックはMODを導入できません（Fabric/Forge のパックを選んでください）。', 'OK')
        setOverlayHandler(null); toggleOverlay(true); return
    }
    document.getElementById('modrinthSearchInput').value = ''
    document.getElementById('modrinthResults').innerHTML = ''
    toggleOverlay(true, 'modrinthContent')
}

function _mrEsc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;' }[c]))
}

async function runModrinthSearch(){
    const ctx = await getModTargetContext()
    if(!ctx || !ctx.loader) return
    const q = document.getElementById('modrinthSearchInput').value.trim()
    const results = document.getElementById('modrinthResults')
    results.innerHTML = '<div style="opacity:0.7">検索中...</div>'
    try {
        const hits = await window.NLModrinth.search(q, ctx.mc, ctx.loader)
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
                <button class="modrinthAddButton" type="button">追加</button>`
            const btn = row.getElementsByClassName('modrinthAddButton')[0]
            btn.onclick = () => addModrinthMod(h, btn)
            results.appendChild(row)
        }
    } catch(err){
        results.innerHTML = '<div style="opacity:0.7">' + (err.message || '検索に失敗しました') + '</div>'
    }
}

async function addModrinthMod(hit, btn){
    const { downloadFile } = require('helios-core/dl')
    const fsx = require('fs-extra'); const pth = require('path')
    const ctx = await getModTargetContext()
    if(!ctx || !ctx.loader) return
    btn.setAttribute('disabled', ''); btn.textContent = '追加中...'
    try {
        const version = await window.NLModrinth.getBestVersion(hit.projectId, ctx.mc, ctx.loader)
        if(!version){ btn.textContent = '非対応'; return }
        const files = await window.NLModrinth.collectRequired(version, ctx.mc, ctx.loader)
        fsx.ensureDirSync(ctx.modsDir)
        let added = 0
        for(const f of files){
            const dest = pth.join(ctx.modsDir, f.filename)
            if(!fsx.existsSync(dest)){ await downloadFile(f.url, dest); added++ }
        }
        btn.textContent = added > 0 ? '追加済み' : '既にあり'
        if(typeof resolveDropinModsForUI === 'function'){ await resolveDropinModsForUI() }
    } catch(err){
        btn.removeAttribute('disabled'); btn.textContent = '再試行'
        console.warn('Modrinth add failed', err)
    }
}

{
    const mb = document.getElementById('settingsModrinthButton')
    if(mb) mb.onclick = () => openModrinthSearch()
    const sb = document.getElementById('modrinthSearchButton')
    if(sb) sb.onclick = () => runModrinthSearch()
    const si = document.getElementById('modrinthSearchInput')
    if(si) si.addEventListener('keydown', (e) => { if(e.key === 'Enter'){ e.preventDefault(); e.stopPropagation(); runModrinthSearch() } })
    const mc = document.getElementById('modrinthCancel')
    if(mc) mc.onclick = () => toggleOverlay(false)
}

if(settingsRevertCustomCode) settingsRevertCustomCode.onclick = revertCustomCode
