/**
 * Share/receive launch configs as a self-contained code (zlib + base64url).
 * window.NLShare.
 */
(function(){
    const path = require('path')
    const fs = require('fs-extra')
    const zlib = require('zlib')
    const { downloadFile } = require('helios-core/dl')
    const ConfigManager = require('./assets/js/configmanager')
    const DropinModUtil = require('./assets/js/dropinmodutil')
    const ManifestUtil = require('./assets/js/modmanifestutil')
    const ShareCodec = require('./assets/js/sharecodec')

    // Codes written before the compact format: 'NLPACK1' + zlib(JSON). Still readable.
    const PREFIX = 'NLPACK1'
    // The launcher's own URL scheme (registered by the installer) and the https relay page that
    // forwards a click in a browser/chat app to it (docs/s/index.html, published with GitHub Pages).
    const SCHEME_URL = 'numapotelauncher://share/'
    const SHARE_PAGE_URL = 'https://oogatakun.github.io/NumapoteLauncher/s/'

    function _b64urlEncode(buf){ return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }
    function _b64urlDecode(str){
        let s = str.replace(/-/g, '+').replace(/_/g, '/')
        while(s.length % 4) s += '='
        return Buffer.from(s, 'base64')
    }
    function encode(obj){ return _b64urlEncode(zlib.deflateSync(Buffer.from(JSON.stringify(obj), 'utf-8'))) }
    function decode(str){ return JSON.parse(zlib.inflateSync(_b64urlDecode(str)).toString('utf-8')) }

    function _instDir(id){ return path.join(ConfigManager.getInstanceDirectory(), id) }
    function _modsDir(id){ return path.join(_instDir(id), 'mods') }
    function _manifestPath(id){ return path.join(_instDir(id), '.numapote-mods.json') }
    function _readManifest(id){ try { const p = _manifestPath(id); if(fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8')) || {} } catch(e){ /* ignore */ } return {} }
    function _writeManifest(id, obj){ try { fs.writeFileSync(_manifestPath(id), JSON.stringify(obj, null, 2)) } catch(e){ /* ignore */ } }
    function underDir(base, p){ return path.normalize(p).startsWith(path.normalize(base)) }
    function _api(source){ return source === 'curseforge' ? window.NLCurseForge : window.NLModrinth }
    function _mkKey(source, projectId){ return source === 'curseforge' ? ('cf:' + projectId) : projectId }

    // Mods in the folder that are neither pack-managed nor recorded in the manifest.
    function collectUnknownJars(instanceId){
        const ins = ConfigManager.getCustomInstance(instanceId)
        if(!ins) return []
        const modsDir = _modsDir(instanceId)
        const managed = new Set((ins.managedFiles || []))
        const manifest = _readManifest(instanceId)
        const known = new Set()
        for(const k of Object.keys(manifest)){ for(const f of (manifest[k].files || [])){ known.add(f) } }
        let list = []
        try { list = DropinModUtil.scanForDropinMods(modsDir, ins.minecraftVersion) } catch(e){ list = [] }
        const out = []
        for(const d of list){
            const base = d.fullName.replace(/\.disabled$/i, '')
            if(managed.has('mods/' + base) || known.has(base)) continue
            let size = 0
            try { size = fs.statSync(path.join(modsDir, d.fullName)).size } catch(e){ /* ignore */ }
            out.push({ name: base, path: path.join(modsDir, d.fullName), size })
        }
        return out
    }

    function buildShareCode(instanceId, includeRawJars){
        const ins = ConfigManager.getCustomInstance(instanceId)
        if(!ins) throw new Error('インスタンスが見つかりません')
        const payload = { name: ins.name, mc: ins.minecraftVersion, loader: ins.loader, loaderVersion: ins.loaderVersion }
        if(ins.modpackSource){
            payload.modpack = { provider: ins.modpackSource.provider, projectId: ins.modpackSource.projectId, versionId: ins.modpackSource.versionId }
        }
        const managed = new Set((ins.managedFiles || []))
        const manifest = _readManifest(instanceId)
        const mods = []
        for(const key of Object.keys(manifest)){
            const e = manifest[key]
            const files = e.files || []
            // Skip mods that are part of the pack (managed) — they come from re-import.
            if(files.some(f => managed.has('mods/' + f))) continue
            // Skip mods that were only installed as another mod's dependency — the
            // receiver gets them back when it resolves that mod's required deps.
            if(e.auto) continue
            const source = e.source || 'modrinth'
            const projectId = key.indexOf('cf:') === 0 ? key.slice(3) : key
            mods.push({ source, projectId, versionId: e.versionId || null, slug: e.slug || null })
        }
        if(mods.length) payload.mods = mods
        if(includeRawJars){
            const raw = []
            for(const j of collectUnknownJars(instanceId)){
                try { raw.push({ name: j.name, data: fs.readFileSync(j.path).toString('base64') }) } catch(e){ /* skip unreadable */ }
            }
            if(raw.length) payload.rawMods = raw
        }
        const code = ShareCodec.encode(payload)
        // url = opens the launcher directly (browser address bar / run dialog);
        // link = https page that forwards to it, so it is clickable in Discord and the like.
        return { code, url: SCHEME_URL + code, link: SHARE_PAGE_URL + '#' + code }
    }

    // Accepts a bare code, a numapotelauncher:// (or old numapote://) URL, or the https relay link.
    function decodeShareCode(text){
        const code = ShareCodec.extractCode(text)
        if(!code) throw new Error('コードが不正です')
        let payload
        try {
            if(code.indexOf(ShareCodec.PREFIX) === 0){
                payload = ShareCodec.decode(code)
            } else {
                payload = decode(code.slice(PREFIX.length))
                if(!payload || payload.v !== 1) throw new Error('unsupported')
            }
        } catch(e){ throw new Error('コードが不正です') }
        return payload
    }

    // A short, plain-text summary of what a share code contains (for the choice screen).
    function describePayload(p){
        const mods = Array.isArray(p.mods) ? p.mods.length : 0
        const raws = Array.isArray(p.rawMods) ? p.rawMods.length : 0
        return {
            name: p.name || '共有構成',
            mc: p.mc,
            loader: p.loader === 'vanilla' ? 'バニラ' : (p.loader + (p.loaderVersion ? ' ' + p.loaderVersion : '')),
            modCount: mods,
            rawCount: raws,
            hasModpack: !!p.modpack
        }
    }

    // Custom instances a share's mods can be added to (they need a mod loader).
    function candidateInstances(payload){
        return ConfigManager.getCustomInstances()
            .filter(i => i && (i.loader === 'fabric' || i.loader === 'forge'))
            .map(i => ({ id: i.id, name: i.name, mc: i.minecraftVersion, loader: i.loader, sameEnv: !!payload && payload.mc === i.minecraftVersion && payload.loader === i.loader }))
    }

    // Best-effort readable name for a mod we could not install (v2 codes carry ids only).
    async function _labelFor(m){
        try {
            const api = _api(m.source)
            if(api && typeof api.getProjectTitle === 'function'){
                const t = await api.getProjectTitle(m.projectId)
                if(t) return t
            }
        } catch(e){ /* fall through */ }
        return m.slug || (m.source === 'curseforge' ? 'CurseForge #' : 'Modrinth ') + m.projectId
    }

    async function importShareCode(payload, opts, onProgress, token){
        opts = opts || {}
        if(payload.loader !== 'fabric' && payload.loader !== 'forge' && payload.loader !== 'vanilla'){
            throw new Error('対応していないローダーです: ' + payload.loader)
        }
        const failed = []
        let id
        // 1) Create the instance (via modpack import, or bare).
        if(payload.modpack){
            const prov = payload.modpack.provider
            const vers = await _api(prov).getModpackVersions(payload.modpack.projectId)
            const v = (vers || []).find(x => x.versionId === payload.modpack.versionId) || (vers || [])[0]
            if(!v || !v.file) throw new Error('共有元のmodpack版が見つかりません')
            const res = await window.NLModpack.importModpack(prov, { projectId: payload.modpack.projectId, title: payload.name }, v.file, onProgress, token, payload.name)
            id = res.id
            for(const f of (res.failed || [])) failed.push(f)
        } else {
            id = ConfigManager.generateCustomInstanceId(payload.name || '共有構成')
            ConfigManager.addCustomInstance({ schema: 1, id, name: payload.name || '共有構成', minecraftVersion: payload.mc, loader: payload.loader, loaderVersion: payload.loaderVersion || '', created: Date.now(), lastPlayed: null })
            ConfigManager.save()
        }
        const modsDir = _modsDir(id)
        fs.ensureDirSync(modsDir)
        // 2) Download the shared (user-added) mods.
        const mods = payload.mods || []
        const manifest = _readManifest(id)
        for(let i = 0; i < mods.length; i++){
            if(token && token.cancelled) break
            const m = mods[i]
            const api = _api(m.source)
            let version = null
            try { version = m.versionId ? await api.getVersionById(m.versionId) : null } catch(e){ version = null }
            if(!version){ try { version = await api.getBestVersion(m.projectId, payload.mc, payload.loader) } catch(e){ version = null } }
            if(!version){ failed.push(await _labelFor(m)); if(typeof onProgress === 'function') onProgress(i + 1, mods.length); continue }
            let ownFile = null
            let resolved = null
            const downloaded = new Set()
            try {
                resolved = await api.collectRequired(version, payload.mc, payload.loader, m.projectId)
                const files = resolved.files || []
                for(const f of files){
                    if(!f.url) continue
                    const dest = path.join(modsDir, f.filename)
                    if(!underDir(modsDir, dest)) continue
                    if(!fs.existsSync(dest)){ await downloadFile(f.url, dest); downloaded.add(f.filename) }
                }
                if(files.length && files[0].url) ownFile = files[0].filename
            } catch(e){ failed.push(await _labelFor(m)); if(typeof onProgress === 'function') onProgress(i + 1, mods.length); continue }
            if(ownFile){
                manifest[_mkKey(m.source, m.projectId)] = { source: m.source, slug: m.slug, title: m.slug || m.projectId, versionId: version.versionId, versionNumber: version.versionNumber, datePublished: version.datePublished, files: [ownFile] }
                ManifestUtil.recordAutoDeps(manifest, resolved && resolved.deps, m.source, m.projectId, m.slug || m.projectId, downloaded)
            }
            if(typeof onProgress === 'function') onProgress(i + 1, mods.length)
        }
        _writeManifest(id, manifest)
        // 3) Place embedded raw jars (if opted in).
        if(opts.includeRaw && Array.isArray(payload.rawMods)){
            for(const r of payload.rawMods){
                if(!r || !r.name || /[\\/]/.test(r.name) || r.name.indexOf('..') >= 0) continue
                const dest = path.join(modsDir, r.name)
                if(!underDir(modsDir, dest)) continue
                try { fs.writeFileSync(dest, Buffer.from(r.data || '', 'base64')) } catch(e){ /* skip */ }
            }
        }
        return { id, name: payload.name, failed }
    }

    /**
     * Add a share's mods to an EXISTING custom instance instead of creating a new one.
     *
     * - A mod the instance already has (same project) is replaced by the shared one and its old file
     *   removed; a jar with the same file name is overwritten.
     * - Anything the share does not mention is left exactly as it is.
     * - The shared version is used when the instance has the same Minecraft version and loader as the
     *   share; otherwise (or if that version is gone) the latest version for the instance is used and
     *   the mod is reported as adjusted.
     * - A modpack the share refers to is not applied here; only the user-added mods and embedded jars.
     *
     * @returns {Promise<{id, name, added: string[], replaced: string[], adjusted: string[], failed: string[]}>}
     */
    async function importIntoExisting(payload, instanceId, opts, onProgress, token){
        opts = opts || {}
        const ins = ConfigManager.getCustomInstance(instanceId)
        if(!ins) throw new Error('取り込み先の起動構成が見つかりません')
        if(ins.loader !== 'fabric' && ins.loader !== 'forge') throw new Error('バニラの構成にはModを追加できません')
        const modsDir = _modsDir(instanceId)
        fs.ensureDirSync(modsDir)
        const inside = (p) => { const rel = path.relative(modsDir, path.normalize(p)); return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel) }
        const removeJar = (name) => {
            for(const n of [name, name + '.disabled']){
                const p = path.join(modsDir, n)
                if(inside(p) && fs.existsSync(p)){ try { fs.removeSync(p) } catch(e){ /* locked: leave it */ } }
            }
        }
        const sameEnv = payload.mc === ins.minecraftVersion && payload.loader === ins.loader
        const manifest = _readManifest(instanceId)
        const result = { id: instanceId, name: ins.name, added: [], replaced: [], adjusted: [], failed: [] }
        const mods = payload.mods || []
        for(let i = 0; i < mods.length; i++){
            if(token && token.cancelled) break
            const m = mods[i]
            const api = _api(m.source)
            let version = null
            let exact = false
            if(sameEnv && m.versionId){
                try { version = await api.getVersionById(m.versionId); exact = !!version } catch(e){ version = null }
            }
            if(!version){ try { version = await api.getBestVersion(m.projectId, ins.minecraftVersion, ins.loader) } catch(e){ version = null } }
            const label = await _labelFor(m)
            if(!version){ result.failed.push(label); if(typeof onProgress === 'function') onProgress(i + 1, mods.length); continue }
            let ownFile = null
            let resolved = null
            const downloaded = new Set()
            try {
                resolved = await api.collectRequired(version, ins.minecraftVersion, ins.loader, m.projectId)
                const files = resolved.files || []
                for(let k = 0; k < files.length; k++){
                    const f = files[k]
                    if(!f.url) continue
                    const dest = path.join(modsDir, f.filename)
                    if(!inside(dest)) continue
                    if(k === 0){
                        // The shared mod itself: replace a same-named file instead of keeping it.
                        removeJar(f.filename)
                        await downloadFile(f.url, dest)
                        downloaded.add(f.filename)
                    } else if(!fs.existsSync(dest) && !fs.existsSync(dest + '.disabled')){
                        await downloadFile(f.url, dest)
                        downloaded.add(f.filename)
                    }
                }
                if(files.length && files[0].url) ownFile = files[0].filename
            } catch(e){ result.failed.push(label); if(typeof onProgress === 'function') onProgress(i + 1, mods.length); continue }
            if(ownFile){
                const key = _mkKey(m.source, m.projectId)
                const prev = manifest[key]
                // Same project already installed: drop its old file(s) (a new file name means a new version).
                if(prev && Array.isArray(prev.files)){ for(const old of prev.files){ if(old !== ownFile) removeJar(old) } }
                manifest[key] = { source: m.source, slug: m.slug || null, title: m.slug || label, versionId: version.versionId, versionNumber: version.versionNumber, datePublished: version.datePublished, files: [ownFile] }
                ManifestUtil.recordAutoDeps(manifest, resolved && resolved.deps, m.source, m.projectId, label, downloaded)
                ;(prev ? result.replaced : result.added).push(label)
                if(!exact && m.versionId) result.adjusted.push(label)
            }
            if(typeof onProgress === 'function') onProgress(i + 1, mods.length)
        }
        _writeManifest(instanceId, manifest)
        // Embedded jars (opted in): same file name = overwrite.
        if(opts.includeRaw && Array.isArray(payload.rawMods)){
            for(const r of payload.rawMods){
                if(!r || !r.name || /[\\/]/.test(r.name) || r.name.indexOf('..') >= 0) continue
                const dest = path.join(modsDir, r.name)
                if(!inside(dest)) continue
                try {
                    const existed = fs.existsSync(dest) || fs.existsSync(dest + '.disabled')
                    removeJar(r.name)
                    fs.writeFileSync(dest, Buffer.from(r.data || '', 'base64'))
                    ;(existed ? result.replaced : result.added).push(r.name)
                } catch(e){ result.failed.push(r.name) }
            }
        }
        return result
    }

    window.NLShare = { collectUnknownJars, buildShareCode, decodeShareCode, importShareCode, importIntoExisting, describePayload, candidateInstances }
})()
