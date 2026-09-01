# 起動構成の共有（④ 自己完結コード）設計

- 日付: 2026-09-01
- 対象: NumapoteLauncher (沼ぽてランチャー)
- 目的: 自作/modpackインスタンスの起動構成を、サーバー不要の**自己完結コード/URL**で共有・受け取り
  できるようにする（非リアルタイム）。受け取り側はコードを貼り付けるとインスタンスを復元する。
- スコープ: ④の第一段。伝送は自己完結コード（`zlib`+base64url）。OSの `numapote://` deep-link登録
  （リンクのダブルクリックでアプリ起動）は将来。

## 決定事項（確定済み）

1. 伝送は自己完結コード（サーバー不要）。コードと `numapote://share/<code>` URL の両方を提示し、
   貼り付けはどちらも受理する。
2. 共有内容: name/mc/loader/loaderVersion＋`modpack`（provider/projectId/versionId、ある場合）＋
   `mods`（`.numapote-mods.json` 由来の出所ありMOD、modpack管理分は除く）。
3. 出所不明jar（manifestにもmanagedFilesにも無い手動jar）は、**共有時に「はい/いいえ」**で中身を埋め込むか
   選べる（名前一覧表示）。受け取り時も**「はい/いいえ」**で配置するか選べる（名前一覧表示）。
4. 復元先は `instances/<id>` 配下限定（パストラバーサル検証）。

## 背景（現状のアーキテクチャ）

- 自作インスタンスは `ConfigManager.addCustomInstance/updateCustomInstance/getCustomInstance`。
  フィールド: `{schema, id, name, minecraftVersion, loader, loaderVersion, created, lastPlayed,
  modpackSource?, managedFiles?}`。
- 導入済みMOD記録 `.numapote-mods.json`（`instances/<id>/.numapote-mods.json`）は
  キー＝projectId（modrinth）/`cf:`+modId（curseforge）、値＝`{slug, title, versionId, versionNumber,
  datePublished, files:[fileName], source}`。versionId は heuristic 検出だと null。
- modpack取り込みは [modpackimport.js](../../../app/assets/js/scripts/modpackimport.js)
  `NLModpack.importModpack(provider, hit, file, onProgress, token, nameOverride)`（インスタンス生成＋
  パックMOD/overrides/managedFiles）。版一覧は各APIの `getModpackVersions(projectId)`。
- MOD検索/版は [modrinth.js](../../../app/assets/js/scripts/modrinth.js) `NLModrinth`
  （`getBestVersion`, `collectRequired`）と [curseforge.js](../../../app/assets/js/scripts/curseforge.js)
  `NLCurseForge`（`getBestVersion`, `collectRequired`, `resolveFiles`, `_mapFile`）。
- ドロップインMODは `DropinModUtil.scanForDropinMods(modsDir, mc)`（`{fullName,...}`）。
- オーバーレイは `setOverlayContent(title, desc, ack, dismiss)` ＋ `setOverlayHandler`/`setDismissHandler`
  ＋ `toggleOverlay(true, true)` で「はい/いいえ」を表現できる。
- `require('electron').clipboard.writeText` でコピー可能。`require('zlib')` 利用可。

## 変更詳細

### A. `getVersionById`（各APIに追加）

- `modrinth.js getVersionById(versionId)`: `GET /version/<id>` → `{versionId:v.id, versionNumber,
  datePublished, files:[{filename,url}], dependencies:[{dependency_type, project_id}]}`（`getBestVersion`
  と同形）。失敗/未存在は null。
- `curseforge.js getVersionById(fileId)`: `POST /mods/files {fileIds:[fileId]}` → `_mapFile(data[0])`。
  無ければ null。
- 両 `window.NL*` の公開に追加。

### B. `share.js`（新規 `window.NLShare`）

- `const PREFIX = 'NLPACK1'`。`encode(obj)` = base64url(`zlib.deflateSync(JSON.stringify(obj))`)、
  `decode(str)` = `JSON.parse(zlib.inflateSync(base64urlDecode(str)))`。base64url は `+/=`→`-_`除去で相互変換。
- `collectUnknownJars(instanceId) → [{name, path, size}]`:
  - `modsDir = instances/<id>/mods`、`DropinModUtil.scanForDropinMods` で列挙。
  - `manifest = .numapote-mods.json` の全 `files` を集合化、`managed = managedFiles` 集合。
  - `mods/<fullName(.disabled除去)>` が manifest.files にも managed にも無いものを unknown とする。
- `buildShareCode(instanceId, includeRawJars) → { code, url }`:
  1. `ins = getCustomInstance(id)`。payload `{ v:1, name, mc, loader, loaderVersion }`。
  2. `ins.modpackSource` があれば `payload.modpack = {provider, projectId, versionId}`。
  3. `.numapote-mods.json` の各エントリで、その `files` が managedFiles に含まれない（＝ユーザー追加）ものを
     `payload.mods.push({ source, projectId:(キーから'cf:'除去), versionId, slug })`。
  4. `includeRawJars` なら `collectUnknownJars` の各jarを読み `payload.rawMods.push({ name, data:base64 })`。
  5. `code = PREFIX + encode(payload)`、`url = 'numapote://share/' + code`。
- `decodeShareCode(text) → payload`:
  - 先頭の `numapote://share/` を除去、`PREFIX` を検証・除去、`decode`。`payload.v !== 1` はエラー。
- `importShareCode(payload, opts, onProgress, token) → { id, name, failed }`:
  1. 対応ローダー検証（fabric/forge のみ、それ以外はエラー）。
  2. `payload.modpack` あり: `getModpackVersions(projectId)` で `versionId` の file を探し
     `NLModpack.importModpack(provider, {projectId, title:payload.name}, file, onProgress, token, payload.name)`。
     → `id`。無ければ `id=genId()` で `addCustomInstance({...payload..., modpackSource:undefined})`。
  3. `instDir = instances/<id>`、`modsDir = instDir/mods`。
  4. `payload.mods` 各件: `api=source別`、`version = await api.getVersionById(versionId) ||
     await api.getBestVersion(projectId, mc, loader)`。null は `failed`。`collectRequired(version, mc, loader)`
     → 各 `f.url` を `modsDir/f.filename` に `downloadFile`（`underDir` 検証）。primaryを `.numapote-mods.json`
     に記録（`_mrKey` 相当のキー）。`onProgress(i, N)`。
  5. `opts.includeRaw && payload.rawMods`: 各 `{name, data}` を `modsDir/name`（`underDir` 検証）へ
     `Buffer.from(data,'base64')` で書き出し。
  6. `{ id, name:payload.name, failed }`。

### C. UI（`overlay.ejs` / `overlay.js` / `launcher.css` / `app.ejs`）

- **共有ボタン**（各行）: `customInstanceActions` に `<button class="customShare" cid="…">共有</button>` を追加。
  ハンドラ: `collectUnknownJars` → 未知jarあれば `setOverlayContent('確認','出所不明のMOD（N件）も共有しますか?\n<names>','はい','いいえ')`＋handlers → `buildShareCode(id, yes)` → `#shareCodeContent` を開き code/url を表示。
- **`#shareCodeContent` オーバーレイ**（新規）: ヘッダ＋読み取り専用 `textarea#shareCodeText`＋「コピー」ボタン
  `#shareCodeCopy`（`clipboard.writeText`）＋閉じる。
- **受け取りボタン**: `#customCreateButtons` に `<button id="customReceiveButton">コードで受け取り</button>` 追加。
  → `#shareImportContent` オーバーレイ（`textarea#shareImportText`＋取り込み`#shareImportBtn`＋キャンセル）。
- **取り込みハンドラ**: `decodeShareCode` → 失敗は表示。`rawMods` あれば「はい/いいえ」確認 → 進捗表示
  （`#shareImportProgress` の簡易テキスト）で `importShareCode` → 完了で `failed` 警告 → 自作タブへ。
- CSS: `#shareCodeContent`/`#shareImportContent`（460px 前後、既存オーバーレイに準拠）、textarea・ボタン。
- `app.ejs`: `share.js` を include（`modpackimport.js` の後）。

## セキュリティ / 前提

- DL元は Modrinth/CurseForge のみ。ファイル配置・書き出しは `instances/<id>` 配下限定
  （`path.normalize` 検証、`..` 拒否）。`rawMods` の `name` は basename のみ許可（パス区切りを含むものは拒否）。
- 共有コードは構成参照＋（任意で）jarバイト列のみ。認証情報は含めない。

## スコープ外（将来）

- `numapote://` のOS deep-link登録（リンクのダブルクリック起動）。
- サーバー発行の短いID。
- 巨大 rawMods の圧縮改善（現状は zlib のみ、jarは非圧縮的で大きくなり得る）。

## エラー / 前提

- コード不正/デコード失敗/`v` 不一致/未対応ローダー → 表示して中止。
- MOD取得不可・配布不可 → `failed` 一覧警告（インスタンスは作成）。
- `rawMods` の不正名（`..`/区切り含む）→ そのjarをスキップ。

## テスト観点（実機DIAG）

1. `buildShareCode`→`decodeShareCode` ラウンドトリップでペイロードが一致。
2. `collectUnknownJars` が手動配置jarを検出、manifest/managed分は含めない。
3. 往復: 追跡MOD＋手動jarを持つインスタンス → `buildShareCode(true)` → `decode` → `importShareCode(includeRaw)`
   → 新インスタンスがMC/ローダー一致、追跡MODがDL済み、手動jarが配置される。
4. 共有ボタンでコード画面が出る／受け取りボタンで貼り付け→取り込みが動く。
5. modpackインスタンスの往復でパック再取り込み＋ユーザー追加MOD復元。
6. lint 増加なし（基準21）。

## 実装順

1. `modrinth.js`/`curseforge.js`: `getVersionById`。
2. `share.js`: collectUnknownJars/buildShareCode/decodeShareCode/importShareCode。
3. UI: 共有ボタン＋`#shareCodeContent`、受け取りボタン＋`#shareImportContent`、CSS、app.ejs。
4. 実機で往復を検証、仕上げ。
