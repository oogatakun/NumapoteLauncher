# 起動エラーログ出力機能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 起動エラー時にエラー画面から「ログを出力」ボタンでネイティブ保存ダイアログを開き、環境・エラー詳細・直近ログを含む分かりやすいエラーログを任意の場所に保存できるようにする。

**Architecture:** レンダラで `console.*` をフックして全ランチャーログをリングバッファに蓄積する新モジュール `errorlog.js`（`window.NLErrorLog`）を用意。`showLaunchFailure` が直近エラーと文脈を記録し、エラーオーバーレイに出力ボタンを表示。ボタン押下でレポート文字列を生成し、メインプロセスの `save-error-log` IPC が `dialog.showSaveDialog`＋`fs.writeFile` で保存する。設定コードタブに `error` を入力するとサンプルエラー画面を出せる。

**Tech Stack:** Electron 33, Node 20, EJS, jQuery, winston(helios-core, Console transport のみ)。

## Global Constraints

- 新規 npm 依存は追加しない。
- `app/app.ejs` に CSP (`script-src 'self' ...`) があるため、追加スクリプトは外部ファイル（同一オリジン）にする。インライン `<script>` は不可。
- レポートにアクセストークン/リフレッシュトークン等の機密情報は含めない。アカウントは `displayName` のみ。
- 保存はユーザーがダイアログで選ぶローカル書き込みのみ。外部送信はしない。
- 出力ボタンはエラーオーバーレイでのみ表示。他のオーバーレイ（サーバー/アカウント/ウィンドウ選択、通常メッセージ）では非表示。
- テストランナーは無いため、各タスクの検証は `npm run lint`（新規エラーを増やさない）＋手動確認（設定コードタブに `error`）とする。
- コミットは実装用ブランチ `feature/error-log-export` で行う。`main` では作業しない。
- Electron GUI の画面確認はGPU無効で起動するとスクリーンショットが撮れる: `npx electron . --disable-gpu`。メインプロセスはレンダラ `console` を stdout へ転送する（`[renderer] console-message`）。

---

## Task 0: 実装用ブランチの作成

**Files:** なし（git操作）

- [ ] **Step 1: 最新 main から分岐**

```bash
git checkout main
git checkout -b feature/error-log-export
```

- [ ] **Step 2: lint ベースライン確認**

Run: `npm run lint`
Expected: エラー件数を控える（以降はこの件数を増やさないことを基準にする）。

---

## Task 1: ログ捕捉＋レポート生成モジュール `errorlog.js`

**Files:**
- Create: `app/assets/js/scripts/errorlog.js`
- Modify: `app/app.ejs`（`<head>` 内、`uicore.js` の前に script 追加）

**Interfaces:**
- Produces（`window.NLErrorLog`）:
  - `pushLine(line: string): void` — 任意の1行をバッファに追記。
  - `setLastError({ title: string, desc: string, err?: Error|null, context?: object }): void`
  - `getLastError(): object|null`
  - `buildReport(): string` — 下記書式のレポート文字列。
  - `getBuffer(): string[]`

- [ ] **Step 1: `app/assets/js/scripts/errorlog.js` を新規作成**

```js
/**
 * Error log capture + report builder.
 * Loaded first so it can hook console before other scripts log.
 * Exposed as window.NLErrorLog (contextIsolation is disabled in this app).
 */
(function(){
    const MAX_LINES = 500
    const buffer = []
    let lastError = null

    function ts(){
        return new Date().toISOString()
    }

    function push(line){
        buffer.push(line)
        if(buffer.length > MAX_LINES){
            buffer.splice(0, buffer.length - MAX_LINES)
        }
    }

    function stringifyArg(a){
        if(typeof a === 'string') return a
        if(a instanceof Error) return (a.stack || (a.name + ': ' + a.message))
        try { return JSON.stringify(a) } catch(e) { return String(a) }
    }

    // Hook console methods so winston (which prints via console) is captured.
    const methods = ['log', 'info', 'warn', 'error', 'debug']
    methods.forEach(function(m){
        const original = console[m] ? console[m].bind(console) : function(){}
        console[m] = function(){
            try {
                const parts = Array.prototype.slice.call(arguments).map(stringifyArg)
                push('[' + ts() + '] [' + m.toUpperCase() + '] ' + parts.join(' '))
            } catch(e) { /* never let logging break the app */ }
            return original.apply(console, arguments)
        }
    })

    function setLastError(info){
        lastError = {
            time: ts(),
            title: (info && info.title) || '',
            desc: (info && info.desc) || '',
            err: (info && info.err) || null,
            context: (info && info.context) || {}
        }
    }

    function buildReport(){
        const e = lastError || { time: ts(), title: '(エラー情報なし)', desc: '', err: null, context: {} }
        const lines = []
        lines.push('==== 沼ぽてランチャー エラーレポート ====')
        lines.push('生成時刻: ' + e.time)
        Object.keys(e.context).forEach(function(k){
            lines.push(k + ': ' + e.context[k])
        })
        lines.push('')
        lines.push('---- エラー概要 ----')
        lines.push(e.title || '(タイトルなし)')
        if(e.desc) lines.push(e.desc)
        lines.push('')
        lines.push('---- エラー詳細 ----')
        if(e.err){
            lines.push('name: ' + (e.err.name || ''))
            lines.push('message: ' + (e.err.message || ''))
            if(e.err.displayable) lines.push('displayable: ' + e.err.displayable)
            lines.push('stack:')
            lines.push(e.err.stack || '(スタックなし)')
        } else {
            lines.push('(エラーオブジェクトなし)')
        }
        lines.push('')
        lines.push('---- 直近ログ ----')
        if(buffer.length === 0){
            lines.push('(ログなし)')
        } else {
            buffer.forEach(function(l){ lines.push(l) })
        }
        return lines.join('\n')
    }

    window.NLErrorLog = {
        pushLine: push,
        setLastError: setLastError,
        getLastError: function(){ return lastError },
        buildReport: buildReport,
        getBuffer: function(){ return buffer.slice() }
    }
})()
```

- [ ] **Step 2: `app/app.ejs` の `<head>` で最初のスクリプトとして読み込む**

`<title>` 行の直後、`uicore.js` の前に1行追加する。変更前:

```html
    <title><%= lang('app.title') %></title>
    <script src="./assets/js/scripts/uicore.js"></script>
```

変更後:

```html
    <title><%= lang('app.title') %></title>
    <script src="./assets/js/scripts/errorlog.js"></script>
    <script src="./assets/js/scripts/uicore.js"></script>
```

- [ ] **Step 3: lint 確認**

Run: `npm run lint`
Expected: 新規エラーが増えていない。

- [ ] **Step 4: 手動確認（バッファ捕捉）**

Run: `npx electron . --disable-gpu`
起動後、メインプロセス出力（`npm start`/`electron .` の stdout）に既存の `[renderer] console-message` が出続けることを確認（既存ログが壊れていない）。DevTools(Ctrl+Shift+I)のConsoleで `window.NLErrorLog.getBuffer().length` が 1 以上、`typeof window.NLErrorLog.buildReport` が `'function'` であることを確認。確認後アプリを閉じる。

- [ ] **Step 5: コミット**

```bash
git add app/assets/js/scripts/errorlog.js app/app.ejs
git commit -m "feat(errorlog): add console-capturing error log module and load it first"
```

---

## Task 2: メインプロセスの保存 IPC（`save-error-log` / `show-item-in-folder`）

**Files:**
- Modify: `index.js`（electron の require に `dialog` 追加；SHELL_OPCODE ハンドラ付近に新 IPC 追加）

**Interfaces:**
- Produces:
  - IPC `ipcMain.handle('save-error-log', (event, content: string, defaultFileName: string) => Promise<{success:boolean, canceled?:boolean, path?:string, error?:string}>)`
  - IPC `ipcMain.handle('show-item-in-folder', (event, targetPath: string) => Promise<{success:boolean}>)`

- [ ] **Step 1: `dialog` を electron の分割代入に追加**

`index.js` 5行目を変更。変更前:

```js
const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron')
```

変更後:

```js
const { app, BrowserWindow, ipcMain, Menu, shell, dialog } = require('electron')
```

- [ ] **Step 2: 保存 IPC を追加**

`index.js` の `ipcMain.handle(SHELL_OPCODE.TRASH_ITEM, ...)` ブロックの直後に、以下を追加する。

```js
// Save an error log to a user-chosen location (native save dialog).
ipcMain.handle('save-error-log', async (event, content, defaultFileName) => {
    try {
        const targetWindow = BrowserWindow.fromWebContents(event.sender) || win
        const result = await dialog.showSaveDialog(targetWindow, {
            title: 'エラーログを保存',
            defaultPath: path.join(app.getPath('desktop'), defaultFileName || 'numapote-error.log'),
            filters: [{ name: 'Log', extensions: ['log', 'txt'] }]
        })
        if(result.canceled || !result.filePath){
            return { success: false, canceled: true }
        }
        await fs.promises.writeFile(result.filePath, content, 'utf8')
        return { success: true, path: result.filePath }
    } catch(err) {
        console.error('[main] save-error-log failed', err)
        return { success: false, error: err.message }
    }
})

// Reveal a file in the OS file manager.
ipcMain.handle('show-item-in-folder', async (event, targetPath) => {
    try {
        shell.showItemInFolder(targetPath)
        return { success: true }
    } catch(err) {
        console.error('[main] show-item-in-folder failed', err)
        return { success: false }
    }
})
```

- [ ] **Step 3: lint 確認**

Run: `npm run lint`
Expected: 新規エラーが増えていない（`fs` と `path` は既存 require 済み）。

- [ ] **Step 4: コミット**

```bash
git add index.js
git commit -m "feat(errorlog): add save-error-log and show-item-in-folder IPC handlers"
```

---

## Task 3: エラーオーバーレイに「ログを出力」ボタンを追加

**Files:**
- Modify: `app/overlay.ejs`（`#overlayActionContainer`）
- Modify: `app/assets/js/scripts/overlay.js`（`setOverlayContent` に非表示リセット追加、`setLogExportVisible` と出力ハンドラ追加）
- Modify: `app/assets/css/launcher.css`（`#overlayLogExport` のスタイル）

**Interfaces:**
- Consumes: `window.NLErrorLog.buildReport()`（Task 1）、IPC `save-error-log`/`show-item-in-folder`（Task 2）、既存 `setOverlayContent`/`setOverlayHandler`/`toggleOverlay`。
- Produces: グローバル関数 `setLogExportVisible(visible: boolean)`（Task 4 の `showLaunchFailure` から呼ぶ）。DOM `#overlayLogExport`。

- [ ] **Step 1: `app/overlay.ejs` の `#overlayActionContainer` にボタンを追加**

変更前:

```html
        <div id="overlayActionContainer">
            <button id="overlayAcknowledge" class="overlayKeybindEnter">Conare Iterum</button>
            <div id="overlayDismissWrapper">
                <button id="overlayDismiss" style="display: none;" class="overlayKeybindEsc">Dismiss</button>
            </div>
        </div>
```

変更後:

```html
        <div id="overlayActionContainer">
            <button id="overlayAcknowledge" class="overlayKeybindEnter">Conare Iterum</button>
            <button id="overlayLogExport" type="button" style="display: none;">ログを出力</button>
            <div id="overlayDismissWrapper">
                <button id="overlayDismiss" style="display: none;" class="overlayKeybindEsc">Dismiss</button>
            </div>
        </div>
```

- [ ] **Step 2: `overlay.js` の `setOverlayContent` 末尾で出力ボタンを既定非表示にする**

`overlay.js` の `setOverlayContent` 関数（`document.getElementById('overlayDismiss').innerHTML = dismiss` の行がある関数）本体の最後に1行追加する。変更前:

```js
function setOverlayContent(title, description, acknowledge, dismiss = Lang.queryJS('overlay.dismiss')){
    document.getElementById('overlayTitle').innerHTML = title
    document.getElementById('overlayDesc').innerHTML = description
    document.getElementById('overlayAcknowledge').innerHTML = acknowledge
    document.getElementById('overlayDismiss').innerHTML = dismiss
}
```

変更後:

```js
function setOverlayContent(title, description, acknowledge, dismiss = Lang.queryJS('overlay.dismiss')){
    document.getElementById('overlayTitle').innerHTML = title
    document.getElementById('overlayDesc').innerHTML = description
    document.getElementById('overlayAcknowledge').innerHTML = acknowledge
    document.getElementById('overlayDismiss').innerHTML = dismiss
    // Reset the error-log export button; only showLaunchFailure re-enables it.
    setLogExportVisible(false)
}
```

- [ ] **Step 3: `overlay.js` に `setLogExportVisible` と出力ハンドラを追加**

`overlay.js` の `setOverlayContent` 関数の直後に、以下を追加する。

```js
/**
 * Show or hide the error-log export button (only meaningful on error overlays).
 * @param {boolean} visible
 */
function setLogExportVisible(visible){
    const btn = document.getElementById('overlayLogExport')
    if(btn) btn.style.display = visible ? '' : 'none'
}

function _nlErrorLogTimestamp(){
    const d = new Date()
    const p = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

(function bindLogExport(){
    const btn = document.getElementById('overlayLogExport')
    if(!btn) return
    btn.addEventListener('click', async () => {
        let content = ''
        try {
            content = (window.NLErrorLog && typeof window.NLErrorLog.buildReport === 'function')
                ? window.NLErrorLog.buildReport()
                : '(ログモジュールが利用できません)'
        } catch(e) {
            content = '(レポート生成に失敗しました: ' + (e && e.message) + ')'
        }
        const fileName = `numapote-error-${_nlErrorLogTimestamp()}.log`
        try {
            const res = await _ipc.invoke('save-error-log', content, fileName)
            if(res && res.success){
                setOverlayContent('保存しました', 'エラーログを保存しました:<br>' + res.path, 'フォルダを開く', 'OK')
                setOverlayHandler(() => { _ipc.invoke('show-item-in-folder', res.path); toggleOverlay(false) })
                setDismissHandler(null)
                toggleOverlay(true, true)
            } else if(res && res.canceled){
                // 何もしない（保存キャンセル）
            } else {
                setOverlayContent('保存に失敗しました', (res && res.error) ? res.error : '不明なエラーです。', 'OK')
                setOverlayHandler(null)
                toggleOverlay(true)
            }
        } catch(err) {
            setOverlayContent('保存に失敗しました', err.message || '不明なエラーです。', 'OK')
            setOverlayHandler(null)
            toggleOverlay(true)
        }
    })
})()
```

- [ ] **Step 4: `launcher.css` に `#overlayLogExport` のスタイルを追加**

`app/assets/css/launcher.css` の `#serverSelectCancel:active,`〜 の直前（=「Window selection overlay」ブロックを追加した箇所の前後どこでも可）に、`#overlayAcknowledge` に準じたスタイルを追加する。`#overlayAcknowledge` の既存定義を検索し（`grep -n "#overlayAcknowledge" app/assets/css/launcher.css`）、その定義ブロックの直後に以下を追記する。

```css
/* Error-log export button on the error overlay. */
#overlayLogExport {
    background: none;
    border: 1px solid #ffffff;
    color: #ffffff;
    font-family: 'Avenir Medium';
    font-weight: bold;
    border-radius: 2px;
    padding: 4px 14px;
    margin-left: 10px;
    cursor: pointer;
    transition: 0.25s ease;
}
#overlayLogExport:hover,
#overlayLogExport:focus {
    box-shadow: 0px 0px 10px 0px #fff;
    outline: none;
}
#overlayLogExport:active {
    border-color: rgba(255, 255, 255, 0.75);
    color: rgba(255, 255, 255, 0.75);
}
```

- [ ] **Step 5: lint 確認**

Run: `npm run lint`
Expected: 新規エラーが増えていない。

- [ ] **Step 6: コミット**

```bash
git add app/overlay.ejs app/assets/js/scripts/overlay.js app/assets/css/launcher.css
git commit -m "feat(errorlog): add export-log button to the error overlay"
```

---

## Task 4: `showLaunchFailure` にエラー詳細と文脈を渡す

**Files:**
- Modify: `app/assets/js/scripts/landing.js`（`showLaunchFailure` 325行付近、各呼び出し箇所、`gameErrorListener` 688行付近）

**Interfaces:**
- Consumes: `window.NLErrorLog.setLastError(...)`（Task 1）、`setLogExportVisible(...)`（Task 3）。
- Produces: `showLaunchFailure(title: string, desc: string, err?: Error|null)`。

- [ ] **Step 1: `showLaunchFailure` を拡張**

`landing.js` の `showLaunchFailure` を変更。変更前:

```js
function showLaunchFailure(title, desc){
    setOverlayContent(
        title,
        desc,
        Lang.queryJS('landing.launch.okay')
    )
    setOverlayHandler(null)
    toggleOverlay(true)
    toggleLaunchArea(false)
}
```

変更後:

```js
function showLaunchFailure(title, desc, err = null){
    // Record error + best-effort context for the exportable report.
    try {
        const context = {}
        try { context['ランチャー'] = 'v' + remote.app.getVersion() } catch(e) { /* ignore */ }
        try { context['OS'] = `${process.platform} ${require('os').release()} (${process.arch})` } catch(e) { /* ignore */ }
        try {
            const sid = ConfigManager.getSelectedServer()
            if(sid) context['Modパック'] = String(sid)
        } catch(e) { /* ignore */ }
        try {
            const acc = ConfigManager.getSelectedAccount()
            if(acc && acc.displayName) context['アカウント'] = acc.displayName
        } catch(e) { /* ignore */ }
        if(window.NLErrorLog && typeof window.NLErrorLog.setLastError === 'function'){
            window.NLErrorLog.setLastError({ title, desc, err, context })
        }
    } catch(e) { /* never let reporting break error display */ }

    setOverlayContent(
        title,
        desc,
        Lang.queryJS('landing.launch.okay')
    )
    setOverlayHandler(null)
    if(typeof setLogExportVisible === 'function') setLogExportVisible(true)
    toggleOverlay(true)
    toggleLaunchArea(false)
}
```

- [ ] **Step 2: catch で `err` が使える呼び出し箇所に第3引数を渡す**

`landing.js` 内で `showLaunchFailure(` を検索（`grep -n "showLaunchFailure(" app/assets/js/scripts/landing.js`）。直前の `catch(err){` 内にあり `err` を参照できる呼び出しは第3引数 `err` を追加する。少なくとも以下の2箇所を変更する。

143行付近、変更前:

```js
        } catch(err) {
            loggerLanding.error('Unhandled error in during launch process.', err)
            showLaunchFailure(Lang.queryJS('landing.launch.failureTitle'), Lang.queryJS('landing.launch.failureText'))
        }
```

変更後:

```js
        } catch(err) {
            loggerLanding.error('Unhandled error in during launch process.', err)
            showLaunchFailure(Lang.queryJS('landing.launch.failureTitle'), Lang.queryJS('landing.launch.failureText'), err)
        }
```

504行付近、変更前:

```js
    } catch(err) {
        loggerLaunchSuite.error('Unable to refresh distribution index.', err)
        showLaunchFailure(Lang.queryJS('landing.dlAsync.fatalError'), Lang.queryJS('landing.dlAsync.unableToLoadDistributionIndex'))
        return
    }
```

変更後:

```js
    } catch(err) {
        loggerLaunchSuite.error('Unable to refresh distribution index.', err)
        showLaunchFailure(Lang.queryJS('landing.dlAsync.fatalError'), Lang.queryJS('landing.dlAsync.unableToLoadDistributionIndex'), err)
        return
    }
```

さらに `fullRepairModule.childProcess.on('error', (err) => {...})`（533行付近）の呼び出しも第3引数 `err` を追加する。変更前:

```js
    fullRepairModule.childProcess.on('error', (err) => {
        loggerLaunchSuite.error('Error during launch', err)
        showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), err.message || Lang.queryJS('landing.dlAsync.errorDuringLaunchText'))
    })
```

変更後:

```js
    fullRepairModule.childProcess.on('error', (err) => {
        loggerLaunchSuite.error('Error during launch', err)
        showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), err.message || Lang.queryJS('landing.dlAsync.errorDuringLaunchText'), err)
    })
```

（他の `showLaunchFailure(` 呼び出しでローカライズ文字列のみのものは、`err` を省略したままでよい。）

- [ ] **Step 3: ゲーム stderr をバッファへ取り込む**

`landing.js` の `gameErrorListener`（688行付近）を変更し、受信した stderr データをバッファに追記する。変更前:

```js
        const gameErrorListener = function(data){
            data = data.trim()
            if(data.indexOf('Could not find or load main class net.minecraft.launchwrapper.Launch') > -1){
                loggerLaunchSuite.error('Game launch failed, LaunchWrapper was not downloaded properly.')
                showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.launchWrapperNotDownloaded'))
            }
        }
```

変更後:

```js
        const gameErrorListener = function(data){
            data = data.trim()
            if(window.NLErrorLog && typeof window.NLErrorLog.pushLine === 'function' && data){
                window.NLErrorLog.pushLine('[GAME stderr] ' + data)
            }
            if(data.indexOf('Could not find or load main class net.minecraft.launchwrapper.Launch') > -1){
                loggerLaunchSuite.error('Game launch failed, LaunchWrapper was not downloaded properly.')
                showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.launchWrapperNotDownloaded'))
            }
        }
```

- [ ] **Step 4: lint 確認**

Run: `npm run lint`
Expected: 新規エラーが増えていない。

- [ ] **Step 5: コミット**

```bash
git add app/assets/js/scripts/landing.js
git commit -m "feat(errorlog): record error detail/context on launch failure and capture game stderr"
```

---

## Task 5: 設定コードタブの `error` テストトリガ

**Files:**
- Modify: `app/assets/js/scripts/settings.js`（`applyCustomCode` 1702行付近）

**Interfaces:**
- Consumes: `showLaunchFailure(title, desc, err)`（Task 4、グローバル）。

- [ ] **Step 1: `applyCustomCode` 先頭で `error` を特別扱いする**

`settings.js` の `applyCustomCode` の `if(!raw){...}` ブロックの直後（`let parsed` の前）に、以下を追加する。変更前:

```js
    if(!raw){
        // 空入力でEnterが押されたら、カスタム設定を元に戻す
        await revertCustomCode()
        return
    }

    let parsed
```

変更後:

```js
    if(!raw){
        // 空入力でEnterが押されたら、カスタム設定を元に戻す
        await revertCustomCode()
        return
    }

    // Test trigger: typing "error" shows a sample error screen to verify the
    // error overlay and its log-export button.
    if(raw.toLowerCase() === 'error'){
        const testErr = new Error('テスト用エラー: コードタブに "error" が入力されました。')
        if(typeof showLaunchFailure === 'function'){
            showLaunchFailure('テストエラー', 'これは動作確認用のサンプルエラー画面です。「ログを出力」ボタンからログを保存できます。', testErr)
        }
        return
    }

    let parsed
```

- [ ] **Step 2: lint 確認**

Run: `npm run lint`
Expected: 新規エラーが増えていない。

- [ ] **Step 3: コミット**

```bash
git add app/assets/js/scripts/settings.js
git commit -m "feat(errorlog): add settings code-tab 'error' trigger for the error screen"
```

---

## Task 6: 手動での統合動作確認

**Files:** なし（手動確認）

- [ ] **Step 1: GPU無効で起動（スクショ検証可能にする）**

Run: `npx electron . --disable-gpu`

- [ ] **Step 2: エラー画面を出す**

設定（歯車）→「コード」タブを開き、入力欄に `error` と入力して適用（Enter または適用ボタン）。エラーオーバーレイ（タイトル「テストエラー」）と「ログを出力」ボタンが表示されることを確認。

- [ ] **Step 3: 通常オーバーレイにボタンが出ないこと**

サーバー選択（メイン画面のパック選択）や、コードタブに無効値（例 `zzz`）を入力して出る「無効なコードです」オーバーレイに、「ログを出力」ボタンが出ないことを確認。

- [ ] **Step 4: 保存フロー**

エラー画面で「ログを出力」をクリック → ネイティブ保存ダイアログが開く → 保存場所を選んで保存 → 「保存しました」表示。保存キャンセル時は何も起きないことも確認。

- [ ] **Step 5: 保存内容の確認**

保存した `.log` を開き、次を確認:
- ヘッダに 生成時刻 / ランチャー / OS / Modパック / アカウント。
- 「エラー概要」「エラー詳細（message・stack）」「直近ログ」がある。
- アクセストークン等の機密が含まれていない。

- [ ] **Step 6: 問題があればログ確認**

DevTools(Ctrl+Shift+I)コンソールおよびメインプロセス出力（`[main] save-error-log failed` 等）を確認し、該当タスクへ戻って修正する。

---

## 自己レビュー結果

- **スペック網羅**: A(errorlog.js)=Task1、B(レポート書式)=Task1 `buildReport`、C(showLaunchFailure拡張)=Task4、D(UIボタン)=Task3、E(保存IPC)=Task2、F(errorトリガ)=Task5、テスト観点=Task6。全項目にタスクあり。
- **プレースホルダ**: なし（全ステップに具体コード/コマンド）。
- **型/識別子整合**: `window.NLErrorLog.{pushLine,setLastError,getLastError,buildReport,getBuffer}` が Task1(定義)と Task3/Task4(使用)で一致。`setLogExportVisible(boolean)` が Task3(定義)・Task4(使用)で一致。IPC名 `save-error-log`/`show-item-in-folder` が Task2(定義)・Task3(使用)で一致。`showLaunchFailure(title, desc, err)` が Task4(定義)・Task5(使用)で一致。DOM id `#overlayLogExport` が Task3 の ejs/js/css で一致。
- **制約反映**: CSP対応（外部スクリプト）、機密除外、他オーバーレイ非表示、lint基準、featureブランチをGlobal Constraintsに明記。
