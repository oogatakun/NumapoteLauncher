/**
 * Helpers for the per-instance installed-mod manifest (instances/<id>/.numapote-mods.json).
 *
 * The manifest is keyed by projectId (Modrinth) or 'cf:' + modId (CurseForge). Besides the
 * mods the user asked for, it can hold mods that were only pulled in as another mod's required
 * dependency; those carry `auto: true` and `requiredBy: [<display names>]` so the Mod tab can
 * tell them apart. Pure functions only (no DOM / Electron) so they can be unit tested.
 */

const EXT_REGEX = /\.(jar|zip|litemod)$/i

exports.keyFor = function(source, projectId){
    return source === 'curseforge' ? ('cf:' + projectId) : String(projectId)
}

function union(a, b){
    const out = Array.isArray(a) ? a.slice() : []
    for(const x of (b || [])){ if(!out.includes(x)) out.push(x) }
    return out
}

// Display name for a project id seen in collectRequired's `requiredBy`.
function labelFor(id, rootId, rootLabel, deps){
    if(String(id) === String(rootId)) return rootLabel
    const d = (deps || []).find(x => String(x.projectId) === String(id))
    return d && d.filename ? d.filename.replace(EXT_REGEX, '') : String(id)
}

/**
 * Record mods that were installed only as another mod's required dependency.
 *
 * - A dependency we just downloaded gets a new `auto` entry.
 * - An existing `auto` entry just gains the extra "required by" name (and the new file if a
 *   different version was fetched).
 * - An entry the user added on purpose (no `auto`) is never touched, and a dependency that was
 *   already on disk without a manifest entry is left unrecorded (we did not install it).
 *
 * @param {Object} manifest The manifest object, mutated in place.
 * @param {Array} deps `deps` from collectRequired().
 * @param {string} source 'modrinth' | 'curseforge'.
 * @param {string} rootId Project id of the mod the user asked for.
 * @param {string} rootLabel Display name of that mod.
 * @param {Set<string>} downloaded File names fetched by this install.
 */
exports.recordAutoDeps = function(manifest, deps, source, rootId, rootLabel, downloaded){
    for(const d of (deps || [])){
        if(!d || !d.projectId || !d.filename) continue
        if(String(d.projectId) === String(rootId)) continue
        const key = exports.keyFor(source, d.projectId)
        const parents = (d.requiredBy && d.requiredBy.length) ? d.requiredBy : [rootId]
        const labels = parents.map(id => labelFor(id, rootId, rootLabel, deps))
        const fresh = !!(downloaded && downloaded.has(d.filename))
        const ex = manifest[key]
        if(ex){
            if(!ex.auto) continue
            ex.requiredBy = union(ex.requiredBy, labels)
            if(fresh && !(ex.files || []).includes(d.filename)){
                ex.files = (ex.files || []).concat(d.filename)
                ex.versionId = d.versionId
                ex.versionNumber = d.versionNumber
                ex.datePublished = d.datePublished
            }
        } else if(fresh){
            manifest[key] = {
                source, slug: null, title: d.filename.replace(EXT_REGEX, ''),
                versionId: d.versionId, versionNumber: d.versionNumber, datePublished: d.datePublished,
                files: [d.filename], auto: true, requiredBy: labels
            }
        }
    }
}

/**
 * @param {Object} manifest
 * @returns {Object<string, Object>} Map of file name -> manifest entry, for auto-installed mods.
 */
exports.autoFileMap = function(manifest){
    const map = {}
    for(const k of Object.keys(manifest || {})){
        const e = manifest[k]
        if(e && e.auto){ for(const f of (e.files || [])){ map[f] = e } }
    }
    return map
}

/**
 * Mods the user added from Modrinth / CurseForge on purpose (not as someone's dependency).
 * Entries without a versionId are guesses made by the search UI for jars that were already on
 * disk, so they are not counted.
 *
 * @param {Object} manifest
 * @returns {Object<string, Object>} Map of file name -> manifest entry.
 */
exports.onlineFileMap = function(manifest){
    const map = {}
    for(const k of Object.keys(manifest || {})){
        const e = manifest[k]
        if(e && !e.auto && e.versionId){ for(const f of (e.files || [])){ map[f] = e } }
    }
    return map
}

/**
 * @param {Object} entry An online-added manifest entry.
 * @returns {string} Plain text for the badge tooltip (not HTML-escaped).
 */
exports.onlineDescription = function(entry){
    const site = entry && entry.source === 'curseforge' ? 'CurseForge' : 'Modrinth'
    return site + 'から追加'
}

/**
 * @param {Object} entry An `auto` manifest entry.
 * @returns {string} Plain text for the badge tooltip (not HTML-escaped).
 */
exports.autoDescription = function(entry){
    const names = (entry && entry.requiredBy) || []
    return names.length ? ('「' + names.join('」「') + '」の前提として自動導入') : '前提として自動導入'
}
