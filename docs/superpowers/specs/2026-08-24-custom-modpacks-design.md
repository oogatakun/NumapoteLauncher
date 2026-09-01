# 自作Modパック（自作インスタンス）機能の設計

- 日付: 2026-08-24
- 対象: NumapoteLauncher (沼ぽてランチャー)
- 目的: Modパック選択画面にタブを追加し、「公式」(oogatakun 管理の配布パック) に加えて、
  ユーザーが自分でMinecraft／Forge／Fabricのバージョンを選んで**自分だけの起動構成
  （自作インスタンス）**を作成・起動できるようにする。
- スコープ: 本仕様は **①基盤** のみを詳細化する。②③④は将来層としてロードマップに記載し、
  ①のデータモデル・境界がそれらを阻害しないことを保証する。

## ロードマップ（段階的に実装）

| 層 | 内容 | 前提 |
|----|------|------|
| **① 基盤（本仕様）** | 自作タブ／MC＋ローダー(Forge/Fabric/なし)のバージョンを選び、名前を付けて自作インスタンスを作成→起動。Modは専用フォルダに投入 | なし |
| ~~② Mod管理~~ | **既に実装済み**（設定画面「Mod」タブ＋dropinmodutil）。①で自作インスタンス対応にするだけ（下記 G） | ① |
| ③ 外部導入 | CurseForge/Modrinth からMODを検索して**選択中パックに導入**。**公式パック・自作パック両方**で使える（導入先は各パックの mods フォルダ＝ドロップイン） | ① |
| ④ 共有 | 起動構成をID/コード/URLで書き出し・貼り付け導入（**リアルタイム同期ではない**） | ①（③があると価値増） |

**②についての重要な訂正**: アプリ内Mod管理（ドラッグ＆ドロップ追加・削除・有効/無効）は
既に設定画面の「Mod」タブ（`settingsTabMods`）＋
[dropinmodutil.js](../../../app/assets/js/dropinmodutil.js) で**実装済み**。選択パックの
`instances/<id>/mods` を対象に動く。したがって②を新規に作る必要はなく、①で
「自作インスタンスも設定Modタブで扱えるようにする」だけでよい（下記 G）。

**④のための前提（①で担保する）**: 自作インスタンスの定義は「自己完結した小さなJSON」として
シリアライズできる形にする。将来、これをBase64/短縮コード/URLに載せて共有し、貼り付けで復元できる。
①では共有UIは作らないが、データモデルがこれを可能にする。

## 背景（現状のアーキテクチャ）

- 本ランチャーは HeliosLauncher フォークで **配布(distribution.json)主導型**。パック一覧・MC版・
  ローダー・Modはすべて remote の [distribution.json](../../../app/assets/js/distromanager.js) で
  定義され、ユーザーは選ぶだけ。ユーザーが版を選ぶ／自作構成を作る概念は無い。
- 起動は [landing.js の dlAsync](../../../app/assets/js/scripts/landing.js) が
  `DistributionIndexProcessor` で配布定義を読み、指定通りに導入して起動する。
- **`ProcessBuilder`**（[processbuilder.js](../../../app/assets/js/processbuilder.js)）は
  `constructor(distroServer, vanillaManifest, modManifest, authUser, launcherVersion)` を取り、
  `distroServer.rawServer.{id,minecraftVersion}` と `distroServer.modules`、
  `vanillaManifest`（Mojang版JSON）、`modManifest`（ローダー版JSON）から起動コマンドを組み立てる
  **データ駆動**構造。→ 配布に無い自作インスタンスでも、同じ形のデータを渡せば起動できる。
- **ドロップインMod機構が既存**（[dropinmodutil.js](../../../app/assets/js/dropinmodutil.js) の
  `scanForDropinMods`）。instanceの mods フォルダのルーズMODを読める。→「手動投入」はこれを流用。
- **Forge導入の実装が既存**（helios-core の DistributionIndexProcessor.installForge が
  ForgeInstallerCLI を実行し `versions/<forgeVer>.json` を生成）。→ 任意版のForgeも同経路で導入可能。
- Fabric は helios-core に無い → Fabric Meta API から自前で導入する（比較的単純）。

## 採用アプローチ

**疑似サーバーオブジェクト＋ProcessBuilder流用**（案A）。
自作インスタンスを「配布サーバーと同じ形のオブジェクト」に整形し、既存の起動処理へ渡す。
ローカル distribution.json 生成（案B）や独立パイプライン新設（案C）は、二重化・前提崩れの
リスクが大きいため採らない。

## 変更詳細（①基盤）

### A. データモデル：自作インスタンス

`config.json`（ConfigManager）に `customInstances` 配列を追加。各要素は**共有可能な自己完結JSON**:

```
{
  "schema": 1,
  "id": "<生成ID>",            // 内部用（フォルダ名）。共有時は受け手側で再採番
  "name": "<表示名>",
  "minecraftVersion": "1.20.1",
  "loader": "fabric" | "forge" | "vanilla",
  "loaderVersion": "0.15.11",  // vanilla の場合は空
  "created": <epoch ms>,
  "lastPlayed": <epoch ms | null>
}
```

- ConfigManager に CRUD を追加: `getCustomInstances()`, `getCustomInstance(id)`,
  `addCustomInstance(obj)`, `updateCustomInstance(id, patch)`, `removeCustomInstance(id)`。
- 実体ディレクトリは `getInstanceDirectory()/<id>/`（`mods/`, `config/` 等）。
- 共有(④)を見据え、`id`/`created`/`lastPlayed` を除いた
  `{schema,name,minecraftVersion,loader,loaderVersion}` が「起動構成コード」の中身になる想定。

### B. UI：Modパック選択オーバーレイにタブ

[overlay.ejs](../../../app/overlay.ejs) の `#serverSelectContent` にタブバーを追加:
- タブ「公式」: 現行の配布パック一覧（`populateServerListings`）。
- タブ「自作」: `customInstances` 一覧＋「＋ 新規作成」ボタン。各行に「フォルダを開く」「削除」。
- タブ切替は表示するリストの出し分けのみ（`overlay.js` に `activeServerTab` 状態を追加）。
- 「自作」で項目を選ぶと、選択サーバーとして扱えるよう内部を統一する（下記 E の疑似サーバー化を
  `updateSelectedServer` 経路に載せる）。

### C. 作成フロー

「＋ 新規作成」で作成フォーム（オーバーレイ内の新コンテンツ or 専用ビュー）:
- Minecraftバージョン: Mojang version manifest を**都度取得**し、リリース版（`type === 'release'`）を
  **新しい順**で表示（**最新リリースを含む**）。スナップショットは将来対応。
- ローダー: なし(バニラ) / Fabric / Forge。
- ローダーバージョン: 選択MC版に対応する一覧（Fabric Meta / Forge maven metadata）。
  「なし」の場合は非表示。**対応するローダーが無いMC版では、そのローダーは選べない／注記する**
  （例: 最新リリース直後は Fabric は出るが Forge はまだ無いことがある。バニラは常に最新可）。
- 名前: 任意（空なら「無題の構成」）。
- 「作成」で `customInstances` にメタ保存（**この時点では軽い**＝メタのみ）。実ファイル導入は初回起動時。

### D. ローダー／バニラ導入（新モジュール `app/assets/js/custominstance.js`）

初回起動（または明示的な準備）時に、選択に応じて導入する:
- **バニラ**: helios-core の MojangIndexProcessor で当該MC版の version.json＋アセット＋ライブラリを取得。
- **Fabric**: Fabric Meta API（`https://meta.fabricmc.net`）から
  `v2/versions/loader/<mc>/<loader>/profile/json` を取得→必要ライブラリをmavenからDL→
  `versions/` に version.json 相当を配置。mainClass 等を modManifest として用意。
- **Forge**: 対応する forge installer jar をDL（Forge maven）→ 既存の ForgeInstallerCLI 実行手順を
  流用して `versions/<forgeVer>.json` を生成→ それを modManifest として読む。
- 進捗は既存の `setLaunchDetails/percentage` に載せる。

### E. 起動：疑似サーバーへ変換して ProcessBuilder へ

自作インスタンスを配布サーバー相当に整形する `buildSyntheticServer(instance)` を用意:
- `rawServer = { id: instance.id, minecraftVersion: instance.minecraftVersion, ... }`
- `modules = [ <ローダーmodule相当> ]`（vanilla の場合は空）
- `ProcessBuilder(syntheticServer, vanillaManifest, modManifest, authUser, launcherVersion).build()`
- Mod は distribution.modules ではなく **ドロップイン機構**で mods フォルダから読み込む
  （既存の drop-in 処理を自作インスタンスにも適用）。
- 起動経路は既存 dlAsync を分岐し、「選択が自作インスタンスなら custominstance 経路」を通す。

### G. 既存の設定「Mod」タブを自作インスタンス対応にする

設定画面のMod管理は既に実装済み（`settings.js` の `resolveDropinModsForUI` などが
`instances/<serverId>/mods` を対象にドラッグ＆ドロップ追加・削除・有効/無効を提供）。
ただし現状は選択パックを `distro.getServerById(getSelectedServer())` で引くため、
自作インスタンスだと `null` になり空表示になる（[settings.js:764](../../../app/assets/js/scripts/settings.js)）。

対応（小さい追加）:
- 選択IDが自作インスタンスのときは、配布ではなく **①で作る疑似サーバー**を返す共通ヘルパ
  `resolveSelectedServerLike()` を用意し、`resolveDropinModsForUI` などがそれを使う。
- これにより、自作インスタンスを選択中でも設定ModタブでドロップインMod管理が**そのまま**使える。
- 配布固有の「必須/任意Mod（distribution modules）」は自作インスタンスには無いので、
  その節は空になる（＝ドロップインMod節のみ表示。想定通り）。

### F. エラー／前提

- 失敗時は既存 `showLaunchFailure(title, desc, err)` を使用（先日実装したログ出力ボタンで内容を保存可能）。
- 対応範囲:
  - Fabric は MC 1.14+。
  - Forge はインストーラ方式（ForgeGradle3=1.13+ 中心）が使える範囲。非常に新しい Forge / NeoForge は
    対象外の可能性があり、その旨を作成フォームで注記／起動失敗時に分かるようにする。
- **ローカル専用**（①では同期・共有はしない。共有は④）。
- MC版はリリースのみ、ただし **manifestを都度取得して最新リリースまで含める**（新しい順）。
  スナップショットは将来対応。ローダーは対応版がある場合のみ選択可。

## セキュリティ / プライバシー

- 外部アクセスは公開APIのみ（Mojang manifest、Fabric Meta、Forge maven）。認証情報は送らない。
- ④の共有コードは「起動構成の記述（版・ローダー）」のみを含み、アカウント情報や機密は含めない設計とする。

## スコープ外（将来層）

- ③ CurseForge/Modrinth 導入（**公式・自作の両パックが対象**。導入先は選択中パックの mods
  フォルダ＝既存ドロップイン機構に載せる）、④ ID/コード/URL共有（非リアルタイム）。
- ②（アプリ内Mod管理）は既存機能で、①の G で自作インスタンス対応にするため、独立層としては不要。
- ①はこれらの土台（自己完結したインスタンス定義、疑似サーバー起動、ドロップインMod対応）を提供する。

## テスト観点（手動確認）

1. 「自作」タブが表示され、公式タブと切り替えられる。
2. 「＋ 新規作成」→ MC版・ローダー・ローダー版・名前を選んで作成でき、一覧に出る。
3. Fabric インスタンスを作成→ PLAY で導入＆起動できる。
4. Forge インスタンスを作成→ PLAY で導入＆起動できる。
5. バニラ（ローダーなし）インスタンスを作成→ 起動できる。
6. mods フォルダにModを入れて起動すると反映される（ドロップイン）。
7. 自作インスタンスを選択中に、設定「Mod」タブでドロップインMODの追加(ドラッグ＆ドロップ)・削除・
   有効/無効トグルが機能する（G の対応）。
8. 「フォルダを開く」「削除」が機能する。
8. 導入・起動失敗時に `showLaunchFailure` が出て、ログ出力で内容を保存できる。
9. lint に新規エラーが増えていない。

## 実装順（①の中での段階）

1. データモデル＋Config CRUD＋疑似サーバー整形（起動の土台）。
2. 「自作」タブUI＋作成フォーム（バージョン一覧取得含む）。
3. Fabric 導入→起動（まず1本通す）。
4. Forge 導入→起動。
5. バニラ導入→起動、ドロップインMod確認、フォルダを開く／削除。
