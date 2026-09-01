# CurseForge モッドパック導入（M-Pack2a）設計

- 日付: 2026-09-01
- 対象: NumapoteLauncher (沼ぽてランチャー)
- 目的: CurseForge のモッドパックをランチャー内で検索し、選択すると MC・ローダー・全MOD が
  揃った自作インスタンスを生成できるようにする。既存の Modrinth モッドパック取り込み／版変更
  （managedFiles）と統合し、モッドパック検索UIに Modrinth/CurseForge のソース切替を追加する。
- スコープ: **M-Pack2a**。配布不可ファイル（`downloadUrl` が null）は一覧で警告する（暫定）。
  ランチャー内ブラウザでの自動DLは **M-Pack2b** で別途対応する。対応ローダーは Fabric / Forge のみ。

## 決定事項（確定済み）

1. CurseForge モッドパックは `classId=4471`。版のファイル（modpack zip）を解析して取り込む。
2. `manifest.json` から MC・ローダー・`files[{projectID,fileID}]`・`overrides` を得る。
   `fileID` は CurseForge API の一括エンドポイントで DL URL を解決する。
3. 配布不可ファイル（`downloadUrl` null）は取得分だけ導入し、**一覧で警告**（M-Pack2a）。
4. モッドパック検索オーバーレイに **Modrinth/CurseForge トグル**を追加（Mod追加UIと同様）。
5. 取り込み・版変更は provider（'modrinth'|'curseforge'）で分岐。managedFiles/modpackSource は共通。

## 背景（現状のアーキテクチャ）

- Modrinth モッドパック取り込みは [modpackimport.js](../../../app/assets/js/scripts/modpackimport.js)
  `importModrinthModpack` ＋ `changeModpackVersion`。インスタンスに `modpackSource`
  （provider/projectId/versionId）と `managedFiles`（配置相対パス）を記録し、版変更では managed 分
  のみ入れ替える。
- 版選択UIは [overlay.js](../../../app/assets/js/scripts/overlay.js) `openModpackVersions(hit, opts)`
  （MC/版ドロップダウン、`opts.onImport`/`onBack`/`currentVersionId`/`importLabel`）。検索は
  `openModpackSearch`/`runModpackSearch`（`#modpackContent` オーバーレイ、`window.NLModrinth.searchModpacks`）。
- CurseForge クライアント [curseforge.js](../../../app/assets/js/scripts/curseforge.js)
  （`window.NLCurseForge`）は `apiKey()`/`hasKey()`/`getJson`（GETのみ）を持つ。Mod検索/版/依存解決は
  Modrinth と同形に正規化済み。
- Mod追加UIの Modrinth/CurseForge トグルは `.serverTab` を流用（[settings.js](../../../app/assets/js/scripts/settings.js) 参照）。
- `node-stream-zip` 利用可。`downloadFile`（helios-core/dl）で保存。

### CurseForge modpack の構造

- モッドパックの版ファイルは zip。中に `manifest.json` ＋ `overrides/`。
- `manifest.json`（例）:
  ```json
  { "minecraft": { "version": "1.20.1", "modLoaders": [{"id":"forge-47.2.0","primary":true}] },
    "manifestType": "minecraftModpack", "name":"…", "version":"…",
    "files": [{"projectID":238222,"fileID":4712664,"required":true}],
    "overrides": "overrides" }
  ```
- `modLoaders[].id` は `forge-<ver>` / `fabric-<ver>` / `quilt-<ver>` / `neoforge-<ver>`。
- `files[].fileID` は `POST /v1/mods/files {fileIds:[…]}` で `{id, modId, fileName, downloadUrl}` に解決。
  `downloadUrl` が null＝配布不可（作者がサードパーティDL拒否）。
- 版一覧の各ファイルの `gameVersions` は MC文字列とローダー名（"Forge"/"Fabric"）が混在。

## 変更詳細

### A. `curseforge.js`

- `postJson(pathAndQuery, body)`: `getJson` と同様だが `method:'POST', json:body`。403/429/非2xx を同様に処理。
- `searchModpacks(query, limit=20)`:
  `GET /mods/search?gameId=432&classId=4471&searchFilter=<q>&sortField=2&sortOrder=desc&pageSize=<n>`
  → `(body.data||[]).map(_mapHit)`（既存の `_mapHit`）。
- `getModpackVersions(projectId)`:
  `GET /mods/<id>/files?pageSize=50` → 各 file を
  `{ versionId:String(f.id), versionNumber:(f.displayName||f.fileName),
     gameVersions:(f.gameVersions||[]).filter(v=>/^\d/.test(v)),
     loaders:(f.gameVersions||[]).filter(v=>!/^\d/.test(v)),
     datePublished:f.fileDate, file:{ url:f.downloadUrl, filename:f.fileName, versionId:String(f.id) } }`。
  `fileDate` 降順。
- `resolveFiles(fileIds)`:
  `POST /mods/files` body `{ fileIds: fileIds.map(Number) }` → `{ [String(id)]: { fileName, downloadUrl } }`。
- 公開に `searchModpacks, getModpackVersions, resolveFiles, postJson` を追加。

### B. `modpackimport.js`（provider 対応化）

- 既存 `_downloadMrpack` を `_downloadArchive(file, commonDir)` にリネーム（拡張子は `.pack` 汎用でよい。
  実体は .mrpack か CF zip）。
- `_readMeta(provider, archivePath) → { mc, loader, loaderVersion, name }`:
  - `modrinth`: 既存 `modrinth.index.json` 解析。
  - `curseforge`: `manifest.json` を読み、`minecraft.version`＝mc、`modLoaders`（`primary` 優先、無ければ[0]）の
    `id` を最初の `-` で分割 → loader名/loaderVersion。`quilt`/`neoforge` は未対応エラー。`name`＝manifest.name。
- `_apply(provider, archivePath, instDir, onProgress) → { managedFiles, failed }`:
  - `modrinth`: 既存（files DL＋overrides）。
  - `curseforge`:
    1. `manifest.files` の `fileID` を集め `NLCurseForge.resolveFiles` で一括解決。
    2. 各 file: 解決結果に `downloadUrl` があれば `instDir/mods/<fileName>` にDL（`underDir` 検証、既存はスキップ）、
       `managedFiles.push('mods/'+fileName)`。null や解決不可は `failed.push(fileName||('fileID '+fileID))`。
    3. zip の `<overrides>/**`（manifest.overrides、既定 'overrides'）を instDir に展開、`managedFiles` に追加。
    4. 進捗 `onProgress(i, total)`。
- `importModpack(provider, hit, file, onProgress)`（旧 `importModrinthModpack` を一般化）:
  1. `file` 未指定なら `_mpApi(provider).getModpackVersions(hit.projectId)[0].file`（このAPI参照は modpackimport 側では
     `window.NLModrinth`/`window.NLCurseForge` を provider で選ぶ小関数 `_api(provider)`）。
  2. `_downloadArchive` → `_readMeta`（未対応は中止・インスタンス未作成）→ `addCustomInstance`
     （`modpackSource:{provider, projectId:hit.projectId, versionId:file.versionId}`）→ `_apply` →
     `updateCustomInstance(id,{managedFiles})`。
  3. 返り値 `{ id, name, fileCount, failed }`。
- `changeModpackVersion(instanceId, file, onProgress)`:
  `provider = ins.modpackSource.provider`。`_downloadArchive`→`_readMeta`（新版検証）→ 旧 managedFiles 削除 →
  `_apply` → `updateCustomInstance`（mc/loader/loaderVersion/managedFiles/modpackSource.versionId 更新）。
- 公開: `window.NLModpack = { importModpack, changeModpackVersion }`。

### C. `overlay.js` / `overlay.ejs` / CSS（ソース切替）

- overlay.ejs: `#modpackContent` に `#modpackSourceToggle`（`.serverTab` の
  `data-source="modrinth"`（selected）/`"curseforge"`）を検索バーの上に追加。
- overlay.js:
  - `let currentModpackSource = 'modrinth'`、`_mpApi(source)`＝`source==='curseforge'?NLCurseForge:NLModrinth`。
  - `openModpackSearch()`: トグル初期化→`runModpackSearch()`。
  - `runModpackSearch()`: `currentModpackSource` で分岐。CurseForge かつ `!NLCurseForge.hasKey()` は
    「CurseForge利用不可（APIキー未設定）」表示。結果行「選択」→`openModpackVersions(h, {source:currentModpackSource})`。
  - トグルボタン: クリックで `currentModpackSource` 更新＋`runModpackSearch()`。
  - `openModpackVersions(hit, opts)`: `opts.source`（既定 'modrinth'）で `_mpApi(source).getModpackVersions`。
    `onImport` 既定は `importModpackVersion(hit, version, opts.source)`。
  - `importModpackVersion(hit, version, source)`: `NLModpack.importModpack(source, hit, version.file, …)`。
  - `openModpackVersionChange(instanceId)`: `src.provider` を `opts.source` に渡す。`changeModpackVersion`
    （UIラッパ）はそのまま（内部で provider 解決）。
- CSS: `#modpackSourceToggle { display:flex; gap:6px; margin-bottom:12px; }`（`.serverTab` は既存）。

## セキュリティ / 前提

- DL元は CurseForge API（`api.curseforge.com`）と CDN のみ。APIキーはログに出さない。
- 配置・削除は `instances/<id>` 配下限定（`path.normalize` 検証、`..` 拒否）。

## スコープ外（将来）

- 配布不可ファイルのランチャー内ブラウザ自動DL = **M-Pack2b**。
- Quilt / NeoForge モッドパック。

## エラー / 前提

- CurseForgeキー未設定 → 検索/版取得で利用不可表示。
- zip DL失敗 / manifest不正 / 未対応ローダー → 表示して中止（旧状態保持）。
- 配布不可・一部DL失敗 → 取得分で作成し `failed` を警告一覧。

## テスト観点（実機DIAG／既存手法。lint＋実機DIAG）

1. `NLCurseForge.searchModpacks('all the mods')` が modpack のみ返す。
2. モッドパックオーバーレイに Modrinth/CurseForge トグルが出て、切替で CurseForge の結果が出る
   （キーありの場合）。
3. `NLCurseForge.getModpackVersions(<id>)` が MC・版・file を返す。
4. CurseForge modpack 取り込み: manifest解析→`resolveFiles`→mods配置→overrides→インスタンス生成
   （`modpackSource.provider='curseforge'`・managedFiles）。配布不可があれば `failed` に出る。
5. 取り込んだCFパックの版変更が動く（provider分岐、managed入れ替え）。
6. Modrinth モッドパック（既存）に回帰なし。
7. lint 増加なし（基準21）。

## 実装順（M-Pack2a）

1. `curseforge.js`: `postJson`・`searchModpacks`・`getModpackVersions`・`resolveFiles`。
2. `modpackimport.js`: `_readMeta`/`_apply` provider対応＋`importModpack`一般化＋`changeModpackVersion` provider分岐。
3. `overlay.js`/`overlay.ejs`/CSS: モッドパックのソーストグル＋`_mpApi`＋source対応。
4. 実機で CurseForge検索→取り込み→版変更 を検証、仕上げ。
