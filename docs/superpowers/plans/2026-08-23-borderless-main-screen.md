# ボーダーレス化機能 メイン画面移設 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 設定画面にあるウィンドウ・ボーダーレス化機能をメイン画面左下のアイコンボタンに移し、選択したウィンドウを「最大化（ボーダーレスフルスクリーン）」「最小化（元サイズに復元）」できるようにする。

**Architecture:** メインプロセス(`index.js`)に user32(FFI) を使った新IPC `apply-window-mode(hwnd, 'maximize'|'restore')` を追加し、元のスタイル・位置・サイズを記憶して全画面化/復元する。レンダラ側は既存のウィンドウ選択オーバーレイ(`overlay.ejs`/`overlay.js`)の確定ボタンを「最大化/最小化」に置換し、メイン画面(`landing.ejs`)左下にアイコンボタンを追加して同オーバーレイを開く。設定画面の旧ボタンは撤去する。

**Tech Stack:** Electron 33, Node 20, EJS, jQuery, ffi-napi/ref-napi(user32), 素のCSS。

## Global Constraints

- 対応OSは Windows のみ。非Windowsでは `{success:false}` を返しメッセージ表示（既存踏襲）。
- 新規 npm 依存は追加しない。`ffi-napi`/`ref-napi`/`node-window-manager` は既存コードが前提としているものを流用し、未導入環境では既存の try/catch で「利用不可メッセージ」に安全にフォールバックする。
- 座標はすべて物理ピクセルで扱う（user32 の `SetWindowPos`/`GetWindowRect`/`GetMonitorInfoW` で統一。DPI変換はしない）。
- UI は既存パターンに合わせる（アイコンは `.mediaButton`+`.mediaSVG`、ツールチップは `#settingsTooltip` と同流儀）。
- 「最小化」ボタンの動作は「元のサイズ・位置・枠に戻す（復元）」であり、タスクバーへの最小化ではない。
- テストランナーは本リポジトリに存在しないため、各タスクの検証は `npm run lint` の通過＋手動起動確認とする。
- コミットは main では行わず、実装用ブランチを切ってから、ユーザー承認のもとで行う（本リポジトリの運用ルール）。各タスクのコミット手順はブランチ作成後を前提とする。

---

## Task 0: 実装用ブランチの作成

**Files:** なし（git操作のみ）

- [ ] **Step 1: ブランチを作成**

```bash
git checkout -b feature/borderless-main-screen
```

- [ ] **Step 2: 現状 lint がベースラインで通ることを確認**

Run: `npm run lint`
Expected: 既存コードのエラーが無いこと（警告のみなら可）。以降のタスクはこの状態を基準に差分を判断する。

---

## Task 1: バックエンドIPC `apply-window-mode` を追加し、旧 `set-window-borderless` を削除

**Files:**
- Modify: `index.js`（`set-window-borderless` ハンドラ 378–410行 を置換）

**Interfaces:**
- Produces: IPC `ipcMain.handle('apply-window-mode', (event, handleStr, mode) => Promise<{success:boolean, message?:string}>)`。`mode` は `'maximize' | 'restore'`。
- Consumes: 既存 IPC `list-windows`（変更なし）。

- [ ] **Step 1: `set-window-borderless` ハンドラ全体（`index.js` 378–410行）を、以下の新ハンドラに置き換える**

```js
// Store original window rect/style so 最小化(restore) can revert exactly.
const originalWindowRects = new Map()

ipcMain.handle('apply-window-mode', async (event, handleStr, mode) => {
    if (process.platform !== 'win32') {
        return { success: false, message: 'Not implemented on this OS' }
    }
    const hwnd = parseInt(handleStr)
    if (isNaN(hwnd)) return { success: false, message: 'Invalid window handle' }
    let ffi
    let ref
    try { ffi = require('ffi-napi'); ref = require('ref-napi') } catch(e){ return { success:false, message: 'ffi-napi/ref-napi がインストールされていません。' } }
    try {
        const user32 = new ffi.Library('user32', {
            'GetWindowLongPtrW': ['longlong', ['longlong', 'int']],
            'SetWindowLongPtrW': ['longlong', ['longlong', 'int', 'longlong']],
            'SetWindowPos': ['bool', ['longlong', 'longlong', 'int', 'int', 'int', 'int', 'uint']],
            'GetWindowRect': ['bool', ['longlong', 'pointer']],
            'MonitorFromWindow': ['longlong', ['longlong', 'uint']],
            'GetMonitorInfoW': ['bool', ['longlong', 'pointer']]
        })
        const GWL_STYLE = -16
        const WS_OVERLAPPEDWINDOW = 0x00CF0000
        const WS_POPUP = 0x80000000
        const SWP_NOSIZE = 0x0001
        const SWP_NOMOVE = 0x0002
        const SWP_NOZORDER = 0x0004
        const SWP_FRAMECHANGED = 0x0020
        const MONITOR_DEFAULTTONEAREST = 0x00000002

        const getRect = (h) => {
            const buf = Buffer.alloc(16)
            if (!user32.GetWindowRect(h, buf)) return null
            const left = buf.readInt32LE(0)
            const top = buf.readInt32LE(4)
            const right = buf.readInt32LE(8)
            const bottom = buf.readInt32LE(12)
            return { x: left, y: top, w: right - left, h: bottom - top }
        }

        if (mode === 'maximize') {
            if (!originalWindowRects.has(hwnd)) {
                const style = parseInt(user32.GetWindowLongPtrW(hwnd, GWL_STYLE))
                const rect = getRect(hwnd)
                if (rect == null) return { success: false, message: 'ウィンドウ情報の取得に失敗しました。' }
                originalWindowRects.set(hwnd, { style, ...rect })
            }
            const cur = parseInt(user32.GetWindowLongPtrW(hwnd, GWL_STYLE))
            const newStyle = (cur & ~WS_OVERLAPPEDWINDOW) | WS_POPUP
            user32.SetWindowLongPtrW(hwnd, GWL_STYLE, newStyle)

            const hmon = user32.MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST)
            const mi = Buffer.alloc(40)
            mi.writeUInt32LE(40, 0) // cbSize
            if (!user32.GetMonitorInfoW(hmon, mi)) return { success: false, message: 'モニター情報の取得に失敗しました。' }
            const mLeft = mi.readInt32LE(4)
            const mTop = mi.readInt32LE(8)
            const mRight = mi.readInt32LE(12)
            const mBottom = mi.readInt32LE(16)
            user32.SetWindowPos(hwnd, 0, mLeft, mTop, mRight - mLeft, mBottom - mTop, SWP_NOZORDER | SWP_FRAMECHANGED)
            return { success: true }
        } else if (mode === 'restore') {
            const saved = originalWindowRects.get(hwnd)
            if (saved) {
                user32.SetWindowLongPtrW(hwnd, GWL_STYLE, saved.style)
                user32.SetWindowPos(hwnd, 0, saved.x, saved.y, saved.w, saved.h, SWP_NOZORDER | SWP_FRAMECHANGED)
                originalWindowRects.delete(hwnd)
            } else {
                const cur = parseInt(user32.GetWindowLongPtrW(hwnd, GWL_STYLE))
                const newStyle = (cur & ~WS_POPUP) | WS_OVERLAPPEDWINDOW
                user32.SetWindowLongPtrW(hwnd, GWL_STYLE, newStyle)
                user32.SetWindowPos(hwnd, 0, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED)
            }
            return { success: true }
        } else {
            return { success: false, message: 'Unknown mode' }
        }
    } catch (err) {
        console.error('[main] apply-window-mode failed', err)
        return { success: false, message: err.message }
    }
})
```

- [ ] **Step 2: `index.js` 内に `set-window-borderless` の参照が残っていないことを確認**

Run: `grep -n "set-window-borderless" index.js`
Expected: 出力なし（0件）。

- [ ] **Step 3: lint 確認**

Run: `npm run lint`
Expected: 追加コードで新規エラーが出ないこと。`ref` 未使用の警告が出る場合は `ref` の require 行を残しつつ eslint 設定に合わせて対応（既存の同ハンドラも同様に require していたため、既存挙動に合わせる）。

- [ ] **Step 4: コミット**

```bash
git add index.js
git commit -m "feat(borderless): add apply-window-mode IPC with resize/restore"
```

---

## Task 2: ウィンドウ選択オーバーレイのボタンを「最大化/最小化」に置換

**Files:**
- Modify: `app/overlay.ejs`（`#windowSelectActions` 31–36行）

**Interfaces:**
- Produces: DOM 要素 `#windowMaximizeButton`, `#windowMinimizeButton`（Task 3 がハンドラを付与）。`#windowSelectCancel` は維持。
- 削除: `#windowSelectConfirm`。

- [ ] **Step 1: `#windowSelectActions`（`app/overlay.ejs` 31–36行）を以下に置き換える**

```html
        <div id="windowSelectActions">
            <div id="windowSelectActionButtons">
                <button id="windowMaximizeButton" type="button">最大化</button>
                <button id="windowMinimizeButton" type="button">最小化</button>
            </div>
            <div id="windowSelectCancelWrapper">
                <button id="windowSelectCancel" class="overlayKeybindEsc">キャンセル</button>
            </div>
        </div>
```

- [ ] **Step 2: `#windowSelectConfirm` が overlay.ejs から消えたことを確認**

Run: `grep -n "windowSelectConfirm" app/overlay.ejs`
Expected: 出力なし（0件）。

- [ ] **Step 3: lint 確認**

Run: `npm run lint`
Expected: 新規エラーなし。

- [ ] **Step 4: コミット**

```bash
git add app/overlay.ejs
git commit -m "feat(borderless): replace window-select confirm with maximize/minimize buttons"
```

---

## Task 3: オーバーレイのロジックを最大化/最小化に対応

**Files:**
- Modify: `app/assets/js/scripts/overlay.js`（`#windowSelectConfirm` ハンドラ 515–561行 を置換）

**Interfaces:**
- Consumes: IPC `apply-window-mode`（Task 1）。DOM `#windowMaximizeButton`/`#windowMinimizeButton`（Task 2）。既存 `setOverlayContent`/`setOverlayHandler`/`toggleOverlay`。
- Produces: 関数 `getSelectedWindowHwnd()`, `applyWindowMode(mode, successMsg)`（このファイル内で完結）。

- [ ] **Step 1: `#windowSelectConfirm` の click ハンドラ（`overlay.js` 515–561行）を、以下に置き換える**

```js
function getSelectedWindowHwnd(){
    const listings = document.getElementsByClassName('windowListing')
    for(let i=0; i<listings.length; i++){
        if(listings[i].hasAttribute('selected')){
            return listings[i].getAttribute('hwnd')
        }
    }
    return null
}

async function applyWindowMode(mode, successMsg){
    const hwnd = getSelectedWindowHwnd()
    if(hwnd == null){
        setOverlayContent('未選択', 'ウィンドウを選択してください。', 'OK')
        setOverlayHandler(null)
        toggleOverlay(true)
        return
    }
    try {
        const res = await _ipc.invoke('apply-window-mode', hwnd, mode)
        if(res && res.success){
            setOverlayContent('完了', successMsg, 'OK')
        } else {
            setOverlayContent('失敗', res && res.message ? res.message : '操作に失敗しました。', 'OK')
        }
    } catch (err) {
        setOverlayContent('エラー', err.message || '不明なエラーが発生しました。', 'OK')
    }
    document.getElementById('windowFilterInput').value = ''
    setOverlayHandler(null)
    toggleOverlay(true)
}

document.getElementById('windowMaximizeButton').addEventListener('click', () => {
    applyWindowMode('maximize', '選択したウィンドウをボーダーレス化しました。')
})

document.getElementById('windowMinimizeButton').addEventListener('click', () => {
    applyWindowMode('restore', '選択したウィンドウを元のサイズに戻しました。')
})
```

- [ ] **Step 2: 旧 `windowSelectConfirm`/`set-window-borderless` 参照が overlay.js に残っていないことを確認**

Run: `grep -n "windowSelectConfirm\|set-window-borderless" app/assets/js/scripts/overlay.js`
Expected: 出力なし（0件）。

- [ ] **Step 3: lint 確認**

Run: `npm run lint`
Expected: 新規エラーなし。

- [ ] **Step 4: コミット**

```bash
git add app/assets/js/scripts/overlay.js
git commit -m "feat(borderless): wire maximize/minimize buttons to apply-window-mode"
```

---

## Task 4: メイン画面左下にアイコンボタンを追加し、オーバーレイを開く

**Files:**
- Modify: `app/landing.ejs`（`#lower > #left` 内 71–97行の `#content`）
- Modify: `app/assets/js/scripts/landing.js`（`server_selection_button` バインド直後、208行付近）

**Interfaces:**
- Consumes: `toggleWindowSelection(true)`（overlay.js、landing.js から呼び出し可能。既存 `server_selection_button` が同様に `toggleServerSelection` を直接呼んでいる）。
- Produces: DOM `#borderlessMediaButton`（+ `#borderlessSVG`, `#borderlessTooltip`）。

- [ ] **Step 1: `app/landing.ejs` の `#lower > #left` 内、`#mojangStatusWrapper` の `</div>`（94行）の直後・`#content` の閉じ `</div>`（95行）の直前に、区切りとアイコンボタンを追加する**

```html
                    <div class="bot_divider"></div>
                    <button class="mediaButton" id="borderlessMediaButton" type="button">
                        <svg id="borderlessSVG" class="mediaSVG" viewBox="0 0 24 24">
                            <path d="M3 4h18a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm1 4v10h16V8H4z"/>
                        </svg>
                        <div id="borderlessTooltip">ボーダーレス化</div>
                    </button>
```

- [ ] **Step 2: `app/assets/js/scripts/landing.js` の 208行（`server_selection_button` の `if` ブロックを閉じる `}`）の直後に、以下を追加する**

```js
// Borderless button (bottom-left of landing) opens the window selection overlay.
const borderlessMediaButton = document.getElementById('borderlessMediaButton')
if (borderlessMediaButton) {
    borderlessMediaButton.onclick = async e => {
        e.currentTarget.blur()
        await toggleWindowSelection(true)
    }
}
```

- [ ] **Step 3: lint 確認**

Run: `npm run lint`
Expected: 新規エラーなし。

- [ ] **Step 4: コミット**

```bash
git add app/landing.ejs app/assets/js/scripts/landing.js
git commit -m "feat(borderless): add borderless icon button to landing bottom-left"
```

---

## Task 5: アイコン/ツールチップの CSS を追加

**Files:**
- Modify: `app/assets/css/launcher.css`（`.mediaButton`/`#settingsTooltip` 定義がある 4076–4160行付近の末尾に追記）

**Interfaces:**
- Consumes: `#borderlessMediaButton`/`#borderlessSVG`/`#borderlessTooltip`（Task 4）。

- [ ] **Step 1: `app/assets/css/launcher.css` の `.mediaButton:hover #settingsTooltip { ... }` ブロック（4151行付近）の後ろに、以下を追記する**

```css
/* Borderless button (landing bottom-left) icon sizing. */
#borderlessSVG {
    height: 22px;
    width: 22px;
    vertical-align: middle;
}
.mediaButton:hover #borderlessSVG,
.mediaButton:focus #borderlessSVG,
.mediaButton:active #borderlessSVG {
    height: 24px;
    width: 24px;
}
#borderlessMediaButton {
    position: relative;
}

/* Borderless tooltip: appears above the icon (button is at the bottom of the screen). */
#borderlessTooltip {
    visibility: hidden;
    opacity: 0;
    position: absolute;
    bottom: 130%;
    left: 50%;
    transform: translateX(-50%);
    white-space: nowrap;
    background-color: rgba(0, 0, 0, 0.75);
    color: #fff;
    text-align: center;
    padding: 5px 10px;
    border-radius: 4px;
    font-size: 12px;
    z-index: 1;
    transition: visibility 0s linear 0.25s, opacity 0.25s ease;
}
#borderlessTooltip::after {
    content: " ";
    position: absolute;
    top: 100%;
    left: 50%;
    margin-left: -5px;
    border-width: 5px;
    border-style: solid;
    border-color: rgba(0, 0, 0, 0.75) transparent transparent transparent;
}
.mediaButton:hover #borderlessTooltip,
.mediaButton:focus #borderlessTooltip,
.mediaButton:active #borderlessTooltip {
    visibility: visible;
    opacity: 1;
    transition: visibility 0s linear 0s, opacity 0.25s ease;
}
```

- [ ] **Step 2: lint 確認（CSSはeslint対象外だが、jsに影響が無いことを確認）**

Run: `npm run lint`
Expected: 新規エラーなし。

- [ ] **Step 3: コミット**

```bash
git add app/assets/css/launcher.css
git commit -m "style(borderless): add landing icon button and upward tooltip styles"
```

---

## Task 6: 設定画面から旧ボーダーレス項目とバインドを撤去

**Files:**
- Modify: `app/settings.ejs`（`settingsFieldContainer` 344–355行）
- Modify: `app/assets/js/scripts/settings.js`（`#settingsBorderlessButton` 1994行〜 と `#settingsAutoBorderlessButton` 2016行〜 のバインド）

**Interfaces:**
- 削除のみ。overlay.js のウィンドウ選択ロジックは landing から使うため残す。

- [ ] **Step 1: `app/settings.ejs` の該当 `settingsFieldContainer`（344–355行の、"Minecraft ウィンドウをボーダーレス化" を含むブロック丸ごと）を削除する**

削除対象は以下のブロック:

```html
            <div class="settingsFieldContainer">
                <div class="settingsFieldLeft">
                    <span class="settingsFieldTitle">Minecraft ウィンドウをボーダーレス化</span>
                    <span class="settingsFieldDesc">起動中のMinecraftウィンドウを選択してボーダーレスにします。Windowsのみ対応です。</span>
                </div>
                <div class="settingsFieldRight">
                    <div style="display:flex;gap:8px;align-items:center;">
                        <button id="settingsBorderlessButton">ウィンドウを選択してボーダーレス化</button>
                        <button id="settingsAutoBorderlessButton">Minecraftを自動でボーダーレス化</button>
                    </div>
                </div>
            </div>
```

- [ ] **Step 2: `app/assets/js/scripts/settings.js` から、`#settingsBorderlessButton` のバインド（`// Bind borderless button to open window selection overlay` コメントを含む 1994行〜）と、`#settingsAutoBorderlessButton` のバインド（`// Bind auto-detect Minecraft borderless button` コメントを含む 2016行〜、その `onclick` 関数の閉じまで）を丸ごと削除する**

削除後、これら2つの識別子が settings.js に残っていないこと。

- [ ] **Step 3: 旧識別子が残っていないことを確認**

Run: `grep -rn "settingsBorderlessButton\|settingsAutoBorderlessButton" app`
Expected: 出力なし（0件）。

- [ ] **Step 4: lint 確認**

Run: `npm run lint`
Expected: 新規エラーなし。

- [ ] **Step 5: コミット**

```bash
git add app/settings.ejs app/assets/js/scripts/settings.js
git commit -m "refactor(borderless): remove borderless controls from settings screen"
```

---

## Task 7: 手動での統合動作確認

**Files:** なし（手動確認）

- [ ] **Step 1: アプリを起動**

Run: `npm start`

- [ ] **Step 2: 以下を順に確認する（スペックのテスト観点）**

1. メイン画面左下にウィンドウアイコンが表示され、ホバーで「ボーダーレス化」ツールチップが上向きに出る。
2. アイコンをクリックするとウィンドウ選択オーバーレイが開き、一覧が表示される。
3. 任意のウィンドウを選び「最大化」→ 枠が消えて、そのウィンドウのモニター全体に広がる。
4. 同じウィンドウを選び「最小化」→ 元のサイズ・位置・枠に戻る。
5. ウィンドウ未選択のまま最大化/最小化 → 「ウィンドウを選択してください」が表示される。
6. 設定画面を開き、旧ボーダーレス項目（2ボタン）が消えていることを確認する。
7. ネイティブモジュール未導入環境では、クラッシュせず「利用できません」系メッセージが出ること（該当環境がある場合のみ）。

- [ ] **Step 3: 問題があればログを確認**

コンソール（`Ctrl + Shift + I`）およびメインプロセスログ（`[main] apply-window-mode failed` 等）を確認し、該当タスクに戻って修正する。

---

## 自己レビュー結果

- **スペック網羅**: A(左下アイコン)=Task4/5、B(オーバーレイ改修)=Task2、C(最大化/最小化ロジック+リサイズ/復元)=Task1/3、設定撤去=Task6、手動テスト観点=Task7。全項目にタスクあり。
- **プレースホルダ**: なし（全ステップに具体コード/コマンドを記載）。
- **型/識別子整合**: IPC名 `apply-window-mode` と mode 値 `'maximize'|'restore'` が Task1(定義)・Task3(呼び出し)で一致。DOM id `#windowMaximizeButton`/`#windowMinimizeButton`/`#borderlessMediaButton`/`#borderlessSVG`/`#borderlessTooltip` が生成タスクと参照タスクで一致。
- **注意点の反映**: 「最小化=復元」の意味、Windows限定、依存未導入時フォールバック、mainでコミットしない運用をGlobal Constraintsに明記。
