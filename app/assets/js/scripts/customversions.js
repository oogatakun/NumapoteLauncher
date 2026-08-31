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
            .filter(v => v.type === 'release')
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

    const FORGE_MAVEN = 'https://maven.minecraftforge.net/net/minecraftforge/forge'

    // All Forge builds for a given MC version, newest-first, with recommended/latest flags.
    async function fetchForgeVersions(mc){
        const metaRes = await fetch(`${FORGE_MAVEN}/maven-metadata.xml`, { cache: 'no-store' })
        if(!metaRes.ok) throw new Error('Forgeバージョン一覧の取得に失敗しました (' + metaRes.status + ')')
        const xml = await metaRes.text()
        const all = []
        const re = /<version>([^<]+)<\/version>/g
        let m
        while((m = re.exec(xml)) !== null){ all.push(m[1]) }
        // maven-metadata is oldest-first; filter to this MC and reverse to newest-first.
        const forThisMc = all.filter(v => v.startsWith(mc + '-')).reverse()
        let rec = null, lat = null
        try {
            // Promotions are served from files.minecraftforge.net (not the maven host).
            const promoRes = await fetch('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json', { cache: 'no-store' })
            if(promoRes.ok){
                const promos = (await promoRes.json()).promos || {}
                rec = promos[mc + '-recommended'] || null
                lat = promos[mc + '-latest'] || null
            }
        } catch(e){ /* flags are best-effort */ }
        return forThisMc.map(full => {
            const version = full.slice(mc.length + 1)
            return { version, full, recommended: version === rec, latest: version === lat }
        })
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

    window.NLCustomVersions = { fetchReleaseVersions, fetchFabricLoaderVersions, fetchFabricProfile, fetchRequiredJavaMajor, fetchForgeVersions }
})()
