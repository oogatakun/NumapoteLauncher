# 起動エラーログ出力機能の設計

- 日付: 2026-08-24
- 対象: NumapoteLauncher (沼ぽてランチャー)
- 目的: Modパックを選択して「プレイ」を押した際に起動エラーが出た場合、エラー画面から
  「ログを出力」ボタンで、原因が分かりやすい包括的なエラーログをネイティブ保存ダイアログ
  （エクスプローラー）で任意の場所に保存できるようにする。保存したログを Claude 等に渡して
  解析させることを想定する。

## 背景（現状）

- すべての起動系エラーは `app/assets/js/scripts/landing.js` の
  `showLaunchFailure(title, desc)` (325行付近) に集約され、オーバーレイ
  (`#overlayTitle` / `#overlayDesc`) に表示される。
- 表示される `desc` は、`err.message` / `err.displayable` の場合もあるが、
  多くはローカライズ済みメッセージ（例:「コンソールを見てください」）で、
  実際の詳細はコンソールログにしか出ていない。
- ロギングは `helios-core` の `LoggerUtil`（winston, **Console transport のみ**）。
  ログファイルは存在せず、出力は console と（メインプロセス経由の）stdout のみ。
  winston は console 経由で出力するため、レンダラの `console.*` をフックすれば
  全ランチャーログを捕捉できる。
- ゲーム(Minecraft)プロセスの stderr は `gameErrorListener` (688行付近) で
  1文字列だけ判定しているが、一般的なクラッシュ内容は捕捉していない。
- `app/app.ejs` に CSP (`script-src 'self' 'sha256-...'`) があるため、追加スクリプトは
  **外部ファイル**（同一オリジン）とする。インライン追加は不可。

## 決定事項（確定済み）

1. 保存形式はテキスト（`.log` / `.txt`）。Claude 等に貼りやすい素のテキスト。
2. レポートにアカウント**表示名**とパックID/名を含めてよい。ただしアクセストークン等の
   **機密情報は含めない**。
3. 操作は「エラー画面の『ログを出力』ボタン → ネイティブ保存ダイアログで保存場所を選択」。
4. 動作確認用に、設定画面の「コード」タブ（`#settingsCustomCode`）に `error` と入力して
   適用すると、サンプルのエラー画面を表示する（本番でも使えるテストトリガ）。

## 変更詳細

### A. ログ捕捉モジュール（新規 `app/assets/js/scripts/errorlog.js`）

- `app/app.ejs` の `<head>` で **最初のスクリプト**として読み込む
  （`uicore.js` より前）。CSP 上は外部ファイルなので許可される。
- 起動直後に `console.log/info/warn/error/debug` をラップし、リングバッファ
  （直近 500 行、各行にISO時刻を付与）へ蓄積する。元の console 動作は保持する。
- グローバル（`window`）に以下を公開する（このプロジェクトは contextIsolation:false・
  nodeIntegration:true のため他スクリプトから直接参照可能）:
  - `NLErrorLog.pushLine(line)` … 任意の1行を追記（例: ゲーム stderr）。
  - `NLErrorLog.setLastError({ title, desc, err, context })` … 直近エラーを保持。
  - `NLErrorLog.getLastError()` … 直近エラーを取得（無ければ null）。
  - `NLErrorLog.buildReport()` … 後述の書式でレポート文字列を生成して返す。
  - `NLErrorLog.getBuffer()` … バッファ配列のコピー。

### B. レポート書式（`buildReport()`）

人間・AI 双方が読みやすいプレーンテキスト。日本語見出し。

```
==== 沼ぽてランチャー エラーレポート ====
生成時刻: <ISO時刻>
ランチャー: v<appver>
OS: <platform> <release> (<arch>)
Modパック: <server名> (<serverId>)
ゲーム/ローダー: <可能なら version / modLoader>
アカウント: <displayName>            # トークン類は出力しない
Java: <javaExecutable もしくは "不明">

---- エラー概要 ----
<title>
<desc>

---- エラー詳細 ----
name: <err.name>
message: <err.message>
displayable: <err.displayable>       # 無ければ省略
stack:
<err.stack>                          # 無ければ "(スタックなし)"

---- 直近ログ ----
<リングバッファの各行>
```

- 値が取得できない項目は「不明」または省略。`context`（server/version/java 等）は
  landing.js が保持している情報から `setLastError` 時に渡す。

### C. `showLaunchFailure` の拡張（`app/assets/js/scripts/landing.js`）

- シグネチャを `showLaunchFailure(title, desc, err = null)` に拡張。
- 本文内で、可能なら現在の起動コンテキスト（選択中 server、version/modLoader、
  Java 実行パス等、その時点で参照可能なもの）を集めて
  `NLErrorLog.setLastError({ title, desc, err, context })` を呼ぶ。
- 既存の各呼び出し箇所（143行/369行/504行/533行/537行/554行/692行 付近など）で、
  catch の `err` が使えるものは第3引数に渡す。ローカライズのみの箇所は `err` 省略可。
- オーバーレイ表示時に「エラーオーバーレイである」ことを示すフラグを立て、出力ボタンの
  表示制御に使う（下記 D）。具体的には出力ボタンの表示を `showLaunchFailure` から明示的に
  ON にし、他の `setOverlayContent` 系フローでは OFF にする。
- ゲーム stderr（`gameErrorListener`）や必要に応じて stdout の一部を
  `NLErrorLog.pushLine(...)` でバッファに追記し、レポートに含める。

### D. UI：出力ボタン（`app/overlay.ejs` / `app/assets/js/scripts/overlay.js` / `launcher.css`）

- `overlay.ejs` の `#overlayActionContainer`（`#overlayAcknowledge` と
  `#overlayDismissWrapper` がある領域）に、`#overlayLogExport`「ログを出力」ボタンを追加。
  既定は `display:none`。
- `overlay.js`:
  - 出力ボタンの表示/非表示を切り替えるヘルパ（例 `setLogExportVisible(bool)`）を追加。
  - `toggleOverlay` を閉じる時、および `setOverlayContent` を通常用途で使う時は
    出力ボタンを非表示に戻す（エラー時だけ `showLaunchFailure` が明示的に表示）。
  - 出力ボタン click:
    1. `NLErrorLog.buildReport()` でレポート生成。
    2. 既定ファイル名 `numapote-error-YYYYMMDD-HHMMSS.log` を作る。
    3. IPC `save-error-log`（content, defaultFileName）を invoke。
    4. 結果に応じて簡単な通知（保存成功: パス表示＋「フォルダを開く」/ キャンセル: 何もしない /
       失敗: エラーメッセージ）。
- `launcher.css`: `#overlayLogExport` を既存 `#overlayAcknowledge` に準じた見た目で追加。

### E. メインプロセス：保存ダイアログ＋書き込み（`index.js`）

- IPC `ipcMain.handle('save-error-log', async (event, content, defaultFileName) => {...})`:
  - `dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('desktop'),
    defaultFileName), filters: [{ name: 'Log', extensions: ['log','txt'] }] })`。
  - `canceled` なら `{ success:false, canceled:true }`。
  - それ以外は `fs.promises.writeFile(filePath, content, 'utf8')` → `{ success:true, path:filePath }`。
  - 例外時 `{ success:false, error: err.message }`。
- 「フォルダを開く」用に、既存の `shell` を用いて `shell.showItemInFolder(path)` を呼ぶ
  IPC（`show-item-in-folder`）を追加、もしくは保存直後にレンダラからの要求で開く。

### F. テスト用トリガ（設定コードタブに `error`）

- `app/assets/js/scripts/settings.js` の `applyCustomCode()` 先頭付近（`raw` 確定後）で、
  `raw.toLowerCase() === 'error'` の場合に、サンプルエラーを生成して
  `showLaunchFailure('テストエラー', '...(動作確認用)...', testErr)` を呼び、`return` する。
  - `testErr` は `new Error('テスト用エラー')`（stack 付き）とし、`buildReport()` に
    詳細・スタックが載ることを確認できるようにする。
- `showLaunchFailure` は landing.js のトップレベル関数でグローバル（contextIsolation:false）。
  クリック時点では landing.js が読み込み済みのため settings.js から呼べる。
- この分岐は既存の short-code 判定（`--tyaromars--` 等）より前に置き、`error` が
  「無効なコード」と誤判定されないようにする。

- レポートにアクセストークン・リフレッシュトークン等は**含めない**。アカウントは
  `displayName` のみ。必要最小限（パック名・バージョン・Java パス・エラー詳細・直近ログ）に留める。
- 保存はユーザーがダイアログで場所を選ぶローカル書き込みのみ。外部送信は行わない。

## スコープ外 / 注意点

- Minecraft 本体のクラッシュレポート（ゲーム側が生成するもの）は対象外。v1 は
  ランチャー側で `showLaunchFailure` に集約されるエラー＋捕捉できた console/stderr を対象とする。
- リングバッファは 500 行程度。巨大ログの全量保存は行わない（YAGNI）。
- 出力ボタンはエラーオーバーレイでのみ表示し、サーバー選択・アカウント選択・
  ウィンドウ選択など他のオーバーレイでは表示しない。

## テスト観点（手動確認）

0. 設定 → コードタブに `error` を入力して適用すると、サンプルのエラー画面が表示される。
1. エラーオーバーレイに「ログを出力」ボタンが出る。
2. 通常のオーバーレイ（サーバー選択等）にはボタンが出ない。
3. ボタン押下でネイティブ保存ダイアログが開き、場所を選んで保存できる。
4. 保存された `.log` を開くと、ヘッダ・エラー概要・詳細・直近ログが読める形で入っている。
5. アクセストークン等の機密が含まれていない。
6. キャンセル時は何も保存されず、エラーも出ない。
7. lint に新規エラーが増えていない。
