# Modrinth Modpack Import (M-Pack1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** Search Modrinth modpacks in-launcher and import a selected `.mrpack` as a new custom instance (MC + loader + all mods).

**Architecture:** `modrinth.js` gains modpack search + `.mrpack` file lookup. A new `modpackimport.js` downloads the `.mrpack`, reads `modrinth.index.json`, validates the loader (Fabric/Forge only), registers a custom instance, downloads each mod into `instances/<id>/mods`, and extracts `overrides/`. A new modpack search overlay on the 自作 tab drives it. Created instances launch via the existing custom-launch flow.

**Tech Stack:** Electron 33, helios-core `downloadFile`, `node-stream-zip`, `got` (Modrinth), existing custom-instance infra.

## Global Constraints

- No unit tests. Verify with `npm run lint` (**baseline 21**) + env-gated runtime DIAG in `landing.js`, reverted before commit.
- Branch `feature/modrinth-modpack-import`, never main. Commit per task. `git add` only named files.
- Downloads from `cdn.modrinth.com` / Modrinth API only. All file placement under `instances/<id>` (validate with `path.normalize`); reject `..` entries.
- Loaders: Fabric/Forge only; Quilt/NeoForge modpacks abort before creating an instance.
- HTML-escape network text with `_mrEsc` before innerHTML.
- Kill leftover electron/java between DIAG runs; prune throwaway instances from config after each.

## File Structure

- **Modify** `app/assets/js/scripts/modrinth.js` — `searchModpacks`, `getModpackFile`.
- **Create** `app/assets/js/scripts/modpackimport.js` — `window.NLModpack.importModrinthModpack`.
- **Modify** `app/app.ejs` — include `modpackimport.js`.
- **Modify** `app/overlay.ejs` — 自作 tab button + `#modpackContent` overlay.
- **Modify** `app/assets/js/scripts/overlay.js` — search/import functions + bindings.
- **Modify** `app/assets/css/launcher.css` — button + overlay styles.

---

### Task 1: modrinth.js — modpack search + file lookup

**Files:** Modify `app/assets/js/scripts/modrinth.js`

**Interfaces:** Produces `window.NLModrinth.searchModpacks(query, limit) → [{projectId,slug,title,author,description,iconUrl,downloads}]` and `getModpackFile(projectId) → {url,filename,versionId}|null`.

- [ ] **Step 1: Add functions**

In `modrinth.js`, after `getBestVersion`, add:
```js
    async function searchModpacks(query, limit = 20){
        const facets = JSON.stringify([['project_type:modpack']])
        const url = `${API}/search?query=${encodeURIComponent(query || '')}&limit=${limit}&facets=${encodeURIComponent(facets)}`
        const body = await getJson(url)
        return (body.hits || []).map(h => ({
            projectId: h.project_id, slug: h.slug, title: h.title, author: h.author,
            description: h.description, iconUrl: h.icon_url, downloads: h.downloads
        }))
    }

    async function getModpackFile(projectId){
        const list = await getJson(`${API}/project/${encodeURIComponent(projectId)}/version`)
        if(!Array.isArray(list) || list.length === 0) return null
        const sorted = list.slice().sort((a, b) => new Date(b.date_published || 0) - new Date(a.date_published || 0))
        for(const v of sorted){
            const files = v.files || []
            const primary = files.find(f => f.primary && /\.mrpack$/i.test(f.filename)) || files.find(f => /\.mrpack$/i.test(f.filename))
            if(primary) return { url: primary.url, filename: primary.filename, versionId: v.id }
        }
        return null
    }
```
Then extend the exports line:
```js
    window.NLModrinth = { search, getBestVersion, collectRequired, searchModpacks, getModpackFile }
```

- [ ] **Step 2: Lint** → `✖ 21 problems`.

- [ ] **Step 3: Runtime DIAG**

Append to `app/assets/js/scripts/landing.js`:
```js
// [DIAG-MPSEARCH] temporary
if (process.env.NL_DIAG_MPSEARCH === '1') {
    setTimeout(async () => {
        const log = (m) => console.log('[DIAG-MPSEARCH] ' + m)
        try {
            const hits = await window.NLModrinth.searchModpacks('fabulously optimized')
            log('count=' + hits.length + ' first=' + (hits[0] && hits[0].title) + ' pid=' + (hits[0] && hits[0].projectId))
            const f = await window.NLModrinth.getModpackFile(hits[0].projectId)
            log('file=' + (f && f.filename) + ' mrpack=' + (f && /\.mrpack$/i.test(f.filename)))
            log('DONE')
        } catch(e){ log('error ' + (e && e.message)) }
    }, 7000)
}
```
Run `NL_DIAG_MPSEARCH=1 npx electron . --disable-gpu`. Expected: `count>0`, a modpack title, `file` ends `.mrpack`, `mrpack=true`.

- [ ] **Step 4: Revert DIAG** — `git checkout -- app/assets/js/scripts/landing.js`

- [ ] **Step 5: Commit**
```bash
git add app/assets/js/scripts/modrinth.js
git commit -m "feat(modpack): Modrinth modpack search + .mrpack file lookup"
```

---

### Task 2: modpackimport.js — download, parse, create instance

**Files:** Create `app/assets/js/scripts/modpackimport.js`; Modify `app/app.ejs`

**Interfaces:** Produces `window.NLModpack.importModrinthModpack(hit, onProgress) → {id,name,fileCount,failed}`.

- [ ] **Step 1: Create the module**

Create `app/assets/js/scripts/modpackimport.js`:
```js
/**
 * Import a Modrinth modpack (.mrpack) as a new custom instance.
 * window.NLModpack.
 */
(function(){
    const path = require('path')
    const fs = require('fs-extra')
    const StreamZip = require('node-stream-zip')
    const { downloadFile } = require('helios-core/dl')
    const ConfigManager = require('./assets/js/configmanager')

    function underDir(base, p){ return path.normalize(p).startsWith(path.normalize(base)) }
    function safeSlug(s){ return String(s || 'pack').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60) }
    function genId(){ return 'custom-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) }

    async function importModrinthModpack(hit, onProgress){
        const commonDir = ConfigManager.getCommonDirectory()
        const file = await window.NLModrinth.getModpackFile(hit.projectId)
        if(!file) throw new Error('このパックに.mrpackファイルが見つかりません')
        const mrpackPath = path.join(commonDir, 'temp', safeSlug(hit.slug || hit.title) + '.mrpack')
        if(!fs.existsSync(mrpackPath)){ await downloadFile(file.url, mrpackPath) }
        const zip = new StreamZip.async({ file: mrpackPath })
        let result
        try {
            const index = JSON.parse((await zip.entryData('modrinth.index.json')).toString('utf8'))
            const deps = index.dependencies || {}
            const mc = deps.minecraft
            if(!mc){ throw new Error('modpackのMinecraftバージョンが不明です') }
            let loader = null, loaderVersion = ''
            if(deps['fabric-loader']){ loader = 'fabric'; loaderVersion = deps['fabric-loader'] }
            else if(deps.forge){ loader = 'forge'; loaderVersion = deps.forge }
            else if(deps['quilt-loader']){ throw new Error('このモッドパックのローダー（Quilt）は未対応です') }
            else if(deps.neoforge){ throw new Error('このモッドパックのローダー（NeoForge）は未対応です') }
            else { throw new Error('対応するローダーが見つかりません（Fabric/Forgeのみ対応）') }

            const id = genId()
            const name = index.name || hit.title || '無題のパック'
            ConfigManager.addCustomInstance({ schema: 1, id, name, minecraftVersion: mc, loader, loaderVersion, created: Date.now(), lastPlayed: null })
            ConfigManager.save()
            const instDir = path.join(ConfigManager.getInstanceDirectory(), id)
            fs.ensureDirSync(instDir)

            const files = (index.files || []).filter(f => !(f.env && f.env.client === 'unsupported'))
            const failed = []
            for(let i = 0; i < files.length; i++){
                const f = files[i]
                const dest = path.join(instDir, f.path)
                if(!underDir(instDir, dest)){ failed.push(f.path); continue }
                if(!fs.existsSync(dest)){
                    try { fs.ensureDirSync(path.dirname(dest)); await downloadFile((f.downloads || [])[0], dest) }
                    catch(e){ failed.push(f.path) }
                }
                if(typeof onProgress === 'function') onProgress(i + 1, files.length)
            }

            // Copy overrides/ and client-overrides/ into the instance dir.
            const entries = await zip.entries()
            for(const ename of Object.keys(entries)){
                const en = entries[ename]
                if(en.isDirectory) continue
                let rel = null
                if(ename.startsWith('overrides/')) rel = ename.slice('overrides/'.length)
                else if(ename.startsWith('client-overrides/')) rel = ename.slice('client-overrides/'.length)
                if(rel == null || rel === '') continue
                const dest = path.join(instDir, rel)
                if(!underDir(instDir, dest)) continue
                fs.ensureDirSync(path.dirname(dest))
                await zip.extract(ename, dest)
            }
            result = { id, name, fileCount: files.length, failed }
        } finally {
            await zip.close()
        }
        return result
    }

    window.NLModpack = { importModrinthModpack }
})()
```

- [ ] **Step 2: Include the script**

In `app/app.ejs`, after `curseforge.js`:
```html
    <script src="./assets/js/scripts/modpackimport.js"></script>
```

- [ ] **Step 3: Lint** → `✖ 21 problems`.

- [ ] **Step 4: Runtime DIAG — real import of a small Fabric pack**

Append to `app/assets/js/scripts/landing.js`:
```js
// [DIAG-MPIMPORT] temporary
if (process.env.NL_DIAG_MPIMPORT === '1') {
    setTimeout(async () => {
        const log = (m) => console.log('[DIAG-MPIMPORT] ' + m)
        try {
            const path = require('path'); const fsx = require('fs-extra')
            const hits = await window.NLModrinth.searchModpacks('fabulously optimized')
            const hit = hits[0]
            log('importing=' + hit.title)
            const res = await window.NLModpack.importModrinthModpack(hit, (i,n)=>{})
            const inst = ConfigManager.getCustomInstance(res.id)
            const modsDir = path.join(ConfigManager.getInstanceDirectory(), res.id, 'mods')
            const jarCount = fsx.existsSync(modsDir) ? fsx.readdirSync(modsDir).filter(n=>/\.jar$/i.test(n)).length : 0
            log('id=' + res.id + ' mc=' + (inst && inst.minecraftVersion) + ' loader=' + (inst && inst.loader) + '/' + (inst && inst.loaderVersion))
            log('fileCount=' + res.fileCount + ' failed=' + res.failed.length + ' jarsOnDisk=' + jarCount)
            log('registered=' + (ConfigManager.getCustomInstances().some(x=>x.id===res.id)))
            log('CLEANUP_ID ' + res.id)
            log('DONE')
        } catch(e){ log('error ' + (e && e.message)) }
    }, 8000)
}
```
Run `NL_DIAG_MPIMPORT=1 npx electron . --disable-gpu` (downloads the pack's mods; a couple minutes). Expected: `mc` a real version, `loader=fabric/<ver>`, `fileCount>0`, `failed=0` (or small), `jarsOnDisk`≈`fileCount`, `registered=true`.

- [ ] **Step 5: Revert DIAG + prune the imported instance**

Capture the `CLEANUP_ID` from the log, then:
```bash
git checkout -- app/assets/js/scripts/landing.js
node -e "const fs=require('fs');const p=require('os').homedir()+'/AppData/Roaming/.numapotelauncher/config.json';const c=JSON.parse(fs.readFileSync(p,'utf8'));if(Array.isArray(c.customInstances)){c.customInstances=c.customInstances.filter(x=>!/^custom-/.test(x&&x.id)||(x&&x.name!=='Fabulously Optimized'));} fs.writeFileSync(p,JSON.stringify(c,null,4));console.log('pruned test packs');"
```
(Only prunes the freshly-imported test pack by name; adjust if the title differs.)

- [ ] **Step 6: Commit**
```bash
git add app/assets/js/scripts/modpackimport.js app/app.ejs
git commit -m "feat(modpack): import a Modrinth .mrpack as a custom instance"
```

---

### Task 3: UI — 自作 tab button + modpack search overlay

**Files:** Modify `app/overlay.ejs`, `app/assets/js/scripts/overlay.js`, `app/assets/css/launcher.css`

- [ ] **Step 1: Add the button + overlay markup**

In `app/overlay.ejs`, after:
```html
                <button id="customInstanceCreateButton" type="button">＋ 新規作成</button>
```
add:
```html
                <button id="customModpackButton" type="button">modpackから作成</button>
```
Then add a new overlay block after the `#customCreateContent` block's closing `</div>`:
```html
    <div id="modpackContent" style="display: none;">
        <span id="modpackHeader">modpackから作成</span>
        <div id="modpackSearchBar">
            <input type="text" id="modpackSearchInput" placeholder="モッドパックを検索">
            <button id="modpackSearchButton" type="button">検索</button>
        </div>
        <div id="modpackResults"><!-- results here --></div>
        <div id="modpackActions">
            <button id="modpackCancel" class="overlayKeybindEsc" type="button">閉じる</button>
        </div>
    </div>
```

- [ ] **Step 2: Add overlay.js functions**

In `app/assets/js/scripts/overlay.js`, add near the other custom-instance functions (e.g., after `openCustomInstanceCreate` / before `createServerHtml`):
```js
async function openModpackSearch(){
    document.getElementById('modpackSearchInput').value = ''
    document.getElementById('modpackResults').innerHTML = ''
    toggleOverlay(true, true, 'modpackContent')
    runModpackSearch()
}

async function runModpackSearch(){
    const q = document.getElementById('modpackSearchInput').value.trim()
    const results = document.getElementById('modpackResults')
    results.innerHTML = '<div style="opacity:0.7">検索中...</div>'
    try {
        const hits = await window.NLModrinth.searchModpacks(q)
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
                <div class="modrinthActions"><button class="modrinthAddButton" type="button">導入</button></div>`
            const btn = row.getElementsByClassName('modrinthAddButton')[0]
            btn.onclick = () => importModpack(h, btn)
            results.appendChild(row)
        }
    } catch(err){
        results.innerHTML = '<div style="opacity:0.7">' + (err.message || '検索に失敗しました') + '</div>'
    }
}

async function importModpack(hit, btn){
    btn.setAttribute('disabled', ''); btn.textContent = '導入中...'
    try {
        const res = await window.NLModpack.importModrinthModpack(hit, (i, n) => { btn.textContent = `導入中 ${i}/${n}` })
        btn.textContent = '完了'
        if(res.failed && res.failed.length){
            setOverlayContent('一部のMODを取得できませんでした', res.failed.slice(0, 10).join('\n') + (res.failed.length > 10 ? '\n…' : ''), 'OK')
            setOverlayHandler(() => { toggleServerSelection(true).then(() => setServerTab('custom')) })
            toggleOverlay(true)
        } else {
            await toggleServerSelection(true); setServerTab('custom')
        }
    } catch(err){
        btn.removeAttribute('disabled'); btn.textContent = '再試行'
        setOverlayContent('取り込み失敗', err.message || '不明なエラー', 'OK')
        setOverlayHandler(null); toggleOverlay(true)
    }
}
```

- [ ] **Step 3: Bind the button + overlay controls**

In `app/assets/js/scripts/overlay.js`, inside the `DOMContentLoaded` handler that binds `customInstanceCreateButton` (around the custom-tab bindings), add:
```js
    const mpBtn = document.getElementById('customModpackButton')
    if(mpBtn) mpBtn.addEventListener('click', () => openModpackSearch())
    const mpSearch = document.getElementById('modpackSearchButton')
    if(mpSearch) mpSearch.addEventListener('click', () => runModpackSearch())
    const mpInput = document.getElementById('modpackSearchInput')
    if(mpInput) mpInput.addEventListener('keydown', (e) => { if(e.key === 'Enter'){ e.preventDefault(); e.stopPropagation(); runModpackSearch() } })
    const mpCancel = document.getElementById('modpackCancel')
    if(mpCancel) mpCancel.addEventListener('click', () => toggleOverlay(false))
```

- [ ] **Step 4: CSS**

In `app/assets/css/launcher.css`, add `#customModpackButton` to the create-button rule (find `#customInstanceCreateButton {`) — duplicate the block for `#customModpackButton` with `margin-top: 6px;`, and a hover rule. Then style the overlay by grouping with the existing `#modrinthContent` rules — for each `#modrinth*` overlay selector add its `#modpack*` sibling:
```css
#customModpackButton {
    margin-top: 6px;
    background: none;
    border: 1px solid #fff;
    color: #fff;
    padding: 6px 16px;
    border-radius: 3px;
    cursor: pointer;
    font-weight: bold;
}
#customModpackButton:hover { box-shadow: 0 0 10px 0 #fff; }
#modpackContent { display: flex; flex-direction: column; align-items: center; justify-content: flex-start; width: 640px; max-width: 90%; max-height: 80%; }
#modpackHeader { font-size: 20px; font-weight: bold; margin-bottom: 16px; }
#modpackSearchBar { display: flex; gap: 8px; width: 100%; margin-bottom: 12px; }
#modpackSearchInput { flex: 1 1 auto; background: rgba(255,255,255,0.85); border: 2px solid rgba(255,255,255,0.75); border-radius: 3px; padding: 6px; }
#modpackSearchButton, #modpackCancel { background: none; border: 1px solid #fff; color: #fff; border-radius: 3px; padding: 6px 14px; cursor: pointer; font-weight: bold; }
#modpackSearchButton:hover, #modpackCancel:hover { box-shadow: 0 0 10px 0 #fff; }
#modpackResults { width: 100%; flex: 1 1 auto; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
#modpackActions { margin-top: 12px; }
```
(If `#modrinthContent` in the CSS uses different sizing, mirror that block's values for `#modpackContent` instead — check `#modrinthContent {` and copy its properties.)

- [ ] **Step 5: Lint** → `✖ 21 problems`.

- [ ] **Step 6: Runtime DIAG — UI end-to-end**

Append to `app/assets/js/scripts/landing.js`:
```js
// [DIAG-MPUI] temporary
if (process.env.NL_DIAG_MPUI === '1') {
    setTimeout(async () => {
        const log = (m) => console.log('[DIAG-MPUI] ' + m)
        try {
            log('btnExists=' + !!document.getElementById('customModpackButton'))
            await openModpackSearch()
            await new Promise(r=>setTimeout(r,4000))
            const rows = document.getElementById('modpackResults').getElementsByClassName('modrinthResult')
            log('overlayShown=' + (document.getElementById('main').hasAttribute('overlay')) + ' rows=' + rows.length + ' first=' + (rows[0] && rows[0].querySelector('.modrinthResultTitle').textContent))
            log('importBtn=' + (rows[0] && rows[0].querySelector('.modrinthAddButton').textContent))
            log('DONE')
        } catch(e){ log('error ' + (e && e.message)) }
    }, 8000)
}
```
Run `NL_DIAG_MPUI=1 npx electron . --disable-gpu`. Expected: `btnExists=true`, `overlayShown=true`, `rows>0` with a modpack title, `importBtn=導入`.

- [ ] **Step 7: Revert DIAG** — `git checkout -- app/assets/js/scripts/landing.js`

- [ ] **Step 8: Commit**
```bash
git add app/overlay.ejs app/assets/js/scripts/overlay.js app/assets/css/launcher.css
git commit -m "feat(modpack): 自作 tab modpack search overlay + import flow"
```

## Self-Review
- Coverage: A→Task1, B→Task2, C→Task3. ✓
- Types: `importModrinthModpack(hit, onProgress) → {id,name,fileCount,failed}` consumed identically in the UI. `searchModpacks`/`getModpackFile` shapes match usage. ✓
- Path safety: `underDir` guards every write. ✓
