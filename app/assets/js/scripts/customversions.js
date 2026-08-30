/**
 * Fetch Minecraft version lists for the custom instance creator.
 * Exposed as window.NLCustomVersions.
 */
(function(){
    const VERSION_MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
    const FABRIC_META = 'https://meta.fabricmc.net'

    async function fetchReleaseVersions(){
        const res = await fetch(VERSION_MANIFEST, { cache: 'no-store' })
        if(!res.ok) throw new Error('バージョン一覧の取得に失敗しました (' + res.status + ')')
        const body = await res.json()
        const versions = Array.isArray(body.versions) ? body.versions : []
        return versions
            // Only 1.x releases for now. MC 26.x moved to a new native-library
            // layout the launcher's ProcessBuilder doesn't support yet, so it would
            // crash on launch — exclude it from the picker until that's implemented.
            .filter(v => v.type === 'release' && /^1\./.test(v.id))
            .map(v => ({ id: v.id, releaseTime: v.releaseTime }))
            // Mojang manifest is already newest-first, but sort defensively.
            .sort((a, b) => new Date(b.releaseTime) - new Date(a.releaseTime))
    }

    async function fetchFabricLoaderVersions(mc){
        const res = await fetch(`${FABRIC_META}/v2/versions/loader/${encodeURIComponent(mc)}`, { cache: 'no-store' })
        if(res.status === 400 || res.status === 404) return [] // MC未対応
        if(!res.ok) throw new Error('Fabricローダー一覧の取得に失敗しました (' + res.status + ')')
        const body = await res.json()
        // body: [{ loader:{version,stable,...}, intermediary, launcherMeta }, ...]
        return (Array.isArray(body) ? body : [])
            .map(e => ({ version: e.loader.version, stable: !!e.loader.stable }))
    }

    async function fetchFabricProfile(mc, loader){
        const url = `${FABRIC_META}/v2/versions/loader/${encodeURIComponent(mc)}/${encodeURIComponent(loader)}/profile/json`
        const res = await fetch(url, { cache: 'no-store' })
        if(!res.ok) throw new Error('Fabricプロファイルの取得に失敗しました (' + res.status + ')')
        return await res.json()
    }

    // The Java major version a given MC release requires, per its Mojang
    // version JSON (javaVersion.majorVersion). Returns null if unavailable.
    async function fetchRequiredJavaMajor(mc){
        try {
            const res = await fetch(VERSION_MANIFEST, { cache: 'no-store' })
            if(!res.ok) return null
            const body = await res.json()
            const entry = (Array.isArray(body.versions) ? body.versions : []).find(v => v.id === mc)
            if(!entry || !entry.url) return null
            const vj = await fetch(entry.url, { cache: 'no-store' }).then(r => r.ok ? r.json() : null)
            if(vj && vj.javaVersion && vj.javaVersion.majorVersion) return vj.javaVersion.majorVersion
            return null
        } catch(e){
            return null
        }
    }

    window.NLCustomVersions = { fetchReleaseVersions, fetchFabricLoaderVersions, fetchFabricProfile, fetchRequiredJavaMajor }
})()
