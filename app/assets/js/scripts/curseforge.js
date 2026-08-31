/**
 * CurseForge API client for importing mods into a pack's mods folder.
 * Exposed as window.NLCurseForge. Response shapes are normalized to match
 * window.NLModrinth so settings.js can treat both sources identically.
 */
(function(){
    const { default: got } = require('got')
    const API = 'https://api.curseforge.com/v1'
    const GAME_ID = 432
    const CLASS_ID = 6
    const LOADER_TYPE = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 }

    // Key resolution: user-supplied key first, then the bundled key.
    function apiKey(){
        let userKey = ''
        try { userKey = ConfigManager.getCurseForgeApiKey() || '' } catch(e) { /* ignore */ }
        if(userKey) return userKey
        try { return require('./assets/js/cfapikey') || '' } catch(e) { return '' }
    }
    function hasKey(){ return !!apiKey() }

    async function getJson(pathAndQuery){
        const key = apiKey()
        if(!key) throw new Error('CurseForge APIキーが未設定です')
        let res
        try {
            res = await got(API + pathAndQuery, { headers: { 'x-api-key': key, 'accept': 'application/json' }, responseType: 'json', throwHttpErrors: false, retry: 0 })
        } catch(err) {
            throw new Error('CurseForgeへの接続に失敗しました: ' + (err.message || ''))
        }
        if(res.statusCode === 403) throw new Error('CurseForge APIキーが無効です')
        if(res.statusCode === 429) throw new Error('CurseForgeのレート制限です。少し待って再試行してください。')
        if(res.statusCode < 200 || res.statusCode >= 300) throw new Error('CurseForgeリクエストに失敗しました (' + res.statusCode + ')')
        return res.body
    }

    // --- Pure mappers (no network) ---
    function _mapHit(m){
        return {
            projectId: String(m.id),
            slug: m.slug,
            title: m.name,
            author: (m.authors && m.authors[0] && m.authors[0].name) || '',
            description: m.summary,
            iconUrl: (m.logo && m.logo.url) || '',
            downloads: m.downloadCount,
            websiteUrl: (m.links && m.links.websiteUrl) || ''
        }
    }
    function _mapFile(f){
        return {
            versionId: String(f.id),
            versionNumber: f.displayName || f.fileName,
            datePublished: f.fileDate,
            files: [{ filename: f.fileName, url: f.downloadUrl || null }],
            dependencies: (f.dependencies || []).map(d => ({
                dependency_type: d.relationType === 3 ? 'required' : 'optional',
                project_id: String(d.modId)
            })),
            blocked: f.downloadUrl == null
        }
    }

    async function search(query, mc, loader, limit = 20){
        const lt = LOADER_TYPE[loader]
        const qs = `?gameId=${GAME_ID}&classId=${CLASS_ID}`
            + `&searchFilter=${encodeURIComponent(query || '')}`
            + `&gameVersion=${encodeURIComponent(mc)}`
            + (lt ? `&modLoaderType=${lt}` : '')
            + `&sortField=2&sortOrder=desc&pageSize=${limit}`
        const body = await getJson('/mods/search' + qs)
        return (body.data || []).map(_mapHit)
    }

    async function getBestVersion(projectId, mc, loader){
        const lt = LOADER_TYPE[loader]
        const qs = `?gameVersion=${encodeURIComponent(mc)}` + (lt ? `&modLoaderType=${lt}` : '') + '&pageSize=50'
        const body = await getJson('/mods/' + encodeURIComponent(projectId) + '/files' + qs)
        const list = body.data || []
        if(list.length === 0) return null
        const sorted = list.slice().sort((a, b) => new Date(b.fileDate || 0) - new Date(a.fileDate || 0))
        return _mapFile(sorted[0])
    }

    function primaryFile(files){
        if(!files || files.length === 0) return null
        const p = files.find(f => f.url) || files[0]
        return { filename: p.filename, url: p.url }
    }

    // Collect the mod + its required dependencies (recursive, deduped).
    // A dependency whose file is non-distributable comes back with url:null.
    async function collectRequired(version, mc, loader){
        const out = []
        const seenFiles = new Set()
        const seenVer = new Set()
        async function walk(ver){
            const key = ver.versionId
            if(key){ if(seenVer.has(key)) return; seenVer.add(key) }
            const pf = primaryFile(ver.files)
            if(pf && !seenFiles.has(pf.filename)){ seenFiles.add(pf.filename); out.push(pf) }
            for(const dep of (ver.dependencies || [])){
                if(dep.dependency_type !== 'required') continue
                const depVer = await getBestVersion(dep.project_id, mc, loader)
                if(depVer) await walk(depVer)
            }
        }
        await walk(version)
        return out
    }

    window.NLCurseForge = { search, getBestVersion, collectRequired, hasKey, _mapHit, _mapFile }
})()
