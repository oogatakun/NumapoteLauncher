/**
 * Compact share-code format (version 2) for launch configs.
 *
 * The first format was JSON + zlib + base64url, which spends most of its bytes on key names and on
 * repeating "modrinth" / "projectId" for every mod. This one is a small binary layout: ids are packed
 * (a Modrinth id is 8 base62 characters = 6 bytes, a CurseForge id is a varint), strings are length
 * prefixed, and the whole body is raw-deflated only when that makes it shorter. Pure functions (no fs /
 * Electron) so they can be unit tested.
 *
 * Text form:  'NL2' + base64url( flags byte + body )
 */

const zlib = require('zlib')

const PREFIX = 'NL2'
const MAX_DECODED_BYTES = 48 * 1024 * 1024   // refuse absurd codes (embedded jars are the only big part)

const F_MODPACK = 1, F_MODS = 2, F_RAW = 4, F_DEFLATED = 8
const LOADERS = ['vanilla', 'fabric', 'forge']
const SOURCES = ['modrinth', 'curseforge']
const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

exports.PREFIX = PREFIX

// --- byte writer / reader -------------------------------------------------

class Writer {
    constructor(){ this.parts = [] }
    byte(n){ this.parts.push(Buffer.from([n & 0xff])) }
    varint(n){
        const out = []
        n = Math.floor(n)
        while(n >= 0x80){ out.push((n % 0x80) | 0x80); n = Math.floor(n / 0x80) }
        out.push(n)
        this.parts.push(Buffer.from(out))
    }
    bytes(buf){ this.parts.push(Buffer.from(buf)) }
    str(s){
        const b = Buffer.from(String(s == null ? '' : s), 'utf-8')
        this.varint(b.length)
        this.bytes(b)
    }
    // An id: 0 = none, 1 = 8 base62 chars (Modrinth), 2 = decimal number (CurseForge), 3 = any other string.
    id(v){
        if(v == null || v === ''){ this.byte(0); return }
        const s = String(v)
        if(/^[0-9A-Za-z]{8}$/.test(s)){
            let n = 0n
            for(const ch of s) n = n * 62n + BigInt(B62.indexOf(ch))
            const b = Buffer.alloc(6)
            for(let i = 5; i >= 0; i--){ b[i] = Number(n & 0xffn); n >>= 8n }
            this.byte(1); this.bytes(b)
        } else if(/^(0|[1-9][0-9]{0,14})$/.test(s)){
            this.byte(2); this.varint(Number(s))
        } else {
            this.byte(3); this.str(s)
        }
    }
    toBuffer(){ return Buffer.concat(this.parts) }
}

class Reader {
    constructor(buf){ this.buf = buf; this.pos = 0 }
    need(n){ if(this.pos + n > this.buf.length) throw new Error('truncated') }
    byte(){ this.need(1); return this.buf[this.pos++] }
    varint(){
        let n = 0, mul = 1
        for(let i = 0; i < 8; i++){
            const b = this.byte()
            n += (b & 0x7f) * mul
            if(!(b & 0x80)) return n
            mul *= 0x80
        }
        throw new Error('bad varint')
    }
    bytes(n){ this.need(n); const b = this.buf.subarray(this.pos, this.pos + n); this.pos += n; return b }
    str(){ const n = this.varint(); return this.bytes(n).toString('utf-8') }
    id(){
        const t = this.byte()
        if(t === 0) return null
        if(t === 1){
            const b = this.bytes(6)
            let n = 0n
            for(const x of b) n = (n << 8n) | BigInt(x)
            let s = ''
            for(let i = 0; i < 8; i++){ s = B62[Number(n % 62n)] + s; n /= 62n }
            return s
        }
        if(t === 2) return String(this.varint())
        if(t === 3) return this.str()
        throw new Error('bad id type')
    }
}

// --- base64url ------------------------------------------------------------

const b64urlEncode = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
function b64urlDecode(str){
    let s = str.replace(/-/g, '+').replace(/_/g, '/')
    while(s.length % 4) s += '='
    return Buffer.from(s, 'base64')
}

// --- public API -----------------------------------------------------------

/**
 * @param {Object} payload { name, mc, loader, loaderVersion, modpack?: {provider, projectId, versionId},
 *                           mods?: [{source, projectId, versionId}], rawMods?: [{name, data(base64)}] }
 * @returns {string} The share code ('NL2…').
 */
exports.encode = function(payload){
    const w = new Writer()
    let flags = 0
    w.str(payload.name)
    w.str(payload.mc)
    const li = LOADERS.indexOf(payload.loader)
    if(li >= 0){ w.byte(li) } else { w.byte(255); w.str(payload.loader) }
    w.str(payload.loaderVersion)
    if(payload.modpack){
        flags |= F_MODPACK
        const pi = SOURCES.indexOf(payload.modpack.provider)
        w.byte(pi >= 0 ? pi : 0)
        w.id(payload.modpack.projectId)
        w.id(payload.modpack.versionId)
    }
    const mods = Array.isArray(payload.mods) ? payload.mods : []
    if(mods.length){
        flags |= F_MODS
        w.varint(mods.length)
        for(const m of mods){
            const si = SOURCES.indexOf(m.source)
            w.byte(si >= 0 ? si : 0)
            w.id(m.projectId)
            w.id(m.versionId)
        }
    }
    const raws = Array.isArray(payload.rawMods) ? payload.rawMods : []
    if(raws.length){
        flags |= F_RAW
        w.varint(raws.length)
        for(const r of raws){
            w.str(r.name)
            const data = Buffer.from(r.data || '', 'base64')
            w.varint(data.length)
            w.bytes(data)
        }
    }
    let body = w.toBuffer()
    const deflated = zlib.deflateRawSync(body, { level: 9 })
    if(deflated.length < body.length){ body = deflated; flags |= F_DEFLATED }
    return PREFIX + b64urlEncode(Buffer.concat([Buffer.from([flags]), body]))
}

/**
 * @param {string} code A code starting with 'NL2' (no URL wrapper).
 * @returns {Object} The payload (same shape as encode's input, with v: 2).
 */
exports.decode = function(code){
    if(typeof code !== 'string' || code.indexOf(PREFIX) !== 0) throw new Error('not a v2 code')
    if(!/^[A-Za-z0-9_-]+$/.test(code.slice(PREFIX.length))) throw new Error('bad characters')
    const raw = b64urlDecode(code.slice(PREFIX.length))
    if(raw.length < 2) throw new Error('too short')
    const flags = raw[0]
    let body = raw.subarray(1)
    if(flags & F_DEFLATED) body = zlib.inflateRawSync(body, { maxOutputLength: MAX_DECODED_BYTES })
    const r = new Reader(body)
    const payload = { v: 2 }
    payload.name = r.str()
    payload.mc = r.str()
    // Reject noise that merely happens to parse: a real code always names a Minecraft version.
    if(!/^[0-9][0-9A-Za-z._+-]{0,31}$/.test(payload.mc)) throw new Error('bad version')
    const li = r.byte()
    payload.loader = li === 255 ? r.str() : (LOADERS[li] || 'vanilla')
    payload.loaderVersion = r.str()
    if(flags & F_MODPACK){
        const provider = SOURCES[r.byte()] || 'modrinth'
        payload.modpack = { provider, projectId: r.id(), versionId: r.id() }
    }
    if(flags & F_MODS){
        const n = r.varint()
        if(n > 5000) throw new Error('too many mods')
        payload.mods = []
        for(let i = 0; i < n; i++){
            const source = SOURCES[r.byte()] || 'modrinth'
            payload.mods.push({ source, projectId: r.id(), versionId: r.id(), slug: null })
        }
    }
    if(flags & F_RAW){
        const n = r.varint()
        if(n > 5000) throw new Error('too many files')
        payload.rawMods = []
        for(let i = 0; i < n; i++){
            const name = r.str()
            const len = r.varint()
            payload.rawMods.push({ name, data: Buffer.from(r.bytes(len)).toString('base64') })
        }
    }
    if(r.pos !== body.length) throw new Error('trailing data')
    return payload
}

/**
 * Pull a share code out of whatever the user pasted: a bare code, a numapotelauncher:// (or the old
 * numapote://) URL, or an https link that carries the code after '#', '?c=' or '/s/'.
 *
 * @param {string} text
 * @returns {string|null} The code ('NL2…' or the legacy 'NLPACK1…'), or null.
 */
exports.extractCode = function(text){
    const s = String(text == null ? '' : text).trim()
    const m = s.match(/(NL2|NLPACK1)[A-Za-z0-9_-]+/)
    return m ? m[0] : null
}
