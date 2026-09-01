# モッドパック導入（M-Pack1: Modrinth）設計

- 日付: 2026-09-01
- 対象: NumapoteLauncher (沼ぽてランチャー)
- 目的: Modrinth のモッドパックをランチャー内で検索し、選択すると **MC・ローダー・全MODが揃った
  自作インスタンス（起動構成）**を自動生成できるようにする。
- スコープ: 本仕様は **M-Pack1（Modrinth の `.mrpack` のみ）**。CurseForge モッドパックは
  manifest 解決・配布不可ファイル対応が別途必要なため将来（M-Pack2）。対応ローダーは
  **Fabric / Forge のみ**（自作起動が対応済みのもの）。

## 決定事項（確定済み）

1. ソースは **Modrinth の `.mrpack`**（zip内 `modrinth.index.json` にMC・ローダー・各ファイル直リンクが並ぶ）。
2. UIは「自作」タブに **「modpackから作成」ボタン**＋専用の**モッドパック検索オーバーレイ**を追加。
3. ローダー判定は **インスタンス登録前**に行い、**Quilt/NeoForge 依存パックは未対応表示で中止**
   （インスタンスを作らない）。
4. MOD・overrides は **`instances/<id>/` 配下**に配置し、パストラバーサルを検証する。
5. 生成インスタンスは既存の自作起動フロー（Fabric/Forge）でそのまま起動する。

## 背景（現状のアーキテクチャ）

- 自作インスタンスは `{schema, id, name, minecraftVersion, loader, loaderVersion, created, lastPlayed}`
  を `ConfigManager.addCustomInstance` で登録（[overlay.js](../../../app/assets/js/scripts/overlay.js)
  の `customCreateConfirm`）。起動は [customlaunch.js](../../../app/assets/js/scripts/customlaunch.js)
  `launchCustomInstance`（vanilla/fabric/forge 対応済み）。ゲームディレクトリは `instances/<id>`、
  ローダーは `instances/<id>/mods` の MOD を自動読み込みする。
- Modrinth API クライアント [modrinth.js](../../../app/assets/js/scripts/modrinth.js)
  （`window.NLModrinth`）は `got` 使用（User-Agent 必須）。`search` は facets で絞り込む。
- `node-stream-zip` 利用可（`require('node-stream-zip')`）。`downloadFile`（helios-core/dl）で保存。
- `_mrEsc`（[settings.js](../../../app/assets/js/scripts/settings.js)）はネット由来テキストの
  HTMLエスケープ。モッドパックUIでも同様にエスケープする（RCE対策）。

### .mrpack の構造

- `.mrpack` は zip。`modrinth.index.json` ＋ 任意の `overrides/`（`client-overrides/`,
  `server-overrides/` も）を含む。
- `modrinth.index.json`:
  ```json
  {
    "formatVersion": 1, "game": "minecraft", "versionId": "...", "name": "Pack Name",
    "files": [{ "path": "mods/x.jar", "hashes": {...},
                "env": {"client":"required","server":"required"},
                "downloads": ["https://cdn.modrinth.com/..."], "fileSize": 123 }],
    "dependencies": { "minecraft": "1.20.1", "fabric-loader": "0.15.11" }
  }
  ```
- `dependencies` は `minecraft` ＋ 次のいずれか: `fabric-loader` / `forge` / `quilt-loader` / `neoforge`。
- `files[].env.client === "unsupported"` はクライアント不要（スキップ）。

## 採用アプローチ

Modrinth の modpack を検索し、選択した版の `.mrpack` をDL・展開。`modrinth.index.json` から
MC・ローダー・MODリストを得て、対応ローダー（Fabric/Forge）なら自作インスタンスを登録し、各MODを
`instances/<id>/mods` へ、`overrides/**` を `instances/<id>/` へ配置する。生成後は既存の自作起動で動く。

## 変更詳細

### A. 検索API（`modrinth.js` に追加）

- `async searchModpacks(query, limit=20)`:
  - `GET /search?query=<q>&limit=<n>&facets=[["project_type:modpack"]]`
  - 返り値: `[{ projectId, slug, title, author, description, iconUrl, downloads }]`（既存 `search` と同形）。
- `async getModpackFile(projectId)`:
  - `GET /project/<id>/version` の最新版（`date_published` 降順先頭）から primary ファイル
    （`.mrpack`）を選び `{ url, filename, versionId }` を返す。無ければ null。

### B. 取り込みモジュール（新規 `app/assets/js/scripts/modpackimport.js` = `window.NLModpack`）

`async importModrinthModpack(hit, onProgress) → { id, name, fileCount }`。

1. **`.mrpack` DL**: `getModpackFile(hit.projectId)` の url を `commonDir/temp/<slug>.mrpack` に
   `downloadFile`（`slug` はファイル名不正文字を除去）。
2. **解析**: `new StreamZip.async({file})` で `modrinth.index.json` を読む。
   - `mc = deps.minecraft`。ローダー: `deps['fabric-loader']`→`{loader:'fabric', ver}`、
     `deps.forge`→`{loader:'forge', ver}`、`deps['quilt-loader']`/`deps.neoforge` → **未対応エラー**
     `throw new Error('このモッドパックのローダー（quilt/neoforge）は未対応です')`。
   - `mc` が無ければ index 不正エラー。
3. **登録（検証後）**: `id = 'custom-'+Date.now().toString(36)+'-'+rand`、
   `ConfigManager.addCustomInstance({schema:1, id, name:index.name||hit.title, minecraftVersion:mc,
   loader, loaderVersion:ver, created:Date.now(), lastPlayed:null})` ＋ `ConfigManager.save()`。
4. **配置ディレクトリ**: `instDir = path.join(ConfigManager.getInstanceDirectory(), id)`。
5. **MODダウンロード**: `index.files` の各件で `if(f.env && f.env.client === 'unsupported') continue`。
   `dest = path.join(instDir, f.path)`。`underDir(instDir, dest)` を検証（`path.normalize` が
   `instDir` 配下）。`fs.existsSync(dest)` ならスキップ。`downloadFile(f.downloads[0], dest)`。
   失敗は名前を `failed[]` に蓄積し継続。`onProgress(i, files.length)`。
6. **overrides 展開**: zip エントリのうち `overrides/` と `client-overrides/` プレフィックスのものを、
   プレフィックスを外したパスで `instDir` 下へ抽出。各抽出先は `underDir(instDir, dest)` 検証。
   `server-overrides/` は無視。ディレクトリエントリはスキップ。
7. 返り値 `{ id, name, fileCount, failed }`。呼び出し側が `failed` を警告表示。

### C. UI（`overlay.ejs` / `overlay.js` / `launcher.css`）

- **overlay.ejs**: `#customInstanceCreateButton` の隣に **`#customModpackButton`（「modpackから作成」）** を
  追加。新規 `#modpackContent` オーバーレイ（`#modpackSearchInput`, `#modpackSearchButton`,
  `#modpackResults`, `#modpackCancel`）を追加。結果行は `.modrinthResult` 系スタイルを流用。
- **overlay.js**:
  - `#customModpackButton` クリックで `openModpackSearch()`（オーバーレイを開き空検索で人気modpack表示）。
  - `runModpackSearch()`: `NLModrinth.searchModpacks` → 結果行を描画、各行に「導入」ボタン。
  - 「導入」で `NLModpack.importModrinthModpack(hit, onProgress)` を実行し、行に進捗（i/N）表示。
    完了で `failed` があれば警告、`toggleServerSelection(true).then(()=>setServerTab('custom'))` で
    「自作」タブに戻して新インスタンスを表示。
  - バインドは既存のオーバーレイ同様、要素存在チェック付きで（overlay.ejs は app.ejs で settings の後に
    読まれるため、DOMは存在する前提だが null 安全に）。
- **launcher.css**: `#customModpackButton` を `#customInstanceCreateButton` と同スタイル。
  `#modpackContent` 系は `#modrinthContent` 系のスタイルを流用/複製。

### D. app.ejs

- `modpackimport.js` を include（`modrinth.js` の後、`customlaunch.js` 近辺）。

## セキュリティ / 前提

- DL元は Modrinth CDN（`cdn.modrinth.com`）と Modrinth API のみ。zip抽出・ファイル配置は
  `instances/<id>` 配下に限定（`path.normalize` 検証）。`..` を含むエントリは拒否。
- ネット由来テキスト（title/author/iconUrl）は `_mrEsc` でエスケープしてから innerHTML。

## スコープ外（将来）

- CurseForge モッドパック（manifest 解決・配布不可ファイル）= M-Pack2。
- Quilt / NeoForge ローダーのモッドパック（自作起動が未対応）。
- 既存インスタンスへのモッドパック上書き更新／パックのバージョン管理。

## エラー / 前提

- 未対応ローダー → 未作成で中止・表示。
- `.mrpack` DL / index 不正 → 表示。
- 一部MOD DL失敗 → 取得分で作成し、失敗名を警告。
- パストラバーサル → 該当エントリ拒否。

## テスト観点（実機DIAG／既存手法。lint＋実機DIAGで検証）

1. `searchModpacks('fabulously optimized')` が modpack のみ返す。
2. 「modpackから作成」→検索→結果表示が動く。
3. Fabric系modpack取り込み: `.mrpack`解析→インスタンス登録→`instances/<id>/mods` にMOD配置＋
   `overrides` 配置。生成インスタンスが「自作」タブに出る。
4. 取り込んだインスタンスが起動する（Fabricローダー＋MOD読み込み）。
5. Quilt/NeoForge依存パックは未対応表示で中止（インスタンス未作成）。
6. `..` を含む細工パスは拒否。
7. 既存の個別MOD導入・自作起動（Fabric/Forge）に回帰なし。
8. lint 増加なし（基準21）。

## 実装順（M-Pack1）

1. `modrinth.js`: `searchModpacks` ＋ `getModpackFile`。
2. `modpackimport.js`: `.mrpack` DL＋解析＋ローダー検証＋登録＋mods/overrides配置。
3. UI: 「自作」タブのボタン＋`#modpackContent`＋検索/導入バインド＋CSS＋app.ejs。
4. 実機で検索→取り込み→起動を検証、仕上げ。
