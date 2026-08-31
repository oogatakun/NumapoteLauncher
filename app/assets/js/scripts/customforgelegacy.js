/**
 * Legacy (pre-FG3) Forge install helpers for custom instances.
 * window.NLCustomForgeLegacy. Parses the installer's install_profile.json
 * (old versionInfo format), extracts the bundled universal jar, downloads
 * libraries, and builds a Type.ForgeHosted synthetic module.
 */
(function(){
    const path = require('path')
    const fs = require('fs-extra')
    const StreamZip = require('node-stream-zip')
    const { downloadFile } = require('helios-core/dl')
    const { Type } = require('helios-distribution-types')

    const FORGE_MAVEN = 'https://maven.minecraftforge.net/net/minecraftforge/forge'

    // 'g.h:a:v[:classifier]' -> 'g/h/a/v/a-v[-classifier].jar'
    function mavenToPath(name){
        const parts = name.split(':')
        const group = parts[0].replace(/\./g, '/')
        const artifact = parts[1]
        const version = parts[2]
        const classifier = parts.length > 3 ? '-' + parts[3] : ''
        return `${group}/${artifact}/${version}/${artifact}-${version}${classifier}.jar`
    }
    function makeLibraryModule(name, jarPath){
        return {
            rawModule: { type: Type.Library, classpath: true },
            subModules: [],
            getVersionlessMavenIdentifier: () => { const [g, a] = name.split(':'); return `${g}:${a}` },
            getPath: () => jarPath
        }
    }
    function normalizeBase(url){
        const u = url.replace('http://files.minecraftforge.net/maven/', 'https://maven.minecraftforge.net/')
        return u.replace(/\/+$/, '') + '/'
    }
    function forgeInstallerUrl(full){ return `${FORGE_MAVEN}/${full}/forge-${full}-installer.jar` }
    function underLibDir(libDir, p){ return path.normalize(p).startsWith(path.normalize(libDir)) }

    async function installLegacyForge(full, mcVersion, commonDir){
        const installerPath = path.join(commonDir, 'temp', `forge-${full}-installer.jar`)
        if(!fs.existsSync(installerPath)){ await downloadFile(forgeInstallerUrl(full), installerPath) }
        const libDir = path.join(commonDir, 'libraries')
        const zip = new StreamZip.async({ file: installerPath })
        const unresolved = []
        let forgeModule, versionInfo
        try {
            const ip = JSON.parse((await zip.entryData('install_profile.json')).toString('utf8'))
            versionInfo = ip.versionInfo
            if(!versionInfo){ throw new Error('このForgeはモダン(FG3)フォーマットです（レガシー経路では処理できません）') }
            const install = ip.install || {}
            // Extract the bundled universal jar.
            let universalPath = null
            if(install.path && install.filePath){
                universalPath = path.join(libDir, mavenToPath(install.path))
                if(!underLibDir(libDir, universalPath)){ throw new Error('不正なライブラリパス') }
                if(!fs.existsSync(universalPath)){
                    fs.ensureDirSync(path.dirname(universalPath))
                    await zip.extract(install.filePath, universalPath)
                }
            }
            // Resolve libraries (client-required only).
            const subModules = []
            for(const lib of (versionInfo.libraries || [])){
                if(lib.clientreq === false) continue
                const rel = mavenToPath(lib.name)
                const dest = path.join(libDir, rel)
                if(install.path && lib.name === install.path){
                    subModules.push(makeLibraryModule(lib.name, universalPath || dest)); continue
                }
                if(!underLibDir(libDir, dest)){ unresolved.push(lib.name); continue }
                if(!fs.existsSync(dest)){
                    let ok = false
                    const tries = []
                    if(lib.url) tries.push(normalizeBase(lib.url) + rel)
                    tries.push('https://libraries.minecraft.net/' + rel)
                    for(const u of tries){ try { await downloadFile(u, dest); if(fs.existsSync(dest)){ ok = true; break } } catch(e){ /* try next */ } }
                    if(!ok){
                        // Fallback: extract from the installer's bundled maven/ folder.
                        try { fs.ensureDirSync(path.dirname(dest)); await zip.extract('maven/' + rel, dest); ok = fs.existsSync(dest) } catch(e){ /* absent */ }
                    }
                    if(!ok){ unresolved.push(lib.name); continue }
                }
                subModules.push(makeLibraryModule(lib.name, dest))
            }
            const idSrc = install.path || ((versionInfo.libraries || [])[0] && versionInfo.libraries[0].name) || 'net.minecraftforge:forge'
            const idParts = String(idSrc).split(':')
            forgeModule = {
                rawModule: { type: Type.ForgeHosted, classpath: true },
                subModules,
                getVersionlessMavenIdentifier: () => `${idParts[0]}:${idParts[1]}`,
                getPath: () => universalPath
            }
        } finally {
            await zip.close()
        }
        return { forgeModule, modManifest: versionInfo, unresolved }
    }

    window.NLCustomForgeLegacy = { installLegacyForge, mavenToPath }
})()
