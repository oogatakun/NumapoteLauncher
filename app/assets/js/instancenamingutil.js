/**
 * Naming of custom launch configs. A custom instance's id doubles as its folder name under
 * instances/, so the id should be something a person can recognise in Explorer. Pure functions
 * (no fs / Electron) so they can be unit tested.
 */

const PREFIX = '自作-'
const MAX_NAME_LENGTH = 40

exports.PREFIX = PREFIX

/**
 * Turn an instance name into something safe to use as a folder name on every OS:
 * no path separators / reserved characters, no trailing dots or spaces, bounded length.
 *
 * @param {string} name
 * @returns {string} Never empty.
 */
exports.sanitizeName = function(name){
    let s = String(name == null ? '' : name)
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f<>:"/\\|?*]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    if(s.length > MAX_NAME_LENGTH) s = s.slice(0, MAX_NAME_LENGTH)
    s = s.replace(/[. ]+$/g, '')
    return s || '無題'
}

/**
 * Build a readable id (= folder name) for a name, adding -2, -3, ... until it is free.
 *
 * @param {string} name
 * @param {(id: string) => boolean} isTaken True when the id is already used.
 * @returns {string}
 */
exports.makeId = function(name, isTaken){
    const base = PREFIX + exports.sanitizeName(name)
    if(!isTaken(base)) return base
    for(let i = 2; i < 1000; i++){
        const candidate = base + '-' + i
        if(!isTaken(candidate)) return candidate
    }
    return base + '-' + Date.now().toString(36)
}

/**
 * Ids generated before readable names existed: custom-<time in base36>-<random>.
 *
 * @param {string} id
 * @returns {boolean}
 */
exports.isLegacyId = function(id){
    return /^custom-[0-9a-z]{6,10}-[0-9a-z]{3,8}$/.test(String(id == null ? '' : id))
}

/**
 * An id is only ever used as a single path segment; refuse anything that could escape
 * the instances folder.
 *
 * @param {string} id
 * @returns {boolean}
 */
exports.isSafeId = function(id){
    const s = String(id == null ? '' : id)
    return s.length > 0 && !/[\\/]/.test(s) && s !== '.' && s !== '..' && !s.includes('\u0000')
}
