# 自作Modパック ① M1（バニラ作成・起動）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modパック選択画面に「公式／自作」タブを追加し、ユーザーが最新を含むMinecraftリリース版を選んで**バニラ（ローダーなし）の自作インスタンス**を作成・一覧管理し、PLAYで起動できるようにする（歩けるskeleton）。

**Architecture:** 自作インスタンスは `config.json` の `customInstances` に保存。選択すると疑似サーバーオブジェクト `{ rawServer:{id,minecraftVersion}, modules:[] }` に変換し、helios-core の `MojangIndexProcessor`＋`downloadQueue` でバニラ本体を検証・DL、`getVersionJson()` の結果を `vanillaManifest` として既存 `ProcessBuilder` に渡して起動する（配布主導の `FullRepair` はサーバーが配布に無いため使わない）。

**Tech Stack:** Electron 33, Node 20, EJS, jQuery, helios-core（MojangIndexProcessor / DownloadEngine / ProcessBuilder）。

## Global Constraints

- 本計画は **①のM1（バニラのみ）**。Fabric=M2, Forge=M3, 設定Modタブ対応/仕上げ=M4 は別計画。
- 新規 npm 依存は追加しない。
- Minecraftバージョンは Mojang version manifest を都度取得し、`type === 'release'` を**新しい順**で表示（**最新リリースを含む**）。スナップショットは対象外。
- 自作インスタンスはローカル専用。共有(④)は対象外だが、保存データは `{schema,name,minecraftVersion,loader,loaderVersion}` を含む自己完結JSONにして将来の共有を阻害しない。
- 失敗時は既存 `showLaunchFailure(title, desc, err)` を使う（先日実装のログ出力ボタンで内容を保存できる）。
- テストランナーは無い。各タスクの検証は `npm run lint`（新規エラーを増やさない）＋手動（GPU無効起動 `npx electron . --disable-gpu`、必要なら `elementFromPoint`/スクショで確認）。
- コミットは実装用ブランチ `feature/custom-modpacks` で行う。`main` では作業しない。
- 参照実装: 既存の起動フロー [landing.js dlAsync](../../../app/assets/js/scripts/landing.js) 509行〜、`ProcessBuilder` [processbuilder.js](../../../app/assets/js/processbuilder.js)、サーバー選択UI [overlay.js](../../../app/assets/js/scripts/overlay.js) の `createServerHtml`/`updateSelectedServer`。

---

## Task 0: 実装用ブランチの作成

**Files:** なし（git操作）

- [ ] **Step 1: main から分岐**

```bash
git checkout main
git checkout -b feature/custom-modpacks
```

- [ ] **Step 2: lint ベースライン確認**

Run: `npm run lint`
Expected: エラー件数を控える（以降この件数を増やさない基準）。

---

## Task 1: ConfigManager に customInstances CRUD を追加

**Files:**
- Modify: `app/assets/js/configmanager.js`（`DEFAULT_CONFIG` 167行付近、`getModConfiguration` 群 585行付近の後ろ）

**Interfaces:**
- Produces:
  - `ConfigManager.getCustomInstances(): Array<Instance>`
  - `ConfigManager.getCustomInstance(id: string): Instance|null`
  - `ConfigManager.addCustomInstance(instance: Instance): void`
  - `ConfigManager.updateCustomInstance(id: string, patch: Object): void`
  - `ConfigManager.removeCustomInstance(id: string): void`
  - Instance = `{ schema:1, id, name, minecraftVersion, loader:'vanilla'|'fabric'|'forge', loaderVersion:string, created:number, lastPlayed:number|null }`

- [ ] **Step 1: `DEFAULT_CONFIG` に `customInstances: []` を追加**

`app/assets/js/configmanager.js` の `DEFAULT_CONFIG` オブジェクト（167行付近）のトップレベルに `customInstances: []` を追加する。既存の `modConfigurations: []` と同じ階層。例（該当キー付近のみ、既存の他キーは残す）:

```js
const DEFAULT_CONFIG = {
    settings: { /* ...既存... */ },
    newsCache: { /* ...既存... */ },
    clientToken: null,
    selectedServer: null,
    selectedAccount: null,
    authenticationDatabase: {},
    modConfigurations: [],
    customInstances: [],
    javaConfig: {}
}
```

（注: 上の隣接キーは既存ファイルの実際の並びに合わせること。追加するのは `customInstances: []` の1行のみ。）

- [ ] **Step 2: 既存configに欠けていても落ちないようにする**

`exports.load` 相当（configを読み込んでvalidateする箇所）で `modConfigurations` を扱っている近辺に、`customInstances` の既定を補完する。`app/assets/js/configmanager.js` 内で `config.modConfigurations` を参照している検証処理があれば、その直後に以下を追加する（無ければ `exports.save` の直前あたりにヘルパを置き、`getCustomInstances` 側で遅延初期化する）:

```js
// Ensure customInstances exists for configs saved before this feature.
function ensureCustomInstances(){
    if(config.customInstances == null){
        config.customInstances = []
    }
    return config.customInstances
}
```

- [ ] **Step 3: CRUD を追加**

`getModConfiguration`/`setModConfiguration` 群の後ろ（601行付近の後）に追加する。

```js
/**
 * Get all user-created custom instances.
 * @returns {Array.<Object>}
 */
exports.getCustomInstances = function(){
    return ensureCustomInstances()
}

/**
 * Get a single custom instance by id.
 * @param {string} id
 * @returns {Object|null}
 */
exports.getCustomInstance = function(id){
    const list = ensureCustomInstances()
    for(let i=0; i<list.length; i++){
        if(list[i].id === id) return list[i]
    }
    return null
}

/**
 * Add a custom instance.
 * @param {Object} instance
 */
exports.addCustomInstance = function(instance){
    ensureCustomInstances().push(instance)
}

/**
 * Merge a patch into an existing custom instance.
 * @param {string} id
 * @param {Object} patch
 */
exports.updateCustomInstance = function(id, patch){
    const list = ensureCustomInstances()
    for(let i=0; i<list.length; i++){
        if(list[i].id === id){
            list[i] = Object.assign({}, list[i], patch)
            return
        }
    }
}

/**
 * Remove a custom instance by id.
 * @param {string} id
 */
exports.removeCustomInstance = function(id){
    const list = ensureCustomInstances()
    const idx = list.findIndex(x => x.id === id)
    if(idx >= 0) list.splice(idx, 1)
}
```

- [ ] **Step 4: lint 確認**

Run: `npm run lint`
Expected: 新規エラーが増えていない。

- [ ] **Step 5: コミット**

```bash
git add app/assets/js/configmanager.js
git commit -m "feat(custom): add customInstances CRUD to ConfigManager"
```

---

## Task 2: バージョン取得ユーティリティ（Mojangリリース一覧）

**Files:**
- Create: `app/assets/js/scripts/customversions.js`
- Modify: `app/app.ejs`（`errorlog.js` の後に読み込み追加）

**Interfaces:**
- Produces（`window.NLCustomVersions`）:
  - `async fetchReleaseVersions(): Promise<Array<{id:string, releaseTime:string}>>` — Mojang manifest のリリース版のみ、新しい順。失敗時は例外。

- [ ] **Step 1: `app/assets/js/scripts/customversions.js` を新規作成**

```js
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
```

- [ ] **Step 2: `app/app.ejs` に読み込みを追加**

`errorlog.js` の script 行の直後に追加する。変更前:

```html
    <script src="./assets/js/scripts/errorlog.js"></script>
    <script src="./assets/js/scripts/uicore.js"></script>
```

変更後:

```html
    <script src="./assets/js/scripts/errorlog.js"></script>
    <script src="./assets/js/scripts/customversions.js"></script>
    <script src="./assets/js/scripts/uicore.js"></script>
```

- [ ] **Step 3: lint 確認**

Run: `npm run lint`
Expected: 新規エラーが増えていない。

- [ ] **Step 4: 手動確認**

Run: `npx electron . --disable-gpu`
DevTools コンソールで `await window.NLCustomVersions.fetchReleaseVersions()` を実行し、最新リリース（例 1.21.x）が配列の先頭付近に来ることを確認。確認後アプリを閉じる。

- [ ] **Step 5: コミット**

```bash
git add app/assets/js/scripts/customversions.js app/app.ejs
git commit -m "feat(custom): add Mojang release version fetcher"
```

---

## Task 3: サーバー選択オーバーレイにタブUIを追加

**Files:**
- Modify: `app/overlay.ejs`（`#serverSelectContent`）
- Modify: `app/assets/css/launcher.css`（タブのスタイル追加）
- Modify: `app/assets/js/scripts/overlay.js`（タブ状態と切替）

**Interfaces:**
- Produces: DOM `#serverTabOfficial`, `#serverTabCustom`, リストコンテナ `#customInstanceListScrollable`, 「＋新規作成」`#customInstanceCreateButton`。グローバル状態 `activeServerTab`（'official'|'custom'）、関数 `setServerTab(tab)`、`populateCustomInstanceListings()`。

- [ ] **Step 1: `app/overlay.ejs` の `#serverSelectContent` にタブと自作リストを追加**

`#serverSelectHeader` の直後（`#filterControls` の前）にタブバーを追加し、`#serverSelectList` の後ろに自作用リストを追加する。変更前:

```html
    <div id="serverSelectContent" style="display: none;">
        <span id="serverSelectHeader"><%- lang('overlay.serverSelectHeader') %></span>
        <div id="filterControls">
            <input type="text" id="filterInput" placeholder="絞り込み">
            <button id="serverLayoutToggle" title="表示切替" type="button">2列</button>
        </div>
        <div id="serverSelectList">
            <div id="serverSelectListScrollable">
                <!-- Server listings populated here. -->
            </div>
        </div>
        <div id="serverSelectActions">
```

変更後:

```html
    <div id="serverSelectContent" style="display: none;">
        <span id="serverSelectHeader"><%- lang('overlay.serverSelectHeader') %></span>
        <div id="serverTabBar">
            <button id="serverTabOfficial" class="serverTab" type="button" selected>公式</button>
            <button id="serverTabCustom" class="serverTab" type="button">自作</button>
        </div>
        <div id="filterControls">
            <input type="text" id="filterInput" placeholder="絞り込み">
            <button id="serverLayoutToggle" title="表示切替" type="button">2列</button>
        </div>
        <div id="serverSelectList">
            <div id="serverSelectListScrollable">
                <!-- Server listings populated here. -->
            </div>
            <div id="customInstanceList" style="display: none;">
                <div id="customInstanceListScrollable">
                    <!-- Custom instances populated here. -->
                </div>
                <button id="customInstanceCreateButton" type="button">＋ 新規作成</button>
            </div>
        </div>
        <div id="serverSelectActions">
```

- [ ] **Step 2: `launcher.css` にタブと自作リストのスタイルを追加**

`#serverSelectContent` 関連スタイルの近く（`grep -n "#serverSelectContent" app/assets/css/launcher.css` で場所確認）に追加する。

```css
/* Custom modpack tabs. */
#serverTabBar {
    display: flex;
    gap: 6px;
    margin-bottom: 12px;
}
.serverTab {
    background: none;
    border: 1px solid rgba(126, 126, 126, 0.57);
    color: #fff;
    padding: 4px 16px;
    border-radius: 3px;
    cursor: pointer;
    opacity: 0.6;
    transition: 0.2s ease;
}
.serverTab[selected] {
    opacity: 1;
    border-color: #fff;
}
.serverTab:hover { opacity: 1; }
#customInstanceListScrollable {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 260px;
    overflow-y: auto;
    width: 420px;
}
#customInstanceCreateButton {
    margin-top: 10px;
    background: none;
    border: 1px solid #fff;
    color: #fff;
    padding: 6px 16px;
    border-radius: 3px;
    cursor: pointer;
    font-weight: bold;
}
#customInstanceCreateButton:hover { box-shadow: 0 0 10px 0 #fff; }
.customInstanceListing {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    color: #fff;
    border: 1px solid rgba(126, 126, 126, 0.57);
    border-radius: 3px;
    padding: 8px 12px;
    background: rgba(0, 0, 0, 0.25);
    cursor: pointer;
    opacity: 0.7;
    transition: 0.2s ease;
}
.customInstanceListing[selected], .customInstanceListing:hover { opacity: 1; border-color: #fff; }
.customInstanceMeta { font-size: 11px; color: rgba(202,202,202,0.8); }
.customInstanceActions { display: flex; gap: 6px; }
.customInstanceActions button {
    background: none; border: 1px solid rgba(126,126,126,0.57); color: #fff;
    border-radius: 3px; padding: 2px 8px; cursor: pointer; font-size: 11px;
}
```

- [ ] **Step 3: `overlay.js` にタブ状態と切替、自作リスト描画を追加**

`overlay.js` の `populateServerListings` 関数の後ろ（`createServerHtml` 付近）に追加する。`_ipc` は既存でファイル先頭に定義済み。

```js
let activeServerTab = 'official'

function setServerTab(tab){
    activeServerTab = tab
    const off = document.getElementById('serverTabOfficial')
    const cus = document.getElementById('serverTabCustom')
    const officialList = document.getElementById('serverSelectListScrollable')
    const customList = document.getElementById('customInstanceList')
    const filter = document.getElementById('filterControls')
    if(tab === 'custom'){
        if(cus) cus.setAttribute('selected', '')
        if(off) off.removeAttribute('selected')
        if(officialList) officialList.style.display = 'none'
        if(customList) customList.style.display = ''
        if(filter) filter.style.display = 'none'
        populateCustomInstanceListings()
    } else {
        if(off) off.setAttribute('selected', '')
        if(cus) cus.removeAttribute('selected')
        if(officialList) officialList.style.display = ''
        if(customList) customList.style.display = 'none'
        if(filter) filter.style.display = ''
    }
}

function populateCustomInstanceListings(){
    const el = document.getElementById('customInstanceListScrollable')
    if(!el) return
    const instances = ConfigManager.getCustomInstances()
    const selected = ConfigManager.getSelectedServer()
    if(instances.length === 0){
        el.innerHTML = '<div style="width:100%;text-align:center;opacity:0.7">まだ自作パックがありません</div>'
        return
    }
    let html = ''
    for(const ins of instances){
        const loaderLabel = ins.loader === 'vanilla' ? 'バニラ' : `${ins.loader} ${ins.loaderVersion}`
        const nameEsc = (ins.name || '無題の構成').replace(/</g, '&lt;')
        html += `<div class="customInstanceListing" cid="${ins.id}" ${ins.id === selected ? 'selected' : ''}>
            <div>
                <div class="customInstanceName">${nameEsc}</div>
                <div class="customInstanceMeta">${ins.minecraftVersion} / ${loaderLabel}</div>
            </div>
            <div class="customInstanceActions">
                <button class="customOpenFolder" cid="${ins.id}" type="button">フォルダ</button>
                <button class="customDelete" cid="${ins.id}" type="button">削除</button>
            </div>
        </div>`
    }
    el.innerHTML = html
    setCustomInstanceHandlers()
}
```

- [ ] **Step 4: タブボタンのバインドを追加**

`overlay.js` の末尾付近（他の `document.getElementById(...).addEventListener` 群の近く）に追加する。

```js
{
    const off = document.getElementById('serverTabOfficial')
    const cus = document.getElementById('serverTabCustom')
    if(off) off.addEventListener('click', () => setServerTab('official'))
    if(cus) cus.addEventListener('click', () => setServerTab('custom'))
}
```

- [ ] **Step 5: lint 確認**

Run: `npm run lint`
Expected: 新規エラーが増えていない（`setCustomInstanceHandlers` は Task 5 で定義。未定義参照は実行時のみで lint は通るが、Task 5 まで自作タブのクリックはしないこと）。

- [ ] **Step 6: コミット**

```bash
git add app/overlay.ejs app/assets/css/launcher.css app/assets/js/scripts/overlay.js
git commit -m "feat(custom): add official/custom tabs to server selection overlay"
```

---

## Task 4: 作成フォーム（バニラ）＋インスタンス作成

**Files:**
- Modify: `app/overlay.ejs`（`#overlayContainer` 内に作成フォーム content を追加）
- Modify: `app/assets/js/scripts/overlay.js`（フォーム表示・送信処理）

**Interfaces:**
- Consumes: `window.NLCustomVersions.fetchReleaseVersions()`（Task 2）、`ConfigManager.addCustomInstance`（Task 1）、`populateCustomInstanceListings`（Task 3）。
- Produces: `openCustomInstanceCreate()`、DOM `#customCreateContent`, `#customCreateMcVersion`, `#customCreateLoader`, `#customCreateName`, `#customCreateConfirm`, `#customCreateCancel`。

- [ ] **Step 1: 作成フォームのマークアップを `app/overlay.ejs` に追加**

`#serverSelectContent` の閉じ `</div>` の直後（他の *Content ブロックと同じ階層）に追加する。

```html
    <div id="customCreateContent" style="display: none;">
        <span id="customCreateHeader">自作パックを作成</span>
        <div class="customCreateField">
            <label for="customCreateName">名前</label>
            <input type="text" id="customCreateName" placeholder="例: 自分のFabric構成">
        </div>
        <div class="customCreateField">
            <label for="customCreateMcVersion">Minecraftバージョン</label>
            <select id="customCreateMcVersion"><option value="">読み込み中...</option></select>
        </div>
        <div class="customCreateField">
            <label for="customCreateLoader">ローダー</label>
            <select id="customCreateLoader">
                <option value="vanilla">なし（バニラ）</option>
            </select>
        </div>
        <div id="customCreateActions">
            <button id="customCreateConfirm" type="button">作成</button>
            <button id="customCreateCancel" type="button">キャンセル</button>
        </div>
    </div>
```

（注: M1 はローダー=バニラのみ。Fabric/Forge の option は M2/M3 で追加する。）

- [ ] **Step 2: フォーム用の最小スタイルを `launcher.css` に追加**

Task 3 で追加したスタイルの近くに追記する。

```css
#customCreateContent {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: stretch;
    width: 420px;
    height: 75%;
    margin: 0 auto;
    color: #fff;
}
#customCreateHeader { font-size: 20px; font-weight: bold; text-align: center; margin-bottom: 20px; }
.customCreateField { display: flex; flex-direction: column; gap: 4px; margin-bottom: 14px; }
.customCreateField input, .customCreateField select {
    background: rgba(255,255,255,0.85); border: 2px solid rgba(255,255,255,0.75);
    border-radius: 3px; padding: 6px;
}
#customCreateActions { display: flex; gap: 12px; justify-content: center; margin-top: 10px; }
#customCreateActions button {
    background: none; border: 1px solid #fff; color: #fff; border-radius: 3px;
    padding: 6px 20px; cursor: pointer; font-weight: bold;
}
#customCreateActions button:hover { box-shadow: 0 0 10px 0 #fff; }
```

- [ ] **Step 3: `overlay.js` にフォーム表示・作成処理を追加**

Task 3 の関数群の後ろに追加する。`toggleOverlay(true, 'customCreateContent')` は既存 `toggleOverlay(toggleState, dismissable=false, content)` の content 指定を使う（既存の `toggleServerSelection` が `toggleOverlay(toggleState, true, 'serverSelectContent')` と同様）。

```js
async function openCustomInstanceCreate(){
    // Reset fields
    const nameEl = document.getElementById('customCreateName')
    const mcEl = document.getElementById('customCreateMcVersion')
    const loaderEl = document.getElementById('customCreateLoader')
    if(nameEl) nameEl.value = ''
    if(loaderEl) loaderEl.value = 'vanilla'
    if(mcEl) mcEl.innerHTML = '<option value="">読み込み中...</option>'
    toggleOverlay(true, 'customCreateContent')
    // Load versions
    try {
        const versions = await window.NLCustomVersions.fetchReleaseVersions()
        if(mcEl){
            mcEl.innerHTML = versions.map(v => `<option value="${v.id}">${v.id}</option>`).join('')
        }
    } catch(err){
        if(mcEl) mcEl.innerHTML = '<option value="">取得失敗</option>'
        setOverlayContent('エラー', 'バージョン一覧の取得に失敗しました。ネットワークを確認してください。', 'OK')
        setOverlayHandler(null)
        toggleOverlay(true)
    }
}

function _genInstanceId(){
    return 'custom-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
}

document.getElementById('customCreateConfirm').addEventListener('click', () => {
    const name = (document.getElementById('customCreateName').value || '').trim() || '無題の構成'
    const mc = document.getElementById('customCreateMcVersion').value
    const loader = document.getElementById('customCreateLoader').value || 'vanilla'
    if(!mc){
        setOverlayContent('未選択', 'Minecraftバージョンを選んでください。', 'OK')
        setOverlayHandler(null)
        toggleOverlay(true)
        return
    }
    const instance = {
        schema: 1,
        id: _genInstanceId(),
        name,
        minecraftVersion: mc,
        loader,               // M1 は 'vanilla' のみ
        loaderVersion: '',
        created: Date.now(),
        lastPlayed: null
    }
    ConfigManager.addCustomInstance(instance)
    ConfigManager.save()
    // 戻って自作タブを表示
    toggleServerSelection(true).then(() => setServerTab('custom'))
})

document.getElementById('customCreateCancel').addEventListener('click', () => {
    toggleServerSelection(true).then(() => setServerTab('custom'))
})
```

- [ ] **Step 4: 「＋新規作成」ボタンをバインド**

Task 3 Step 4 で追加したタブバインドのブロックに、作成ボタンのバインドを足す。

```js
{
    const createBtn = document.getElementById('customInstanceCreateButton')
    if(createBtn) createBtn.addEventListener('click', () => openCustomInstanceCreate())
}
```

- [ ] **Step 5: lint 確認**

Run: `npm run lint`
Expected: 新規エラーが増えていない。

- [ ] **Step 6: コミット**

```bash
git add app/overlay.ejs app/assets/css/launcher.css app/assets/js/scripts/overlay.js
git commit -m "feat(custom): add vanilla custom-instance creation form"
```

---

## Task 5: 自作インスタンスの選択・フォルダを開く・削除

**Files:**
- Modify: `app/assets/js/scripts/overlay.js`（`setCustomInstanceHandlers` 定義）
- Modify: `index.js`（`open-folder` IPC 追加）

**Interfaces:**
- Consumes: `ConfigManager.getSelectedServer/setSelectedServer`, `ConfigManager.getCustomInstance/removeCustomInstance/save`, `ConfigManager.getInstanceDirectory`。
- Produces: `setCustomInstanceHandlers()`（Task 3 の `populateCustomInstanceListings` から呼ばれる）、IPC `open-folder`。

- [ ] **Step 1: `index.js` に `open-folder` IPC を追加**

Task の `show-item-in-folder` ハンドラの直後に追加する。

```js
// Open a folder in the OS file manager (creating nothing).
ipcMain.handle('open-folder', async (event, targetPath) => {
    try {
        await shell.openPath(targetPath)
        return { success: true }
    } catch(err) {
        console.error('[main] open-folder failed', err)
        return { success: false, error: err.message }
    }
})
```

- [ ] **Step 2: `overlay.js` に `setCustomInstanceHandlers` を追加**

`populateCustomInstanceListings` の後ろに追加する。`require('path')` は overlay.js 先頭に無ければ追加（`const path = require('path')`）。

```js
function setCustomInstanceHandlers(){
    // Select an instance (click on the row, not on action buttons).
    Array.from(document.getElementsByClassName('customInstanceListing')).forEach(row => {
        row.onclick = (e) => {
            if(e.target.closest('.customInstanceActions')) return
            const cid = row.getAttribute('cid')
            ConfigManager.setSelectedServer(cid)
            ConfigManager.save()
            const cur = document.querySelector('.customInstanceListing[selected]')
            if(cur) cur.removeAttribute('selected')
            row.setAttribute('selected', '')
            if(typeof updateSelectedServer === 'function'){
                updateSelectedServer(null) // 自作は distro に無いので null を渡し、表示は下の行で更新
            }
            const btn = document.getElementById('server_selection_button')
            const ins = ConfigManager.getCustomInstance(cid)
            if(btn && ins) btn.innerHTML = '&#8226; ' + (ins.name || '無題の構成')
            toggleOverlay(false)
        }
    })
    // Open folder
    Array.from(document.getElementsByClassName('customOpenFolder')).forEach(b => {
        b.onclick = async (e) => {
            e.stopPropagation()
            const cid = b.getAttribute('cid')
            const dir = require('path').join(ConfigManager.getInstanceDirectory(), cid)
            try { require('fs-extra').ensureDirSync(dir) } catch(err) { /* ignore */ }
            await _ipc.invoke('open-folder', dir)
        }
    })
    // Delete
    Array.from(document.getElementsByClassName('customDelete')).forEach(b => {
        b.onclick = (e) => {
            e.stopPropagation()
            const cid = b.getAttribute('cid')
            const ins = ConfigManager.getCustomInstance(cid)
            setOverlayContent('削除しますか？', `「${(ins && ins.name) || '無題の構成'}」を一覧から削除します。`, '削除する', 'キャンセル')
            setOverlayHandler(() => {
                ConfigManager.removeCustomInstance(cid)
                if(ConfigManager.getSelectedServer() === cid){
                    ConfigManager.setSelectedServer(null)
                }
                ConfigManager.save()
                toggleServerSelection(true).then(() => setServerTab('custom'))
            })
            setDismissHandler(null)
            toggleOverlay(true, true)
        }
    })
}
```

- [ ] **Step 3: lint 確認**

Run: `npm run lint`
Expected: 新規エラーが増えていない。

- [ ] **Step 4: 手動確認（起動以外のUI一巡）**

Run: `npx electron . --disable-gpu`
- パック選択オーバーレイを開き「自作」タブに切替 → 「＋新規作成」→ 名前とMC版を選んで「作成」→ 一覧に出る。
- 行をクリックで選択され、オーバーレイが閉じてPLAY横の表示が名前になる。
- 「フォルダ」でインスタンスフォルダがエクスプローラーで開く。
- 「削除」で確認 → 削除される。
確認後アプリを閉じる。

- [ ] **Step 5: コミット**

```bash
git add index.js app/assets/js/scripts/overlay.js
git commit -m "feat(custom): select / open-folder / delete for custom instances"
```

---

## Task 6: バニラ起動（疑似サーバー＋MojangIndexProcessor）

**Files:**
- Create: `app/assets/js/scripts/customlaunch.js`
- Modify: `app/app.ejs`（読み込み追加）
- Modify: `app/assets/js/scripts/landing.js`（`dlAsync` 先頭で自作インスタンス選択なら分岐）

**Interfaces:**
- Consumes: helios-core `MojangIndexProcessor`, `downloadQueue`（`require('helios-core/dl')`）、`ProcessBuilder`、`ConfigManager`。既存 `landing.js` の `setLaunchDetails/setLaunchPercentage/setDownloadPercentage/toggleLaunchArea/onLoadComplete/showLaunchFailure/proc` を利用（同一レンダラのグローバル）。
- Produces（`window.NLCustomLaunch`）:
  - `isCustomSelected(): boolean`
  - `async launchCustomInstance(instance): Promise<void>`

- [ ] **Step 1: `app/assets/js/scripts/customlaunch.js` を新規作成**

```js
/**
 * Launch a user-created (custom) instance without the distribution.
 * Exposed as window.NLCustomLaunch. contextIsolation is disabled, so it can
 * use the launch helpers/globals defined by landing.js at call time.
 */
(function(){
    const { MojangIndexProcessor, downloadQueue } = require('helios-core/dl')
    const ProcessBuilder = require('./assets/js/processbuilder')
    const ConfigManager = require('./assets/js/configmanager')

    function isCustomSelected(){
        return ConfigManager.getCustomInstance(ConfigManager.getSelectedServer()) != null
    }

    /**
     * Build a distribution-server-like object ProcessBuilder can consume.
     * For vanilla there are no modules.
     */
    function buildSyntheticServer(instance){
        return {
            rawServer: {
                id: instance.id,
                name: instance.name,
                minecraftVersion: instance.minecraftVersion,
                javaOptions: undefined
            },
            modules: []
        }
    }

    async function launchCustomInstance(instance){
        const commonDir = ConfigManager.getCommonDirectory()

        // 1) Validate + download vanilla files via Mojang processor.
        setLaunchDetails('バニラファイルを準備中...')
        setLaunchPercentage(0, 100)
        const proc = new MojangIndexProcessor(commonDir, instance.minecraftVersion)
        await proc.init()
        const invalidByCat = await proc.validate(async () => {})
        const assets = Object.values(invalidByCat).reduce((a, b) => a.concat(b), [])
        if(assets.length > 0){
            setLaunchDetails('ダウンロード中...')
            await downloadQueue(assets, received => {
                // Rough progress; totalStages-based progress can be refined later.
                setDownloadPercentage(Math.min(99, received))
            })
            setDownloadPercentage(100)
        }
        await proc.postDownload()
        const versionData = await proc.getVersionJson()

        // 2) Ensure a mod configuration exists so ProcessBuilder won't crash.
        if(ConfigManager.getModConfiguration(instance.id) == null){
            ConfigManager.setModConfiguration(instance.id, { id: instance.id, mods: {} })
            ConfigManager.save()
        }

        // 3) Build & launch.
        const authUser = ConfigManager.getSelectedAccount()
        const syntheticServer = buildSyntheticServer(instance)
        setLaunchDetails('起動準備中...')
        const pb = new ProcessBuilder(syntheticServer, versionData, null, authUser, remote.app.getVersion())
        const gameProc = pb.build()

        // Update lastPlayed
        ConfigManager.updateCustomInstance(instance.id, { lastPlayed: Date.now() })
        ConfigManager.save()

        return gameProc
    }

    window.NLCustomLaunch = { isCustomSelected, launchCustomInstance }
})()
```

- [ ] **Step 2: `app/app.ejs` に読み込みを追加**

`customversions.js` の直後に追加する。

```html
    <script src="./assets/js/scripts/customversions.js"></script>
    <script src="./assets/js/scripts/customlaunch.js"></script>
    <script src="./assets/js/scripts/uicore.js"></script>
```

- [ ] **Step 3: `landing.js` の `dlAsync` 先頭で自作インスタンス分岐を追加**

`dlAsync` の `const loggerLaunchSuite = ...` の直後（516行付近の前）に、自作インスタンスなら専用経路を通す分岐を追加する。変更前:

```js
async function dlAsync(login = true) {

    // Login parameter is temporary for debug purposes. Allows testing the validation/downloads without
    // launching the game.

    const loggerLaunchSuite = LoggerUtil.getLogger('LaunchSuite')

    setLaunchDetails(Lang.queryJS('landing.dlAsync.loadingServerInfo'))
```

変更後:

```js
async function dlAsync(login = true) {

    // Login parameter is temporary for debug purposes. Allows testing the validation/downloads without
    // launching the game.

    const loggerLaunchSuite = LoggerUtil.getLogger('LaunchSuite')

    // Custom (user-created) instance path — bypasses the distribution.
    if(window.NLCustomLaunch && window.NLCustomLaunch.isCustomSelected()){
        if(login && ConfigManager.getSelectedAccount() == null){
            loggerLanding.error('You must be logged into an account.')
            return
        }
        const instance = ConfigManager.getCustomInstance(ConfigManager.getSelectedServer())
        toggleLaunchArea(true)
        try {
            proc = await window.NLCustomLaunch.launchCustomInstance(instance)
            setLaunchDetails(Lang.queryJS('landing.dlAsync.doneEnjoyServer'))
            const tempListener = function(data){
                if(GAME_LAUNCH_REGEX.test(data.trim())){
                    onLoadComplete()
                }
            }
            proc.stdout.on('data', tempListener)
            proc.stderr.on('data', function(d){
                if(window.NLErrorLog && d) window.NLErrorLog.pushLine('[GAME stderr] ' + String(d).trim())
            })
        } catch(err){
            loggerLaunchSuite.error('Error during custom instance launch.', err)
            showLaunchFailure('起動に失敗しました', err.message || 'コンソールを確認してください。', err)
        }
        return
    }

    setLaunchDetails(Lang.queryJS('landing.dlAsync.loadingServerInfo'))
```

- [ ] **Step 4: lint 確認**

Run: `npm run lint`
Expected: 新規エラーが増えていない。

- [ ] **Step 5: バニラ起動の手動検証（本タスクの肝。ProcessBuilder結合点を実機で詰める）**

Run: `npx electron . --disable-gpu`（ログイン済みアカウントが必要）
1. 「自作」タブでバニラインスタンス（例 MC 1.20.1）を作成して選択。
2. PLAY を押す。
3. 期待: バニラファイルのDL → Minecraft（バニラ）が起動する。
4. 失敗した場合、以下の**結合点**をログ（`[renderer] console-message` とエラー画面のログ出力）で確認し修正する:
   - `ConfigManager.getEffectiveJavaExecutable(instance.id)` が有効なJavaを返すか（返さない場合は、既存の `asyncSystemScan` によるJava検証を自作経路でも通す必要がある。`landing.js` の Java 検証 → `dlAsync` の流れを参考に、自作経路の前段で Java を確保する）。
   - `ProcessBuilder` が `syntheticServer.rawServer` から参照する追加フィールド（例: `javaOptions`、`mainServer`、`autoConnect` 等）が未定義で落ちないか。落ちる項目があれば `buildSyntheticServer` に安全な既定値を足す。
   - `resolveModConfiguration` が空 `modules` と `mods:{}` で正常に動くか。
5. 起動できたら、`instances/<id>/mods` に任意のバニラ対応リソース（例: データパックではなくOptiFine等の単体jar）を置く必要はない（バニラなので）。ドロップインの本格確認は M4。

> 注: このステップは実機での結合調整を含む。上記の結合点はコード読解から予測した箇所であり、
> 実行結果に応じて `buildSyntheticServer` と Java 確保処理を最小限調整すること（起動成功が受け入れ基準）。

- [ ] **Step 6: コミット**

```bash
git add app/assets/js/scripts/customlaunch.js app/app.ejs app/assets/js/scripts/landing.js
git commit -m "feat(custom): launch vanilla custom instances via synthetic server"
```

---

## Task 7: M1 統合動作確認

**Files:** なし（手動）

- [ ] **Step 1: 一連の流れ**

Run: `npx electron . --disable-gpu`
1. パック選択 → 「自作」タブ → 「＋新規作成」→ 最新付近のMC版を選択して作成。
2. 一覧表示・選択・フォルダを開く・削除が機能する。
3. バニラインスタンスを選んで PLAY → Minecraft が起動する。
4. 公式タブに戻すと従来通りoogatakunパックで起動できる（既存機能が壊れていない）。
5. 起動失敗時はエラー画面＋「ログを出力」でログ保存できる。

- [ ] **Step 2: lint 最終確認**

Run: `npm run lint`
Expected: ベースラインから新規エラーが増えていない。

---

## 自己レビュー結果

- **スペック網羅（M1範囲）**: データモデル/Config=Task1、バージョン取得(最新含む)=Task2、タブUI=Task3、作成フォーム=Task4、選択/フォルダ/削除=Task5、バニラ起動(疑似サーバー)=Task6、公式が壊れないこと=Task7。①のうち Fabric/Forge/設定Modタブ対応は M2–M4（別計画）。
- **プレースホルダ**: 実装コードは具体化済み。Task6 Step5 は「実機での結合調整」を含むが、対象の結合点・受け入れ基準（起動成功）を明示しており、曖昧なTODOではない。
- **型/識別子整合**: `ConfigManager.getCustomInstances/getCustomInstance/addCustomInstance/updateCustomInstance/removeCustomInstance`（Task1定義→Task3/4/5/6使用）一致。`window.NLCustomVersions.fetchReleaseVersions`（Task2→Task4）一致。`setServerTab/populateCustomInstanceListings/setCustomInstanceHandlers/openCustomInstanceCreate`（Task3/4/5内）一致。`window.NLCustomLaunch.{isCustomSelected,launchCustomInstance}`（Task6定義→landing.js使用）一致。IPC `open-folder`（Task5）一致。
- **リスク**: 最大の不確実性は Task6 の ProcessBuilder 結合（Java確保・rawServer参照フィールド）。歩けるskeletonとして最小の疑似サーバーで起動を通し、必要フィールドは実機ログで補完する方針。
