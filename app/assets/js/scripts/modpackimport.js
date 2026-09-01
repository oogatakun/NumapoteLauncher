/**
 * Import a Modrinth modpack (.mrpack) as a new custom instance, and change the
 * version of an already-imported one. window.NLModpack.
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

    async function _downloadMrpack(file, commonDir){
        const mrpackPath = path.join(commonDir, 'temp', safeSlug('pack-' + (file.versionId || Date.now())) + '.mrpack')
        if(!fs.existsSync(mrpackPath)){ await downloadFile(file.url, mrpackPath) }
        return mrpackPath
    }

    // Read MC + loader from the pack index; throws on unsupported loaders.
    async function _readMrpackMeta(mrpackPath){
        const zip = new StreamZip.async({ file: mrpackPath })
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
            return { mc, loader, loaderVersion, name: index.name }
        } finally {
            await zip.close()
        }
    }

    // Download files + extract overrides into instDir; return placed relative paths.
    async function _applyMrpack(mrpackPath, instDir, onProgress){
        const zip = new StreamZip.async({ file: mrpackPath })
        const managedFiles = []
        const failed = []
        try {
            const index = JSON.parse((await zip.entryData('modrinth.index.json')).toString('utf8'))
            fs.ensureDirSync(instDir)
            const files = (index.files || []).filter(f => !(f.env && f.env.client === 'unsupported'))
            for(let i = 0; i < files.length; i++){
                const f = files[i]
                const dest = path.join(instDir, f.path)
                if(!underDir(instDir, dest)){ failed.push(f.path); continue }
                if(!fs.existsSync(dest)){
                    try { fs.ensureDirSync(path.dirname(dest)); await downloadFile((f.downloads || [])[0], dest) }
                    catch(e){ failed.push(f.path); continue }
                }
                managedFiles.push(f.path)
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
                managedFiles.push(rel)
            }
        } finally {
            await zip.close()
        }
        return { managedFiles, failed }
    }

    async function importModrinthModpack(hit, file, onProgress){
        const commonDir = ConfigManager.getCommonDirectory()
        if(!file){
            const vers = await window.NLModrinth.getModpackVersions(hit.projectId)
            file = vers[0] && vers[0].file
        }
        if(!file) throw new Error('このパックに.mrpackファイルが見つかりません')
        const mrpackPath = await _downloadMrpack(file, commonDir)
        const meta = await _readMrpackMeta(mrpackPath)
        const id = genId()
        const name = meta.name || hit.title || '無題のパック'
        ConfigManager.addCustomInstance({
            schema: 1, id, name, minecraftVersion: meta.mc, loader: meta.loader, loaderVersion: meta.loaderVersion,
            created: Date.now(), lastPlayed: null,
            modpackSource: { provider: 'modrinth', projectId: hit.projectId, versionId: file.versionId }
        })
        ConfigManager.save()
        const instDir = path.join(ConfigManager.getInstanceDirectory(), id)
        const applied = await _applyMrpack(mrpackPath, instDir, onProgress)
        ConfigManager.updateCustomInstance(id, { managedFiles: applied.managedFiles })
        ConfigManager.save()
        return { id, name, fileCount: applied.managedFiles.length, failed: applied.failed }
    }

    async function changeModpackVersion(instanceId, file, onProgress){
        const commonDir = ConfigManager.getCommonDirectory()
        const ins = ConfigManager.getCustomInstance(instanceId)
        if(!ins) throw new Error('インスタンスが見つかりません')
        if(!file) throw new Error('バージョンが選択されていません')
        const mrpackPath = await _downloadMrpack(file, commonDir)
        const meta = await _readMrpackMeta(mrpackPath) // validates loader (may abort)
        const instDir = path.join(ConfigManager.getInstanceDirectory(), instanceId)
        // Remove only the previously pack-managed files.
        for(const rel of (ins.managedFiles || [])){
            const dest = path.join(instDir, rel)
            if(underDir(instDir, dest) && fs.existsSync(dest)){ try { fs.removeSync(dest) } catch(e){ /* ignore */ } }
        }
        const applied = await _applyMrpack(mrpackPath, instDir, onProgress)
        ConfigManager.updateCustomInstance(instanceId, {
            minecraftVersion: meta.mc, loader: meta.loader, loaderVersion: meta.loaderVersion,
            managedFiles: applied.managedFiles,
            modpackSource: Object.assign({}, ins.modpackSource, { versionId: file.versionId })
        })
        ConfigManager.save()
        return { id: instanceId, fileCount: applied.managedFiles.length, failed: applied.failed }
    }

    window.NLModpack = { importModrinthModpack, changeModpackVersion }
})()
