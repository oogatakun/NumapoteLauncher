# モッドパックのバージョン更新・ダウングレード設計

- 日付: 2026-09-01
- 対象: NumapoteLauncher (沼ぽてランチャー)
- 目的: 取り込んだ Modrinth モッドパック（自作インスタンス）のバージョンを、後から
  **更新（新しい版）／ダウングレード（古い版）**に入れ替えられるようにする。
- スコープ: Modrinth の `.mrpack` で取り込んだインスタンスのみ。入れ替えは
  **パックが配置したファイル（managedFiles）だけ**を対象にし、ユーザーが後から追加した
  MOD は保持する。

## 決定事項（確定済み）

1. 入れ替えは **パック管理分のみ**（`managedFiles` で追跡）。ユーザー追加MODは残す。
2. 取り込み時にインスタンスへ `modpackSource`（provider/projectId/versionId）と
   `managedFiles`（配置した相対パス一覧）を記録する。
3. 版変更で **MC・ローダーも新版に合わせて更新**（ダウングレードでMCが変わる場合も反映）。
4. 新版が未対応ローダー（Quilt/NeoForge）なら検証時点で中止（旧状態保持）。
5. `modpackSource` の無い既存インスタンス（本機能以前の取り込み）は対象外（ボタン非表示）。

## 背景（現状のアーキテクチャ）

- 取り込みは [modpackimport.js](../../../app/assets/js/scripts/modpackimport.js)
  `importModrinthModpack(hit, file, onProgress)`。`.mrpack` をDL・解析し、`modrinth.index.json`
  から MC/ローダーを判定して自作インスタンスを登録、`instances/<id>/` に MOD と overrides を配置。
  現状 **source/managedFiles を記録していない**。
- バージョン一覧は [modrinth.js](../../../app/assets/js/scripts/modrinth.js) `getModpackVersions(projectId)`
  → `[{versionId, versionNumber, gameVersions, loaders, datePublished, file:{url,filename,versionId}}]`。
- 版選択UIは [overlay.js](../../../app/assets/js/scripts/overlay.js) の `openModpackVersions(hit)`
  （MC/版ドロップダウン→`importModpackVersion`）。一覧描画は `populateCustomInstanceListings`、
  行操作は `setCustomInstanceHandlers`（フォルダ/削除）。
- インスタンス更新は `ConfigManager.updateCustomInstance(id, patch)`（Object.assign マージ）。

## 変更詳細

### A. `modpackimport.js` の再構成

- `_downloadMrpack(file, commonDir) → mrpackPath`: `commonDir/temp/<slug-versionId>.mrpack` にDL（未取得なら）。
- `_readMrpackMeta(mrpackPath) → { mc, loader, loaderVersion }`: `modrinth.index.json` を読み
  `dependencies` から判定。`quilt-loader`/`neoforge` は `throw`、`minecraft` 無しも `throw`。
- `_applyMrpack(mrpackPath, instDir, onProgress) → { managedFiles, failed }`:
  - `index.files`（`env.client === 'unsupported'` は除外）を `instDir/<path>` にDL。
  - `overrides/**`・`client-overrides/**` を `instDir/` に展開。
  - 配置した相対パス（forward-slash）を `managedFiles` に集める。DL失敗は `failed` に。
  - すべて `underDir(instDir, dest)` 検証（`..` 拒否）。
- `importModrinthModpack(hit, file, onProgress) → { id, name, fileCount, failed }`:
  1. `file` 未指定なら `getModpackVersions` の先頭。
  2. `_downloadMrpack` → `_readMrpackMeta`（未対応なら中止・インスタンス未作成）。
  3. `ConfigManager.addCustomInstance({schema:1, id, name, minecraftVersion:mc, loader,
     loaderVersion, created, lastPlayed:null, modpackSource:{provider:'modrinth',
     projectId:hit.projectId, versionId:file.versionId}})` ＋ save。
  4. `_applyMrpack` → `updateCustomInstance(id, {managedFiles})` ＋ save。
- `changeModpackVersion(instanceId, file, onProgress) → { id, fileCount, failed }`（新規）:
  1. インスタンス取得（無ければ throw）。
  2. `_downloadMrpack` → `_readMrpackMeta`（新版検証。未対応なら中止・旧状態保持）。
  3. **旧 `managedFiles` を削除**: 各 rel を `instDir/rel` にし、`underDir` かつ存在すれば `fs.removeSync`。
  4. `_applyMrpack` で新版配置。
  5. `updateCustomInstance(instanceId, { minecraftVersion:mc, loader, loaderVersion,
     managedFiles, modpackSource: {...old, versionId:file.versionId} })` ＋ save。
- 公開: `window.NLModpack = { importModrinthModpack, changeModpackVersion }`。

### B. `overlay.js` UI

- `openModpackVersions(hit, opts = {})` に拡張:
  - `opts.currentVersionId`: 一覧で該当版を「(現在)」表示、初期選択を現在のMC・版に合わせる。
  - `opts.onImport(version)`: 「導入/適用」押下時の処理（未指定＝`importModpackVersion(hit, version)`）。
  - `opts.onBack()`: 「戻る」の処理（未指定＝`runModpackSearch()`）。
  - `opts.importLabel`: ボタン文言（既定「導入」）。
- `openModpackVersionChange(instanceId)`:
  - `ins.modpackSource` を読み、`toggleOverlay(true, true, 'modpackContent')` 後
    `openModpackVersions({projectId:src.projectId, title:ins.name}, { currentVersionId:src.versionId,
    importLabel:'適用', onImport:(v)=>changeModpackVersion(instanceId, v),
    onBack:()=>toggleServerSelection(true).then(()=>setServerTab('custom')) })`。
- `changeModpackVersion(instanceId, version)`（UIラッパ）: 進捗表示→`NLModpack.changeModpackVersion`→
  完了で「自作」タブへ。`failed` 警告・失敗時再試行。
- `populateCustomInstanceListings`: `ins.modpackSource` がある行のみ、アクションに
  `<button class="customModpackVersion" cid="…" type="button">版変更</button>` を先頭追加。
- `setCustomInstanceHandlers`: `.customModpackVersion` に `openModpackVersionChange(cid)` を紐付け
  （`e.stopPropagation()`）。

### C. CSS

- `.customModpackVersion` は既存の `.customInstanceActions button` スタイルを流用（追加最小限）。

## セキュリティ / 前提

- DL元は Modrinth CDN / API のみ。配置・削除は `instances/<id>` 配下に限定（`path.normalize` 検証）。
- 削除は `managedFiles` に列挙された相対パスのみ（ユーザー追加分は触らない）。

## スコープ外（将来）

- CurseForge モッドパックの版変更（取り込み自体が未対応）。
- overrides のユーザー編集の保護（版変更で overrides は新版で上書き）。
- MOD 単位の差分更新（現状は managedFiles 一括入れ替え）。

## エラー / 前提

- 通信失敗 / index不正 / 未対応版 → 表示して中止（旧状態保持）。
- 一部ファイルDL失敗 → 取得分で適用し失敗名を警告。

## テスト観点（実機DIAG／既存手法。lint＋実機DIAGで検証）

1. 取り込み後、インスタンスに `modpackSource`（projectId/versionId）と `managedFiles` が記録される。
2. modpack由来の行に「版変更」ボタンが出る。非modpackインスタンスには出ない。
3. 版変更で別MC/版に切替 → 旧managedFiles削除・新版配置、`minecraftVersion`/`loader`/`loaderVersion`/
   `modpackSource.versionId`/`managedFiles` が更新される。
4. ユーザーが手動追加したMOD（managedFiles外の `mods/*.jar`）が版変更後も残る。
5. 未対応版（Quilt/NeoForge）への変更は中止・表示（旧状態保持）。
6. lint 増加なし（基準21）。

## 実装順

1. `modpackimport.js`: メタ/適用の分離＋`modpackSource`/`managedFiles`記録＋`changeModpackVersion`。
2. `overlay.js`: `openModpackVersions` opts化＋「版変更」ボタン＋ハンドラ＋`openModpackVersionChange`＋
   `changeModpackVersion` ラッパ。
3. CSS（必要なら）。
4. 実機で 取り込み→版変更（更新・ダウングレード）→ユーザーMOD保持 を検証。
