# 自作インスタンス Forgeローダー対応（M-Forge1: モダンForge）設計

- 日付: 2026-08-31
- 対象: NumapoteLauncher (沼ぽてランチャー)
- 目的: 自作インスタンス作成でローダーに **Forge** を選べるようにし、モダンForge
  （MC 1.13以降 / ForgeGradle3）の自作インスタンスを作成・起動できるようにする。
- スコープ: 本仕様は **M-Forge1（モダンForgeのみ）**。レガシーForge（1.12.2以前）は
  導入方式が根本的に異なるため **M-Forge2** として別spec/planで対応する。
  最終ゴールはモダン＋レガシー両対応だが、まず動く土台（モダン）を作る。

## 決定事項（確定済み）

1. 対応範囲は **モダンForge（MC 1.13以降）** から。レガシーは M-Forge2。
2. UIは既存の「ローダーバージョン」項目を流用し、**ローダーにForgeを選ぶとMC選択に連動して
   Forgeビルド一覧を表示**する（ForgeはMC依存）。
3. Forge一覧は **その MC の全ビルドを新しい順**に出し、`recommended`/`latest` を先頭に
   目印付きで表示する。
4. 実装は helios-core の `DistributionIndexProcessor.installForge` と同梱
   `libraries/java/ForgeInstallerCLI.jar` を再利用（公式パック起動で実績あり）。
5. Forgeのライブラリは Fabric と同様、生成された version.json から **Type.Library
   サブモジュール**を構築して合成 Type.Forge モジュールに載せ、ProcessBuilder に渡す。

## 背景（現状のアーキテクチャ）

- 自作インスタンスの作成UIは [overlay.ejs](../../../app/overlay.ejs) の `#customCreateContent`。
  ローダーは現状 `vanilla` / `fabric` のみ（`#customCreateLoader`）。ローダーバージョンは
  `#customCreateLoaderVersionField` / `#customCreateLoaderVersion`（Fabric選択時のみ表示）。
- 起動は [customlaunch.js](../../../app/assets/js/scripts/customlaunch.js) の
  `launchCustomInstance`。バニラは MojangIndexProcessor でDL、Fabricは
  [customfabric.js](../../../app/assets/js/scripts/customfabric.js) `installFabric` が
  合成 Type.Fabric モジュール（＋Type.Library サブモジュール）を作り、ProcessBuilder に渡す。
- [customversions.js](../../../app/assets/js/scripts/customversions.js) が
  `fetchReleaseVersions` / `fetchFabricLoaderVersions` / `fetchFabricProfile` /
  `fetchRequiredJavaMajor` を提供（すべて `got`）。
- 公式パックのForge起動フロー（[landing.js](../../../app/assets/js/scripts/landing.js) 675-710）:
  - `new DistributionIndexProcessor(commonDir, distribution, serverId)`。
  - `wrapperPath` = `libraries/java/ForgeInstallerCLI.jar`（dev/mac/win でパス分岐）。
  - `installForge(jExe, wrapperPath, onProgress)` を実行 → `versions/<full>/<full>.json` 生成。
  - `loadModLoaderVersionJson(serv)` で Forge の version.json（modManifest）取得。
- helios-core `DistributionIndexProcessor.installForge`（[helios-core/dist/dl/distribution/DistributionIndexProcessor.js](../../../helios-core/dist/dl/distribution/DistributionIndexProcessor.js)）:
  - Forgeモジュール（Type.Forge）が無い/FG3未満なら早期return（＝レガシーはこの経路では入らない）。
  - `forgeModule.getPath()`＝インストーラjar、`forgeModule.getMavenComponents().version`＝`<mc>-<forge>`。
  - `versions/<full>/<full>.json` が既にあればスキップ（冪等）。
- ProcessBuilder（[processbuilder.js](../../../app/assets/js/processbuilder.js)）は Forge 1.13+ を
  Fabric同様に扱う（`modManifest.mainClass` / `modManifest.arguments.jvm|game` と、
  `server.modules` から `_resolveServerLibraries` でクラスパス構築）。

## 採用アプローチ

helios-core の Forgeインストーラ実行機構をそのまま再利用する。自作インスタンスには配布物
（Nebula事前処理）が無いため、**合成ディストリビューション**（`getServerById` が Type.Forge
モジュールを持つserverを返す）を作って `installForge` に食わせ、生成された version.json の
`libraries` から Type.Library サブモジュールを構築して合成 Type.Forge モジュールに載せる。
これで Fabric と同じ「合成モジュール＋ProcessBuilder」の型に載る。

## 変更詳細

### A. バージョン取得（`customversions.js` に追加）

- `async fetchForgeVersions(mcVersion)`:
  - `GET https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml`
    を取得し、`<version>` 要素（`<mc>-<forge>` 形式）を抽出。選択MCに一致するもののみ残す。
  - `GET https://maven.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json`
    の `promos` から `"<mc>-recommended"` / `"<mc>-latest"` の Forge バージョンを取得。
  - 返り値: `[{ version:'<forge>', full:'<mc>-<forge>', recommended:boolean, latest:boolean }]`
    を **新しい順**（maven-metadata の並びは古い順なので逆順）で返す。recommended/latest に
    該当するものへフラグを立てる。
  - `got` 使用。XMLは軽量な正規表現/簡易パースで `<version>...</version>` を拾う
    （依存追加を避ける）。

### B. 作成UI（`overlay.ejs` ＋ 作成ロジック）

- `overlay.ejs`: `#customCreateLoader` に `<option value="forge">Forge</option>` を追加。
- 作成ロジック（Fabricのローダーバージョン表示・切替を行っている既存スクリプト）に:
  - ローダー変更時: `forge` なら `#customCreateLoaderVersionField` を表示し、
    現在の `#customCreateMcVersion` を使って `fetchForgeVersions(mc)` で一覧を投入。
    `fabric` は従来どおり、`vanilla` は非表示。
  - **MC変更時**: ローダーが `forge` のときは Forge一覧を再取得して入れ直す。
  - 一覧の各 `<option>` ラベルは `<forge> (推奨)` / `<forge> (最新)` のように目印付き。
    既定選択は recommended（無ければ latest、無ければ先頭）。
  - **M-Forge1ガード**: `forge` かつ MCが1.13未満（`mcVersionAtLeast('1.13', mc)` が false）
    の場合、一覧を空にして「このバージョンのForgeは今後対応予定です（レガシー）」を表示し、
    作成ボタンを無効化。
- 作成時、`instance.loader = 'forge'`、`instance.loaderVersion = '<forge>'`（`<mc>-` を除いた
  Forge側バージョン）を保存。

### C. Forgeインストール（新規 `app/assets/js/scripts/customforge.js` = `window.NLCustomForge`）

- `forgeInstallerUrl(full)` → `https://maven.minecraftforge.net/net/minecraftforge/forge/<full>/forge-<full>-installer.jar`。
- `resolveWrapperPath()` → landing.js と同じ dev/mac/win 分岐で `ForgeInstallerCLI.jar` の絶対パス。
- `buildSyntheticForgeDistro(id, mcVersion, full, installerPath)`:
  - `getServerById(id)` が次を返すオブジェクト:
    `{ rawServer:{ id, minecraftVersion:mcVersion }, modules:[ forgeInstallerModule ] }`
  - `forgeInstallerModule` は `{ rawModule:{ type:Type.Forge }, subModules:[],
    getPath:()=>installerPath, getMavenComponents:()=>({version: full}) }`。
- `async installForge(full, mcVersion, commonDir, javaExecPath, onProgress)`:
  1. インストーラjarを `commonDir/temp/forge-<full>-installer.jar` にDL（未取得なら）。
  2. 合成ディストリを作り、`new DistributionIndexProcessor(commonDir, synthDistro, id)`。
  3. `await dip.installForge(javaExecPath, resolveWrapperPath(), onProgress)`
     → `versions/<full>/<full>.json` 生成（冪等・既存ならスキップ）。
  4. `const modManifest = await dip.loadModLoaderVersionJson(serv)`（Forge version.json）。
  5. `modManifest.libraries` から Type.Library サブモジュールを構築:
     - 各 lib の `downloads.artifact.path`（無ければ maven→path 変換）で
       `commonDir/libraries/<path>` を算出。未取得なら `downloads.artifact.url`（無ければ
       Forge maven）からDL。`installFabric` の `makeLibraryModule` と同型。
  6. 合成 Type.Forge モジュールを返す:
     `{ rawModule:{ type:Type.Forge, classpath:true }, subModules:[...libs],
        getVersionlessMavenIdentifier, getPath:()=>installerPath }`。
  - 返り値: `{ forgeModule, modManifest }`。

### D. 起動（`customlaunch.js` に forge ブランチ）

`launchCustomInstance` のローダー分岐に追加:
```js
} else if(instance.loader === 'forge'){
    setLaunchDetails('Forgeを準備中...')
    const jExe = await resolveJavaExec(instance.minecraftVersion)
    const full = `${instance.minecraftVersion}-${instance.loaderVersion}`
    const { forgeModule, modManifest: fm } = await window.NLCustomForge.installForge(
        full, instance.minecraftVersion, commonDir, jExe,
        p => setDownloadPercentage(Math.min(99, p)))
    modManifest = fm
    loaderModules = [forgeModule]
}
```
その後は既存と同一の `new ProcessBuilder(syntheticServer, versionData, modManifest, authUser, ver).build()`。

- `resolveJavaExec(mc)`: 既存のJava解決（`getEffectiveJavaOptions` ＋ ConfigManager の
  `getJavaExecutable`/Javaパス）を用いてインストーラ実行用のJava実行パスを返す。無ければ
  既存のJava準備動線に誘導（エラー表示）。

### E. エラー処理

- Forge一覧取得失敗 → 「Forgeバージョン一覧の取得に失敗しました」。
- インストーラDL失敗 / `ForgeInstallerCLI.jar` 不在 → 具体メッセージ。
- `installForge` reject（非ゼロ終了）→ 既存のエラー画面（③で作成したログ出力導線）に載せ、
  「Forgeのインストールに失敗しました」＋詳細。
- Java不在/不適合 → 既存Java準備動線へ。
- MC<1.13でforge → 作成時ブロック（B節ガード）。
- 冪等: `versions/<full>/<full>.json` 既存なら再インストールをスキップ。

## セキュリティ / 前提

- ダウンロード元は Forge公式 maven（`maven.minecraftforge.net`）と Mojang のみ。`got` 使用。
- インストーラjarのサブプロセス実行は helios-core 既存フローと同一（公式パック起動で実績あり）。

## スコープ外（将来）

- レガシーForge（1.12.2以前）＝ M-Forge2。
- NeoForge の自作インスタンス対応。
- Forgeインストール進捗の細粒度UI（既存の download 進捗表示で代用）。

## テスト観点（実機・DIAG／既存手法。ユニットテスト基盤は無いので lint＋実機DIAGで検証）

1. 作成UIのローダーに Forge が出る。Forge選択で別項目にForge一覧が出る。
2. MC変更でForge一覧が入れ替わる。MC<1.13は非対応表示＋作成不可。
3. `fetchForgeVersions('1.20.1')` が全ビルド＋recommended/latest目印を新しい順で返す。
4. モダンForge自作インスタンスを作成→起動（例: 1.20.1 recommended）。インストーラ実行→
   `versions/<full>/<full>.json` 生成→ Forge のメインクラスでゲーム起動。
5. 2回目起動は再インストールをスキップ（冪等）。
6. Fabric/バニラ自作の起動に回帰が無い。
7. lint 増加なし（基準21）。

## 実装順（M-Forge1）

1. `customversions.js`: `fetchForgeVersions`。
2. 作成UI: Forgeオプション＋MC連動一覧＋MC<1.13ガード。
3. `customforge.js`: `installForge`（合成ディストリ＋helios installForge＋Type.Library構築）。
4. `customlaunch.js`: forgeブランチ＋Java解決。
5. 実機で作成→起動を検証、仕上げ。
