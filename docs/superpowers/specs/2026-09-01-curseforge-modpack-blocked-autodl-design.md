# CurseForge 配布不可ファイルの自動DL（M-Pack2b）設計

- 日付: 2026-09-01
- 対象: NumapoteLauncher (沼ぽてランチャー)
- 目的: CurseForge モッドパック取り込み/版変更時に、配布不可ファイル（API `downloadUrl` が null）を
  **ランチャー内ブラウザで自動ダウンロードし、インスタンスの `mods/` へ保存**する。
- スコープ: M-Pack2b。M-Pack2a（CFモッドパック取り込み・警告一覧）の続き。既存の主プロセスの手動DL
  機構（`openManualWindow`）を再利用する。

## 決定事項（確定済み）

1. 既存の主プロセス手動DL機構 `openManualWindow` を再利用する（ファイルごとに BrowserWindow を開き
   `will-download` を捕捉して指定パスへ保存・サイズ/MD5検証）。
2. DLページURLは `mod.websiteUrl + '/download/' + fileId`（プロジェクト種別に依らず正しいパス）。
3. 取り込み/版変更の完了後に**自動**で起動（配布不可0件なら何もしない）。
4. 配布不可分の `mods/<fileName>` も `managedFiles` に含める（版変更で正しく入れ替わるように）。
5. Cloudflare等でユーザー操作が要る場合はウィンドウが可視なので人が対応（自動CAPTCHA突破はしない）。

## 背景（現状のアーキテクチャ）

- 主プロセス [index.js](../../../index.js) に手動DL機構が既にある（`ipcMain.on('openManualWindow', …)`）。
  `result.manualData` の各 `manual` について BrowserWindow を開き、`manual.manual.url` をロード、
  `will-download` で一時保存→`item.getTotalBytes() === manual.size` かつ md5（`manual.MD5`）一致なら
  `manual.path` へ `moveSync`。各アイテム形状:
  `{ manual: { name, url }, size, MD5, path }`。`closeManualWindow`/`preventManualWindowRedirect` も既存。
- M-Pack2a: [curseforge.js](../../../app/assets/js/scripts/curseforge.js) `resolveFiles(fileIds)` は
  `{ [fileId]: {fileName, downloadUrl, modId} }` を返す。[modpackimport.js](../../../app/assets/js/scripts/modpackimport.js)
  の CF `_apply` は `downloadUrl` null を `failed` に積むのみ。
- レンダラースクリプトは `require('electron').ipcRenderer` を使える（既存の他スクリプトと同様）。

### CurseForge データ

- `resolveFiles`（`POST /mods/files`）の各 file は `fileName`・`downloadUrl`（null あり）・`fileLength`・
  `hashes:[{value, algo}]`（algo=1:SHA1, 2:MD5）を持つ。
- `POST /mods {modIds}` の各 mod は `name`・`slug`・`links.websiteUrl` を持つ。
- 配布不可ファイルのDLページ: `<websiteUrl>/download/<fileId>`（自動でDLが始まる）。

## 変更詳細

### A. `curseforge.js`

- `resolveFiles` の各値に `fileLength` と `md5` を追加:
  `{ fileName, downloadUrl, modId, fileLength, md5 }`。`md5` は `hashes.find(h => h.algo === 2)?.value || null`。
- `getModsBulk(modIds)` 追加: `POST /mods { modIds: modIds.map(Number) }` →
  `{ [String(mod.id)]: { name: mod.name, slug: mod.slug, websiteUrl: (mod.links && mod.links.websiteUrl) || '' } }`。
- 公開に `getModsBulk` を追加。

### B. `modpackimport.js`

- `_apply`（CF分岐）: 配布不可（解決結果に `downloadUrl` が無い）を検出したら、
  `blockedManual.push({ modId, fileId, fileName, fileLength, md5 })`（`failed` にも従来どおり名前を積む）。
  `_apply` の返り値に `blockedManual` を追加。
- `_startManualDownloads(provider, instDir, blockedManual, managedFiles)` を追加（CF専用）:
  1. `blockedManual` が空なら何もしない。
  2. `window.NLCurseForge.getModsBulk([...modIds])` で `websiteUrl` を解決。
  3. 各アイテムを構築:
     `{ manual: { name: modName, url: websiteUrl + '/download/' + fileId },
        size: fileLength, MD5: md5, path: path.join(instDir, 'mods', fileName) }`。
     `websiteUrl` が空なら該当はスキップ（`failed` 相当のまま）。
  4. 対象の `mods/<fileName>` を `managedFiles` に追加（未含有なら）。
  5. `require('electron').ipcRenderer.send('openManualWindow', { manualData })`。
- `importModpack` / `changeModpackVersion`: `_apply` 後、provider が curseforge かつ
  `blockedManual.length > 0` なら `_startManualDownloads` を呼び、更新後の `managedFiles` を保存。
  返り値の `failed` からは自動DLに回した分を除く（残りの真の失敗のみ警告）。

### C. UI（`overlay.js`）

- 既存の完了処理はそのまま（`failed` があれば警告一覧）。自動DL対象は `failed` から除かれるため、
  「配布不可 → ブラウザ自動DL」分は警告に出ず、ブラウザウィンドウが開く。
- 追加のUIは不要（`_startManualDownloads` が主プロセスにブラウザを開かせる）。必要なら
  完了メッセージに「配布不可の N 件をブラウザでダウンロード中」を付記。

## セキュリティ / 前提

- DL元は CurseForge（`www.curseforge.com` / CDN）のみ。保存先は `instances/<id>/mods` 配下限定
  （`manual.path` を都度構築、`fileName` は resolveFiles 由来）。
- APIキーはログに出さない。自動CAPTCHA突破はしない（ウィンドウ可視でユーザー対応）。

## スコープ外（将来）

- 手動DLウィンドウの一括進捗集約UI（現状は各ウィンドウが個別に進捗表示）。
- Modrinth 側の配布不可（Modrinth は直リンクのため通常発生しない）。

## エラー / 前提

- `getModsBulk`/`resolveFiles` 失敗 → 取得できた分で続行、残りは `failed` 警告。
- md5 無し → サイズ一致のみで検証（既存 `validateLocal` は hash 無しなら true）。
- Cloudflare/確認ページ → 可視ウィンドウでユーザー対応。

## テスト観点（実機DIAG＋手動確認）

1. `resolveFiles` が `fileLength`・`md5` を返す（配布不可ファイル含む）。
2. `getModsBulk([modId…])` が `websiteUrl` を返す。
3. 配布不可を含むCFパックの取り込みで、`ipcRenderer.send('openManualWindow', …)` が呼ばれ、`manualData`
   が正しい（url=websiteUrl+/download/fileId、path=mods/<fileName>、size=fileLength、MD5）。配布不可分が
   `managedFiles` に含まれ、`failed` からは除かれる（send をスパイして検証）。
4. 配布不可0件のパックでは `openManualWindow` を呼ばない。
5. **手動確認**: 実際に配布不可を含むCFパックを取り込み、ブラウザウィンドウが開いて `mods/` に保存される。
6. lint 増加なし（基準21）。

## 実装順（M-Pack2b）

1. `curseforge.js`: `resolveFiles` に fileLength/md5、`getModsBulk` 追加。
2. `modpackimport.js`: `_apply` で blockedManual 収集、`_startManualDownloads` 追加、import/change で起動。
3. 実機DIAGで send 内容を検証、手動で実DLを確認、仕上げ。
