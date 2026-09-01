/**
 * Import a Modrinth modpack (.mrpack) as a new custom instance.
 * window.NLModpack.
 */
(function(){
    const path = require('path')
    const fs = require('fs-extra')
    const StreamZip = require('node-stream-zip')
    const { downloadFile } = require('helios-core/dl')
    const ConfigManager = require('./assets/js/configmanager')

    function underDir(base, p){ return path.normalize(p).startsWith(path.normalize(base)) }
    function safeSlug(s){ return String(s || 'pack').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60) }
    function genId(){ return 'custom-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) }

    async function importModrinthModpack(hit, file, onProgress){
        const commonDir = ConfigManager.getCommonDirectory()
        if(!file){
            const vers = await window.NLModrinth.getModpackVersions(hit.projectId)
            file = vers[0] && vers[0].file
        }
        if(!file) throw new Error('このパックに.mrpackファイルが見つかりません')
        const mrpackPath = path.join(commonDir, 'temp', safeSlug((hit.slug || hit.title) + '-' + (file.versionId || '')) + '.mrpack')
        if(!fs.existsSync(mrpackPath)){ await downloadFile(file.url, mrpackPath) }
        const zip = new StreamZip.async({ file: mrpackPath })
        let result
        try {
            const index = JSON.parse((await zip.entryData('modrinth.index.json')).toString('utf8'))
            const deps = index.dependencies || {}
            const mc = deps.minecraft
            if(!mc){ throw new Error('modpackのMinecraftバージョンが不明です') }
            let loader = null, loaderVersion = ''
            if(deps['fabric-loader']){ loader = 'fabric'; loaderVersion = deps['fabric-loader'] }
            else if(deps.forge){ loader = 'forge'; loaderVersion = deps.forge }
            else if(deps['quilt-loader']){ throw new Error('このモッドパックのローダー（Quilt）は未対応です') }
            else if(deps.neoforge){ throw new Error('このモッドパックのローダー（NeoForge）は未対応です') }
            else { throw new Error('対応するローダーが見つかりません（Fabric/Forgeのみ対応）') }

            const id = genId()
            const name = index.name || hit.title || '無題のパック'
            ConfigManager.addCustomInstance({ schema: 1, id, name, minecraftVersion: mc, loader, loaderVersion, created: Date.now(), lastPlayed: null })
            ConfigManager.save()
            const instDir = path.join(ConfigManager.getInstanceDirectory(), id)
            fs.ensureDirSync(instDir)

            const files = (index.files || []).filter(f => !(f.env && f.env.client === 'unsupported'))
            const failed = []
            for(let i = 0; i < files.length; i++){
                const f = files[i]
                const dest = path.join(instDir, f.path)
                if(!underDir(instDir, dest)){ failed.push(f.path); continue }
                if(!fs.existsSync(dest)){
                    try { fs.ensureDirSync(path.dirname(dest)); await downloadFile((f.downloads || [])[0], dest) }
                    catch(e){ failed.push(f.path) }
                }
                if(typeof onProgress === 'function') onProgress(i + 1, files.length)
            }

            // Copy overrides/ and client-overrides/ into the instance dir.
            const entries = await zip.entries()
            for(const ename of Object.keys(entries)){
                const en = entries[ename]
                if(en.isDirectory) continue
                let rel = null
                if(ename.startsWith('overrides/')) rel = ename.slice('overrides/'.length)
                else if(ename.startsWith('client-overrides/')) rel = ename.slice('client-overrides/'.length)
                if(rel == null || rel === '') continue
                const dest = path.join(instDir, rel)
                if(!underDir(instDir, dest)) continue
                fs.ensureDirSync(path.dirname(dest))
                await zip.extract(ename, dest)
            }
            result = { id, name, fileCount: files.length, failed }
        } finally {
            await zip.close()
        }
        return result
    }

    window.NLModpack = { importModrinthModpack }
})()
