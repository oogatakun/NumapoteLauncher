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

    const PREFIX = 'NLPACK1'

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
        const payload = { v: 1, name: ins.name, mc: ins.minecraftVersion, loader: ins.loader, loaderVersion: ins.loaderVersion }
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
        const code = PREFIX + encode(payload)
        return { code, url: 'numapote://share/' + code }
    }

    function decodeShareCode(text){
        let s = String(text || '').trim()
        if(s.indexOf('numapote://share/') === 0) s = s.slice('numapote://share/'.length)
        if(s.indexOf(PREFIX) !== 0) throw new Error('コードが不正です')
        s = s.slice(PREFIX.length)
        let payload
        try { payload = decode(s) } catch(e){ throw new Error('コードが不正です') }
        if(!payload || payload.v !== 1) throw new Error('対応していない共有形式です')
        return payload
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
            id = 'custom-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
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
            if(!version){ failed.push(m.slug || m.projectId); if(typeof onProgress === 'function') onProgress(i + 1, mods.length); continue }
            let ownFile = null
            try {
                const resolved = await api.collectRequired(version, payload.mc, payload.loader)
                const files = resolved.files || []
                for(const f of files){
                    if(!f.url) continue
                    const dest = path.join(modsDir, f.filename)
                    if(!underDir(modsDir, dest)) continue
                    if(!fs.existsSync(dest)){ await downloadFile(f.url, dest) }
                }
                if(files.length && files[0].url) ownFile = files[0].filename
            } catch(e){ failed.push(m.slug || m.projectId); if(typeof onProgress === 'function') onProgress(i + 1, mods.length); continue }
            if(ownFile){
                manifest[_mkKey(m.source, m.projectId)] = { source: m.source, slug: m.slug, title: m.slug, versionId: version.versionId, versionNumber: version.versionNumber, datePublished: version.datePublished, files: [ownFile] }
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

    window.NLShare = { collectUnknownJars, buildShareCode, decodeShareCode, importShareCode }
})()
