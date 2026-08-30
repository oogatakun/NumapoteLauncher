/**
 * Modrinth API client for importing mods into a pack's mods folder.
 * Exposed as window.NLModrinth.
 */
(function(){
    const { default: got } = require('got')
    const API = 'https://api.modrinth.com/v2'
    function ua(){
        let ver = '0.0.0'
        try { ver = require('@electron/remote').app.getVersion() } catch(e) { /* ignore */ }
        return `NumapoteLauncher/${ver} (github.com/oogatakun/NumapoteLauncher)`
    }
    async function getJson(url){
        let res
        try {
            res = await got(url, { headers: { 'user-agent': ua() }, responseType: 'json', throwHttpErrors: false, retry: 0 })
        } catch(err) {
            throw new Error('Modrinthへの接続に失敗しました: ' + (err.message || ''))
        }
        if(res.statusCode === 429) throw new Error('Modrinthのレート制限です。少し待って再試行してください。')
        if(res.statusCode < 200 || res.statusCode >= 300) throw new Error('Modrinthリクエストに失敗しました (' + res.statusCode + ')')
        return res.body
    }

    async function search(query, mc, loader, limit = 20){
        const facets = JSON.stringify([['project_type:mod'], ['versions:' + mc], ['categories:' + loader]])
        const url = `${API}/search?query=${encodeURIComponent(query || '')}&limit=${limit}&facets=${encodeURIComponent(facets)}`
        const body = await getJson(url)
        return (body.hits || []).map(h => ({
            projectId: h.project_id, slug: h.slug, title: h.title, author: h.author,
            description: h.description, iconUrl: h.icon_url, downloads: h.downloads
        }))
    }

    async function getBestVersion(projectId, mc, loader){
        const gv = encodeURIComponent(JSON.stringify([mc]))
        const ld = encodeURIComponent(JSON.stringify([loader]))
        const list = await getJson(`${API}/project/${encodeURIComponent(projectId)}/version?game_versions=${gv}&loaders=${ld}`)
        if(!Array.isArray(list) || list.length === 0) return null
        const v = list[0] // newest compatible
        return { versionId: v.id, files: v.files || [], dependencies: v.dependencies || [] }
    }

    function primaryFile(files){
        if(!files || files.length === 0) return null
        const p = files.find(f => f.primary) || files[0]
        return { filename: p.filename, url: p.url }
    }

    // Collect the mod + its required dependencies (recursive, deduped).
    async function collectRequired(version, mc, loader){
        const out = []
        const seenFiles = new Set()
        const seenVer = new Set()
        async function walk(ver){
            const key = ver.versionId || ver.id
            if(key){ if(seenVer.has(key)) return; seenVer.add(key) }
            const pf = primaryFile(ver.files)
            if(pf && !seenFiles.has(pf.filename)){
                seenFiles.add(pf.filename)
                out.push(pf)
            }
            for(const dep of (ver.dependencies || [])){
                if(dep.dependency_type !== 'required') continue
                let depVer = null
                if(dep.version_id){
                    const dv = await getJson(`${API}/version/${encodeURIComponent(dep.version_id)}`)
                    depVer = { versionId: dv.id, files: dv.files || [], dependencies: dv.dependencies || [] }
                } else if(dep.project_id){
                    depVer = await getBestVersion(dep.project_id, mc, loader)
                }
                if(depVer) await walk(depVer)
            }
        }
        await walk(version)
        return out
    }

    window.NLModrinth = { search, getBestVersion, collectRequired }
})()
