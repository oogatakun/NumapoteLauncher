# Custom Instance Modern Forge (M-Forge1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let users create and launch custom instances with modern Forge (MC 1.13+), reusing helios-core's Forge installer.

**Architecture:** A new `customforge.js` downloads the Forge installer, runs it via helios-core `DistributionIndexProcessor.installForge` (with the bundled `ForgeInstallerCLI.jar`) against a synthetic distribution containing a `Type.Forge` module, then loads the generated Forge `version.json` as the modManifest. ProcessBuilder reads Forge libraries directly from `modManifest.libraries` (verified in `_resolveServerLibraries`), so we only ensure those libraries are on disk and pass a minimal `Type.Forge` module. The create UI gains a Forge option whose loader-version list is driven by the selected MC.

**Tech Stack:** Electron 33 (nodeIntegration, shared renderer globals: `remote`, `ConfigManager`, `setLaunchDetails`, etc.), helios-core (`DistributionIndexProcessor`, `downloadFile`, `mcVersionAtLeast`), helios-distribution-types (`Type.Forge`), `fetch`/`got`, EJS.

## Global Constraints

- No unit-test framework. Each task is verified by `npm run lint` (**must stay at baseline 21 errors**) plus an env-gated runtime DIAG appended to `app/assets/js/scripts/landing.js`, run with `NL_DIAG_<X>=1 npx electron . --disable-gpu`, then reverted before commit.
- Branch `feature/custom-forge-modern`, never main. Commit per task. `git add` ONLY named files; never `git add .`.
- Scope is **modern Forge only (MC 1.13+)**. MC<1.13 with Forge is blocked in the create UI (legacy = M-Forge2).
- Download sources: Forge maven (`maven.minecraftforge.net`) and Mojang only.
- Forge module type is `Type.Forge`; its `getMavenComponents().version` MUST be `<mc>-<forge>` (e.g. `1.20.1-47.2.0`).
- Kill leftover electron between DIAG runs: `powershell.exe -NoProfile -Command "Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force"`.
- Prune throwaway `diag*`/`custom-*` instances created by DIAGs from `%APPDATA%/.numapotelauncher/config.json` after each verification.

## File Structure

- **Modify** `app/assets/js/scripts/customversions.js` — add `fetchForgeVersions(mc)`.
- **Modify** `app/overlay.ejs` — add Forge `<option>`.
- **Modify** `app/assets/js/scripts/overlay.js` — Forge branch in `refreshLoaderVersions`, MC-change re-fetch, confirm-handler loader-version requirement, MC<1.13 guard.
- **Create** `app/assets/js/scripts/customforge.js` — `window.NLCustomForge.installForge`.
- **Modify** `app/app.ejs` — include `customforge.js`.
- **Modify** `app/assets/js/scripts/customlaunch.js` — Forge branch in `launchCustomInstance`.

---

### Task 1: `fetchForgeVersions(mc)` in customversions.js

**Files:** Modify `app/assets/js/scripts/customversions.js`

**Interfaces:**
- Produces: `window.NLCustomVersions.fetchForgeVersions(mc) → Promise<[{version:string, full:string, recommended:boolean, latest:boolean}]>` (newest-first).

- [ ] **Step 1: Add the function and export**

Add inside the IIFE, after `fetchFabricProfile` (before `fetchRequiredJavaMajor`):
```js
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
            const promoRes = await fetch(`${FORGE_MAVEN}/promotions_slim.json`, { cache: 'no-store' })
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
```
Then add `fetchForgeVersions` to the exports object:
```js
    window.NLCustomVersions = { fetchReleaseVersions, fetchFabricLoaderVersions, fetchFabricProfile, fetchRequiredJavaMajor, fetchForgeVersions }
```

- [ ] **Step 2: Lint**

Run: `npm run lint 2>&1 | grep -E "problems"` → Expected `✖ 21 problems`.

- [ ] **Step 3: Runtime DIAG (network)**

Append to `app/assets/js/scripts/landing.js`:
```js
// [DIAG-FGVER] temporary
if (process.env.NL_DIAG_FGVER === '1') {
    setTimeout(async () => {
        try {
            const list = await window.NLCustomVersions.fetchForgeVersions('1.20.1')
            const rec = list.find(v => v.recommended); const lat = list.find(v => v.latest)
            console.log('[DIAG-FGVER] count=' + list.length + ' first=' + (list[0] && list[0].full) + ' rec=' + (rec && rec.version) + ' lat=' + (lat && lat.version))
            console.log('[DIAG-FGVER] DONE')
        } catch(e){ console.log('[DIAG-FGVER] error ' + (e && e.message)) }
    }, 7000)
}
```
Run (harness with `NL_DIAG_FGVER`). Expected: `count>0`, `first` is a `1.20.1-...` string, `rec` and `lat` are non-empty version numbers.

- [ ] **Step 4: Revert DIAG** — `git checkout -- app/assets/js/scripts/landing.js`

- [ ] **Step 5: Commit**
```bash
git add app/assets/js/scripts/customversions.js
git commit -m "feat(forge): fetchForgeVersions for the custom instance creator"
```

---

### Task 2: Create-UI Forge option + MC-driven version list

**Files:** Modify `app/overlay.ejs`, `app/assets/js/scripts/overlay.js`

**Interfaces:** Consumes `fetchForgeVersions` (Task 1) and helios-core `mcVersionAtLeast`.

- [ ] **Step 1: Add the Forge option**

In `app/overlay.ejs`, in `#customCreateLoader`, after the Fabric option:
```html
                <option value="forge">Forge</option>
```

- [ ] **Step 2: Forge branch in `refreshLoaderVersions`**

In `app/assets/js/scripts/overlay.js`, replace the `refreshLoaderVersions` function (the one with the `if(loaderEl.value === 'fabric'){ ... } else { ... }`) with this version that adds a Forge branch:
```js
    async function refreshLoaderVersions(){
        if(!loaderEl) return
        if(loaderEl.value === 'fabric'){
            if(loaderVerField) loaderVerField.style.display = ''
            if(loaderVerEl) loaderVerEl.innerHTML = '<option value="">読み込み中...</option>'
            try {
                const mc = document.getElementById('customCreateMcVersion').value
                const list = await window.NLCustomVersions.fetchFabricLoaderVersions(mc)
                if(list.length === 0){
                    if(loaderVerEl) loaderVerEl.innerHTML = '<option value="">このMC版はFabric非対応</option>'
                } else if(loaderVerEl){
                    loaderVerEl.innerHTML = list.map(v => `<option value="${v.version}">${v.version}${v.stable ? '' : ' (beta)'}</option>`).join('')
                }
            } catch(e){ if(loaderVerEl) loaderVerEl.innerHTML = '<option value="">取得失敗</option>' }
        } else if(loaderEl.value === 'forge'){
            if(loaderVerField) loaderVerField.style.display = ''
            const mc = document.getElementById('customCreateMcVersion').value
            const { mcVersionAtLeast } = require('helios-core/common')
            if(!mc || !mcVersionAtLeast('1.13', mc)){
                if(loaderVerEl) loaderVerEl.innerHTML = '<option value="">このバージョンのForgeは今後対応予定です（レガシー）</option>'
                return
            }
            if(loaderVerEl) loaderVerEl.innerHTML = '<option value="">読み込み中...</option>'
            try {
                const list = await window.NLCustomVersions.fetchForgeVersions(mc)
                if(list.length === 0){
                    if(loaderVerEl) loaderVerEl.innerHTML = '<option value="">このMC版に対応するForgeがありません</option>'
                } else if(loaderVerEl){
                    loaderVerEl.innerHTML = list.map(v => {
                        const tag = v.recommended ? ' (推奨)' : (v.latest ? ' (最新)' : '')
                        return `<option value="${v.version}">${v.version}${tag}</option>`
                    }).join('')
                    const def = list.find(v => v.recommended) || list.find(v => v.latest)
                    if(def) loaderVerEl.value = def.version
                }
            } catch(e){ if(loaderVerEl) loaderVerEl.innerHTML = '<option value="">取得失敗</option>' }
        } else {
            if(loaderVerField) loaderVerField.style.display = 'none'
        }
    }
```

- [ ] **Step 3: MC-change re-fetch for Forge too**

In the same file, change the MC onchange binding:
```js
    if(mcEl2) mcEl2.onchange = () => { if(loaderEl && loaderEl.value === 'fabric') refreshLoaderVersions() }
```
to:
```js
    if(mcEl2) mcEl2.onchange = () => { if(loaderEl && (loaderEl.value === 'fabric' || loaderEl.value === 'forge')) refreshLoaderVersions() }
```

- [ ] **Step 4: Require loader version for Forge in the confirm handler**

In the `customCreateConfirm` click handler, replace:
```js
    let loaderVersion = ''
    if(loader === 'fabric'){
        loaderVersion = document.getElementById('customCreateLoaderVersion').value
        if(!loaderVersion){
            setOverlayContent('未選択', 'Fabricローダーのバージョンを選んでください。', 'OK')
            setOverlayHandler(null); toggleOverlay(true); return
        }
    }
```
with:
```js
    let loaderVersion = ''
    if(loader === 'fabric' || loader === 'forge'){
        loaderVersion = document.getElementById('customCreateLoaderVersion').value
        if(!loaderVersion){
            setOverlayContent('未選択', 'ローダーのバージョンを選んでください。', 'OK')
            setOverlayHandler(null); toggleOverlay(true); return
        }
    }
```

- [ ] **Step 5: Lint** → `npm run lint 2>&1 | grep -E "problems"` → `✖ 21 problems`.

- [ ] **Step 6: Runtime DIAG**

Append to `app/assets/js/scripts/landing.js`:
```js
// [DIAG-FGUI] temporary
if (process.env.NL_DIAG_FGUI === '1') {
    setTimeout(async () => {
        const log = (m) => console.log('[DIAG-FGUI] ' + m)
        try {
            await openCustomInstanceCreate()
            await new Promise(r=>setTimeout(r,3000))
            const loaderEl = document.getElementById('customCreateLoader')
            log('forgeOption=' + !!Array.from(loaderEl.options).find(o=>o.value==='forge'))
            const mcEl = document.getElementById('customCreateMcVersion')
            mcEl.value = '1.20.1'; loaderEl.value = 'forge'; loaderEl.onchange()
            await new Promise(r=>setTimeout(r,4000))
            const lv = document.getElementById('customCreateLoaderVersion')
            log('forge120 opts=' + lv.options.length + ' selected=' + lv.value + ' fieldShown=' + (document.getElementById('customCreateLoaderVersionField').style.display !== 'none'))
            mcEl.value = '1.12.2'; mcEl.onchange()
            await new Promise(r=>setTimeout(r,2500))
            log('legacyGuard=' + /今後対応/.test(document.getElementById('customCreateLoaderVersion').innerHTML))
            log('DONE')
        } catch(e){ log('error ' + (e&&e.message)) }
    }, 8000)
}
```
Run with `NL_DIAG_FGUI`. Expected: `forgeOption=true`, `forge120 opts>1 selected=<a version> fieldShown=true`, `legacyGuard=true`.

- [ ] **Step 7: Revert DIAG** — `git checkout -- app/assets/js/scripts/landing.js`

- [ ] **Step 8: Commit**
```bash
git add app/overlay.ejs app/assets/js/scripts/overlay.js
git commit -m "feat(forge): create-UI Forge option with MC-driven version list + legacy guard"
```

---

### Task 3: `customforge.js` — install Forge via helios-core

**Files:** Create `app/assets/js/scripts/customforge.js`; Modify `app/app.ejs`

**Interfaces:**
- Consumes: helios-core `DistributionIndexProcessor`, `downloadFile`; `Type.Forge`; globals `remote`, `ConfigManager`.
- Produces: `window.NLCustomForge.installForge(full, mcVersion, commonDir, javaExecPath, onProgress) → Promise<{forgeModule, modManifest}>`.

- [ ] **Step 1: Create the module**

Create `app/assets/js/scripts/customforge.js`:
```js
/**
 * Forge install helpers for custom instances (modern Forge / MC 1.13+).
 * window.NLCustomForge. Reuses helios-core's DistributionIndexProcessor to run
 * the Forge installer against a synthetic distribution.
 */
(function(){
    const path = require('path')
    const fs = require('fs-extra')
    const { downloadFile, DistributionIndexProcessor } = require('helios-core/dl')
    const { Type } = require('helios-distribution-types')
    const isDev = require('./assets/js/isdev')
    const remote = require('@electron/remote')

    const FORGE_MAVEN = 'https://maven.minecraftforge.net/net/minecraftforge/forge'

    function forgeInstallerUrl(full){
        return `${FORGE_MAVEN}/${full}/forge-${full}-installer.jar`
    }

    // Path to the bundled ForgeInstallerCLI.jar (mirrors landing.js).
    function resolveWrapperPath(){
        const { join } = path
        if(isDev){
            return join(process.cwd(), 'libraries', 'java', 'ForgeInstallerCLI.jar')
        }
        const exePath = remote.app.getPath('exe')
        if(process.platform === 'darwin'){
            return join(exePath, '..', '..', 'Resources', 'libraries', 'java', 'ForgeInstallerCLI.jar')
        }
        return join(exePath, '..', 'resources', 'libraries', 'java', 'ForgeInstallerCLI.jar')
    }

    // A minimal Type.Forge module. installForge (helios) reads getPath()/getMavenComponents();
    // ProcessBuilder's Forge branch reads modManifest.libraries directly, not subModules.
    function makeForgeModule(full, installerPath){
        return {
            rawModule: { type: Type.Forge, classpath: true },
            subModules: [],
            getMavenComponents: () => ({ version: full }),
            getVersionlessMavenIdentifier: () => 'net.minecraftforge:forge',
            getPath: () => installerPath
        }
    }

    async function installForge(full, mcVersion, commonDir, javaExecPath, onProgress){
        const id = 'customforge-' + full
        const installerPath = path.join(commonDir, 'temp', `forge-${full}-installer.jar`)
        if(!fs.existsSync(installerPath)){
            await downloadFile(forgeInstallerUrl(full), installerPath)
        }
        const forgeModule = makeForgeModule(full, installerPath)
        const server = { rawServer: { id, minecraftVersion: mcVersion }, modules: [forgeModule] }
        const synthDistro = { getServerById: (sid) => (sid === id ? server : null) }
        const dip = new DistributionIndexProcessor(commonDir, synthDistro, id)
        // Runs the Forge installer; idempotent (skips if versions/<full>/<full>.json exists).
        await dip.installForge(javaExecPath, resolveWrapperPath(), p => { if(typeof onProgress === 'function') onProgress(p) })
        // Forge version.json (mainClass, arguments, libraries).
        const modManifest = await dip.loadModLoaderVersionJson(server)
        // Ensure every runtime library is on disk (installer downloads most; fill gaps).
        const libDir = path.join(commonDir, 'libraries')
        for(const lib of (modManifest.libraries || [])){
            const art = lib.downloads && lib.downloads.artifact
            if(!art || !art.path) continue
            const dest = path.join(libDir, art.path)
            if(!fs.existsSync(dest) && art.url){
                try { await downloadFile(art.url, dest) } catch(e){ /* processed artifacts have no url; installer made them */ }
            }
        }
        return { forgeModule, modManifest }
    }

    window.NLCustomForge = { installForge, forgeInstallerUrl }
})()
```

- [ ] **Step 2: Include the script**

In `app/app.ejs`, after the `customfabric.js` include (or after `customversions.js`), add:
```html
    <script src="./assets/js/scripts/customforge.js"></script>
```
(Place it before `customlaunch.js` so `window.NLCustomForge` exists when launch runs.)

- [ ] **Step 3: Lint** → `✖ 21 problems`.

- [ ] **Step 4: Runtime DIAG — real install (needs Java; heavy)**

Append to `app/assets/js/scripts/landing.js`:
```js
// [DIAG-FGINST] temporary: real Forge install for 1.20.1
if (process.env.NL_DIAG_FGINST === '1') {
    setTimeout(async () => {
        const log = (m) => console.log('[DIAG-FGINST] ' + m)
        try {
            const path = require('path'); const fsx = require('fs-extra')
            const id = 'diagfginst-' + Date.now().toString(36)
            const inst = { schema:1, id, name:'FGINST', minecraftVersion:'1.20.1', loader:'forge', loaderVersion:'47.2.0', created:Date.now(), lastPlayed:null }
            ConfigManager.addCustomInstance(inst); ConfigManager.setSelectedServer(id)
            const jopts = await window.NLCustomLaunch.getEffectiveJavaOptions('1.20.1')
            ConfigManager.ensureJavaConfig(id, jopts); ConfigManager.save()
            const jExe = ConfigManager.getEffectiveJavaExecutable(id)
            log('jExe=' + (jExe ? 'present' : 'MISSING'))
            if(!jExe){ log('SKIP no java'); log('DONE'); return }
            // Ensure vanilla present first (Forge installer considers the client jar).
            const { MojangIndexProcessor } = require('helios-core/dl')
            const mp = new MojangIndexProcessor(ConfigManager.getCommonDirectory(), '1.20.1'); await mp.init()
            const commonDir = ConfigManager.getCommonDirectory()
            const res = await window.NLCustomForge.installForge('1.20.1-47.2.0', '1.20.1', commonDir, jExe, p => {})
            const vjson = path.join(commonDir, 'versions', '1.20.1-47.2.0', '1.20.1-47.2.0.json')
            const libCount = (res.modManifest.libraries || []).length
            let onDisk = 0
            for(const lib of (res.modManifest.libraries || [])){ const a = lib.downloads && lib.downloads.artifact; if(a && a.path && fsx.existsSync(path.join(commonDir,'libraries',a.path))) onDisk++ }
            log('versionJson=' + fsx.existsSync(vjson) + ' mainClass=' + res.modManifest.mainClass + ' libs=' + libCount + ' onDisk=' + onDisk)
            log('DONE')
        } catch(e){ log('error ' + (e&&e.message)) }
    }, 9000)
}
```
Run with `NL_DIAG_FGINST` (allow up to ~120 polls / a few minutes — it downloads and runs the installer). Expected: `jExe=present`, `versionJson=true`, `mainClass` present (a `cpw...`/`net.minecraftforge...` bootstrap class), `libs>0`, `onDisk` == `libs` (or nearly, processed artifacts included).

- [ ] **Step 5: Revert DIAG + prune instance**
```bash
git checkout -- app/assets/js/scripts/landing.js
node -e "const fs=require('fs');const p=require('os').homedir()+'/AppData/Roaming/.numapotelauncher/config.json';const c=JSON.parse(fs.readFileSync(p,'utf8'));if(Array.isArray(c.customInstances)){c.customInstances=c.customInstances.filter(x=>!/^diagfginst-/.test(x&&x.id));} if(/^diagfginst-/.test(c.selectedServer||''))c.selectedServer=null; fs.writeFileSync(p,JSON.stringify(c,null,4));console.log('pruned');"
```

- [ ] **Step 6: Commit**
```bash
git add app/assets/js/scripts/customforge.js app/app.ejs
git commit -m "feat(forge): customforge.js installs modern Forge via helios-core installer"
```

---

### Task 4: Forge launch branch in customlaunch.js

**Files:** Modify `app/assets/js/scripts/customlaunch.js`

**Interfaces:** Consumes `window.NLCustomForge.installForge` (Task 3), `ConfigManager.getEffectiveJavaExecutable`.

- [ ] **Step 1: Add the Forge branch**

In `app/assets/js/scripts/customlaunch.js`, after the `if(instance.loader === 'fabric'){ ... }` block (before the `// 3) Build & launch.` comment), add:
```js
        else if(instance.loader === 'forge'){
            setLaunchDetails('Forgeを準備中...')
            const jExe = ConfigManager.getEffectiveJavaExecutable(instance.id)
            if(jExe == null){ throw new Error('Javaが見つかりません。先にJavaを準備してください。') }
            const full = `${instance.minecraftVersion}-${instance.loaderVersion}`
            const { forgeModule, modManifest: fm } = await window.NLCustomForge.installForge(
                full, instance.minecraftVersion, commonDir, jExe,
                p => setDownloadPercentage(Math.min(99, p)))
            modManifest = fm
            loaderModules = [forgeModule]
            setDownloadPercentage(100)
        }
```
Note: the existing Fabric block is `if(instance.loader === 'fabric'){ ... }` — change it to end so this `else if` chains onto it (the Fabric block currently is a standalone `if`; making this an `else if` is correct since a loader is exactly one value).

- [ ] **Step 2: Lint** → `✖ 21 problems`.

- [ ] **Step 3: Runtime DIAG — end-to-end create → launch**

Append to `app/assets/js/scripts/landing.js`:
```js
// [DIAG-FGLAUNCH] temporary: create + launch a 1.20.1 Forge instance
if (process.env.NL_DIAG_FGLAUNCH === '1') {
    setTimeout(async () => {
        const log = (m) => console.log('[DIAG-FGLAUNCH] ' + m)
        try {
            const id = 'diagfgl-' + Date.now().toString(36)
            const inst = { schema:1, id, name:'FGL', minecraftVersion:'1.20.1', loader:'forge', loaderVersion:'47.2.0', created:Date.now(), lastPlayed:null }
            ConfigManager.addCustomInstance(inst); ConfigManager.setSelectedServer(id)
            const jopts = await window.NLCustomLaunch.getEffectiveJavaOptions('1.20.1')
            ConfigManager.ensureJavaConfig(id, jopts); ConfigManager.save()
            if(!ConfigManager.getEffectiveJavaExecutable(id)){ log('SKIP no java'); log('DONE'); return }
            const proc = await window.NLCustomLaunch.launchCustomInstance(inst)
            log('spawned pid=' + (proc && proc.pid))
            let sawForge = false
            const done = new Promise(resolve => {
                const to = setTimeout(() => resolve(), 45000)
                const onData = (d) => { const s = d.toString(); if(/Forge|FML|modlauncher|net\.minecraftforge/i.test(s)){ sawForge = true } if(/LWJGL|Backend library|Loading|Setting user/i.test(s)){ clearTimeout(to); resolve() } }
                if(proc && proc.stdout) proc.stdout.on('data', onData)
                if(proc && proc.stderr) proc.stderr.on('data', onData)
            })
            await done
            log('sawForgeInLog=' + sawForge)
            try { if(proc) proc.kill() } catch(e){}
            log('DONE')
        } catch(e){ log('error ' + (e&&e.message)) }
    }, 9000)
}
```
Run with `NL_DIAG_FGLAUNCH` (allow several minutes; installs Forge then launches). Expected: `spawned pid=<number>`, `sawForgeInLog=true` (Forge/FML bootstrap appears in the game log), no `error`. A window may briefly appear; the DIAG kills the process.

- [ ] **Step 4: Revert DIAG + prune instance**
```bash
git checkout -- app/assets/js/scripts/landing.js
node -e "const fs=require('fs');const p=require('os').homedir()+'/AppData/Roaming/.numapotelauncher/config.json';const c=JSON.parse(fs.readFileSync(p,'utf8'));if(Array.isArray(c.customInstances)){c.customInstances=c.customInstances.filter(x=>!/^diagfgl-/.test(x&&x.id));} if(/^diagfgl-/.test(c.selectedServer||''))c.selectedServer=null; fs.writeFileSync(p,JSON.stringify(c,null,4));console.log('pruned');"
```

- [ ] **Step 5: Regression — Fabric/vanilla custom launch still builds**

Confirm the Fabric add→launch path is unaffected by re-running the existing generalized launch (optional if time-boxed): create a vanilla 1.20.1 instance via config and call `launchCustomInstance`; expect a spawned pid. (Vanilla needs no loader install; a quick smoke.)

- [ ] **Step 6: Commit**
```bash
git add app/assets/js/scripts/customlaunch.js
git commit -m "feat(forge): launch modern Forge custom instances"
```

## Self-Review notes
- Spec coverage: A→Task1, B→Task2, C→Task3, D→Task4, E(errors)→Tasks 2-4 messages. ✓
- Type consistency: `installForge(full, mcVersion, commonDir, javaExecPath, onProgress)` returns `{forgeModule, modManifest}`; consumed identically in Task 4. ✓
- Forge classpath comes from `modManifest.libraries` (verified in `_resolveServerLibraries` Type.Forge branch); Task 3 ensures those are on disk. ✓
