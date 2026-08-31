/**
 * Forge install helpers for custom instances (modern Forge / MC 1.13+).
 * window.NLCustomForge. Reuses helios-core's DistributionIndexProcessor to run
 * the Forge installer against a synthetic distribution.
 */
(function(){
    const path = require('path')
    const fs = require('fs-extra')
    const { downloadFile, DistributionIndexProcessor } = require('helios-core/dl')
    const { Type } = require('helios-distribution-types')
    const isDev = require('./assets/js/isdev')
    const remote = require('@electron/remote')

    const FORGE_MAVEN = 'https://maven.minecraftforge.net/net/minecraftforge/forge'

    function forgeInstallerUrl(full){
        return `${FORGE_MAVEN}/${full}/forge-${full}-installer.jar`
    }

    // Path to the bundled ForgeInstallerCLI.jar (mirrors landing.js).
    function resolveWrapperPath(){
        const { join } = path
        if(isDev){
            return join(process.cwd(), 'libraries', 'java', 'ForgeInstallerCLI.jar')
        }
        const exePath = remote.app.getPath('exe')
        if(process.platform === 'darwin'){
            return join(exePath, '..', '..', 'Resources', 'libraries', 'java', 'ForgeInstallerCLI.jar')
        }
        return join(exePath, '..', 'resources', 'libraries', 'java', 'ForgeInstallerCLI.jar')
    }

    // A minimal Type.Forge module. installForge (helios) reads getPath()/getMavenComponents();
    // ProcessBuilder's Forge branch reads modManifest.libraries directly, not subModules.
    function makeForgeModule(full, installerPath){
        return {
            rawModule: { type: Type.Forge, classpath: true },
            subModules: [],
            getMavenComponents: () => ({ version: full }),
            getVersionlessMavenIdentifier: () => 'net.minecraftforge:forge',
            getPath: () => installerPath
        }
    }

    async function installForge(full, mcVersion, commonDir, javaExecPath, onProgress){
        const id = 'customforge-' + full
        const installerPath = path.join(commonDir, 'temp', `forge-${full}-installer.jar`)
        if(!fs.existsSync(installerPath)){
            await downloadFile(forgeInstallerUrl(full), installerPath)
        }
        const forgeModule = makeForgeModule(full, installerPath)
        const server = { rawServer: { id, minecraftVersion: mcVersion }, modules: [forgeModule] }
        const synthDistro = { getServerById: (sid) => (sid === id ? server : null) }
        const dip = new DistributionIndexProcessor(commonDir, synthDistro, id)
        // Runs the Forge installer; idempotent (skips if versions/<full>/<full>.json exists).
        await dip.installForge(javaExecPath, resolveWrapperPath(), p => { if(typeof onProgress === 'function') onProgress(p) })
        // Forge version.json (mainClass, arguments, libraries).
        const modManifest = await dip.loadModLoaderVersionJson(server)
        // Ensure every runtime library is on disk (installer downloads most; fill gaps).
        const libDir = path.join(commonDir, 'libraries')
        for(const lib of (modManifest.libraries || [])){
            const art = lib.downloads && lib.downloads.artifact
            if(!art || !art.path) continue
            const dest = path.join(libDir, art.path)
            if(!fs.existsSync(dest) && art.url){
                try { await downloadFile(art.url, dest) } catch(e){ /* processed artifacts have no url; installer made them */ }
            }
        }
        return { forgeModule, modManifest }
    }

    window.NLCustomForge = { installForge, forgeInstallerUrl }
})()
