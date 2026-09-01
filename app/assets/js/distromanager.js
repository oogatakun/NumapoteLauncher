const { DistributionAPI } = require('helios-core/common')

const ConfigManager = require('./configmanager')

// Old WesterosCraft url.
// exports.REMOTE_DISTRO_URL = 'http://mc.westeroscraft.com/WesterosCraftLauncher/distribution.json'
// exports.REMOTE_DISTRO_URL = 'https://helios-files.geekcorner.eu.org/distribution.json'
const DEFAULT_DISTRO = 'https://raw.githubusercontent.com/oogatakun/modpack/refs/heads/main/distribution.json'

function createInternalApi(){
    const remoteUrl = ConfigManager.getDistributionUrl() ?? DEFAULT_DISTRO
    return new DistributionAPI(
        ConfigManager.getLauncherDirectory(),
        ConfigManager.getCommonDirectory(),
        ConfigManager.getInstanceDirectory(),
        remoteUrl,
        false
    )
}

let _internalApi = createInternalApi()

// Export a proxy that forwards to the current internal API instance.
const api = new Proxy({}, {
    get: (target, prop) => {
        const val = _internalApi[prop]
        if(typeof val === 'function') return val.bind(_internalApi)
        return val
    }
})

exports.DistroAPI = api

/** Reload the internal DistributionAPI instance (e.g., after changing distribution URL). */
exports.reload = function(){
    _internalApi = createInternalApi()
    return api
}
