# ボーダーレス化機能をメイン画面へ移設する設計

- 日付: 2026-08-23
- 対象: NumapoteLauncher (沼ぽてランチャー)
- 目的: 現在「設定」画面にあるウィンドウ・ボーダーレス化機能を、メイン画面（landing）左下のアイコンボタンから使えるようにし、選択したウィンドウを「最大化（ボーダーレスフルスクリーン）」「最小化（元のサイズに復元）」できるようにする。

## 背景（現状）

- ボーダーレス機能は **設定画面** にある。
  - `app/settings.ejs` 346–355行付近に `settingsFieldContainer` があり、
    「ウィンドウを選択してボーダーレス化」(`#settingsBorderlessButton`) と
    「Minecraftを自動でボーダーレス化」(`#settingsAutoBorderlessButton`) の2ボタンがある。
  - `app/assets/js/scripts/settings.js` 1994–2064行付近でこれらをバインドしている。
- ウィンドウ選択のオーバーレイ `#windowSelectContent` は既に `app/overlay.ejs` (20–37行) にあり、
  ロジックは `app/assets/js/scripts/overlay.js` (453–579行) にある
  (`populateWindowListings` / `setWindowListingHandlers` / `toggleWindowSelection` /
  `#windowSelectConfirm` ハンドラなど)。
- バックエンドは `index.js`:
  - `list-windows` (350行) … 開いているウィンドウ一覧を返す（`node-window-manager` 使用）。
  - `set-window-borderless(hwnd, makeBorderless)` (378行) … `ffi-napi` で user32 を呼び、
    `WS_OVERLAPPEDWINDOW`⇄`WS_POPUP` を切り替えるのみ。**`SetWindowPos` は `NOMOVE|NOSIZE`
    のためサイズ・位置は変えていない。** = 「画面全体に広げる」動作は未実装。

## 決定事項（確定済み）

1. **「最大化」の挙動**: 枠を消して、そのウィンドウがあるモニター全体に広げる
   （ボーダーレスフルスクリーン）。「最小化」は必ず元の枠付きサイズ・位置に戻す。
2. **設定画面の既存2ボタン**: 両方削除し、メイン画面のボタンに一本化する
   （「自動でボーダーレス化」機能も設定からは撤去）。
3. **メイン画面のボタン**: テキストではなく「ウィンドウ」を表すアイコンボタンとし、
   カーソルを合わせると「ボーダーレス化」というツールチップを表示する
   （既存の `.mediaButton` + `#settingsTooltip` と同じ流儀）。

## 採用アプローチ

サイズ拡大・復元は **既存の FFI(user32) 方式を拡張** して実装する。
`node-window-manager` の `setBounds` は使わない（枠スタイル変更ができずFFI併用になり、
座標系混在によるDPIズレのリスクがあるため）。

モニター矩形は user32 の `MonitorFromWindow` + `GetMonitorInfoW` から物理ピクセルで取得し、
同じく物理ピクセルで動く `SetWindowPos` と座標系を揃える（DPIスケーリング下でもズレない）。

## 変更詳細

### A. メイン画面左下のアイコンボタン (`app/landing.ejs`)

- `#lower > #left`（サーバー状態・Mojang状態が並ぶ左下クラスタ）内に、
  ウィンドウを表すSVGアイコンボタンを1つ追加する。
- マークアップは既存の内部メディアボタンに倣う:
  - `button.mediaButton#borderlessMediaButton`
  - 中に `svg.mediaSVG#borderlessSVG`（「ウィンドウ」を表すシンプルな図形）
  - ホバー用ツールチップ `div#borderlessTooltip` にテキスト「ボーダーレス化」
- クリックで `toggleWindowSelection(true)` を呼び、`#windowSelectContent` オーバーレイを開く。
  - `overlay.js` は landing より後に読み込まれるため、`settings.js` と同様に
    関数が未定義の場合は短時間リトライするガードを入れる。

### B. ボタン/ツールチップの CSS (`app/assets/css/launcher.css`)

- 既存 `.mediaButton` / `.mediaSVG` を流用しつつ、左下配置に合わせた専用ツールチップ
  `#borderlessTooltip` を追加する。
  - 既存 `#settingsTooltip` は右側に出る配置なので、左下ボタン用にはアイコンの
    **上方向** に出るよう `bottom`/`left` と矢印(`::after`)の向きを調整した別定義にする。
  - 表示トリガは `.mediaButton:hover/focus/active #borderlessTooltip { visibility:visible; opacity:1 }`。

### C. ウィンドウ選択オーバーレイの改修 (`app/overlay.ejs`)

- `#windowSelectActions` (31–36行) の確定ボタン `#windowSelectConfirm`「選択してボーダーレス」を、
  次の2ボタンに置き換える:
  - `#windowMaximizeButton`「最大化」
  - `#windowMinimizeButton`「最小化」
- キャンセル `#windowSelectCancel` は維持。
- Enterキーで誤動作しないよう `overlayKeybindEnter` の付与は付けない
  （最大化/最小化を明示クリックさせる。Escはキャンセルに付与）。

### D. オーバーレイのロジック改修 (`app/assets/js/scripts/overlay.js`)

- 既存 `#windowSelectConfirm` のハンドラ (515行〜) を削除し、
  選択中ウィンドウの `hwnd` を取得する共通関数 `getSelectedWindowHwnd()` を用意する。
- `#windowMaximizeButton` / `#windowMinimizeButton` にそれぞれハンドラを付与:
  - 未選択なら「ウィンドウを選択してください」を通知して中断。
  - 選択済みなら後述の新IPCを呼び、成功/失敗をオーバーレイで通知する。
- 通知後にオーバーレイを一覧に戻すか閉じるかは既存踏襲（結果ダイアログ表示 → OKで閉じる）。

### E. バックエンドIPCの拡張 (`index.js`)

- 新ハンドラ `apply-window-mode(hwnd, mode)` を追加する（`mode` は `'maximize' | 'restore'`）。
  既存 `set-window-borderless` は設定画面撤去に伴い呼び出し元がなくなるため削除する。
- メインプロセスに `const originalWindowRects = new Map()` を持つ。キーは `hwnd`(数値)。
- 追加する user32 関数（FFI定義に追記）:
  - `GetWindowRect(hwnd, lpRect)` … RECT(4×int32) を Buffer で受ける。
  - `MonitorFromWindow(hwnd, dwFlags)` … `MONITOR_DEFAULTTONEAREST(2)`。
  - `GetMonitorInfoW(hMonitor, lpmi)` … MONITORINFO(40byte, 先頭に cbSize=40)。rcMonitor は offset 4。
  - 既存の `GetWindowLongPtrW` / `SetWindowLongPtrW` / `SetWindowPos` は流用。
- `mode === 'maximize'`:
  1. `originalWindowRects` に当該 hwnd が未登録なら、現在の `style`(GetWindowLongPtrW) と
     `GetWindowRect` の {x,y,w,h} を保存する。
  2. スタイルを `(style & ~WS_OVERLAPPEDWINDOW) | WS_POPUP` にする。
  3. `MonitorFromWindow`+`GetMonitorInfoW` でモニター矩形を得て、
     `SetWindowPos(hwnd, 0, mon.left, mon.top, mon.width, mon.height,
     SWP_NOZORDER | SWP_FRAMECHANGED)` で全画面に広げる。
  4. `{success:true}` を返す。
- `mode === 'restore'`:
  1. `originalWindowRects` から保存値を取得。
  2. あれば元のスタイルに戻し、元の {x,y,w,h} に `SetWindowPos`（FRAMECHANGED付き）で復元し、
     Map から当該エントリを削除。
  3. 保存値が無ければフォールバックとして枠のみ `WS_OVERLAPPEDWINDOW` に戻す。
  4. `{success:true}` を返す。
- 非Windows / モジュール未導入 / ハンドル不正 は既存同様 `{success:false, message}` を返す。

### F. 設定画面からの撤去

- `app/settings.ejs` の該当 `settingsFieldContainer`（346–355行付近）を削除。
- `app/assets/js/scripts/settings.js` の `#settingsBorderlessButton`（1994行〜）と
  `#settingsAutoBorderlessButton`（2016行〜）のバインドを削除。
- `overlay.js` 側のウィンドウ選択ロジックは landing から使うため残す。
- 「自動でボーダーレス化」機能は今回のUIには含めない（決定事項2）。

## スコープ外 / 注意点

- 本機能は `ffi-napi` / `ref-napi` / `node-window-manager` ネイティブモジュールに依存するが、
  現状 `package.json` に依存が記載されていない。**未導入環境ではこの機能は動作しない。**
  今回はUI/ロジック改修が主眼であり、依存の追加・ビルド対応は本スペックのスコープ外とする
  （動作確認には別途これらの導入が必要）。この前提は実装時に既存のtry/catchによる
  「利用不可メッセージ」で安全にフォールバックされる。
- 対応OSは Windows のみ（既存踏襲）。他OSでは `{success:false}` を返しメッセージ表示。
- 複数モニター: ウィンドウが跨っている場合は `MONITOR_DEFAULTTONEAREST` により
  最も重なりの大きいモニターへ広げる。

## テスト観点（手動確認）

1. メイン画面左下にアイコンが表示され、ホバーで「ボーダーレス化」が出る。
2. クリックでウィンドウ選択オーバーレイが開き、一覧が表示される。
3. ウィンドウを選び「最大化」→ 枠が消えモニター全体に広がる。
4. 同じウィンドウで「最小化」→ 元のサイズ・位置・枠に戻る。
5. 未選択で最大化/最小化 → 選択を促すメッセージ。
6. 設定画面から旧2ボタンが消えている。
7. 非対応環境（モジュール未導入）でクラッシュせずメッセージ表示。
