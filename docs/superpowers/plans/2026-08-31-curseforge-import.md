# CurseForge Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add CurseForge as a second online mod source alongside Modrinth, sharing one search overlay via a source toggle, with add/remove/update, required-dependency resolution, and a "open on CurseForge" fallback for non-distributable mods.

**Architecture:** New `curseforge.js` API client normalizes CurseForge responses to the **exact same shape** as `modrinth.js`, so the existing search/install/manifest logic in `settings.js` is generalized to take a `source` argument and swap the API object. The existing `#modrinthContent` overlay is extended with a Modrinth/CurseForge toggle and a CurseForge API-key field. The install manifest keys CurseForge entries as `cf:<modId>` (Modrinth entries unchanged).

**Tech Stack:** Electron 33 (contextIsolation:false, nodeIntegration:true — renderer scripts share globals and use `require`), `got` (CurseForge needs the `x-api-key` header), `fs-extra`, helios-core `downloadFile`, EJS templates, plain DOM/JS.

## Global Constraints

- No unit-test framework exists. Every task is verified by (a) `npm run lint` showing **no increase over the baseline of 21 errors**, and (b) an env-gated runtime DIAG appended to `app/assets/js/scripts/landing.js`, run with `NL_DIAG_<X>=1 npx electron . --disable-gpu`, then reverted before commit. GDI screenshots require `--disable-gpu`.
- All work on a feature branch `feature/curseforge-import`, never on `main`. Commit per task.
- `git add` ONLY the specific files named in each task. NEVER `git add .` or `git add -A`.
- CurseForge network data (title/author/iconUrl/websiteUrl) MUST be HTML-escaped with the existing `_mrEsc` before insertion via innerHTML (nodeIntegration RCE risk).
- The CurseForge API key MUST NOT be logged and MUST NOT be committed: `app/assets/js/cfapikey.js` is git-ignored; only `app/assets/js/cfapikey.example.js` (empty string) is committed.
- Key resolution order everywhere: user key (`ConfigManager.getCurseForgeApiKey()`) → bundled key (`require('./assets/js/cfapikey')`) → if both empty, CurseForge is disabled with a message.
- Manifest: CurseForge entries keyed `cf:<modId>` with a `source` field; existing Modrinth entries (bare projectId) stay valid and unchanged.
- CurseForge constants: base `https://api.curseforge.com/v1`, `gameId=432`, `classId=6`, `modLoaderType` map `{forge:1, fabric:4, quilt:5, neoforge:6}`, required dependency `relationType===3`, non-distributable file `downloadUrl == null`.
- Kill any leftover electron between DIAG runs: `powershell.exe -NoProfile -Command "Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force"`.

## File Structure

- **Create** `app/assets/js/cfapikey.js` (git-ignored) — `module.exports = '<real key or empty>'`. Bundled key lives here in official builds.
- **Create** `app/assets/js/cfapikey.example.js` (committed) — `module.exports = ''`. Placeholder so source builds resolve the require.
- **Create** `app/assets/js/scripts/curseforge.js` — `window.NLCurseForge = { search, getBestVersion, collectRequired, hasKey, _mapHit, _mapFile }`. CurseForge REST client + pure mappers.
- **Modify** `app/assets/js/configmanager.js` — `curseForgeApiKey` default + get/set.
- **Modify** `app/assets/js/scripts/settings.js` — generalize the Modrinth-only functions to be source-aware (`_mrApi`, `_mrKey`, `openOnlineModSearch`, `runOnlineModSearch`, `renderOnlineActions`, `installOnlineVersion`, `addOnlineMod`, `removeOnlineMod`, `updateOnlineMod`, `_mrSetSource`, `_mrOnlineNote`) + bindings.
- **Modify** `app/overlay.ejs` — source toggle + CF key row inside `#modrinthContent`.
- **Modify** `app/settings.ejs` — `#settingsCurseForgeButton`.
- **Modify** `app/assets/css/launcher.css` — CF button style, toggle bar, key input, note.
- **Modify** `app/app.ejs` — include `curseforge.js`.
- **Modify** `.gitignore` — ignore `app/assets/js/cfapikey.js`.

---

### Task 1: CurseForge API key foundation (bundled file + config get/set)

**Files:**
- Create: `app/assets/js/cfapikey.example.js`
- Create: `app/assets/js/cfapikey.js` (git-ignored)
- Modify: `.gitignore`
- Modify: `app/assets/js/configmanager.js` (DEFAULT_CONFIG + two exports)

**Interfaces:**
- Produces: `ConfigManager.getCurseForgeApiKey() → string`, `ConfigManager.setCurseForgeApiKey(v:string) → void`; bundled key module at `./assets/js/cfapikey` exporting a string (empty by default).

- [ ] **Step 1: Create the committed placeholder key module**

Create `app/assets/js/cfapikey.example.js`:
```js
// Placeholder CurseForge API key. Official builds replace app/assets/js/cfapikey.js
// (git-ignored) with a file that exports a real key. Source builds fall back to
// this empty string, which disables CurseForge until the user supplies their own key.
module.exports = ''
```

- [ ] **Step 2: Create the git-ignored bundled key module (empty for now)**

Create `app/assets/js/cfapikey.js`:
```js
module.exports = ''
```

- [ ] **Step 3: Git-ignore the bundled key file**

Append to `.gitignore` (new line at end):
```
# CurseForge API key (bundled at build time, never committed)
app/assets/js/cfapikey.js
```

- [ ] **Step 4: Add config default + accessors**

In `app/assets/js/configmanager.js`, find `DEFAULT_CONFIG` (around line 189, where `selectedServer` and `customInstances` are defined) and add a `curseForgeApiKey: ''` property alongside the other top-level defaults (place it right after the `customInstances: []` line):
```js
    customInstances: [],
    curseForgeApiKey: '',
```
Then add these two exports next to `getSelectedServer`/`setSelectedServer` (around line 386):
```js
/**
 * @returns {string} The user-supplied CurseForge API key ('' if unset).
 */
exports.getCurseForgeApiKey = function(){
    return config.curseForgeApiKey || ''
}

/**
 * @param {string} key The CurseForge API key to store.
 */
exports.setCurseForgeApiKey = function(key){
    config.curseForgeApiKey = key || ''
}
```

- [ ] **Step 5: Lint**

Run: `npm run lint 2>&1 | grep -E "problems"`
Expected: `✖ 21 problems (21 errors, 0 warnings)` (no increase).

- [ ] **Step 6: Runtime DIAG — config roundtrip**

Append to `app/assets/js/scripts/landing.js`:
```js
// [DIAG-CFKEY] temporary
if (process.env.NL_DIAG_CFKEY === '1') {
    setTimeout(() => {
        try {
            const d = ConfigManager.getCurseForgeApiKey()
            ConfigManager.setCurseForgeApiKey('abc123'); ConfigManager.save()
            const got = ConfigManager.getCurseForgeApiKey()
            ConfigManager.setCurseForgeApiKey(d); ConfigManager.save()
            console.log('[DIAG-CFKEY] default=' + JSON.stringify(d) + ' roundtrip=' + (got === 'abc123'))
            console.log('[DIAG-CFKEY] DONE')
        } catch (e) { console.log('[DIAG-CFKEY] error ' + (e && e.message)) }
    }, 7000)
}
```
Run:
```bash
powershell.exe -NoProfile -Command "Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force"
NL_DIAG_CFKEY=1 npx electron . --disable-gpu > /tmp/cfkey.log 2>&1 &
for i in $(seq 1 30); do grep -q "DIAG-CFKEY. DONE\|DIAG-CFKEY. error" /tmp/cfkey.log && break; ping -n 2 127.0.0.1 >/dev/null; done
grep "DIAG-CFKEY" /tmp/cfkey.log
powershell.exe -NoProfile -Command "Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force"
```
Expected: `default="" roundtrip=true`.

- [ ] **Step 7: Revert the DIAG**

Run: `git checkout -- app/assets/js/scripts/landing.js`

- [ ] **Step 8: Commit**

```bash
git add app/assets/js/cfapikey.example.js .gitignore app/assets/js/configmanager.js
git commit -m "feat(curseforge): bundled/user API key foundation (config get/set, gitignored key file)"
```
Note: `app/assets/js/cfapikey.js` is intentionally NOT added (git-ignored).

---

### Task 2: CurseForge API client `curseforge.js`

**Files:**
- Create: `app/assets/js/scripts/curseforge.js`
- Modify: `app/app.ejs` (add script include after modrinth.js, line 6)

**Interfaces:**
- Consumes: `ConfigManager.getCurseForgeApiKey()` (Task 1); bundled key `require('./assets/js/cfapikey')`.
- Produces `window.NLCurseForge` with the SAME shapes as `window.NLModrinth`:
  - `search(query, mc, loader, limit=20) → Promise<[{projectId:string, slug, title, author, description, iconUrl, downloads, websiteUrl}]>`
  - `getBestVersion(projectId, mc, loader) → Promise<null | {versionId:string, versionNumber, datePublished, files:[{filename, url|null}], dependencies:[{dependency_type:'required'|'optional', project_id:string}], blocked:boolean}>`
  - `collectRequired(version, mc, loader) → Promise<[{filename, url|null}]>` (mod first, then required deps)
  - `hasKey() → boolean`
  - `_mapHit(rawMod) → hit`, `_mapFile(rawFile) → version` (pure, no network)

- [ ] **Step 1: Create the module**

Create `app/assets/js/scripts/curseforge.js`:
```js
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
```

- [ ] **Step 2: Include the script**

In `app/app.ejs`, after line 6 (`<script src="./assets/js/scripts/modrinth.js"></script>`), add:
```html
    <script src="./assets/js/scripts/curseforge.js"></script>
```

- [ ] **Step 3: Lint**

Run: `npm run lint 2>&1 | grep -E "problems"`
Expected: `✖ 21 problems` (no increase).

- [ ] **Step 4: Runtime DIAG — pure mappers (no network, no key)**

Append to `app/assets/js/scripts/landing.js`:
```js
// [DIAG-CFMAP] temporary
if (process.env.NL_DIAG_CFMAP === '1') {
    setTimeout(() => {
        try {
            const hit = window.NLCurseForge._mapHit({ id: 238222, slug: 'jei', name: 'JEI', summary: 's', downloadCount: 5, authors: [{ name: 'mezz' }], logo: { url: 'http://x/i.png' }, links: { websiteUrl: 'http://cf/jei' } })
            console.log('[DIAG-CFMAP] hit projectId=' + hit.projectId + ' title=' + hit.title + ' author=' + hit.author + ' web=' + hit.websiteUrl)
            const ok = window.NLCurseForge._mapFile({ id: 111, fileName: 'jei-1.jar', displayName: 'JEI 1', fileDate: '2026-01-01T00:00:00Z', downloadUrl: 'http://cdn/jei-1.jar', dependencies: [{ modId: 999, relationType: 3 }, { modId: 5, relationType: 2 }] })
            console.log('[DIAG-CFMAP] file ver=' + ok.versionId + ' num=' + ok.versionNumber + ' blocked=' + ok.blocked + ' deps=' + JSON.stringify(ok.dependencies))
            const blk = window.NLCurseForge._mapFile({ id: 222, fileName: 'x.jar', fileDate: '2026-01-01T00:00:00Z', downloadUrl: null, dependencies: [] })
            console.log('[DIAG-CFMAP] blockedFile blocked=' + blk.blocked + ' url=' + JSON.stringify(blk.files[0].url))
            console.log('[DIAG-CFMAP] hasKey=' + window.NLCurseForge.hasKey())
            console.log('[DIAG-CFMAP] DONE')
        } catch (e) { console.log('[DIAG-CFMAP] error ' + (e && e.message)) }
    }, 7000)
}
```
Run (same harness as Task 1 Step 6 with `NL_DIAG_CFMAP`).
Expected:
- `hit projectId=238222 title=JEI author=mezz web=http://cf/jei`
- `file ver=111 num=JEI 1 blocked=false deps=[{"dependency_type":"required","project_id":"999"},{"dependency_type":"optional","project_id":"5"}]`
- `blockedFile blocked=true url=null`
- `hasKey=false`

- [ ] **Step 5: Revert the DIAG**

Run: `git checkout -- app/assets/js/scripts/landing.js`

- [ ] **Step 6: Commit**

```bash
git add app/assets/js/scripts/curseforge.js app/app.ejs
git commit -m "feat(curseforge): API client normalizing search/files to Modrinth shape"
```

---

### Task 3: Generalize settings.js mod functions to be source-aware

This task refactors the Modrinth-only functions to take a `source` argument and delegate to the right API object, WITHOUT changing Modrinth behavior. It renames the internal functions to source-neutral names and updates the bindings. CurseForge-specific UI (toggle, key field, buttons) comes in Task 4; blocked-mod handling comes in Task 5 (this task installs the plumbing but the blocked branch is added here so Task 4/5 wire cleanly).

**Files:**
- Modify: `app/assets/js/scripts/settings.js` (the Modrinth block: `_mrEsc` through the DOMContentLoaded bindings)

**Interfaces:**
- Consumes: `window.NLModrinth`, `window.NLCurseForge` (Task 2); `getModTargetContext()`, `_mrEsc`, `_mrReadManifest`/`_mrWriteManifest`/`_mrHeuristicEntry`, `resolveDropinModsForUI`, `shell`, `toggleOverlay`, `setOverlayContent`, `setOverlayHandler` (existing).
- Produces: `openOnlineModSearch(source)`, `runOnlineModSearch()`, `renderOnlineActions(actionsEl, hit, ctx, source)`, `installOnlineVersion(ctx, hit, version, source) → {blockedNames:[]}`, `addOnlineMod(hit, ctx, actionsEl, btn, source)`, `removeOnlineMod(hit, ctx, actionsEl, entry, btn, source)`, `updateOnlineMod(hit, ctx, actionsEl, entry, best, btn, source)`, `_mrApi(source)`, `_mrKey(source, projectId)`, `_mrSetSource(source)`, `_mrOnlineNote(actionsEl, msg)`, module-level `currentModSource`.

- [ ] **Step 1: Add source helpers and generalize `_mrInstalledEntry`**

In `app/assets/js/scripts/settings.js`, immediately after the `_mrEsc` function, add:
```js
// Source selection: swap the API object and namespace the manifest key by source.
function _mrApi(source){
    return source === 'curseforge' ? window.NLCurseForge : window.NLModrinth
}
function _mrKey(source, projectId){
    return source === 'curseforge' ? ('cf:' + projectId) : projectId
}
let currentModSource = 'modrinth'
```
Then replace the existing `_mrInstalledEntry(ctx, manifest, projectId, hit)` function with this source-aware version (keeps the on-disk check + slug self-heal, now namespaced and stamping `source`):
```js
function _mrInstalledEntry(ctx, manifest, source, hit){
    const fsx = require('fs-extra'); const pth = require('path')
    const key = _mrKey(source, hit.projectId)
    const e = manifest[key]
    if(e && Array.isArray(e.files) && e.files.length > 0){
        for(const fn of e.files){
            const p = pth.join(ctx.modsDir, fn)
            if(fsx.existsSync(p) || fsx.existsSync(p + '.disabled')) return e
        }
    }
    const h = _mrHeuristicEntry(ctx, hit)
    if(h){ h.source = source; manifest[key] = h; _mrWriteManifest(ctx, manifest); return h }
    return null
}
```

- [ ] **Step 2: Replace `runModrinthSearch` with `runOnlineModSearch`**

Replace the entire `runModrinthSearch()` function with:
```js
async function runOnlineModSearch(){
    const source = currentModSource
    const ctx = await getModTargetContext()
    if(!ctx || !ctx.loader) return
    const results = document.getElementById('modrinthResults')
    if(source === 'curseforge' && !window.NLCurseForge.hasKey()){
        results.innerHTML = '<div style="opacity:0.7">CurseForge利用不可（APIキー未設定）</div>'
        return
    }
    const q = document.getElementById('modrinthSearchInput').value.trim()
    results.innerHTML = '<div style="opacity:0.7">検索中...</div>'
    try {
        const hits = await _mrApi(source).search(q, ctx.mc, ctx.loader)
        if(hits.length === 0){ results.innerHTML = '<div style="opacity:0.7">見つかりませんでした</div>'; return }
        results.innerHTML = ''
        for(const h of hits){
            const row = document.createElement('div')
            row.className = 'modrinthResult'
            const icon = h.iconUrl ? `<img src="${_mrEsc(h.iconUrl)}">` : '<img>'
            row.innerHTML = `${icon}
                <div class="modrinthResultInfo">
                    <div class="modrinthResultTitle">${_mrEsc(h.title)}</div>
                    <div class="modrinthResultMeta">${_mrEsc(h.author)} ・ DL ${Number(h.downloads||0).toLocaleString()}</div>
                </div>
                <div class="modrinthActions"></div>`
            results.appendChild(row)
            renderOnlineActions(row.getElementsByClassName('modrinthActions')[0], h, ctx, source)
        }
    } catch(err){
        results.innerHTML = '<div style="opacity:0.7">' + (err.message || '検索に失敗しました') + '</div>'
    }
}
```

- [ ] **Step 3: Replace `_mrRenderActions` with `renderOnlineActions`**

Replace the entire `_mrRenderActions(actionsEl, hit, ctx)` function with:
```js
function renderOnlineActions(actionsEl, hit, ctx, source){
    const manifest = _mrReadManifest(ctx)
    const entry = _mrInstalledEntry(ctx, manifest, source, hit)
    actionsEl.innerHTML = ''
    if(!entry){
        const add = document.createElement('button')
        add.type = 'button'; add.className = 'modrinthAddButton'; add.textContent = '追加'
        add.onclick = () => addOnlineMod(hit, ctx, actionsEl, add, source)
        actionsEl.appendChild(add)
        return
    }
    const rem = document.createElement('button')
    rem.type = 'button'; rem.className = 'modrinthRemoveButton'; rem.textContent = '削除'
    rem.onclick = () => removeOnlineMod(hit, ctx, actionsEl, entry, rem, source)
    actionsEl.appendChild(rem)
    _mrApi(source).getBestVersion(hit.projectId, ctx.mc, ctx.loader).then(best => {
        if(!best) return
        const newer = best.versionId !== entry.versionId
            && new Date(best.datePublished || 0) > new Date(entry.datePublished || 0)
        if(!newer || !actionsEl.isConnected) return
        const upd = document.createElement('button')
        upd.type = 'button'; upd.className = 'modrinthUpdateButton'; upd.textContent = '更新'
        upd.title = (entry.versionNumber || '') + ' → ' + (best.versionNumber || '')
        upd.onclick = () => updateOnlineMod(hit, ctx, actionsEl, entry, best, upd, source)
        actionsEl.insertBefore(upd, actionsEl.firstChild)
    }).catch(() => { /* update check is best-effort */ })
}
```

- [ ] **Step 4: Replace `_mrInstallVersion` with `installOnlineVersion` (skips blocked files)**

Replace the entire `_mrInstallVersion(ctx, hit, version)` function with:
```js
// Download the resolved version (mod + required deps) into the mods folder and
// record the mod's own file. Files with url:null (non-distributable) are skipped
// and their names returned so the caller can warn the user.
async function installOnlineVersion(ctx, hit, version, source){
    const { downloadFile } = require('helios-core/dl')
    const fsx = require('fs-extra'); const pth = require('path')
    const files = await _mrApi(source).collectRequired(version, ctx.mc, ctx.loader)
    fsx.ensureDirSync(ctx.modsDir)
    const blockedNames = []
    for(const f of files){
        if(!f.url){ blockedNames.push(f.filename); continue }
        const dest = pth.join(ctx.modsDir, f.filename)
        if(!fsx.existsSync(dest) && !fsx.existsSync(dest + '.disabled')){ await downloadFile(f.url, dest) }
    }
    // files[0] is the mod itself (collectRequired walks it first).
    if(files.length > 0 && files[0].url){
        const manifest = _mrReadManifest(ctx)
        manifest[_mrKey(source, hit.projectId)] = {
            source, slug: hit.slug, title: hit.title,
            versionId: version.versionId, versionNumber: version.versionNumber,
            datePublished: version.datePublished, files: [files[0].filename]
        }
        _mrWriteManifest(ctx, manifest)
    }
    return { blockedNames }
}
```

- [ ] **Step 5: Add `_mrOnlineNote` and replace `addModrinthMod` with `addOnlineMod`**

Replace the entire `addModrinthMod(hit, ctx, actionsEl, btn)` function with the note helper + generalized add (includes the blocked-mod branch used in Task 5):
```js
// Show a small per-row note beneath the result row (blocked/manual-download info).
function _mrOnlineNote(actionsEl, msg){
    const row = actionsEl.closest('.modrinthResult')
    if(!row || !row.parentNode) return
    let note = row.nextElementSibling
    if(!note || !note.classList || !note.classList.contains('modrinthNote')){
        note = document.createElement('div'); note.className = 'modrinthNote'
        row.parentNode.insertBefore(note, row.nextSibling)
    }
    note.textContent = msg
}

async function addOnlineMod(hit, ctx, actionsEl, btn, source){
    btn.setAttribute('disabled', ''); btn.textContent = '追加中...'
    try {
        const version = await _mrApi(source).getBestVersion(hit.projectId, ctx.mc, ctx.loader)
        if(!version){ btn.textContent = '非対応'; return }
        if(version.blocked){
            // Author disabled third-party distribution → send the user to the site.
            btn.removeAttribute('disabled'); btn.className = 'modrinthAddButton'; btn.textContent = 'CurseForgeで開く'
            btn.onclick = () => { try { shell.openExternal(hit.websiteUrl) } catch(e) { /* ignore */ } }
            _mrOnlineNote(actionsEl, 'このMODは配布不可設定のため手動DLが必要です')
            return
        }
        const res = await installOnlineVersion(ctx, hit, version, source)
        if(typeof resolveDropinModsForUI === 'function'){ await resolveDropinModsForUI() }
        if(res.blockedNames && res.blockedNames.length){
            _mrOnlineNote(actionsEl, '依存 ' + res.blockedNames.join(', ') + ' は手動DLが必要です')
        }
        renderOnlineActions(actionsEl, hit, ctx, source)
    } catch(err){
        btn.removeAttribute('disabled'); btn.textContent = '再試行'
        console.warn('online add failed', err)
    }
}
```

- [ ] **Step 6: Replace `removeModrinthMod`/`updateModrinthMod` with `removeOnlineMod`/`updateOnlineMod`**

Replace the entire `removeModrinthMod(...)` function with:
```js
async function removeOnlineMod(hit, ctx, actionsEl, entry, btn, source){
    const pth = require('path'); const fsx = require('fs-extra')
    btn.setAttribute('disabled', ''); btn.textContent = '削除中...'
    try {
        for(const fn of (entry.files || [])){
            const onDisk = fsx.existsSync(pth.join(ctx.modsDir, fn)) ? fn
                : (fsx.existsSync(pth.join(ctx.modsDir, fn + '.disabled')) ? fn + '.disabled' : null)
            if(onDisk){ await DropinModUtil.deleteDropinMod(ctx.modsDir, onDisk) }
        }
        const manifest = _mrReadManifest(ctx)
        delete manifest[_mrKey(source, hit.projectId)]
        _mrWriteManifest(ctx, manifest)
        if(typeof resolveDropinModsForUI === 'function'){ await resolveDropinModsForUI() }
        renderOnlineActions(actionsEl, hit, ctx, source)
    } catch(err){
        btn.removeAttribute('disabled'); btn.textContent = '再試行'
        console.warn('online remove failed', err)
    }
}
```
Then replace the entire `updateModrinthMod(...)` function with:
```js
async function updateOnlineMod(hit, ctx, actionsEl, entry, best, btn, source){
    const pth = require('path'); const fsx = require('fs-extra')
    btn.setAttribute('disabled', ''); btn.textContent = '更新中...'
    try {
        const oldFiles = (entry.files || []).slice()
        await installOnlineVersion(ctx, hit, best, source)
        const newManifest = _mrReadManifest(ctx)
        const nk = _mrKey(source, hit.projectId)
        const newFiles = (newManifest[nk] && newManifest[nk].files) || []
        for(const fn of oldFiles){
            if(newFiles.includes(fn)) continue
            const onDisk = fsx.existsSync(pth.join(ctx.modsDir, fn)) ? fn
                : (fsx.existsSync(pth.join(ctx.modsDir, fn + '.disabled')) ? fn + '.disabled' : null)
            if(onDisk){ await DropinModUtil.deleteDropinMod(ctx.modsDir, onDisk) }
        }
        if(typeof resolveDropinModsForUI === 'function'){ await resolveDropinModsForUI() }
        renderOnlineActions(actionsEl, hit, ctx, source)
    } catch(err){
        btn.removeAttribute('disabled'); btn.textContent = '再試行'
        console.warn('online update failed', err)
    }
}
```

- [ ] **Step 7: Add `_mrSetSource` and replace `openModrinthSearch` with `openOnlineModSearch`**

Replace the entire `openModrinthSearch()` function with:
```js
// Reflect the active source in the overlay chrome (toggle, header, key row).
function _mrSetSource(source){
    currentModSource = source
    const bar = document.getElementById('onlineModSourceToggle')
    if(bar){
        Array.from(bar.children).forEach(b => {
            if(b.getAttribute('data-source') === source) b.setAttribute('selected', '')
            else b.removeAttribute('selected')
        })
    }
    const row = document.getElementById('cfApiKeyRow')
    if(row) row.style.display = (source === 'curseforge') ? '' : 'none'
    const header = document.getElementById('modrinthHeader')
    if(header) header.textContent = (source === 'curseforge') ? 'CurseForgeから追加' : 'Modrinthから追加'
}

async function openOnlineModSearch(source){
    const ctx = await getModTargetContext()
    if(!ctx || !ctx.loader){
        setOverlayContent('MOD非対応', 'このパックはMODを導入できません（Fabric/Forge のパックを選んでください）。', 'OK')
        setOverlayHandler(null); toggleOverlay(true); return
    }
    _mrSetSource(source)
    document.getElementById('modrinthSearchInput').value = ''
    document.getElementById('modrinthResults').innerHTML = ''
    toggleOverlay(true, true, 'modrinthContent')
    if(source === 'curseforge' && !window.NLCurseForge.hasKey()){
        document.getElementById('modrinthResults').innerHTML = '<div style="opacity:0.7">CurseForge利用不可（APIキー未設定）</div>'
    }
}
```

- [ ] **Step 8: Update the DOMContentLoaded bindings**

Replace the existing binding block (the `document.addEventListener('DOMContentLoaded', ...)` that wires `settingsModrinthButton`, `modrinthSearchButton`, `modrinthSearchInput`, `modrinthCancel`) with:
```js
// The overlay markup (#modrinthContent) lives in overlay.ejs, included AFTER
// settings.ejs in app.ejs — bind once the whole document is parsed.
document.addEventListener('DOMContentLoaded', () => {
    const mb = document.getElementById('settingsModrinthButton')
    if(mb) mb.onclick = () => openOnlineModSearch('modrinth')
    const cfb = document.getElementById('settingsCurseForgeButton')
    if(cfb) cfb.onclick = () => openOnlineModSearch('curseforge')
    const sb = document.getElementById('modrinthSearchButton')
    if(sb) sb.onclick = () => runOnlineModSearch()
    const si = document.getElementById('modrinthSearchInput')
    if(si) si.addEventListener('keydown', (e) => { if(e.key === 'Enter'){ e.preventDefault(); e.stopPropagation(); runOnlineModSearch() } })
    const mc = document.getElementById('modrinthCancel')
    if(mc) mc.onclick = () => toggleOverlay(false)
    const bar = document.getElementById('onlineModSourceToggle')
    if(bar){
        Array.from(bar.children).forEach(b => {
            b.onclick = () => { _mrSetSource(b.getAttribute('data-source')); runOnlineModSearch() }
        })
    }
    const cfk = document.getElementById('cfApiKeyInput')
    if(cfk){
        try { cfk.value = ConfigManager.getCurseForgeApiKey() } catch(e) { /* ignore */ }
        cfk.onchange = () => {
            try { ConfigManager.setCurseForgeApiKey(cfk.value.trim()); ConfigManager.save() } catch(e) { /* ignore */ }
            runOnlineModSearch()
        }
    }
})
```

- [ ] **Step 9: Lint**

Run: `npm run lint 2>&1 | grep -E "problems"`
Expected: `✖ 21 problems` (no increase). If ESLint reports `no-unused-vars` for a leftover old name, you missed a replacement — fix it.

- [ ] **Step 10: Runtime DIAG — Modrinth regression (no key needed)**

This proves the generalization did not break Modrinth. Append to `app/assets/js/scripts/landing.js`:
```js
// [DIAG-GEN] temporary: Modrinth add→reopen→remove via generalized functions
if (process.env.NL_DIAG_GEN === '1') {
    setTimeout(async () => {
        const log = (m) => console.log('[DIAG-GEN] ' + m)
        try {
            const path = require('path'); const fsx = require('fs-extra')
            const id = 'diaggen-' + Date.now().toString(36)
            ConfigManager.addCustomInstance({ schema:1, id, name:'GEN', minecraftVersion:'1.20.1', loader:'fabric', loaderVersion:'0.16.10', created:Date.now(), lastPlayed:null })
            ConfigManager.setSelectedServer(id); ConfigManager.save()
            const modsDir = path.join(ConfigManager.getInstanceDirectory(), id, 'mods')
            const manifestPath = path.join(ConfigManager.getInstanceDirectory(), id, '.numapote-mods.json')
            await openOnlineModSearch('modrinth')
            document.getElementById('modrinthSearchInput').value = 'iris'
            document.getElementById('modrinthSearchButton').click()
            await new Promise(r=>setTimeout(r,4500))
            let target = null
            for(const row of document.getElementById('modrinthResults').getElementsByClassName('modrinthResult')){ const t=row.querySelector('.modrinthResultTitle'); if(t&&/^iris/i.test(t.textContent)){ target=row; break } }
            const actions = target.querySelector('.modrinthActions')
            log('initial=' + actions.firstChild.textContent)
            actions.firstChild.click()
            for(let i=0;i<40;i++){ if(fsx.existsSync(manifestPath)) break; await new Promise(r=>setTimeout(r,500)) }
            await new Promise(r=>setTimeout(r,1500))
            const man = fsx.existsSync(manifestPath) ? JSON.parse(fsx.readFileSync(manifestPath,'utf-8')) : {}
            const k = Object.keys(man)[0]
            log('afterAdd button=' + actions.firstChild.textContent + ' manifestKey=' + k + ' source=' + (man[k]&&man[k].source))
            document.getElementById('modrinthSearchButton').click(); await new Promise(r=>setTimeout(r,4500)); await new Promise(r=>setTimeout(r,1500))
            let t2=null; for(const row of document.getElementById('modrinthResults').getElementsByClassName('modrinthResult')){ const t=row.querySelector('.modrinthResultTitle'); if(t&&/^iris/i.test(t.textContent)){ t2=row; break } }
            const a2=t2.querySelector('.modrinthActions')
            log('afterReopen=' + a2.firstChild.textContent)
            const rem=a2.querySelector('.modrinthRemoveButton'); if(rem){ rem.click(); await new Promise(r=>setTimeout(r,3000)) }
            const man2 = fsx.existsSync(manifestPath) ? JSON.parse(fsx.readFileSync(manifestPath,'utf-8')) : {}
            log('afterRemove keys=' + Object.keys(man2).length + ' button=' + a2.firstChild.textContent)
            log('DONE')
        } catch(e){ log('error ' + (e&&e.message)) }
    }, 9000)
}
```
Run with `NL_DIAG_GEN` (same harness; allow up to ~70 polls).
Expected: `initial=追加`, `afterAdd button=削除 manifestKey=<modrinth projectId, NOT cf:...> source=modrinth`, `afterReopen=削除`, `afterRemove keys=0 button=追加`.

- [ ] **Step 11: Revert the DIAG and clean the throwaway instance**

Run:
```bash
git checkout -- app/assets/js/scripts/landing.js
```
Then remove the `diaggen-*` custom instance from config so it does not linger in the 自作 tab (the folder is auto-cleaned; only the config entry needs pruning):
```bash
node -e "const fs=require('fs');const p=require('os').homedir()+'/AppData/Roaming/.numapotelauncher/config.json';const c=JSON.parse(fs.readFileSync(p,'utf8'));if(Array.isArray(c.customInstances)){c.customInstances=c.customInstances.filter(x=>!/^diaggen-/.test(x&&x.id));} if(/^diaggen-/.test(c.selectedServer||''))c.selectedServer=null; fs.writeFileSync(p,JSON.stringify(c,null,4));console.log('pruned');"
```

- [ ] **Step 12: Commit**

```bash
git add app/assets/js/scripts/settings.js
git commit -m "refactor(mods): generalize Modrinth mod functions to be source-aware (adds CurseForge plumbing)"
```

---

### Task 4: Overlay toggle, CurseForge button, and styles

**Files:**
- Modify: `app/overlay.ejs` (inside `#modrinthContent`, lines 102-112)
- Modify: `app/settings.ejs` (line 160 area)
- Modify: `app/assets/css/launcher.css`

**Interfaces:**
- Consumes: `openOnlineModSearch`, `runOnlineModSearch`, `_mrSetSource` bindings (Task 3); `.serverTab` styling (existing).
- Produces DOM: `#onlineModSourceToggle` with two `.serverTab[data-source]` buttons, `#cfApiKeyRow`/`#cfApiKeyInput`, `#settingsCurseForgeButton`.

- [ ] **Step 1: Extend the overlay markup**

In `app/overlay.ejs`, replace the `#modrinthContent` block (lines 102-112) with:
```html
    <div id="modrinthContent" style="display: none;">
        <span id="modrinthHeader">Modrinthから追加</span>
        <div id="onlineModSourceToggle">
            <button class="serverTab" type="button" data-source="modrinth" selected>Modrinth</button>
            <button class="serverTab" type="button" data-source="curseforge">CurseForge</button>
        </div>
        <div id="modrinthSearchBar">
            <input type="text" id="modrinthSearchInput" placeholder="MODを検索">
            <button id="modrinthSearchButton" type="button">検索</button>
        </div>
        <div id="cfApiKeyRow" style="display: none;">
            <input type="text" id="cfApiKeyInput" placeholder="CurseForge APIキー（未入力なら同梱キーを使用）">
        </div>
        <div id="modrinthResults"><!-- results here --></div>
        <div id="modrinthActions">
            <button id="modrinthCancel" class="overlayKeybindEsc" type="button">閉じる</button>
        </div>
    </div>
```

- [ ] **Step 2: Add the CurseForge button in settings**

In `app/settings.ejs`, after line 160 (`<button id="settingsModrinthButton" type="button">Modrinthから追加</button>`), add:
```html
                    <button id="settingsCurseForgeButton" type="button">CurseForgeから追加</button>
```

- [ ] **Step 3: Style the CurseForge button, toggle, key input, and note**

In `app/assets/css/launcher.css`, add `#settingsCurseForgeButton` to the two existing selector groups so it matches the Modrinth/file-system buttons. Change:
```css
#settingsDropinFileSystemButton,
#settingsModrinthButton {
```
to:
```css
#settingsDropinFileSystemButton,
#settingsModrinthButton,
#settingsCurseForgeButton {
```
and change:
```css
#settingsDropinFileSystemButton:hover,
#settingsDropinFileSystemButton:focus,
#settingsDropinFileSystemButton[drag],
#settingsModrinthButton:hover,
#settingsModrinthButton:focus {
```
to:
```css
#settingsDropinFileSystemButton:hover,
#settingsDropinFileSystemButton:focus,
#settingsDropinFileSystemButton[drag],
#settingsModrinthButton:hover,
#settingsModrinthButton:focus,
#settingsCurseForgeButton:hover,
#settingsCurseForgeButton:focus {
```
Then append near the other `#modrinth*` overlay rules (after `#modrinthActions { margin-top: 12px; }`):
```css
#onlineModSourceToggle { display: flex; gap: 6px; margin-bottom: 12px; }
#cfApiKeyRow { margin-bottom: 12px; }
#cfApiKeyInput { width: 100%; box-sizing: border-box; background: rgba(255,255,255,0.85); border: 2px solid rgba(255,255,255,0.75); border-radius: 3px; padding: 6px; }
.modrinthNote { font-size: 11px; color: #e6b566; padding: 2px 8px 6px; }
```

- [ ] **Step 4: Lint**

Run: `npm run lint 2>&1 | grep -E "problems"`
Expected: `✖ 21 problems` (CSS/EJS are not linted; this confirms no JS regressions).

- [ ] **Step 5: Runtime DIAG — overlay chrome + empty-key state + button style**

Append to `app/assets/js/scripts/landing.js`:
```js
// [DIAG-CFUI] temporary
if (process.env.NL_DIAG_CFUI === '1') {
    setTimeout(async () => {
        const log = (m) => console.log('[DIAG-CFUI] ' + m)
        try {
            const path = require('path')
            const id = 'diagcfui-' + Date.now().toString(36)
            ConfigManager.addCustomInstance({ schema:1, id, name:'CFUI', minecraftVersion:'1.20.1', loader:'fabric', loaderVersion:'0.16.10', created:Date.now(), lastPlayed:null })
            ConfigManager.setSelectedServer(id); ConfigManager.save()
            // Style parity with sibling
            const cfBtn = document.getElementById('settingsCurseForgeButton')
            const mrBtn = document.getElementById('settingsModrinthButton')
            const cs = getComputedStyle(cfBtn), ms = getComputedStyle(mrBtn)
            log('btn color=' + cs.color + ' bg=' + cs.backgroundColor + ' matchColor=' + (cs.color===ms.color) + ' matchBg=' + (cs.backgroundColor===ms.backgroundColor))
            // Open on CurseForge tab (no key → disabled message)
            await openOnlineModSearch('curseforge')
            log('header=' + document.getElementById('modrinthHeader').textContent)
            log('keyRowVisible=' + (getComputedStyle(document.getElementById('cfApiKeyRow')).display !== 'none'))
            log('toggleSelected=' + document.querySelector('#onlineModSourceToggle [data-source=curseforge]').hasAttribute('selected'))
            log('emptyKeyMsg=' + /利用不可/.test(document.getElementById('modrinthResults').textContent))
            // Switch to Modrinth via toggle → key row hides
            document.querySelector('#onlineModSourceToggle [data-source=modrinth]').click()
            await new Promise(r=>setTimeout(r,500))
            log('afterToggleModrinth keyRowVisible=' + (getComputedStyle(document.getElementById('cfApiKeyRow')).display !== 'none') + ' header=' + document.getElementById('modrinthHeader').textContent)
            log('DONE')
        } catch(e){ log('error ' + (e&&e.message)) }
    }, 9000)
}
```
Run with `NL_DIAG_CFUI`.
Expected: `matchColor=true matchBg=true`, `header=CurseForgeから追加`, `keyRowVisible=true`, `toggleSelected=true`, `emptyKeyMsg=true`, `afterToggleModrinth keyRowVisible=false header=Modrinthから追加`.

- [ ] **Step 6: Revert DIAG + prune throwaway instance**

```bash
git checkout -- app/assets/js/scripts/landing.js
node -e "const fs=require('fs');const p=require('os').homedir()+'/AppData/Roaming/.numapotelauncher/config.json';const c=JSON.parse(fs.readFileSync(p,'utf8'));if(Array.isArray(c.customInstances)){c.customInstances=c.customInstances.filter(x=>!/^diagcfui-/.test(x&&x.id));} if(/^diagcfui-/.test(c.selectedServer||''))c.selectedServer=null; fs.writeFileSync(p,JSON.stringify(c,null,4));console.log('pruned');"
```

- [ ] **Step 7: Commit**

```bash
git add app/overlay.ejs app/settings.ejs app/assets/css/launcher.css
git commit -m "feat(curseforge): overlay source toggle, CurseForge button, API-key field + styles"
```

---

### Task 5: Blocked-mod fallback verification + polish

The blocked-mod branch and note helper were added in Task 3 (`addOnlineMod`) and Task 4 (CSS). This task verifies them end-to-end with a mocked blocked version (no key/network) and confirms the manual-download dependency note.

**Files:**
- (Verification only — no source changes expected. If a defect is found, fix it in `app/assets/js/scripts/settings.js` and note it in the commit.)

**Interfaces:**
- Consumes: `addOnlineMod`, `installOnlineVersion`, `_mrOnlineNote` (Task 3); `.modrinthNote` (Task 4).

- [ ] **Step 1: Runtime DIAG — blocked mod → "CurseForgeで開く" + dependency note**

Append to `app/assets/js/scripts/landing.js`:
```js
// [DIAG-CFBLK] temporary
if (process.env.NL_DIAG_CFBLK === '1') {
    setTimeout(async () => {
        const log = (m) => console.log('[DIAG-CFBLK] ' + m)
        try {
            const path = require('path')
            const id = 'diagcfblk-' + Date.now().toString(36)
            ConfigManager.addCustomInstance({ schema:1, id, name:'CFBLK', minecraftVersion:'1.20.1', loader:'fabric', loaderVersion:'0.16.10', created:Date.now(), lastPlayed:null })
            ConfigManager.setSelectedServer(id); ConfigManager.save()
            const ctx = await getModTargetContext()
            // Spy on shell.openExternal
            let opened = null
            const realOpen = shell.openExternal; shell.openExternal = (u) => { opened = u; return Promise.resolve() }
            // Case A: mod itself blocked
            window.NLCurseForge.getBestVersion = async () => ({ versionId:'1', versionNumber:'v1', datePublished:'2026-01-01', files:[{filename:'blk.jar', url:null}], dependencies:[], blocked:true })
            const rowA = document.createElement('div'); rowA.className='modrinthResult'; rowA.innerHTML='<div class="modrinthResultInfo"></div><div class="modrinthActions"></div>'
            document.getElementById('modrinthResults').appendChild(rowA)
            const aA = rowA.querySelector('.modrinthActions'); const btnA = document.createElement('button'); aA.appendChild(btnA)
            await addOnlineMod({ projectId:'100', slug:'blk', title:'Blk', websiteUrl:'http://cf/blk' }, ctx, aA, btnA, 'curseforge')
            btnA.click()
            log('blockedBtn=' + btnA.textContent + ' opened=' + opened + ' note=' + (rowA.nextElementSibling && rowA.nextElementSibling.textContent))
            // Case B: mod OK but a required dep is blocked (installOnlineVersion collects blockedNames)
            window.NLCurseForge.collectRequired = async () => ([{ filename:'main.jar', url:null }, { filename:'dep.jar', url:null }])
            const resB = await installOnlineVersion(ctx, { projectId:'200', slug:'m', title:'M' }, { versionId:'2', files:[{filename:'main.jar',url:null}], dependencies:[] }, 'curseforge')
            log('blockedNames=' + JSON.stringify(resB.blockedNames))
            shell.openExternal = realOpen
            log('DONE')
        } catch(e){ log('error ' + (e&&e.message)) }
    }, 9000)
}
```
Run with `NL_DIAG_CFBLK`.
Expected: `blockedBtn=CurseForgeで開く opened=http://cf/blk note=このMODは配布不可設定のため手動DLが必要です`, and `blockedNames=["main.jar","dep.jar"]`.

- [ ] **Step 2: If the DIAG revealed a defect, fix it**

Only if Step 1 did not match expectations: correct `app/assets/js/scripts/settings.js` (`addOnlineMod` / `installOnlineVersion` / `_mrOnlineNote`) and re-run Step 1 until it matches. If everything matched, make no changes.

- [ ] **Step 3: Lint**

Run: `npm run lint 2>&1 | grep -E "problems"`
Expected: `✖ 21 problems`.

- [ ] **Step 4: Revert DIAG + prune throwaway instance**

```bash
git checkout -- app/assets/js/scripts/landing.js
node -e "const fs=require('fs');const p=require('os').homedir()+'/AppData/Roaming/.numapotelauncher/config.json';const c=JSON.parse(fs.readFileSync(p,'utf8'));if(Array.isArray(c.customInstances)){c.customInstances=c.customInstances.filter(x=>!/^diagcfblk-/.test(x&&x.id));} if(/^diagcfblk-/.test(c.selectedServer||''))c.selectedServer=null; fs.writeFileSync(p,JSON.stringify(c,null,4));console.log('pruned');"
```

- [ ] **Step 5: Commit**

If Step 2 changed source:
```bash
git add app/assets/js/scripts/settings.js
git commit -m "fix(curseforge): correct blocked-mod fallback per runtime verification"
```
If no changes were needed, record verification with an empty commit:
```bash
git commit --allow-empty -m "test(curseforge): verify blocked-mod fallback (open site + dependency note)"
```

---

## Live CurseForge smoke test (manual, requires a real key)

The automated DIAGs above are key-free. Before merging, if a real CurseForge API key is available, the human should place it in `app/assets/js/cfapikey.js` (or paste it into the overlay key field) and manually confirm against a moddable Fabric pack: (1) CurseForge tab search returns results, (2) adding a Fabric mod writes a `cf:<modId>` manifest entry and the button becomes 削除, (3) reopening shows 削除, (4) a mod with a required dependency pulls the dependency jar, (5) the Modrinth tab still works. This mirrors spec test observations 1-9. Without a key, these are covered structurally by the mapper and generalization DIAGs.
