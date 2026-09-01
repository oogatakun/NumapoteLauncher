/**
 * Import a modpack (Modrinth .mrpack or CurseForge zip) as a new custom instance,
 * and change the version of an already-imported one. window.NLModpack.
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
    function _api(provider){ return provider === 'curseforge' ? window.NLCurseForge : window.NLModrinth }

    async function _downloadArchive(file, commonDir){
        const dest = path.join(commonDir, 'temp', safeSlug('pack-' + (file.versionId || Date.now())) + '.packzip')
        if(!fs.existsSync(dest)){ await downloadFile(file.url, dest) }
        return dest
    }

    // --- Read MC + loader (throws on unsupported loaders) ---
    function _parseLoaderId(id){
        // 'forge-47.2.0' / 'fabric-0.15.11' / 'quilt-...' / 'neoforge-...'
        const dash = String(id).indexOf('-')
        const name = dash >= 0 ? id.slice(0, dash) : id
        const ver = dash >= 0 ? id.slice(dash + 1) : ''
        return { name: String(name).toLowerCase(), ver }
    }
    async function _readMeta(provider, archivePath){
        const zip = new StreamZip.async({ file: archivePath })
        try {
            if(provider === 'curseforge'){
                const manifest = JSON.parse((await zip.entryData('manifest.json')).toString('utf8'))
                const mc = manifest.minecraft && manifest.minecraft.version
                if(!mc){ throw new Error('modpackのMinecraftバージョンが不明です') }
                const mls = (manifest.minecraft.modLoaders) || []
                const ml = mls.find(l => l.primary) || mls[0]
                if(!ml){ throw new Error('modpackのローダー情報がありません') }
                const { name, ver } = _parseLoaderId(ml.id)
                if(name === 'forge'){ return { mc, loader: 'forge', loaderVersion: ver, name: manifest.name } }
                if(name === 'fabric'){ return { mc, loader: 'fabric', loaderVersion: ver, name: manifest.name } }
                if(name === 'quilt'){ throw new Error('このモッドパックのローダー（Quilt）は未対応です') }
                if(name === 'neoforge'){ throw new Error('このモッドパックのローダー（NeoForge）は未対応です') }
                throw new Error('対応するローダーが見つかりません（Fabric/Forgeのみ対応）')
            }
            // modrinth
            const index = JSON.parse((await zip.entryData('modrinth.index.json')).toString('utf8'))
            const deps = index.dependencies || {}
            const mc = deps.minecraft
            if(!mc){ throw new Error('modpackのMinecraftバージョンが不明です') }
            if(deps['fabric-loader']) return { mc, loader: 'fabric', loaderVersion: deps['fabric-loader'], name: index.name }
            if(deps.forge) return { mc, loader: 'forge', loaderVersion: deps.forge, name: index.name }
            if(deps['quilt-loader']) throw new Error('このモッドパックのローダー（Quilt）は未対応です')
            if(deps.neoforge) throw new Error('このモッドパックのローダー（NeoForge）は未対応です')
            throw new Error('対応するローダーが見つかりません（Fabric/Forgeのみ対応）')
        } finally {
            await zip.close()
        }
    }

    async function _copyOverrides(zip, instDir, managedFiles, prefixes){
        const entries = await zip.entries()
        for(const ename of Object.keys(entries)){
            if(entries[ename].isDirectory) continue
            let rel = null
            for(const pre of prefixes){ if(ename.startsWith(pre)){ rel = ename.slice(pre.length); break } }
            if(rel == null || rel === '') continue
            const dest = path.join(instDir, rel)
            if(!underDir(instDir, dest)) continue
            fs.ensureDirSync(path.dirname(dest))
            await zip.extract(ename, dest)
            managedFiles.push(rel)
        }
    }

    // --- Download files + extract overrides; return placed relative paths ---
    async function _apply(provider, archivePath, instDir, onProgress){
        const managedFiles = []
        const failed = []
        const blockedManual = []
        fs.ensureDirSync(instDir)
        const zip = new StreamZip.async({ file: archivePath })
        try {
            if(provider === 'curseforge'){
                const manifest = JSON.parse((await zip.entryData('manifest.json')).toString('utf8'))
                const list = manifest.files || []
                const resolved = await window.NLCurseForge.resolveFiles(list.map(f => f.fileID))
                for(let i = 0; i < list.length; i++){
                    const r = resolved[String(list[i].fileID)]
                    const fileName = r && r.fileName
                    const url = r && r.downloadUrl
                    if(!fileName){ failed.push('fileID ' + list[i].fileID); if(typeof onProgress === 'function') onProgress(i + 1, list.length); continue }
                    if(!url){
                        // Non-distributable: queue for the in-launcher browser download.
                        blockedManual.push({ modId: list[i].projectID, fileId: list[i].fileID, fileName, fileLength: r.fileLength, md5: r.md5 })
                        if(typeof onProgress === 'function') onProgress(i + 1, list.length); continue
                    }
                    const rel = 'mods/' + fileName
                    const dest = path.join(instDir, rel)
                    if(!underDir(instDir, dest)){ failed.push(fileName); continue }
                    if(!fs.existsSync(dest)){
                        try { fs.ensureDirSync(path.dirname(dest)); await downloadFile(url, dest) }
                        catch(e){ failed.push(fileName); if(typeof onProgress === 'function') onProgress(i + 1, list.length); continue }
                    }
                    managedFiles.push(rel)
                    if(typeof onProgress === 'function') onProgress(i + 1, list.length)
                }
                const ovr = (manifest.overrides || 'overrides').replace(/\/+$/, '') + '/'
                await _copyOverrides(zip, instDir, managedFiles, [ovr])
            } else {
                // modrinth
                const index = JSON.parse((await zip.entryData('modrinth.index.json')).toString('utf8'))
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
                await _copyOverrides(zip, instDir, managedFiles, ['overrides/', 'client-overrides/'])
            }
        } finally {
            await zip.close()
        }
        return { managedFiles, failed, blockedManual }
    }

    // For CurseForge non-distributable files: resolve mod pages and open the
    // in-launcher browser windows to download them into mods/. Adds the target
    // paths to managedFiles (so a later version change removes them).
    async function _startManualDownloads(instDir, blockedManual, managedFiles){
        if(!blockedManual || blockedManual.length === 0) return
        const modIds = Array.from(new Set(blockedManual.map(b => String(b.modId)).filter(Boolean)))
        let mods = {}
        try { mods = await window.NLCurseForge.getModsBulk(modIds) } catch(e){ mods = {} }
        const manualData = []
        for(const b of blockedManual){
            const info = mods[String(b.modId)]
            if(!info || !info.websiteUrl) continue
            const rel = 'mods/' + b.fileName
            manualData.push({
                manual: { name: info.name || b.fileName, url: info.websiteUrl + '/download/' + b.fileId },
                size: b.fileLength, MD5: b.md5, path: path.join(instDir, rel)
            })
            if(!managedFiles.includes(rel)) managedFiles.push(rel)
        }
        if(manualData.length){
            try { require('electron').ipcRenderer.send('openManualWindow', { manualData }) } catch(e){ /* ignore */ }
        }
        return manualData.length
    }

    async function importModpack(provider, hit, file, onProgress){
        const commonDir = ConfigManager.getCommonDirectory()
        if(!file){
            const vers = await _api(provider).getModpackVersions(hit.projectId)
            file = vers[0] && vers[0].file
        }
        if(!file) throw new Error('このパックにダウンロード可能なファイルが見つかりません')
        const archivePath = await _downloadArchive(file, commonDir)
        const meta = await _readMeta(provider, archivePath)
        const id = genId()
        const name = meta.name || hit.title || '無題のパック'
        ConfigManager.addCustomInstance({
            schema: 1, id, name, minecraftVersion: meta.mc, loader: meta.loader, loaderVersion: meta.loaderVersion,
            created: Date.now(), lastPlayed: null,
            modpackSource: { provider, projectId: hit.projectId, versionId: file.versionId }
        })
        ConfigManager.save()
        const instDir = path.join(ConfigManager.getInstanceDirectory(), id)
        const applied = await _apply(provider, archivePath, instDir, onProgress)
        if(provider === 'curseforge'){ await _startManualDownloads(instDir, applied.blockedManual, applied.managedFiles) }
        ConfigManager.updateCustomInstance(id, { managedFiles: applied.managedFiles })
        ConfigManager.save()
        return { id, name, fileCount: applied.managedFiles.length, failed: applied.failed, blocked: (applied.blockedManual || []).length }
    }

    async function changeModpackVersion(instanceId, file, onProgress){
        const commonDir = ConfigManager.getCommonDirectory()
        const ins = ConfigManager.getCustomInstance(instanceId)
        if(!ins) throw new Error('インスタンスが見つかりません')
        if(!file) throw new Error('バージョンが選択されていません')
        const provider = (ins.modpackSource && ins.modpackSource.provider) || 'modrinth'
        const archivePath = await _downloadArchive(file, commonDir)
        const meta = await _readMeta(provider, archivePath) // validates loader (may abort)
        const instDir = path.join(ConfigManager.getInstanceDirectory(), instanceId)
        for(const rel of (ins.managedFiles || [])){
            const dest = path.join(instDir, rel)
            if(underDir(instDir, dest) && fs.existsSync(dest)){ try { fs.removeSync(dest) } catch(e){ /* ignore */ } }
        }
        const applied = await _apply(provider, archivePath, instDir, onProgress)
        if(provider === 'curseforge'){ await _startManualDownloads(instDir, applied.blockedManual, applied.managedFiles) }
        ConfigManager.updateCustomInstance(instanceId, {
            minecraftVersion: meta.mc, loader: meta.loader, loaderVersion: meta.loaderVersion,
            managedFiles: applied.managedFiles,
            modpackSource: Object.assign({}, ins.modpackSource, { versionId: file.versionId })
        })
        ConfigManager.save()
        return { id: instanceId, fileCount: applied.managedFiles.length, failed: applied.failed, blocked: (applied.blockedManual || []).length }
    }

    window.NLModpack = { importModpack, changeModpackVersion }
})()
