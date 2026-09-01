# ③ 外部導入（Modrinth）機能の設計

- 日付: 2026-08-31
- 対象: NumapoteLauncher (沼ぽてランチャー)
- 目的: 選択中のパック（公式・自作の両方）に対して、**Modrinth** から MOD を検索して
  導入できるようにする。導入は選択中パックの `mods` フォルダ（ドロップインMOD）に落とし、
  既存の設定「Mod」タブで管理する。**必須依存(required dependencies)は自動で一緒に導入**する。
- スコープ: 本仕様は **③のうち Modrinth のみ**。CurseForge は将来（APIキー問題が別途）。
  Modrinthモジュールは「モッドパック(.mrpack)一括導入」は含めない（個別MODのみ）。

## 決定事項（確定済み）

1. ソースは **Modrinth**（公開API・APIキー不要・User-Agent必須）から。
2. 導入対象は **個別MOD**（＋**必須依存の自動解決**）。任意依存(optional)は自動導入しない。
3. UIは**設定「Mod」タブ内**に「Modrinthから追加」導線を置く。
4. 導入先は**選択中パックの `mods` フォルダ**（ドロップイン）。公式・自作の両方で使える。

## 背景（現状のアーキテクチャ）

- 設定「Mod」タブ（`settingsTabMods`）は、選択中パックの `instances/<serverId>/mods` を対象に
  ドロップインMODの一覧・有効/無効・削除・ドラッグ＆ドロップ追加を提供する
  ([settings.js](../../../app/assets/js/scripts/settings.js) の `resolveDropinModsForUI` 757行 ほか)。
- ただし現状は選択中パックを `distro.getServerById(getSelectedServer())` で引くため、
  **自作インスタンス(custom instance)だと `null` になり Mod タブが空**になる
  （[settings.js:764](../../../app/assets/js/scripts/settings.js) 等、全体で `getServerById` 依存）。
  → ③では、まずこの「Modタブの自作インスタンス対応（① section G）」を土台として実装する。
- 自作インスタンスは `ConfigManager.getCustomInstance(id)` で `{minecraftVersion, loader, ...}` を
  取得できる（M1で実装済み）。公式パックは `serv.rawServer.minecraftVersion` と
  `serv.modules`（Type.Forge / Type.Fabric）からローダーが分かる。
- ダウンロードは helios-core の `downloadFile(url, path)` を利用（M2で使用実績あり）。

## 採用アプローチ

Modrinth の公開 REST API（`https://api.modrinth.com/v2`）を用いる。導入先は選択中パックの
mods フォルダ（既存のドロップイン機構に載せる）。管理UIは既存の設定「Mod」タブに統合する。
「Modタブの自作対応」を先に入れることで、公式・自作の両方で同じ導線になる。

## 変更詳細

### A. 土台：設定「Mod」タブを自作インスタンス対応にする（① section G）

- `settings.js` に共通ヘルパ `resolveSelectedServerLike()` を追加:
  - 選択中IDが配布サーバーにあれば従来通り `getServerById` の結果を返す。
  - 無く、かつ `ConfigManager.getCustomInstance(id)` があれば、**疑似サーバー相当**
    `{ rawServer: { id, minecraftVersion, name }, modules: [] }` を返す。
- Mod タブ関連（`resolveDropinModsForUI` 757行、`parseModulesForUI` を使う描画、
  `saveDropinModConfiguration`、モッドフォルダのパス算出 914行/1091行 など）が、
  `getServerById(...)` の直呼びをやめて `resolveSelectedServerLike()` を使う。
- 疑似サーバーは `modules: []` なので「必須/任意MOD」節は空になり、**ドロップインMOD節のみ**
  表示される（自作パックにはドロップインしか無いので想定通り）。
- これにより自作パックでも Mod タブでドロップインMOD（追加/削除/有効/無効）が使える。

### B. Modrinth API モジュール（新規 `app/assets/js/scripts/modrinth.js`）

`window.NLModrinth` を公開。すべて `fetch`。**User-Agent** に
`NumapoteLauncher/<appver> (github.com/oogatakun/NumapoteLauncher)` を付ける（Modrinth推奨）。

- `async search(query, mcVersion, loader, limit=20)`:
  - `GET /v2/search?query=<q>&limit=<n>&facets=[["project_type:mod"],["versions:<mc>"],["categories:<loader>"]]`
  - 返り値: `[{ projectId, slug, title, author, description, iconUrl, downloads }]`
- `async getBestVersion(projectId, mcVersion, loader)`:
  - `GET /v2/project/<id>/version?game_versions=["<mc>"]&loaders=["<loader>"]`
  - 対応する最新の version を1つ選び、`{ versionId, files:[{url,filename,primary}], dependencies }` を返す。
    無ければ null。
- `async resolveRequiredDeps(version, mcVersion, loader, visited)`:
  - `version.dependencies` のうち `dependency_type === 'required'` を再帰解決。
  - 各依存の `project_id`（または `version_id`）から対応バージョンを取得し、ダウンロード対象へ追加。
  - `visited`（SetにprojectId）で重複・循環を回避。
- `maven/pathは不要`（Modrinthのfile.urlは直リンク）。

### C. 導入先コンテキスト判定（`settings.js` もしくは新規UIスクリプト）

- `getModTargetContext()`:
  - 選択中が自作インスタンス → `{ id, mc: instance.minecraftVersion, loader: instance.loader, modsDir }`
  - 公式パック → `{ id, mc: serv.rawServer.minecraftVersion, loader: <modulesからforge/fabric判定>, modsDir }`
  - `modsDir = instances/<id>/mods`
  - `loader` が `vanilla`（自作バニラ）や不明の場合は「このパックはMOD非対応です（Fabric/Forgeが必要）」を表示し、導入UIを出さない。
  - Modrinthの loader 名は小文字（`fabric`/`forge`/`quilt`/`neoforge`）。自作の `forge`/`fabric` はそのまま使う。

### D. UI：Modrinth 検索・追加（`settings.ejs` / 新規 `modrinth-ui` ロジック / `launcher.css`）

- 設定Modタブの `#settingsDropinModsContainer`（「Mod追加」ボタン付近）に
  「**Modrinthから追加**」ボタン `#settingsModrinthButton` を追加。
- クリックで検索パネル（オーバーレイ or タブ内展開）を開く:
  - 検索入力 `#modrinthSearchInput` ＋ 実行、結果リスト `#modrinthResults`。
  - 各結果に アイコン/名前/作者/DL数 と「**追加**」ボタン。
  - 検索は導入先コンテキストの `mc`＋`loader` で facets 絞り込み（互換のみ表示）。
- 「追加」で:
  1. `getBestVersion` で対応バージョン取得（無ければ「このパックに対応するバージョンがありません」）。
  2. `resolveRequiredDeps` で必須依存を集約。
  3. 本体＋依存の各 primary file を `modsDir` に `downloadFile` で保存（既存ファイルはスキップ）。
  4. 進捗/結果を表示（「〇〇 と依存2件を追加しました」等）。
  5. `resolveDropinModsForUI()` を呼んで Mod タブのドロップイン一覧を更新。

### E. ダウンロード

- 保存先 `path.join(modsDir, file.filename)`。`fs.existsSync` でスキップ。
- `downloadFile(file.url, dest)`（helios-core/dl）。失敗時は該当MODをスキップしメッセージ。

## セキュリティ / プライバシー

- Modrinth 公開APIのみ。認証情報は送らない。User-Agent にランチャー名/版のみ。
- ダウンロードは Modrinth CDN（`cdn.modrinth.com`）からの MOD jar。ユーザー操作起点でのみ実行。

## スコープ外（将来）

- CurseForge 導入（APIキー問題）。
- Modrinth モッドパック(.mrpack) 一括導入。
- 任意依存(optional)の自動導入、MODのバージョン固定/更新管理。

## エラー / 前提

- 通信失敗・レート制限（429）・対応バージョン無し・ローダー無しパック → それぞれ分かりやすく表示。
- Modrinth の loader 名とインスタンスの loader 名の対応（fabric/forge）を合わせる。
- 失敗時は既存のオーバーレイ（`setOverlayContent`）で通知。

## テスト観点（手動確認）

1. （section G）自作インスタンス選択中に設定Modタブでドロップイン一覧・追加・削除・有効/無効が動く。
2. 公式パック選択中に「Modrinthから追加」で検索でき、互換MODのみ出る。
3. 自作(Fabric)パックで検索→MOD追加→`mods` に jar が入り、Modタブに出る。
4. 必須依存を持つMOD（例: 何かのライブラリ依存）を追加すると、依存jarも一緒に入る。
5. バニラ自作パックでは「MOD非対応」表示になり導入UIが出ない。
6. 既存jarがある場合は再DLされない。
7. 通信失敗/対応版なし時に分かりやすいエラーが出る。
8. lint に新規エラーが増えていない。

## 実装順（③の中での段階）

1. **section G**（Modタブ自作対応）— 単体で価値があり、Modrinth導入の前提。
2. Modrinth APIモジュール＋導入先コンテキスト判定。
3. 検索UI＋単体MOD追加（依存なし）を通す。
4. 必須依存の自動解決を追加。
5. エラー/非対応表示の仕上げ。
