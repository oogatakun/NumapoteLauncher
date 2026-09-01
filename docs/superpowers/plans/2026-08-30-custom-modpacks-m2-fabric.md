# 自作Modパック ① M2（Fabric作成・起動）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 自作インスタンスで **Fabric** を選べるようにし、選択MC版に対応するFabricローダーのバージョンを選んで作成→PLAYでFabricのMinecraftを起動できるようにする（M1のバニラ経路にFabricを追加）。

**Architecture:** Fabric Meta API から (a) 対応ローダー一覧、(b) 起動プロファイルJSON（`mainClass`/`arguments`/`libraries`）を取得。プロファイルの各ライブラリを maven 座標からダウンロードし、`Type.Fabric` の**疑似モジュール**（＋`Type.Library`の疑似サブモジュール群）を組み立てて、M1と同じ疑似サーバー経路で `ProcessBuilder(server, vanillaManifest, fabricProfileJson, authUser, ver)` に渡す。ProcessBuilder は無改造で流用（`usingFabricLoader` によりクライアントjarをクラスパスに追加し、`_resolveServerLibraries` の `Type.Fabric` 分岐がローダー＋ライブラリを解決する）。

**Tech Stack:** Electron 33, Node 20, helios-core（ProcessBuilder / MojangIndexProcessor）, Fabric Meta API, `helios-distribution-types`（`Type`）。

## Global Constraints

- 本計画は **①のM2（Fabricのみ）**。Forge=M3、外部導入=③、共有=④ は別。バニラ(M1)は実装済み・変更しない。
- 新規 npm 依存は追加しない。
- Fabric対応は MC 1.14+。作成フォームで、選択MC版にFabricローダーが無い場合はFabricを選べない／注記する。
- ローカル専用。失敗時は既存 `showLaunchFailure(title, desc, err)` を使う（ログ出力ボタンで内容保存可）。
- テストランナー無し。各タスクの検証は `npm run lint`（新規エラーを増やさない。ベースライン **21 problems (21 errors)**）＋手動（`npx electron . --disable-gpu`、必要なら `[renderer] console-message` ログ・スクショ）。
- コミットは実装用ブランチ `feature/custom-modpacks-fabric` で行う。`main` では作業しない。
- **ProcessBuilder は原則無改造**。疑似 `Type.Fabric` モジュールが満たすべきインターフェース（ProcessBuilderが呼ぶもの）:
  - `rawModule.type === Type.Fabric`（ローダー）/ `Type.Library`（各ライブラリ）
  - `getVersionlessMavenIdentifier(): string`（`group:artifact`）
  - `getPath(): string`（jarの絶対パス）
  - `subModules: Array`（ローダーは各ライブラリ、ライブラリは `[]`）
  - `rawModule.classpath`（Type.Library。未指定は真扱い＝`?? true`）
- 参照: M1実装 [customlaunch.js](../../../app/assets/js/scripts/customlaunch.js)、[ProcessBuilder `_resolveServerLibraries`](../../../app/assets/js/processbuilder.js) 910行、`classpathArg` 749行、`build()` 54-58行。

---

## Task 0: 実装用ブランチ

- [ ] **Step 1:** `git checkout main && git checkout -b feature/custom-modpacks-fabric`
- [ ] **Step 2:** `npm run lint` でベースライン確認（21）。

---

## Task 1: Fabric Meta クライアント（バージョン一覧＋プロファイル）

**Files:**
- Modify: `app/assets/js/scripts/customversions.js`（`window.NLCustomVersions` に追加）

**Interfaces:**
- Produces:
  - `async fetchFabricLoaderVersions(mc: string): Promise<Array<{version:string, stable:boolean}>>` — 新しい順（Fabric Meta は既に新しい順）。対応が無ければ空配列。
  - `async fetchFabricProfile(mc: string, loader: string): Promise<Object>` — 起動プロファイルJSON（`id`,`mainClass`,`arguments`,`libraries`）。

- [ ] **Step 1: `customversions.js` の IIFE 内に追加し、エクスポートに足す**

```js
    const FABRIC_META = 'https://meta.fabricmc.net'

    async function fetchFabricLoaderVersions(mc){
        const res = await fetch(`${FABRIC_META}/v2/versions/loader/${encodeURIComponent(mc)}`, { cache: 'no-store' })
        if(res.status === 400 || res.status === 404) return [] // MC未対応
        if(!res.ok) throw new Error('Fabricローダー一覧の取得に失敗しました (' + res.status + ')')
        const body = await res.json()
        // body: [{ loader:{version,stable,...}, intermediary, launcherMeta }, ...]
        return (Array.isArray(body) ? body : [])
            .map(e => ({ version: e.loader.version, stable: !!e.loader.stable }))
    }

    async function fetchFabricProfile(mc, loader){
        const url = `${FABRIC_META}/v2/versions/loader/${encodeURIComponent(mc)}/${encodeURIComponent(loader)}/profile/json`
        const res = await fetch(url, { cache: 'no-store' })
        if(!res.ok) throw new Error('Fabricプロファイルの取得に失敗しました (' + res.status + ')')
        return await res.json()
    }
```

エクスポート行を `window.NLCustomVersions = { fetchReleaseVersions, fetchFabricLoaderVersions, fetchFabricProfile }` に更新する。

- [ ] **Step 2:** `npm run lint`（新規エラー無し）。
- [ ] **Step 3: 手動確認**：`npx electron . --disable-gpu` の DevTools で `await window.NLCustomVersions.fetchFabricLoaderVersions('1.20.1')` が配列を返し、`await window.NLCustomVersions.fetchFabricProfile('1.20.1', <その先頭version>)` が `mainClass`/`libraries` を含むことを確認。
- [ ] **Step 4:** commit `feat(custom): add Fabric Meta loader-list and profile fetchers`

---

## Task 2: Maven座標→パス／URL ヘルパ

**Files:**
- Create: `app/assets/js/scripts/customfabric.js`
- Modify: `app/app.ejs`（`customlaunch.js` の前に読み込み）

**Interfaces:**
- Produces（`window.NLCustomFabric`）:
  - `mavenToPath(name: string): string` — `group:artifact:version[:classifier]` → `group(スラッシュ化)/artifact/version/artifact-version[-classifier].jar`
  - `async installFabric(profile, commonDir, onProgress): Promise<{loaderPath, libEntries}>` — 後述（Task 3で実装。本タスクは `mavenToPath` のみ）。

- [ ] **Step 1: `app/assets/js/scripts/customfabric.js` を新規作成（mavenToPath のみ）**

```js
/**
 * Fabric install helpers for custom instances. window.NLCustomFabric.
 */
(function(){
    // 'net.fabricmc:fabric-loader:0.15.11' -> 'net/fabricmc/fabric-loader/0.15.11/fabric-loader-0.15.11.jar'
    function mavenToPath(name){
        const parts = name.split(':')
        const group = parts[0].replace(/\./g, '/')
        const artifact = parts[1]
        const version = parts[2]
        const classifier = parts.length > 3 ? '-' + parts[3] : ''
        return `${group}/${artifact}/${version}/${artifact}-${version}${classifier}.jar`
    }

    window.NLCustomFabric = { mavenToPath }
})()
```

- [ ] **Step 2: `app/app.ejs`** の `customlaunch.js` の直前に `<script src="./assets/js/scripts/customfabric.js"></script>` を追加。
- [ ] **Step 3:** `npm run lint`。
- [ ] **Step 4:** commit `feat(custom): add Fabric maven-path helper module`

---

## Task 3: Fabricライブラリのダウンロード＋疑似モジュール構築

**Files:**
- Modify: `app/assets/js/scripts/customfabric.js`

**Interfaces:**
- Consumes: `helios-core/dl` の `downloadFile`（`downloadFile(url, path, onProgress?)`）。`Type`（`helios-distribution-types`）。`mavenToPath`（Task 2）。
- Produces（`window.NLCustomFabric`）:
  - `async installFabric(profile, commonDir): Promise<Object>` — profile.libraries を全てDLし、**疑似 `Type.Fabric` モジュール**を返す（ProcessBuilder が `_resolveServerLibraries` で使う形）。

- [ ] **Step 1: `customfabric.js` にライブラリDL＋疑似モジュール構築を追加**

`require` を先頭に追加:
```js
    const path = require('path')
    const fs = require('fs-extra')
    const { downloadFile } = require('helios-core/dl')
    const { Type } = require('helios-distribution-types')
```

関数を追加:
```js
    function makeLibraryModule(name, jarPath){
        return {
            rawModule: { type: Type.Library, classpath: true },
            subModules: [],
            getVersionlessMavenIdentifier: () => {
                const [g, a] = name.split(':')
                return `${g}:${a}`
            },
            getPath: () => jarPath
        }
    }

    // Download every profile library into commonDir/libraries and build a
    // synthetic Type.Fabric module (loader) whose subModules are the libraries,
    // matching what ProcessBuilder._resolveServerLibraries expects.
    async function installFabric(profile, commonDir){
        const libDir = path.join(commonDir, 'libraries')
        const libs = Array.isArray(profile.libraries) ? profile.libraries : []
        const subModules = []
        let loaderModule = null
        for(const lib of libs){
            const rel = mavenToPath(lib.name)
            const dest = path.join(libDir, rel)
            if(!fs.existsSync(dest)){
                const base = (lib.url || 'https://maven.fabricmc.net/').replace(/\/$/, '')
                await downloadFile(`${base}/${rel}`, dest)
            }
            const mod = makeLibraryModule(lib.name, dest)
            subModules.push(mod)
            if(lib.name.startsWith('net.fabricmc:fabric-loader:')){
                loaderModule = { name: lib.name, path: dest }
            }
        }
        // The Type.Fabric (loader) module. If the loader jar wasn't in libraries
        // (it always is for Fabric), fall back to the first subModule.
        const loaderName = loaderModule ? loaderModule.name : (libs[0] && libs[0].name)
        const loaderPath = loaderModule ? loaderModule.path : (subModules[0] && subModules[0].getPath())
        return {
            rawModule: { type: Type.Fabric, classpath: true },
            subModules,
            getVersionlessMavenIdentifier: () => {
                const [g, a] = String(loaderName).split(':')
                return `${g}:${a}`
            },
            getPath: () => loaderPath
        }
    }
```

エクスポートを `window.NLCustomFabric = { mavenToPath, installFabric }` に更新。

> 注: Fabricのプロファイル `libraries` には fabric-loader 自体も含まれる（`net.fabricmc:fabric-loader:<ver>`）。ProcessBuilder は `Type.Fabric` モジュールの `getPath()`（ローダーjar）と、その `subModules`（各ライブラリ）を両方クラスパスに入れる。ローダーが subModules にも含まれるが重複は `getVersionlessMavenIdentifier` キーの上書きで実害なし。

- [ ] **Step 2:** `npm run lint`。
- [ ] **Step 3:** commit `feat(custom): download Fabric libraries and build synthetic Type.Fabric module`

---

## Task 4: launchCustomInstance を Fabric 対応に

**Files:**
- Modify: `app/assets/js/scripts/customlaunch.js`

**Interfaces:**
- Consumes: `window.NLCustomVersions.fetchFabricProfile`（Task 1）、`window.NLCustomFabric.installFabric`（Task 3）。

- [ ] **Step 1: `launchCustomInstance` に Fabric 分岐を追加**

現在（M1）は vanilla のみで `new ProcessBuilder(syntheticServer, versionData, null, ...)` を呼ぶ。これを、loaderに応じて modManifest と modules を変える形にする。`launchCustomInstance` 内、vanilla のダウンロード（MojangIndexProcessor）**後**、ProcessBuilder 構築の**前**に以下を挿入し、`buildSyntheticServer`／ProcessBuilder 引数を分岐する。

```js
        // Loader-specific setup.
        let modManifest = null
        let loaderModules = []
        if(instance.loader === 'fabric'){
            setLaunchDetails('Fabricを準備中...')
            const profile = await window.NLCustomVersions.fetchFabricProfile(instance.minecraftVersion, instance.loaderVersion)
            const fabricModule = await window.NLCustomFabric.installFabric(profile, commonDir)
            modManifest = profile          // has mainClass + arguments + libraries
            loaderModules = [fabricModule]  // Type.Fabric synthetic module
        }
```

`buildSyntheticServer(instance)` を、modules を受け取れるように変更（または launch 内で server.modules を差し込む）:
```js
        const syntheticServer = buildSyntheticServer(instance)
        syntheticServer.modules = loaderModules
        ...
        const pb = new ProcessBuilder(syntheticServer, versionData, modManifest, authUser, remote.app.getVersion())
```

（vanilla の場合は `modManifest=null`, `loaderModules=[]` のまま＝M1と同一挙動。）

- [ ] **Step 2:** `npm run lint`。
- [ ] **Step 3:** commit `feat(custom): launch Fabric custom instances via synthetic Type.Fabric module`

---

## Task 5: 作成フォームに Fabric を追加（ローダー版の動的取得）

**Files:**
- Modify: `app/overlay.ejs`（`#customCreateLoader` に fabric option）
- Modify: `app/assets/js/scripts/overlay.js`（ローダー選択でローダー版一覧を出す／作成時に loaderVersion を保存）

**Interfaces:**
- Consumes: `window.NLCustomVersions.fetchFabricLoaderVersions`（Task 1）。
- Produces: DOM `#customCreateLoaderVersion`（ローダー版select）。

- [ ] **Step 1: `overlay.ejs`** の `#customCreateLoader` に fabric を追加し、ローダー版 select を足す。

```html
            <select id="customCreateLoader">
                <option value="vanilla">なし（バニラ）</option>
                <option value="fabric">Fabric</option>
            </select>
        </div>
        <div class="customCreateField" id="customCreateLoaderVersionField" style="display:none;">
            <label for="customCreateLoaderVersion">ローダーバージョン</label>
            <select id="customCreateLoaderVersion"><option value="">選択してください</option></select>
        </div>
```

- [ ] **Step 2: `overlay.js`** の `openCustomInstanceCreate()` 末尾（版一覧ロード後）に、ローダー変更・MC変更で Fabric ローダー版を更新する処理を追加。

```js
    const loaderEl = document.getElementById('customCreateLoader')
    const loaderVerField = document.getElementById('customCreateLoaderVersionField')
    const loaderVerEl = document.getElementById('customCreateLoaderVersion')
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
        } else {
            if(loaderVerField) loaderVerField.style.display = 'none'
        }
    }
    if(loaderEl) loaderEl.onchange = refreshLoaderVersions
    const mcEl2 = document.getElementById('customCreateMcVersion')
    if(mcEl2) mcEl2.onchange = () => { if(loaderEl && loaderEl.value === 'fabric') refreshLoaderVersions() }
```

- [ ] **Step 3: 作成確定ハンドラ** で loaderVersion を保存し、Fabric選択時は版必須にする。`#customCreateConfirm` の click 内、instance 構築前に:

```js
    const loader = document.getElementById('customCreateLoader').value || 'vanilla'
    let loaderVersion = ''
    if(loader === 'fabric'){
        loaderVersion = document.getElementById('customCreateLoaderVersion').value
        if(!loaderVersion){
            setOverlayContent('未選択', 'Fabricローダーのバージョンを選んでください。', 'OK')
            setOverlayHandler(null); toggleOverlay(true); return
        }
    }
```
そして instance オブジェクトの `loader`/`loaderVersion` にこれらを使う（既存の固定 `loader` 読み取りを置換）。

- [ ] **Step 4:** `npm run lint`。
- [ ] **Step 5:** commit `feat(custom): add Fabric option and loader-version picker to create form`

---

## Task 6: 手動統合確認（Fabric起動）★実機の受け入れ基準

**Files:** なし（手動）

- [ ] **Step 1:** `npx electron . --disable-gpu`（ログイン済みアカウント必須）
- [ ] **Step 2:** 自作タブ→新規作成→MC 1.20.1、ローダー=Fabric、ローダー版（先頭）を選び作成→選択→PLAY。
- [ ] **Step 3:** 期待：バニラDL→FabricライブラリDL→**FabricのMinecraftが起動**（ログに Fabric/Knot 系や `Sound engine started`）。
- [ ] **Step 4:** 失敗時は `[renderer] console-message` とエラー画面のログ出力で確認し、以下の結合点を調整:
  - profile.libraries の `url` 欠落ライブラリ（Mojang提供分など）の base URL 補完。
  - クラスパスに fabric-loader/intermediary/クライアントjar が揃っているか（`classpathArg`＋`_resolveServerLibraries` の結果）。
  - `modManifest.arguments`（Fabricの追加game/jvm引数）が ProcessBuilder に取り込まれているか。
  > M1同様、疑似モジュールの微調整（`getVersionlessMavenIdentifier`/`getPath`/`subModules`）で起動成功に持ち込む（起動成功が受け入れ基準）。
- [ ] **Step 5:** バニラ(既存M1)が引き続き起動できることも確認（回帰なし）。

---

## 自己レビュー結果

- **スペック(section D)網羅**: Fabric Meta 取得=Task1、maven→path=Task2、ライブラリDL＋疑似モジュール=Task3、起動統合=Task4、作成フォーム=Task5、実機確認=Task6。
- **プレースホルダ**: 具体コードを記載。Task6は実機結合調整を含むが対象点と受け入れ基準（Fabric起動成功）を明示。
- **型/識別子整合**: `window.NLCustomVersions.{fetchFabricLoaderVersions,fetchFabricProfile}`（Task1→Task4/5）、`window.NLCustomFabric.{mavenToPath,installFabric}`（Task2/3→Task4）、疑似モジュールIF（`rawModule.type`,`getVersionlessMavenIdentifier`,`getPath`,`subModules`,`rawModule.classpath`）が ProcessBuilder の呼び出し（`_resolveServerLibraries`/`_resolveModuleLibraries`/`classpathArg`）と一致。DOM id `#customCreateLoaderVersion*` は Task5内で一致。
- **無改造方針**: ProcessBuilder は変更しない（`usingFabricLoader` 経路＋`Type.Fabric` 分岐を疑似モジュールで満たす）。M1のクライアントjar修正（`!hasModLoader`）は Fabric では usingFabricLoader 側の既存条件で担保。
- **リスク**: Fabricライブラリの `url`/パス解決とProcessBuilderのモジュールIF適合が実機調整ポイント（M1の起動同様、runtimeで詰める）。
