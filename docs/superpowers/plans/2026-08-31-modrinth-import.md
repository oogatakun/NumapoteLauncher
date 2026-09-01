# ③ Modrinth 外部導入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 選択中パック（公式・自作）に Modrinth から MOD を検索して導入（必須依存も自動）できるようにし、既存の設定「Mod」タブで管理できるようにする。

**Architecture:** まず設定Modタブを自作インスタンス対応にする（疑似サーバー化）。Modrinth 公開API で検索/対応バージョン/依存を解決し、選択中パックの `mods` フォルダへ `downloadFile` で落とす（ドロップイン）。UIは設定Modタブの「Modrinthから追加」からオーバーレイで検索・追加。

**Tech Stack:** Electron 33, Node 20, EJS, jQuery, helios-core（downloadFile, dropinmodutil）, Modrinth REST API v2。

## Global Constraints

- 新規 npm 依存は追加しない。
- Modrinth のみ（CurseForge・.mrpack一括・任意依存の自動導入は対象外）。必須依存(required)のみ自動。
- すべての Modrinth リクエストに User-Agent `NumapoteLauncher/<appver> (github.com/oogatakun/NumapoteLauncher)` を付ける。
- 導入先は `instances/<packId>/mods/<filename>`。既存ファイルはスキップ。
- ローダー未対応パック（自作バニラ等）ではMOD導入UIを出さず「MOD非対応」を示す。
- CSP（app.ejs）のため追加スクリプトは外部ファイル。
- テストランナー無し。各タスク検証は `npm run lint`（ベースライン **21 problems (21 errors)** を増やさない）＋手動（`npx electron . --disable-gpu`）。
- コミットは実装用ブランチ `feature/modrinth-import`。`main` では作業しない。**各タスクは変更したファイルのみ `git add`**（`git add .`/`-A` 禁止＝リポジトリに未追跡ベースラインが多数あるため）。
- Modrinth API 実測フィールド: 検索hit=`project_id,slug,title,author,description,icon_url,downloads`。version=`id,project_id,game_versions,loaders,files,dependencies`、`files[i]={url,filename,primary}`、`dependencies[i]={dependency_type,project_id,version_id}`（`dependency_type` は `required|optional|incompatible|embedded`）。version配列は新しい順。

---

## Task 0: 実装用ブランチ

- [ ] **Step 1:** `git checkout main && git checkout -b feature/modrinth-import`
- [ ] **Step 2:** `npm run lint` でベースライン確認（21）。

---

## Task 1: 設定Modタブを自作インスタンス対応（section G）

**Files:**
- Modify: `app/assets/js/scripts/settings.js`（`resolveDropinModsForUI` 757行、`resolveShaderpacksForUI` 908行、選択サーバー表示 1085行 付近）

**Interfaces:**
- Produces: `resolveSelectedServerLike(distro)` — 配布サーバー or 自作インスタンスの疑似サーバー `{ rawServer:{id,minecraftVersion,name}, modules:[] }` を返す。

- [ ] **Step 1: `settings.js` に共通ヘルパを追加**

`resolveDropinModsForUI` 関数の直前に追加する。

```js
/**
 * Resolve the selected pack as a distribution-server-like object. Falls back to
 * a synthetic server for user-created custom instances (which are not in the
 * distribution), so the Mod tab works for them too.
 * @param {Object} distro The distribution index.
 * @returns {Object|null}
 */
function resolveSelectedServerLike(distro){
    const id = ConfigManager.getSelectedServer()
    const serv = distro ? distro.getServerById(id) : null
    if(serv && serv.rawServer) return serv
    const ins = ConfigManager.getCustomInstance(id)
    if(ins){
        return { rawServer: { id: ins.id, minecraftVersion: ins.minecraftVersion, name: ins.name }, modules: [] }
    }
    return null
}
```

- [ ] **Step 2: `resolveDropinModsForUI`（757行付近）を疑似サーバー対応にする**

変更前:
```js
    const serv = distro.getServerById(ConfigManager.getSelectedServer())
    if(!serv || !serv.rawServer){
        document.getElementById('settingsDropinModsContent').innerHTML = ''
        CACHE_DROPIN_MODS = []
        return
    }
```
変更後:
```js
    const serv = resolveSelectedServerLike(distro)
    if(!serv || !serv.rawServer){
        document.getElementById('settingsDropinModsContent').innerHTML = ''
        CACHE_DROPIN_MODS = []
        return
    }
```

- [ ] **Step 3: `resolveShaderpacksForUI`（908行付近）も同様に**

その関数内の `const serv = distro.getServerById(ConfigManager.getSelectedServer())` を
`const serv = resolveSelectedServerLike(distro)` に置換（`if(!serv || !serv.rawServer)` ガードは維持）。

- [ ] **Step 4: 選択サーバー表示（1085行付近）も同様に**

`prepareModsTab` 相当の、`settingsSelServContent` を埋める関数内の
`const serv = distro.getServerById(ConfigManager.getSelectedServer())` を
`const serv = resolveSelectedServerLike(distro)` に置換（`getServerById` を直呼びしている Mod/シェーダー/選択表示系のみ。ランチャー設定やアカウント系の `getServerById` は変更しない）。

- [ ] **Step 5:** `npm run lint`（新規エラー無し）。
- [ ] **Step 6: 手動確認**：`npx electron . --disable-gpu` で、自作パックを選択→設定→Modタブで、ドロップインMOD節が表示され（空でも「まだ〜」やドラッグ&ドロップ追加が機能）、エラーが出ないこと。
- [ ] **Step 7:** `git add app/assets/js/scripts/settings.js` → commit `feat(mods): make settings Mod tab work for custom instances`

---

## Task 2: Modrinth API モジュール

**Files:**
- Create: `app/assets/js/scripts/modrinth.js`
- Modify: `app/app.ejs`（`errorlog.js` の後に読み込み）

**Interfaces:**
- Produces（`window.NLModrinth`）:
  - `async search(query, mc, loader, limit=20): Promise<Array<{projectId,slug,title,author,description,iconUrl,downloads}>>`
  - `async getBestVersion(projectId, mc, loader): Promise<{versionId,files,dependencies}|null>`
  - `async collectRequired(version, mc, loader): Promise<Array<{filename,url}>>` — 本体＋必須依存の primary file 群（重複/循環回避）。

- [ ] **Step 1: `app/assets/js/scripts/modrinth.js` を新規作成**

```js
/**
 * Modrinth API client for importing mods into a pack's mods folder.
 * Exposed as window.NLModrinth.
 */
(function(){
    const API = 'https://api.modrinth.com/v2'
    function ua(){
        let ver = '0.0.0'
        try { ver = require('@electron/remote').app.getVersion() } catch(e) { /* ignore */ }
        return `NumapoteLauncher/${ver} (github.com/oogatakun/NumapoteLauncher)`
    }
    async function getJson(url){
        const res = await fetch(url, { headers: { 'User-Agent': ua() }, cache: 'no-store' })
        if(res.status === 429) throw new Error('Modrinthのレート制限です。少し待って再試行してください。')
        if(!res.ok) throw new Error('Modrinthリクエストに失敗しました (' + res.status + ')')
        return res.json()
    }

    async function search(query, mc, loader, limit = 20){
        const facets = JSON.stringify([['project_type:mod'], ['versions:' + mc], ['categories:' + loader]])
        const url = `${API}/search?query=${encodeURIComponent(query || '')}&limit=${limit}&facets=${encodeURIComponent(facets)}`
        const body = await getJson(url)
        return (body.hits || []).map(h => ({
            projectId: h.project_id, slug: h.slug, title: h.title, author: h.author,
            description: h.description, iconUrl: h.icon_url, downloads: h.downloads
        }))
    }

    async function getBestVersion(projectId, mc, loader){
        const gv = encodeURIComponent(JSON.stringify([mc]))
        const ld = encodeURIComponent(JSON.stringify([loader]))
        const list = await getJson(`${API}/project/${encodeURIComponent(projectId)}/version?game_versions=${gv}&loaders=${ld}`)
        if(!Array.isArray(list) || list.length === 0) return null
        const v = list[0] // newest compatible
        return { versionId: v.id, files: v.files || [], dependencies: v.dependencies || [] }
    }

    function primaryFile(files){
        if(!files || files.length === 0) return null
        const p = files.find(f => f.primary) || files[0]
        return { filename: p.filename, url: p.url }
    }

    // Collect the mod + its required dependencies (recursive, deduped).
    async function collectRequired(version, mc, loader){
        const out = []
        const seen = new Set()
        async function walk(ver){
            const pf = primaryFile(ver.files)
            if(pf && !seen.has(pf.filename)){
                seen.add(pf.filename)
                out.push(pf)
            }
            for(const dep of (ver.dependencies || [])){
                if(dep.dependency_type !== 'required') continue
                let depVer = null
                if(dep.version_id){
                    const dv = await getJson(`${API}/version/${encodeURIComponent(dep.version_id)}`)
                    depVer = { files: dv.files || [], dependencies: dv.dependencies || [] }
                } else if(dep.project_id){
                    depVer = await getBestVersion(dep.project_id, mc, loader)
                }
                if(depVer) await walk(depVer)
            }
        }
        await walk(version)
        return out
    }

    window.NLModrinth = { search, getBestVersion, collectRequired }
})()
```

- [ ] **Step 2: `app/app.ejs`** の `errorlog.js` の直後に `<script src="./assets/js/scripts/modrinth.js"></script>` を追加。
- [ ] **Step 3:** `npm run lint`。
- [ ] **Step 4: 手動確認**：DevTools で `await window.NLModrinth.search('sodium','1.20.1','fabric')` が Sodium を含む配列を返し、`await window.NLModrinth.getBestVersion('AANobbMI','1.20.1','fabric')` が files を含むことを確認。
- [ ] **Step 5:** `git add app/assets/js/scripts/modrinth.js app/app.ejs` → commit `feat(mods): add Modrinth API client`

---

## Task 3: 導入先コンテキスト判定

**Files:**
- Modify: `app/assets/js/scripts/settings.js`

**Interfaces:**
- Produces: `async getModTargetContext(): Promise<{id, mc, loader, modsDir}|null>` — loader は `fabric`/`forge` 等の小文字、mods対象外(バニラ/不明)は `loader:null`。

- [ ] **Step 1: `settings.js` に追加（`resolveSelectedServerLike` の近く）**

```js
/**
 * Determine the import target (mc version, loader, mods dir) for the selected pack.
 * loader is a lowercase Modrinth loader name (fabric/forge/quilt/neoforge) or null
 * when the pack cannot use mods (vanilla / unknown).
 */
async function getModTargetContext(){
    const id = ConfigManager.getSelectedServer()
    if(!id) return null
    const modsDir = path.join(ConfigManager.getInstanceDirectory(), id, 'mods')
    const ins = ConfigManager.getCustomInstance(id)
    if(ins){
        const loader = (ins.loader === 'fabric' || ins.loader === 'forge' || ins.loader === 'quilt' || ins.loader === 'neoforge') ? ins.loader : null
        return { id, mc: ins.minecraftVersion, loader, modsDir }
    }
    const distro = await DistroAPI.getDistribution()
    const serv = distro ? distro.getServerById(id) : null
    if(!serv || !serv.rawServer) return null
    let loader = null
    try {
        const { Type } = require('helios-distribution-types')
        for(const mdl of (serv.modules || [])){
            const t = mdl.rawModule && mdl.rawModule.type
            if(t === Type.Fabric){ loader = 'fabric'; break }
            if(t === Type.Forge || t === Type.ForgeHosted){ loader = 'forge'; break }
        }
    } catch(e) { /* ignore */ }
    return { id, mc: serv.rawServer.minecraftVersion, loader, modsDir }
}
```

- [ ] **Step 2:** `npm run lint`。
- [ ] **Step 3:** `git add app/assets/js/scripts/settings.js` → commit `feat(mods): add mod import target context resolver`

---

## Task 4: Modrinth 検索オーバーレイ UI

**Files:**
- Modify: `app/overlay.ejs`（`#overlayContainer` に `#modrinthContent` を追加）
- Modify: `app/settings.ejs`（`#settingsDropinModsContainer` に「Modrinthから追加」ボタン追加）
- Modify: `app/assets/css/launcher.css`（スタイル）

**Interfaces:**
- Produces: DOM `#settingsModrinthButton`, `#modrinthContent`, `#modrinthSearchInput`, `#modrinthSearchButton`, `#modrinthResults`, `#modrinthCancel`。

- [ ] **Step 1: `app/settings.ejs`** の `#settingsDropinModsContainer` 内、`#settingsDropinFileSystemButton` の直後に追加。

```html
                    <button id="settingsModrinthButton" type="button">Modrinthから追加</button>
```

- [ ] **Step 2: `app/overlay.ejs`** の `#serverSelectContent` と同階層（`#overlayContainer` 直下）に検索コンテンツを追加。

```html
    <div id="modrinthContent" style="display: none;">
        <span id="modrinthHeader">Modrinthから追加</span>
        <div id="modrinthSearchBar">
            <input type="text" id="modrinthSearchInput" placeholder="MODを検索">
            <button id="modrinthSearchButton" type="button">検索</button>
        </div>
        <div id="modrinthResults"><!-- results here --></div>
        <div id="modrinthActions">
            <button id="modrinthCancel" type="button">閉じる</button>
        </div>
    </div>
```

- [ ] **Step 3: `app/assets/css/launcher.css`** にスタイル追加（既存 `#serverSelectContent` 系の近く）。

```css
#modrinthContent {
    display: flex; flex-direction: column; align-items: center; height: 75%; width: 460px; margin: 0 auto; color: #fff;
}
#modrinthHeader { font-size: 20px; font-weight: bold; margin-bottom: 16px; }
#modrinthSearchBar { display: flex; gap: 8px; width: 100%; margin-bottom: 12px; }
#modrinthSearchInput { flex: 1 1 auto; background: rgba(255,255,255,0.85); border: 2px solid rgba(255,255,255,0.75); border-radius: 3px; padding: 6px; }
#modrinthSearchButton, #modrinthCancel { background: none; border: 1px solid #fff; color: #fff; border-radius: 3px; padding: 6px 14px; cursor: pointer; font-weight: bold; }
#modrinthSearchButton:hover, #modrinthCancel:hover { box-shadow: 0 0 10px 0 #fff; }
#modrinthResults { width: 100%; flex: 1 1 auto; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
#modrinthActions { margin-top: 12px; }
.modrinthResult { display: flex; align-items: center; gap: 10px; border: 1px solid rgba(126,126,126,0.57); border-radius: 3px; padding: 8px; background: rgba(0,0,0,0.25); }
.modrinthResult img { width: 40px; height: 40px; border-radius: 4px; background: rgba(255,255,255,0.1); object-fit: cover; }
.modrinthResultInfo { flex: 1 1 auto; min-width: 0; }
.modrinthResultTitle { font-weight: bold; }
.modrinthResultMeta { font-size: 11px; color: rgba(202,202,202,0.8); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.modrinthAddButton { background: none; border: 1px solid #fff; color: #fff; border-radius: 3px; padding: 4px 12px; cursor: pointer; }
.modrinthAddButton:hover { box-shadow: 0 0 8px 0 #fff; }
.modrinthAddButton[disabled] { opacity: 0.5; cursor: default; }
```

- [ ] **Step 4:** `npm run lint`。
- [ ] **Step 5:** `git add app/settings.ejs app/overlay.ejs app/assets/css/launcher.css` → commit `feat(mods): add Modrinth search overlay UI`

---

## Task 5: 検索・単体追加（依存なし）＋Modタブ更新

**Files:**
- Modify: `app/assets/js/scripts/settings.js`（ボタンバインド・検索・追加処理）

**Interfaces:**
- Consumes: `window.NLModrinth`（Task 2）、`getModTargetContext`（Task 3）、`resolveDropinModsForUI`（既存）、`toggleOverlay`/`setOverlayContent`（overlay.js）。helios `downloadFile`。

- [ ] **Step 1: `settings.js` に検索UIロジックを追加（末尾付近）**

```js
async function openModrinthSearch(){
    const ctx = await getModTargetContext()
    if(!ctx || !ctx.loader){
        setOverlayContent('MOD非対応', 'このパックはMODを導入できません（Fabric/Forge のパックを選んでください）。', 'OK')
        setOverlayHandler(null); toggleOverlay(true); return
    }
    document.getElementById('modrinthSearchInput').value = ''
    document.getElementById('modrinthResults').innerHTML = ''
    toggleOverlay(true, 'modrinthContent')
}

async function runModrinthSearch(){
    const ctx = await getModTargetContext()
    if(!ctx || !ctx.loader) return
    const q = document.getElementById('modrinthSearchInput').value.trim()
    const results = document.getElementById('modrinthResults')
    results.innerHTML = '<div style="opacity:0.7">検索中...</div>'
    try {
        const hits = await window.NLModrinth.search(q, ctx.mc, ctx.loader)
        if(hits.length === 0){ results.innerHTML = '<div style="opacity:0.7">見つかりませんでした</div>'; return }
        results.innerHTML = ''
        for(const h of hits){
            const row = document.createElement('div')
            row.className = 'modrinthResult'
            const icon = h.iconUrl ? `<img src="${h.iconUrl}">` : '<img>'
            row.innerHTML = `${icon}
                <div class="modrinthResultInfo">
                    <div class="modrinthResultTitle">${(h.title||'').replace(/</g,'&lt;')}</div>
                    <div class="modrinthResultMeta">${(h.author||'')} ・ DL ${Number(h.downloads||0).toLocaleString()}</div>
                </div>
                <button class="modrinthAddButton" type="button">追加</button>`
            const btn = row.getElementsByClassName('modrinthAddButton')[0]
            btn.onclick = () => addModrinthMod(h, btn)
            results.appendChild(row)
        }
    } catch(err){
        results.innerHTML = '<div style="opacity:0.7">' + (err.message || '検索に失敗しました') + '</div>'
    }
}

async function addModrinthMod(hit, btn){
    const { downloadFile } = require('helios-core/dl')
    const fsx = require('fs-extra'); const pth = require('path')
    const ctx = await getModTargetContext()
    if(!ctx || !ctx.loader) return
    btn.setAttribute('disabled', ''); btn.textContent = '追加中...'
    try {
        const version = await window.NLModrinth.getBestVersion(hit.projectId, ctx.mc, ctx.loader)
        if(!version){ btn.textContent = '非対応'; return }
        // Task 6 で collectRequired に差し替え。まずは本体のみ。
        const files = []
        const primary = (version.files.find(f => f.primary) || version.files[0])
        if(primary) files.push({ filename: primary.filename, url: primary.url })
        fsx.ensureDirSync(ctx.modsDir)
        let added = 0
        for(const f of files){
            const dest = pth.join(ctx.modsDir, f.filename)
            if(!fsx.existsSync(dest)){ await downloadFile(f.url, dest); added++ }
        }
        btn.textContent = added > 0 ? '追加済み' : '既にあり'
        if(typeof resolveDropinModsForUI === 'function'){ await resolveDropinModsForUI() }
    } catch(err){
        btn.removeAttribute('disabled'); btn.textContent = '再試行'
        console.warn('Modrinth add failed', err)
    }
}
```

- [ ] **Step 2: ボタンのバインドを追加**（`settings.js` の他の `onclick` バインド群の近く）

```js
{
    const mb = document.getElementById('settingsModrinthButton')
    if(mb) mb.onclick = () => openModrinthSearch()
    const sb = document.getElementById('modrinthSearchButton')
    if(sb) sb.onclick = () => runModrinthSearch()
    const si = document.getElementById('modrinthSearchInput')
    if(si) si.addEventListener('keydown', (e) => { if(e.key === 'Enter'){ e.preventDefault(); e.stopPropagation(); runModrinthSearch() } })
    const mc = document.getElementById('modrinthCancel')
    if(mc) mc.onclick = () => toggleOverlay(false)
}
```

- [ ] **Step 3:** `npm run lint`。
- [ ] **Step 4: 手動確認**：自作(Fabric 1.20.1)パック選択→設定→Modタブ→「Modrinthから追加」→ "sodium" 検索→追加→`instances/<id>/mods` に sodium jar が入り、Modタブのドロップイン一覧に出る。
- [ ] **Step 5:** `git add app/assets/js/scripts/settings.js` → commit `feat(mods): Modrinth search and single-mod add`

---

## Task 6: 必須依存の自動解決

**Files:**
- Modify: `app/assets/js/scripts/settings.js`（`addModrinthMod` の files 収集を `collectRequired` に）

- [ ] **Step 1: `addModrinthMod` の本体のみ収集を依存込みに差し替え**

変更前:
```js
        // Task 6 で collectRequired に差し替え。まずは本体のみ。
        const files = []
        const primary = (version.files.find(f => f.primary) || version.files[0])
        if(primary) files.push({ filename: primary.filename, url: primary.url })
```
変更後:
```js
        const files = await window.NLModrinth.collectRequired(version, ctx.mc, ctx.loader)
```

- [ ] **Step 2:** ダウンロードループ後の通知に依存件数を反映（任意）。`btn.textContent` は追加数に応じて `追加済み`/`既にあり` のまま可。

- [ ] **Step 3:** `npm run lint`。
- [ ] **Step 4: 手動確認**：依存を持つMOD（例: Fabric向けで Fabric API 等の required を持つもの、または "iris"（sodium依存））を追加すると、依存jarも `mods` に入ることを確認。
- [ ] **Step 5:** `git add app/assets/js/scripts/settings.js` → commit `feat(mods): auto-resolve required Modrinth dependencies`

---

## Task 7: 手動統合確認

**Files:** なし（手動）

- [ ] **Step 1:** `npx electron . --disable-gpu`
- [ ] **Step 2:** 検証観点:
  1. 自作(Fabric)パックで Modタブが表示され、Modrinth検索→互換MODのみ出る。
  2. MOD追加→`mods` に jar、Modタブに反映、有効/無効・削除ができる。
  3. 必須依存が一緒に入る。
  4. 公式パック（Forge）でも検索でき、forge対応MODが出る（導入先は公式パックの mods）。
  5. バニラ自作パックでは「MOD非対応」表示。
  6. 既存jarは再DLされない。通信失敗/対応版なしで分かりやすいエラー。
- [ ] **Step 3:** `npm run lint` 最終確認（ベースライン維持）。

---

## 自己レビュー結果

- **スペック網羅**: A(section G)=Task1、B(Modrinth API)=Task2、C(context)=Task3、D(UI)=Task4、E(検索+追加+DL)=Task5、依存=Task6、テスト=Task7。
- **プレースホルダ**: 具体コード記載。Task5 の files 収集は Task6 で `collectRequired` に置換する旨を明示（段階実装）。
- **型/識別子整合**: `window.NLModrinth.{search,getBestVersion,collectRequired}`（Task2→Task5/6）、`getModTargetContext`（Task3→Task5/6）、`resolveSelectedServerLike`（Task1）、DOM id（`#settingsModrinthButton`/`#modrinth*`）が Task4定義↔Task5使用で一致。Modrinth応答フィールドは実測に一致。
- **回帰配慮**: section G は Mod/シェーダー/選択表示系の `getServerById` のみ疑似化（ランチャー設定・アカウント系は不変）。導入先は選択中パックの mods（既存ドロップイン機構）。
