/**
 * Fabric install helpers for custom instances. window.NLCustomFabric.
 */
(function(){
    const path = require('path')
    const fs = require('fs-extra')
    const { downloadFile } = require('helios-core/dl')
    const { Type } = require('helios-distribution-types')

    // 'net.fabricmc:fabric-loader:0.15.11' -> 'net/fabricmc/fabric-loader/0.15.11/fabric-loader-0.15.11.jar'
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
            getVersionlessMavenIdentifier: () => {
                const [g, a] = name.split(':')
                return `${g}:${a}`
            },
            getPath: () => jarPath
        }
    }

    // Download every profile library into commonDir/libraries and build a
    // synthetic Type.Fabric module (loader) whose subModules are the libraries,
    // matching what ProcessBuilder._resolveServerLibraries expects.
    async function installFabric(profile, commonDir){
        const libDir = path.join(commonDir, 'libraries')
        const libs = Array.isArray(profile.libraries) ? profile.libraries : []
        const subModules = []
        let loaderModule = null
        for(const lib of libs){
            const rel = mavenToPath(lib.name)
            const dest = path.join(libDir, rel)
            if(!fs.existsSync(dest)){
                const base = (lib.url || 'https://maven.fabricmc.net/').replace(/\/$/, '')
                await downloadFile(`${base}/${rel}`, dest)
            }
            const mod = makeLibraryModule(lib.name, dest)
            subModules.push(mod)
            if(lib.name.startsWith('net.fabricmc:fabric-loader:')){
                loaderModule = { name: lib.name, path: dest }
            }
        }
        // The Type.Fabric (loader) module. If the loader jar wasn't in libraries
        // (it always is for Fabric), fall back to the first subModule.
        const loaderName = loaderModule ? loaderModule.name : (libs[0] && libs[0].name)
        const loaderPath = loaderModule ? loaderModule.path : (subModules[0] && subModules[0].getPath())
        return {
            rawModule: { type: Type.Fabric, classpath: true },
            subModules,
            getVersionlessMavenIdentifier: () => {
                const [g, a] = String(loaderName).split(':')
                return `${g}:${a}`
            },
            getPath: () => loaderPath
        }
    }

    window.NLCustomFabric = { mavenToPath, installFabric }
})()
