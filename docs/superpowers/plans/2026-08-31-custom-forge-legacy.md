# Custom Instance Legacy Forge (M-Forge2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans or subagent-driven-development. Steps use `- [ ]`.

**Goal:** Create and launch custom instances with legacy (pre-FG3) Forge by parsing the installer's `install_profile.json` ourselves.

**Architecture:** Route the custom-instance Forge branch by `DistributionIndexProcessor.isForgeGradle3(mc, full)`: FG3 keeps the existing `customforge.installForge`; older builds use a new `customforgelegacy.installLegacyForge` that reads `install_profile.json` (old `versionInfo` format), extracts the bundled universal jar, downloads libraries (with URL fixups + installer-bundled `maven/` fallback), and returns a `Type.ForgeHosted` module + `versionInfo` as the modManifest. ProcessBuilder's <1.13 path launches it via `minecraftArguments`.

**Tech Stack:** Electron 33, helios-core (`DistributionIndexProcessor.isForgeGradle3`, `downloadFile`), `node-stream-zip`, helios-distribution-types (`Type.ForgeHosted`, `Type.Library`), `fs-extra`.

## Global Constraints

- No unit tests. Verify with `npm run lint` (**stay at baseline 21**) + env-gated runtime DIAG in `landing.js`, reverted before commit.
- Branch `feature/custom-forge-legacy`, never main. Commit per task. `git add` only named files.
- Legacy = pre-FG3 (Forge build ≤ `14.23.5.2847`, or any MC<1.13 build that isn't FG3). Routing uses `isForgeGradle3(mc, full)`.
- Download sources: Forge maven, `libraries.minecraft.net`, and the installer's own zip only. Zip extraction targets must stay under `commonDir/libraries` (validate with `path.normalize`).
- Kill leftover electron/java between DIAG runs; prune `diag*` instances from config after each.

## File Structure

- **Modify** `app/assets/js/scripts/overlay.js` — remove the MC<1.13 Forge guard.
- **Create** `app/assets/js/scripts/customforgelegacy.js` — `window.NLCustomForgeLegacy.installLegacyForge`.
- **Modify** `app/app.ejs` — include `customforgelegacy.js`.
- **Modify** `app/assets/js/scripts/customlaunch.js` — route Forge branch by `isForgeGradle3`.

---

### Task 1: Remove the MC<1.13 Forge guard

**Files:** Modify `app/assets/js/scripts/overlay.js`

- [ ] **Step 1: Replace the guard**

In `refreshLoaderVersions`, replace:
```js
            const mc = document.getElementById('customCreateMcVersion').value
            const { mcVersionAtLeast } = require('helios-core/common')
            if(!mc || !mcVersionAtLeast('1.13', mc)){
                if(loaderVerEl) loaderVerEl.innerHTML = '<option value="">このバージョンのForgeは今後対応予定です（レガシー）</option>'
                return
            }
            if(loaderVerEl) loaderVerEl.innerHTML = '<option value="">読み込み中...</option>'
```
with:
```js
            const mc = document.getElementById('customCreateMcVersion').value
            if(!mc){ if(loaderVerEl) loaderVerEl.innerHTML = '<option value="">先にMinecraftバージョンを選択</option>'; return }
            if(loaderVerEl) loaderVerEl.innerHTML = '<option value="">読み込み中...</option>'
```

- [ ] **Step 2: Lint** → `✖ 21 problems`.

- [ ] **Step 3: Runtime DIAG**

Append to `app/assets/js/scripts/landing.js`:
```js
// [DIAG-LGUI] temporary
if (process.env.NL_DIAG_LGUI === '1') {
    setTimeout(async () => {
        const log = (m) => console.log('[DIAG-LGUI] ' + m)
        try {
            await openCustomInstanceCreate(); await new Promise(r=>setTimeout(r,3000))
            const loaderEl = document.getElementById('customCreateLoader')
            const mcEl = document.getElementById('customCreateMcVersion')
            mcEl.value = '1.7.10'; loaderEl.value = 'forge'; loaderEl.onchange()
            await new Promise(r=>setTimeout(r,9000))
            const lv = document.getElementById('customCreateLoaderVersion')
            log('forge1710 opts=' + lv.options.length + ' first=' + (lv.options[0] && lv.options[0].value))
            log('DONE')
        } catch(e){ log('error ' + (e&&e.message)) }
    }, 8000)
}
```
Run `NL_DIAG_LGUI=1 npx electron . --disable-gpu`. Expected: `forge1710 opts>1` with a real Forge build value (no legacy-block message).

- [ ] **Step 4: Revert DIAG** — `git checkout -- app/assets/js/scripts/landing.js`

- [ ] **Step 5: Commit**
```bash
git add app/assets/js/scripts/overlay.js
git commit -m "feat(forge): allow legacy Forge versions in the create UI (drop MC<1.13 guard)"
```

---

### Task 2: `customforgelegacy.js` — parse install_profile.json + build ForgeHosted module

**Files:** Create `app/assets/js/scripts/customforgelegacy.js`; Modify `app/app.ejs`

**Interfaces:**
- Produces: `window.NLCustomForgeLegacy.installLegacyForge(full, mcVersion, commonDir) → Promise<{forgeModule, modManifest, unresolved:string[]}>`.

- [ ] **Step 1: Create the module**

Create `app/assets/js/scripts/customforgelegacy.js`:
```js
/**
 * Legacy (pre-FG3) Forge install helpers for custom instances.
 * window.NLCustomForgeLegacy. Parses the installer's install_profile.json
 * (old versionInfo format), extracts the bundled universal jar, downloads
 * libraries, and builds a Type.ForgeHosted synthetic module.
 */
(function(){
    const path = require('path')
    const fs = require('fs-extra')
    const StreamZip = require('node-stream-zip')
    const { downloadFile } = require('helios-core/dl')
    const { Type } = require('helios-distribution-types')

    const FORGE_MAVEN = 'https://maven.minecraftforge.net/net/minecraftforge/forge'

    // 'g.h:a:v[:classifier]' -> 'g/h/a/v/a-v[-classifier].jar'
    function mavenToPath(name){
        const parts = name.split(':')
        const group = parts[0].replace(/\./g, '/')
        const artifact = parts[1]
        const version = parts[2]
        const classifier = parts.length > 3 ? '-' + parts[3] : ''
        return `${group}/${artifact}/${version}/${artifact}-${version}${classifier}.jar`
    }
    function makeLibraryModule(name, jarPath){
        return {
            rawModule: { type: Type.Library, classpath: true },
            subModules: [],
            getVersionlessMavenIdentifier: () => { const [g, a] = name.split(':'); return `${g}:${a}` },
            getPath: () => jarPath
        }
    }
    function normalizeBase(url){
        const u = url.replace('http://files.minecraftforge.net/maven/', 'https://maven.minecraftforge.net/')
        return u.replace(/\/+$/, '') + '/'
    }
    function forgeInstallerUrl(full){ return `${FORGE_MAVEN}/${full}/forge-${full}-installer.jar` }
    function underLibDir(libDir, p){ return path.normalize(p).startsWith(path.normalize(libDir)) }

    async function installLegacyForge(full, mcVersion, commonDir){
        const installerPath = path.join(commonDir, 'temp', `forge-${full}-installer.jar`)
        if(!fs.existsSync(installerPath)){ await downloadFile(forgeInstallerUrl(full), installerPath) }
        const libDir = path.join(commonDir, 'libraries')
        const zip = new StreamZip.async({ file: installerPath })
        const unresolved = []
        let forgeModule, versionInfo
        try {
            const ip = JSON.parse((await zip.entryData('install_profile.json')).toString('utf8'))
            versionInfo = ip.versionInfo
            if(!versionInfo){ throw new Error('このForgeはモダン(FG3)フォーマットです（レガシー経路では処理できません）') }
            const install = ip.install || {}
            // Extract the bundled universal jar.
            let universalPath = null
            if(install.path && install.filePath){
                universalPath = path.join(libDir, mavenToPath(install.path))
                if(!underLibDir(libDir, universalPath)){ throw new Error('不正なライブラリパス') }
                if(!fs.existsSync(universalPath)){
                    fs.ensureDirSync(path.dirname(universalPath))
                    await zip.extract(install.filePath, universalPath)
                }
            }
            // Resolve libraries (client-required only).
            const subModules = []
            for(const lib of (versionInfo.libraries || [])){
                if(lib.clientreq === false) continue
                const rel = mavenToPath(lib.name)
                const dest = path.join(libDir, rel)
                if(install.path && lib.name === install.path){
                    subModules.push(makeLibraryModule(lib.name, universalPath || dest)); continue
                }
                if(!underLibDir(libDir, dest)){ unresolved.push(lib.name); continue }
                if(!fs.existsSync(dest)){
                    let ok = false
                    const tries = []
                    if(lib.url) tries.push(normalizeBase(lib.url) + rel)
                    tries.push('https://libraries.minecraft.net/' + rel)
                    for(const u of tries){ try { await downloadFile(u, dest); if(fs.existsSync(dest)){ ok = true; break } } catch(e){ /* try next */ } }
                    if(!ok){
                        // Fallback: extract from the installer's bundled maven/ folder.
                        try { fs.ensureDirSync(path.dirname(dest)); await zip.extract('maven/' + rel, dest); ok = fs.existsSync(dest) } catch(e){ /* absent */ }
                    }
                    if(!ok){ unresolved.push(lib.name); continue }
                }
                subModules.push(makeLibraryModule(lib.name, dest))
            }
            const idSrc = install.path || ((versionInfo.libraries || [])[0] && versionInfo.libraries[0].name) || 'net.minecraftforge:forge'
            const idParts = String(idSrc).split(':')
            forgeModule = {
                rawModule: { type: Type.ForgeHosted, classpath: true },
                subModules,
                getVersionlessMavenIdentifier: () => `${idParts[0]}:${idParts[1]}`,
                getPath: () => universalPath
            }
        } finally {
            await zip.close()
        }
        return { forgeModule, modManifest: versionInfo, unresolved }
    }

    window.NLCustomForgeLegacy = { installLegacyForge, mavenToPath }
})()
```

- [ ] **Step 2: Include the script**

In `app/app.ejs`, after the `customforge.js` include:
```html
    <script src="./assets/js/scripts/customforgelegacy.js"></script>
```

- [ ] **Step 3: Lint** → `✖ 21 problems`.

- [ ] **Step 4: Runtime DIAG — real legacy install (1.7.10)**

Append to `app/assets/js/scripts/landing.js`:
```js
// [DIAG-LGINST] temporary
if (process.env.NL_DIAG_LGINST === '1') {
    setTimeout(async () => {
        const log = (m) => console.log('[DIAG-LGINST] ' + m)
        try {
            const path = require('path'); const fsx = require('fs-extra')
            const commonDir = ConfigManager.getCommonDirectory()
            const full = '1.7.10-10.13.4.1614-1.7.10'
            const res = await window.NLCustomForgeLegacy.installLegacyForge(full, '1.7.10', commonDir)
            log('type=' + res.forgeModule.rawModule.type + ' mainClass=' + res.modManifest.mainClass)
            log('subMods=' + res.forgeModule.subModules.length + ' unresolved=' + res.unresolved.length + ' (' + res.unresolved.slice(0,5).join(',') + ')')
            log('universalExists=' + fsx.existsSync(res.forgeModule.getPath()))
            let onDisk = 0; for(const sm of res.forgeModule.subModules){ if(fsx.existsSync(sm.getPath())) onDisk++ }
            log('subModsOnDisk=' + onDisk)
            log('DONE')
        } catch(e){ log('error ' + (e&&e.message)) }
    }, 8000)
}
```
Run `NL_DIAG_LGINST=1 npx electron . --disable-gpu` (downloads installer + libs). Expected: `type=ForgeHosted`, `mainClass=net.minecraft.launchwrapper.Launch`, `subMods>0`, `universalExists=true`, `subModsOnDisk`==`subMods`, `unresolved` small (ideally 0).

- [ ] **Step 5: Revert DIAG** — `git checkout -- app/assets/js/scripts/landing.js`

- [ ] **Step 6: Commit**
```bash
git add app/assets/js/scripts/customforgelegacy.js app/app.ejs
git commit -m "feat(forge): customforgelegacy.js installs legacy Forge from install_profile.json"
```

---

### Task 3: Route the launch by isForgeGradle3

**Files:** Modify `app/assets/js/scripts/customlaunch.js`

- [ ] **Step 1: Replace the Forge branch**

In `launchCustomInstance`, replace the whole `} else if(instance.loader === 'forge'){ ... setDownloadPercentage(100) }` block with:
```js
        } else if(instance.loader === 'forge'){
            setLaunchDetails('Forgeを準備中...')
            const full = `${instance.minecraftVersion}-${instance.loaderVersion}`
            const { DistributionIndexProcessor } = require('helios-core/dl')
            if(DistributionIndexProcessor.isForgeGradle3(instance.minecraftVersion, full)){
                const jExe = ConfigManager.getEffectiveJavaExecutable(instance.id)
                if(jExe == null){ throw new Error('Javaが見つかりません。先にJavaを準備してください。') }
                const { forgeModule, modManifest: fm } = await window.NLCustomForge.installForge(
                    full, instance.minecraftVersion, commonDir, jExe,
                    p => setDownloadPercentage(Math.min(99, p)))
                modManifest = fm                // Forge version.json (FG3)
                loaderModules = [forgeModule]   // Type.Forge synthetic module
            } else {
                const { forgeModule, modManifest: fm, unresolved } = await window.NLCustomForgeLegacy.installLegacyForge(
                    full, instance.minecraftVersion, commonDir)
                modManifest = fm                // legacy versionInfo (minecraftArguments)
                loaderModules = [forgeModule]   // Type.ForgeHosted synthetic module
                if(unresolved && unresolved.length){
                    setLaunchDetails('一部ライブラリを取得できませんでした: ' + unresolved.join(', '))
                }
            }
            setDownloadPercentage(100)
        }
```

- [ ] **Step 2: Lint** → `✖ 21 problems`.

- [ ] **Step 3: Runtime DIAG — routing + end-to-end legacy launch (1.7.10)**

Append to `app/assets/js/scripts/landing.js`:
```js
// [DIAG-LGLAUNCH] temporary
if (process.env.NL_DIAG_LGLAUNCH === '1') {
    setTimeout(async () => {
        const log = (m) => console.log('[DIAG-LGLAUNCH] ' + m)
        try {
            const { DistributionIndexProcessor } = require('helios-core/dl')
            log('route 1.20.1=' + DistributionIndexProcessor.isForgeGradle3('1.20.1','1.20.1-47.2.0') + ' 1.12.2new=' + DistributionIndexProcessor.isForgeGradle3('1.12.2','1.12.2-14.23.5.2859') + ' 1.7.10=' + DistributionIndexProcessor.isForgeGradle3('1.7.10','1.7.10-10.13.4.1614-1.7.10'))
            const id = 'diaglgl-' + Date.now().toString(36)
            const inst = { schema:1, id, name:'LGL', minecraftVersion:'1.7.10', loader:'forge', loaderVersion:'10.13.4.1614-1.7.10', created:Date.now(), lastPlayed:null }
            ConfigManager.addCustomInstance(inst); ConfigManager.setSelectedServer(id)
            const jopts = await window.NLCustomLaunch.getEffectiveJavaOptions('1.7.10')
            ConfigManager.ensureJavaConfig(id, jopts); ConfigManager.save()
            const jdk = 'C:/Program Files/Eclipse Adoptium/jdk-8.0.462.8-hotspot/bin/java.exe'
            const _orig = ConfigManager.getEffectiveJavaExecutable
            ConfigManager.getEffectiveJavaExecutable = () => jdk
            let proc
            try { proc = await window.NLCustomLaunch.launchCustomInstance(inst) }
            finally { ConfigManager.getEffectiveJavaExecutable = _orig }
            log('spawned pid=' + (proc && proc.pid))
            let sawForge = false
            await new Promise(resolve => {
                const to = setTimeout(resolve, 60000)
                const onData = (d) => { const s = d.toString(); if(/FML|forge|ModLoader|MinecraftForge|launchwrapper|Loading tweak/i.test(s)) sawForge = true; if(/LWJGL|Setting user|Reloading|Starting up SoundSystem/i.test(s)){ clearTimeout(to); resolve() } }
                if(proc && proc.stdout) proc.stdout.on('data', onData)
                if(proc && proc.stderr) proc.stderr.on('data', onData)
                if(proc) proc.on('close', () => { clearTimeout(to); resolve() })
            })
            log('sawForgeInLog=' + sawForge)
            try { if(proc) proc.kill() } catch(e){}
            log('DONE')
        } catch(e){ log('error ' + (e&&e.message)) }
    }, 9000)
}
```
Run `NL_DIAG_LGLAUNCH=1 npx electron . --disable-gpu` (several minutes). Expected: `route 1.20.1=true 1.12.2new=true 1.7.10=false`, `spawned pid=<number>`, `sawForgeInLog=true`. (1.7.10 uses Java 8, which the system has.)

- [ ] **Step 4: Revert DIAG + prune instance**
```bash
git checkout -- app/assets/js/scripts/landing.js
node -e "const fs=require('fs');const p=require('os').homedir()+'/AppData/Roaming/.numapotelauncher/config.json';const c=JSON.parse(fs.readFileSync(p,'utf8'));if(Array.isArray(c.customInstances)){c.customInstances=c.customInstances.filter(x=>!/^diaglgl-/.test(x&&x.id));} if(/^diaglgl-/.test(c.selectedServer||''))c.selectedServer=null; fs.writeFileSync(p,JSON.stringify(c,null,4));console.log('pruned');"
```

- [ ] **Step 5: Commit**
```bash
git add app/assets/js/scripts/customlaunch.js
git commit -m "feat(forge): route custom Forge launch by isForgeGradle3 (legacy vs FG3)"
```

## Self-Review
- Coverage: A→Tasks 1&3, B→Task 2, C→Task 3. ✓
- Types: `installLegacyForge(full, mcVersion, commonDir) → {forgeModule, modManifest, unresolved}` consumed identically in Task 3. `forgeModule` is `Type.ForgeHosted` with `Type.Library` subModules (matches `_resolveServerLibraries`). ✓
- Legacy launch uses `minecraftArguments` via ProcessBuilder's <1.13 path (no installer subprocess). ✓
