# 自作構成の並び替え・お気に入り設計

- 日付: 2026-09-01
- 目的: 「自作」一覧でインスタンスを**ドラッグで並び替え**、**お気に入り（★）で上部固定**できるようにする。

## 決定事項
1. 各インスタンスに `favorite: boolean` を追加。並び順は `customInstances` 配列順で保持。
2. 表示順 = お気に入り優先（安定ソート `(b.favorite?1:0)-(a.favorite?1:0)`）→ 各グループ内は配列順。
3. ドラッグは配列順を並び替えて保存。★を跨ぐ移動は★フラグ側が優先（見た目上は★同士/非★同士で並び替わる）。

## 変更詳細
### A. ConfigManager（configmanager.js）
- `moveCustomInstance(id, targetId)`: 配列内で `id` を `targetId` の直前へ移動（targetId無ければ末尾）。
- `favorite` は既存 `updateCustomInstance(id, {favorite})` で設定。

### B. 一覧描画（overlay.js `populateCustomInstanceListings`）
- `const instances = ConfigManager.getCustomInstances().slice().sort((a,b)=>(b.favorite?1:0)-(a.favorite?1:0))`。
- 各行 `.customInstanceListing` に `draggable="true"` を付与。
- 行の操作に **★トグル** `<button class="customFavorite" cid>`（`favorite` で `★`、他は `☆`）を先頭追加。

### C. ハンドラ（overlay.js `setCustomInstanceHandlers`）
- `.customFavorite`: クリックで `updateCustomInstance(cid,{favorite:!cur})` ＋ `save` ＋ `populateCustomInstanceListings()`（★が上へ）。`stopPropagation`。
- ドラッグ: 各行に
  - `dragstart` → `_dragCid = cid`、行に `dragging` クラス。
  - `dragover` → `e.preventDefault()`（ドロップ許可）、対象行に挿入インジケータ。
  - `drop` → `ConfigManager.moveCustomInstance(_dragCid, targetCid)` ＋ `save` ＋ 再描画。
  - `dragend` → クラス除去、`_dragCid=null`。
  - 行内ボタン/入力は既存の `stopPropagation` で誤操作を防止。
- CSS: `.customInstanceListing.dragging { opacity:0.5 }`、`.customInstanceListing.dragover { border-color:#7ad67a }`、`.customFavorite`（★は金色 `#f5c518`）。

## セキュリティ/前提
- ローカルconfigのみ。既存の選択・改名・各操作に影響なし。

## テスト（実機DIAG）
1. ★トグルでお気に入りが上部固定（再描画で先頭へ）。configに `favorite` 保存。
2. ドラッグでcが配列順が入れ替わり `customInstances` 配列に反映・保存。
3. 再描画後も順序・★保持。
4. 既存操作（選択/改名/版変更/共有/削除）に回帰なし。
5. lint 増加なし（基準21）。

## 実装順
1. configmanager: `moveCustomInstance`。
2. overlay.js: 描画に★＋draggable、ハンドラに★トグル＋ドラッグ、CSS。
3. 実機DIAGで★・並び替え・永続化を検証。
