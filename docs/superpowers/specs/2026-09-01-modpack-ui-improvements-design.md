# モッドパックUI改善（進捗/リンク/バッジ）設計

- 日付: 2026-09-01
- 対象: NumapoteLauncher (沼ぽてランチャー)
- 目的: モッドパック導入まわりのUXを改善する3点:
  1. 導入/適用押下で**進捗バー画面に切替**、**キャンセル**ボタン、導入中は**ESC無効**。
  2. modpack/mod の**名前クリックで配布サイトを開く**（外部ブラウザ）。
  3. 設定Modタブで**パック由来Modと自分で追加したModを区別**（更新は自分追加に入らない）。

## 決定事項（確定済み）

1. 導入中はオーバーレイを非dismissableで開き直して ESC を無効化、閉じるボタンを隠し、進捗パネルを表示。
2. キャンセル: 新規導入 → インスタンスを削除してロールバック。版変更 → 一部適用のまま警告。
3. 名前クリック: Modrinth=`https://modrinth.com/project/<slug>`、CurseForge=hit.websiteUrl を
   `shell.openExternal`。
4. Modタブのバッジ: managedFiles に含まれれば「パック」、無ければ「自分」。

## 背景（現状のアーキテクチャ）

- モッドパック検索/版選択/導入は [overlay.js](../../../app/assets/js/scripts/overlay.js)
  （`openModpackSearch`/`runModpackSearch`/`openModpackVersions`/`importModpackVersion`/
  `changeModpackVersion`）。取り込み本体は [modpackimport.js](../../../app/assets/js/scripts/modpackimport.js)
  `importModpack`/`changeModpackVersion`（`onProgress(i,n)` 通知あり）。
- `toggleOverlay(state, dismissable, content)`：`dismissable` false で ESC 無効（`bindOverlayKeys`）。
- mod検索（Modrinth/CurseForge）UIは [settings.js](../../../app/assets/js/scripts/settings.js)
  `runOnlineModSearch`（`.modrinthResultTitle` を描画）。検索hitは `{projectId, slug, title, author,
  iconUrl, downloads, websiteUrl?}`（CurseForge hitは `websiteUrl` 保持、Modrinth hitは `slug` 保持）。
- 設定Modタブのドロップイン描画は [settings.js](../../../app/assets/js/scripts/settings.js)
  `resolveDropinModsForUI`（`#settingsDropinModsContent` に `.settingsModName` 等）。`dropin.fullName`
  はディスク上のファイル名（無効時は `.disabled` 付き）。
- インスタンスの `managedFiles`（`mods/<fileName>` 等）は `ConfigManager.getCustomInstance(id).managedFiles`。

## 変更詳細

### ① 進捗UI＋キャンセル＋ESC無効

- `modpackimport.js`:
  - `importModpack(provider, hit, file, onProgress, token)` / `changeModpackVersion(instanceId, file,
    onProgress, token)` に**キャンセルトークン** `token = { cancelled: bool }` を追加。
  - `_apply(provider, archivePath, instDir, onProgress, token)`：各ファイルDLの直前に
    `if(token && token.cancelled) throw new Error('__cancelled__')`。
  - `importModpack`：`__cancelled__` を捕捉したら `ConfigManager.removeCustomInstance(id)` ＋
    `fs.removeSync(instDir)` ＋ save し、`__cancelled__` を再throw。
  - `changeModpackVersion`：`__cancelled__` はそのまま再throw（部分適用は残す）。
- `overlay.ejs`：`#modpackContent` に進捗パネル要素を追加（既定非表示）:
  `#modpackProgress`（`#modpackProgressTitle`, `.bar>.barInner`, `#modpackProgressText`,
  `#modpackCancelBtn`）。
- `overlay.js`:
  - `importModpackVersion`/`changeModpackVersion`（UIラッパ）を進捗表示に変更:
    1. `toggleOverlay(true, false, 'modpackContent')` で ESC 無効化、結果欄・版パネルを隠し
       `#modpackProgress` を表示、`#modpackCancel`（閉じる）を隠す。
    2. `const token = { cancelled: false }`。`#modpackCancelBtn` → `token.cancelled = true`（ボタンを
       「キャンセル中...」に）。
    3. `onProgress = (i,n) => { バー幅 = i/n*100%、テキスト = i/n }`。
    4. 完了 → 自作タブへ（既存）。`__cancelled__` → 導入なら結果欄に戻す、版変更なら
       「キャンセルしました（一部のみ適用）」警告後 自作タブへ。
    5. 終了時に `#modpackProgress` を隠し `#modpackCancel` を戻す。
- CSS：`#modpackProgress`（縦並び）、`.modpackBar`（外枠）、`.modpackBarInner`（幅0%→trans）、
  `#modpackCancelBtn`。

### ② 名前クリックで配布サイト

- `_projectUrl(source, hit)`（overlay.js と settings.js 双方に小ヘルパ、または共通化）:
  - `curseforge` → `hit.websiteUrl || ''`
  - それ以外(modrinth) → `hit.slug ? 'https://modrinth.com/project/' + hit.slug : ''`
- 対象の `.modrinthResultTitle`（modpack検索・mod検索）と版選択の `.modpackVersionTitle` に
  `class="... clickableTitle"` を付け、クリックで `url && shell.openExternal(url)`。ソースは各描画箇所が
  持っている（mod検索は現在のソース、modpack検索は `currentModpackSource`）。
- CSS：`.clickableTitle { cursor:pointer; } .clickableTitle:hover { text-decoration:underline; }`。

### ③ パック/自分バッジ（設定Modタブ）

- `settings.js` `resolveDropinModsForUI`：選択中IDの `ins = ConfigManager.getCustomInstance(id)` を取得。
  `managed = new Set((ins && ins.managedFiles) || [])`。
- 各 dropin: `base = dropin.fullName.replace(/\.disabled$/i,'')`、`isPack = managed.has('mods/'+base)`。
  `.settingsModName` の隣に `<span class="modOriginBadge ${isPack?'pack':'user'}">${isPack?'パック':'自分'}</span>`。
- 非modpackインスタンス（`managedFiles` 無し）は全て「自分」。公式パックは custom でないので従来通り
  （バッジ無し or 全「自分」）。※`ins` が無い場合はバッジ非表示。
- CSS：`.modOriginBadge`（小さめ）、`.pack`/`.user` で色分け。

## セキュリティ / 前提

- `shell.openExternal` は Modrinth/CurseForge のURLのみ（hit由来）。URLが空なら何もしない。
- キャンセルのフォルダ削除は `instances/<id>` 配下のみ。

## スコープ外（将来）

- 配布不可自動DL（ブラウザ）側の進捗をこのバーに統合。
- 版変更キャンセルの完全ロールバック（旧状態復元）。

## エラー / 前提

- キャンセルは `__cancelled__` を専用マーカーとして扱い、通常エラー表示とは分ける。
- URL未取得（slug/websiteUrl無し）→ クリック無反応。

## テスト観点（実機DIAG／既存手法）

1. 導入押下で進捗パネル表示・ESC無効（dismissable=false）・閉じる非表示。onProgress でバーが伸びる。
2. キャンセル（導入）→ インスタンスが削除されロールバック（config/フォルダ）。
3. `_projectUrl` が Modrinth/CurseForge で正しいURLを返す。タイトルに clickableTitle が付く。
4. 設定Modタブで、パック由来Modに「パック」、手動追加Modに「自分」バッジが出る。版変更後もパックModは
   「パック」のまま。
5. 既存の取り込み・版変更・mod検索に回帰なし。
6. lint 増加なし（基準21）。

## 実装順

1. `modpackimport.js`: キャンセルトークン＋ロールバック。
2. `overlay.js`/`overlay.ejs`/CSS: 進捗パネル＋ESC無効＋キャンセル、タイトルクリック。
3. `settings.js`/CSS: mod検索タイトルクリック＋Modタブのパック/自分バッジ。
4. 実機DIAGで検証、仕上げ。
