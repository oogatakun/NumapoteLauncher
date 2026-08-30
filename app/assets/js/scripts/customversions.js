/**
 * Fetch Minecraft version lists for the custom instance creator.
 * Exposed as window.NLCustomVersions.
 */
(function(){
    const VERSION_MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'

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

    window.NLCustomVersions = { fetchReleaseVersions }
})()
