# ③ 外部導入（CurseForge）機能の設計

- 日付: 2026-08-31
- 対象: NumapoteLauncher (沼ぽてランチャー)
- 目的: 選択中のパック（公式・自作の両方）に対して、**CurseForge** から MOD を検索して
  導入できるようにする。Modrinth に続く「第二のソース」であり、既存の Modrinth 導入UIと
  **統合された1つのオーバーレイ**にソース切替トグルで同居させる。導入は選択中パックの
  `mods` フォルダ（ドロップインMOD）に落とし、既存の設定「Mod」タブで管理する。
  **必須依存(required dependencies)は自動で一緒に導入**する。
- スコープ: 本仕様は **③のうち CurseForge のみ**。既存の Modrinth 実装
  （[modrinth.js](../../../app/assets/js/scripts/modrinth.js)、
  [settings.js](../../../app/assets/js/scripts/settings.js) の検索/導入UI）を土台に一般化する。
  CurseForge の「モッドパック(.zip/manifest) 一括導入」は含めない（個別MODのみ）。

## 決定事項（確定済み）

1. **APIキー方式は「PrismLauncher方式」**: キーはアプリに同梱するが公開ソースには含めない。
   加えて利用者が設定で自分のキーを入れられる（二段構え）。
2. **キー解決の優先順位**: ①利用者が入力したキー → ②同梱キー → ③どちらも空なら CurseForge を無効化。
3. **UIは統合オーバーレイ**: 既存の Modrinth オーバーレイを汎用化し、上部に
   「Modrinth / CurseForge」切替トグルを置く。導線ボタンは「Modrinthから追加」「CurseForgeから追加」の2つ。
4. **導入対象は個別MOD**（＋**必須依存の自動解決**）。任意依存(optional)は自動導入しない。
5. **配布不可MOD**（`downloadUrl===null`）は自動DLせず「CurseForgeで開く」で既定ブラウザに誘導（規約準拠）。
6. 導入先は**選択中パックの `mods` フォルダ**（ドロップイン）。公式・自作の両方で使える。

## 背景（現状のアーキテクチャ）

- Modrinth 導入は 3 層で実装済み:
  - [modrinth.js](../../../app/assets/js/scripts/modrinth.js): `window.NLModrinth = { search, getBestVersion, collectRequired }`。
    `got`（User-Agent 必須のため fetch 不可）で公開APIを叩く。
  - [settings.js](../../../app/assets/js/scripts/settings.js): 検索UI（`openModrinthSearch` /
    `runModrinthSearch` / `_mrRenderActions` / `addModrinthMod` / `removeModrinthMod` /
    `updateModrinthMod`）と、導入済み管理 manifest（`_mrReadManifest` ほか）。
  - [overlay.ejs](../../../app/overlay.ejs) の `#modrinthContent`（`#modrinthSearchInput` /
    `#modrinthSearchButton` / `#modrinthResults` / `#modrinthCancel`）と、
    [launcher.css](../../../app/assets/css/launcher.css) の `.modrinthResult` 系スタイル。
- 導入先コンテキストは `getModTargetContext()` が返す `{ id, mc, loader, modsDir }`
  （公式パックは modules から forge/fabric 判定、自作は `ConfigManager.getCustomInstance`）。
- 導入済み管理 manifest は `instances/<id>/.numapote-mods.json`。現状 Modrinth の projectId を
  そのままキーにし、各エントリは `{ slug, title, versionId, versionNumber, datePublished, files:[ownFilename] }`。
  ファイル存在チェック＋slug一致フォールバックで導入済みを判定する。
- ダウンロードは helios-core の `downloadFile(url, path)`。削除は `DropinModUtil.deleteDropinMod`
  （ゴミ箱送り・復元可能）。

## 採用アプローチ

CurseForge の REST API（`https://api.curseforge.com/v1`、`x-api-key` ヘッダ必須）を用いる。
`curseforge.js` を新設し、**Modrinth モジュールと同じ関数シグネチャ・同じ返り値形状**に正規化する
ことで、settings.js 側の検索・導入ロジックを「ソース引数でAPIオブジェクトを差し替えるだけ」で
共用できるようにする。UIは既存オーバーレイを汎用化してトグルで両ソースを同居させる。

## 変更詳細

### A. APIキーの同梱と設定

- **新規（gitignore）** `app/assets/js/cfapikey.js`: `module.exports = '<実キー>'`。
  同梱ビルドにのみ実キーを入れる。`.gitignore` に追加し公開ソースに出さない。
- **新規（コミット）** `app/assets/js/cfapikey.example.js`: `module.exports = ''`（プレースホルダ）。
  リポジトリにはこちらだけ入れ、README等でビルド時に `cfapikey.js` を用意する旨を記す。
- `.gitignore` に `app/assets/js/cfapikey.js` を追記。
- [configmanager.js](../../../app/assets/js/configmanager.js):
  - `DEFAULT_CONFIG` に `curseForgeApiKey: ''` を追加。
  - `exports.getCurseForgeApiKey = () => config.curseForgeApiKey`。
  - `exports.setCurseForgeApiKey = (v) => { config.curseForgeApiKey = v }`。
  - `validateKeySet` により既存 config には自動で既定値が補完される。

### B. CurseForge API モジュール（新規 `app/assets/js/scripts/curseforge.js`）

`window.NLCurseForge` を公開。`got` を使用しヘッダ `x-api-key` を付ける。
定数: `API='https://api.curseforge.com/v1'`、`GAME_ID=432`、`CLASS_ID=6`。
`modLoaderType` 対応表: `forge:1, fabric:4, quilt:5, neoforge:6`。

- `apiKey()`: `ConfigManager.getCurseForgeApiKey() || require('./assets/js/cfapikey')` の順で解決。
  空文字なら空を返す。
- `hasKey()`: `apiKey()` が非空なら true。
- `async search(query, mc, loader, limit=20)`:
  - キー未設定なら例外 `CurseForge APIキーが未設定です`。
  - `GET /mods/search?gameId=432&classId=6&searchFilter=<q>&gameVersion=<mc>&modLoaderType=<n>&sortField=2&sortOrder=desc&pageSize=<limit>`
  - 返り値（Modrinthの `search` と同形）:
    `[{ projectId:<mod.id を文字列化>, slug:<mod.slug>, title:<mod.name>, author:<mod.authors[0].name>,
       description:<mod.summary>, iconUrl:<mod.logo?.url>, downloads:<mod.downloadCount>,
       websiteUrl:<mod.links?.websiteUrl> }]`
- `async getBestVersion(projectId, mc, loader)`:
  - `GET /mods/<modId>/files?gameVersion=<mc>&modLoaderType=<n>&pageSize=50`
  - `data` を `fileDate` 降順にソートし先頭を採用。無ければ null。
  - 返り値（Modrinthの `getBestVersion` と同形＋`blocked`）:
    `{ versionId:<file.id を文字列化>, versionNumber:<file.displayName || file.fileName>,
       datePublished:<file.fileDate>,
       files:[{ filename:<file.fileName>, url:<file.downloadUrl> }],
       dependencies:[{ dependency_type:(relationType===3?'required':'optional'),
                       project_id:<dep.modId を文字列化> }],
       blocked:<file.downloadUrl == null>, websiteUrl:<省略可> }`
- `async collectRequired(version, mc, loader)`:
  - Modrinth と同じ挙動。本体の primary file を先頭に push し、`dependency_type==='required'` の
    依存を `getBestVersion(dep.project_id, mc, loader)` で再帰解決。`seenVer`（versionId）で循環回避、
    `seenFiles`（filename）で重複回避。`url` が null（配布不可）のファイルは push するが `url:null` の
    まま返し、呼び出し側がDLスキップ＋警告する。返り値要素: `{ filename, url }`。
- User-Agent は不要だが got のデフォルトで可。`x-api-key` のみ必須。

### C. settings.js の一般化（ソース非依存化）

既存の Modrinth 専用関数をソース引数付きに一般化する。**関数名は互換のため残しつつ**、
内部を汎用関数に委譲する形にして差分を最小化する。

- ソース→APIオブジェクト解決: `_mrApi(source)` → `source==='curseforge' ? window.NLCurseForge : window.NLModrinth`。
- manifest キー: `_mrKey(source, projectId)` → `source==='curseforge' ? 'cf:'+projectId : projectId`。
  既存 Modrinth エントリ（素の projectId）は不変。各エントリに `source` フィールドを追加保存。
- `openOnlineModSearch(source)`（旧 `openModrinthSearch`）: コンテキスト検証後、オーバーレイを開き
  指定ソースのタブをアクティブにして検索欄クリア。CurseForge かつ `!hasKey()` の場合も開くが、
  結果欄に「CurseForge利用不可（APIキー未設定）」を表示し検索ボタン無効。
- `runOnlineModSearch(source)`（旧 `runModrinthSearch`）: `_mrApi(source).search(...)` を呼び、
  各結果行を描画。行の描画・アクションボタンは `_mrRenderActions(actionsEl, hit, ctx, source)` に
  `source` を渡す。
- `_mrRenderActions(actionsEl, hit, ctx, source)`:
  - manifest から `_mrKey(source, hit.projectId)` で導入済み判定（slug フォールバックも維持）。
  - 未導入: 「追加」。**配布不可（blocked）の事前検出はしない**（版取得は行ごとに1回の通信となり、
    検索1回で最大20件×通信＝過負荷・レート制限リスクのため）。blocked は**追加クリック時**に判定する
    （下記 `addOnlineMod` 参照）: クリックで版を解決し、本体が配布不可なら**DLせず**ボタンを
    「CurseForgeで開く」に差し替え（`shell.openExternal(hit.websiteUrl)`）、警告表示。
  - 導入済み: 「削除」＋（新しい版があれば）「更新」。更新判定は Modrinth と同一。
- `addOnlineMod(hit, ctx, actionsEl, btn, source)`（旧 `addModrinthMod`）、
  `removeOnlineMod(...)`（旧 `removeModrinthMod`）、`updateOnlineMod(...)`（旧 `updateModrinthMod`）:
  いずれも `_mrApi(source)` と `_mrKey(source, ...)` を使う汎用版。導入時に
  `_mrInstallVersion(ctx, hit, version, source)` が manifest に `source` 込みで記録。
- `addOnlineMod` の blocked 処理: 版解決後、`version.blocked`（本体が配布不可）なら DL・記録を行わず、
  ボタンを「CurseForgeで開く」に差し替え `shell.openExternal(hit.websiteUrl)` を割り当て、警告表示。
- `_mrInstallVersion`: `collectRequired` の結果のうち `url` が null の要素（配布不可の必須依存）はDLせず、
  ファイル名を集めて「〇〇は手動DLが必要（CurseForgeで開く）」と警告表示。DL可能分のみ保存し、
  本体（先頭要素）が DL 可能なら manifest 記録する（本体が配布不可のケースは上記 `addOnlineMod` 側で処理）。

### D. UI（overlay.ejs / settings.ejs / launcher.css）

- **overlay.ejs**: `#modrinthContent` を汎用オンラインMODオーバーレイとして拡張。
  - 上部にソース切替トグル `#onlineModSourceToggle`（`[data-source="modrinth"]` /
    `[data-source="curseforge"]` の2ボタン、選択中に `selected` 属性）。
  - CurseForge タブ選択時のみ表示する APIキー入力行 `#cfApiKeyRow`（`#cfApiKeyInput` ＋
    注記「※未入力なら同梱キーを使用」）。`change` で `ConfigManager.setCurseForgeApiKey` 保存後、再検索。
  - 既存の検索欄・結果欄・閉じるは流用（id 据え置きで低リスク）。
- **settings.ejs**: `#settingsDropinModsContainer` に「CurseForgeから追加」ボタン
  `#settingsCurseForgeButton` を「Modrinthから追加」の隣（下）に追加。両ボタンは
  `openOnlineModSearch('modrinth'|'curseforge')` を呼ぶ。
- **launcher.css**: `#settingsCurseForgeButton` を `#settingsModrinthButton` と同スタイルに。
  ソーストグル `#onlineModSourceToggle` を既存タブUI（modpack タブ等）に準じたスタイルで。
  結果行スタイル（`.modrinthResult` 系）はそのまま共用（クラス名は据え置き）。
  「CurseForgeで開く」ボタンは `.modrinthAddButton` を流用しラベルのみ変更。
- **バインド**: 既存の DOMContentLoaded ブロックに、`#settingsCurseForgeButton`・
  トグル・`#cfApiKeyInput` のハンドラを追加。

### E. ダウンロード / セキュリティ

- 保存先 `path.join(modsDir, file.filename)`。`fs.existsSync` でスキップ。DLは `downloadFile`。
- `x-api-key` は `api.curseforge.com` 宛のみ。キーはログ出力しない。`cfapikey.js` は gitignore。
- ネット由来データ（title/author/iconUrl/websiteUrl）は `_mrEsc` でHTMLエスケープしてから innerHTML。
- 配布不可MODは自動DLせず `shell.openExternal` でCurseForgeページを開く（規約準拠）。

## エラー / 前提

- キー未設定 → 「CurseForge利用不可（APIキー未設定）」。
- 403 → 「CurseForge APIキーが無効です」。429 → レート制限。対応ファイル無し → 「このパックに対応する
  バージョンがありません」。通信失敗 → 接続エラー。いずれも結果欄またはオーバーレイに表示。
- CurseForge の `modLoaderType` とインスタンスの loader 名（forge/fabric/quilt/neoforge）を対応させる。
- 未対応 loader（vanilla 等）は既存どおり導入UIを出さない（`getModTargetContext` で loader=null）。

## スコープ外（将来）

- CurseForge モッドパック一括導入。
- 任意依存(optional)の自動導入、MODのバージョン固定/更新一括管理。
- ④ 起動構成の共有（ID/コード/URL）。

## テスト観点（手動確認）

1. 同梱キー（または利用者キー）ありで、CurseForge タブ検索が互換MODのみ表示する。
2. CF Fabric パックで CurseForge MOD 追加 → `mods` に jar、manifest に `cf:<modId>`（source付き）、
   ボタンが「削除」になる。
3. 画面を閉じて再検索 → manifest から「削除」表示。
4. 旧版が入っている状態で新版がある場合「更新」表示 → 押すと最新導入＋旧ファイル削除。
5. 必須依存を持つ CF MOD を追加すると依存 jar も入る。
6. 配布不可MOD（downloadUrl null）で「CurseForgeで開く」が既定ブラウザを開き、クラッシュしない。
7. 利用者キー・同梱キーとも空 → CurseForge タブが「利用不可（APIキー未設定）」表示、検索無効。
   Modrinth タブは通常どおり動く。
8. トグルで Modrinth ↔ CurseForge を切替でき、Modrinth 側の挙動は無影響（回帰なし）。
9. 利用者キーを設定画面（オーバーレイ内）で入力→保存→そのキーが優先される。
10. lint に新規エラーが増えていない（基準 21）。

## 実装順（③CurseForge の中での段階）

1. **APIキー土台**: `cfapikey.js`/example・`.gitignore`・configmanager のキー get/set。
2. **curseforge.js**: search / getBestVersion / collectRequired（Modrinth と同形に正規化）。
3. **settings.js 一般化**: ソース引数化（`_mrApi`/`_mrKey`/汎用 open/run/render/add/remove/update）。
   Modrinth 側の回帰が無いことを確認。
4. **UI**: overlay トグル＋CFキー行、settings の CurseForge ボタン、CSS、バインド。
5. **配布不可MODフォールバック**＋エラー/未対応表示の仕上げ。
