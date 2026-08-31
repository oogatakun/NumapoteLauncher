# 自作インスタンス Forgeローダー対応（M-Forge2: レガシーForge）設計

- 日付: 2026-08-31
- 対象: NumapoteLauncher (沼ぽてランチャー)
- 目的: 自作インスタンスで **レガシーForge（旧フォーマット / ForgeGradle2以前）** を作成・起動
  できるようにする。helios-core の `installForge` は対象外（FG3のみ）なので、Forgeインストーラ内の
  `install_profile.json`（旧フォーマット）を自前で処理する。
- スコープ: M-Forge2。M-Forge1（モダン/FG3）は実装済み。**可能な限り全旧バージョン**を対象にし、
  ライブラリ取得に複数フォールバックを設けて幅広く対応する。

## 決定事項（確定済み）

1. **経路分岐は MCバージョンではなく `DistributionIndexProcessor.isForgeGradle3(mc, full)` で行う**:
   - true（FG3。MC≥1.13、または 1.12.2 の Forgeビルド > `14.23.5.2847`）→ 既存 `customforge.installForge`。
   - false（旧フォーマット）→ 新規 `customforgelegacy.installLegacyForge`。
2. M-Forge1で入れた UI の **「MC<1.13は非対応」ガードを撤去**。Forge一覧は全ビルドを出す。
3. レガシーは Java 8 が基本（既存の `getEffectiveJavaOptions` の suggestedMajor に従う）。
4. レガシーForgeは `Type.ForgeHosted` モジュール（＋`Type.Library` サブモジュール）として構築し、
   modManifest = install_profile の `versionInfo`（`mainClass`/`minecraftArguments`/`libraries`）。

## 背景（現状のアーキテクチャ）

- M-Forge1（[customforge.js](../../../app/assets/js/scripts/customforge.js)）: FG3 Forge を helios-core
  `installForge` ＋ 同梱 `ForgeInstallerCLI.jar` で導入し、`Type.Forge` モジュールを返す。
  ProcessBuilder は `Type.Forge` を modManifest.libraries から解決する。
- 作成UI（[overlay.js](../../../app/assets/js/scripts/overlay.js)）の `refreshLoaderVersions` に
  Forgeブランチがあり、現状 MC<1.13 を「今後対応予定（レガシー）」でブロックしている。
- [customlaunch.js](../../../app/assets/js/scripts/customlaunch.js) の `launchCustomInstance` は
  vanilla を MojangIndexProcessor でDLし、loader分岐（fabric / forge）でmodManifest＋loaderModulesを
  用意して ProcessBuilder に渡す。
- ProcessBuilder（[processbuilder.js](../../../app/assets/js/processbuilder.js)）は
  `mcVersionAtLeast('1.13')` が false のとき `_constructJVMArguments112` ＋ `_resolveForgeArgs`
  （`modManifest.minecraftArguments` を使用）で起動する。`_resolveServerLibraries` は
  `Type.ForgeHosted` を「getPath()（＝universal jar）＋ subModules（Type.Library）」で解決する。
  `_isTopLevelModLoader` は ForgeHosted を含むので `hasModLoader` は true になる。
- `isForgeGradle3(mcVersion, forgeVersion)`（helios）: MC≥1.13 で true。それ未満は Forgeビルドを
  `14.23.5.2847` と比較し、超えていれば true（FG3）、以下なら false（旧）。`forgeVersion` は
  `<mc>-<forge>` を渡してよい（内部で `split('-')[1]` により forge 部分を取る）。
- `node-stream-zip` が利用可能（helios-core 依存。`require('node-stream-zip')`）。

### 旧フォーマットの実測（例）

- **1.7.10-10.13.4.1614-1.7.10 installer**: エントリに `install_profile.json`（`install` + `versionInfo`）
  と `forge-…-universal.jar` を含む。`versionInfo.id`=`1.7.10-Forge10.13.4.1614-1.7.10`、
  `mainClass`=`net.minecraft.launchwrapper.Launch`、`minecraftArguments` に `--tweakClass …`、
  `libraries` 18件（先頭は `net.minecraftforge:forge:…`（url=Forge maven）、他は Mojang libs 等）。
  `install.filePath`=`forge-…-universal.jar`、`install.path`=`net.minecraftforge:forge:…`。
- **1.12.2-14.23.5.2859 installer**: `spec`/`processors`/`data`/`version.json` を含む **FG3フォーマット**
  （`versionInfo` 無し）。→ これは isForgeGradle3 が true なので M-Forge1 経路で処理される。

## 採用アプローチ

インストーラ内 `install_profile.json`（旧フォーマット）を `node-stream-zip` で読み、`versionInfo` から
起動情報（mainClass/minecraftArguments/libraries）を、`install` から universal jar を取得する。universal は
インストーラ zip から `commonDir/libraries` へ抽出し、その他ライブラリは URL 修正＋Mojang＋インストーラ
同梱 `maven/` の順でフォールバック取得する。これらを `Type.ForgeHosted` 合成モジュール（subModules は
Type.Library）にまとめ、ProcessBuilder の <1.13 経路に載せる。

## 変更詳細

### A. 経路分岐とUI

- **overlay.js `refreshLoaderVersions` の Forge ブランチ**: `mcVersionAtLeast('1.13')` ガードを撤去し、
  MC に関わらず `fetchForgeVersions(mc)` の全ビルドを表示する（一覧が空なら「対応するForgeがありません」）。
- **customlaunch.js forge ブランチ**: `full = <mc>-<forgeVersion>` を作り、
  `DistributionIndexProcessor.isForgeGradle3(mc, full)` で分岐:
  - true → 既存の `customforge.installForge`（Java実行パス解決含む、現状のまま）。
  - false → `window.NLCustomForgeLegacy.installLegacyForge(full, mc, commonDir)`。

### B. レガシーハンドラ（新規 `app/assets/js/scripts/customforgelegacy.js`）

`window.NLCustomForgeLegacy.installLegacyForge(full, mcVersion, commonDir) → {forgeModule, modManifest}`。

1. **インストーラDL**: `https://maven.minecraftforge.net/net/minecraftforge/forge/<full>/forge-<full>-installer.jar`
   を `commonDir/temp/forge-<full>-installer.jar` へ（未取得なら `downloadFile`）。
2. **install_profile.json 解析**: `new StreamZip.async({file: installerPath})` で開き、
   `install_profile.json` を読む。`versionInfo` が無ければ FG3 フォーマットとみなしエラー
   （通常は分岐で回避）。`install`（`filePath`/`path`）と `versionInfo`（`id`/`mainClass`/
   `minecraftArguments`/`libraries`）を取得。
3. **maven→path 変換** `mavenToPath(name)`（customfabric と同型。`group:artifact:version[:classifier]`
   → `group/artifact/version/artifact-version[-classifier].jar`）。
4. **universal 抽出**: `install.filePath` の zip エントリを `commonDir/libraries/<mavenToPath(install.path)>`
   へ書き出す（存在すればスキップ）。抽出先が libraries 配下であることを検証（パストラバーサル防止）。
5. **ライブラリ解決**（`versionInfo.libraries` の各件。`clientreq === false` はスキップ）:
   - `rel = mavenToPath(lib.name)`、`dest = commonDir/libraries/<rel>`。
   - `lib.name === install.path` は手順4で配置済み → その dest を使いスキップ。
   - `fs.existsSync(dest)` ならスキップ。
   - 取得の順:
     1. `lib.url` あり: base を正規化（`http://files.minecraftforge.net/maven/` → `https://maven.minecraftforge.net/`、
        末尾 `/` を1つに）し `base + rel` を `downloadFile`。
     2. 失敗 or `lib.url` 無し: `https://libraries.minecraft.net/<rel>` を試行。
     3. なお失敗: インストーラ zip 内 `maven/<rel>` があれば抽出。
   - すべて失敗した必須libは `unresolved` に名前を蓄積（例外にせず継続）。
   - 各 dest から `Type.Library` モジュール（customfabric の `makeLibraryModule` と同型）を作り subModules に追加。
6. **Type.ForgeHosted モジュール**を返す:
   `{ rawModule:{type:Type.ForgeHosted, classpath:true}, subModules:[...libs],
      getVersionlessMavenIdentifier:()=> group:artifact of install.path,
      getPath:()=> universalPath }`。
7. 返り値 `{ forgeModule, modManifest: versionInfo, unresolved }`。呼び出し側が unresolved を警告表示。

### C. 起動（customlaunch.js）

レガシー経路では `modManifest = versionInfo`、`loaderModules = [forgeModule]`。以降は既存と同一の
ProcessBuilder 呼び出し。ProcessBuilder が <1.13 を検出し minecraftArguments 経路で起動する。
`installLegacyForge` の `unresolved` が非空なら、既存のオーバーレイ/エラー画面に
「一部ライブラリを取得できませんでした: …」を表示（起動は試みる）。

## セキュリティ / 前提

- ダウンロード元は Forge maven（`maven.minecraftforge.net`）・Mojang libraries（`libraries.minecraft.net`）・
  インストーラ同梱のみ。zip 抽出先は `commonDir/libraries` 配下に限定（`path.normalize` で検証）。
- レガシーForgeは Java 8 前提。Java 準備は既存動線に委譲。

## スコープ外（将来）

- NeoForge の自作インスタンス対応。
- 極端に古い/壊れた Forge ビルドで maven からライブラリが完全消失しているケース（取得不可は警告のみ）。

## エラー / 前提

- インストーラDL失敗 / install_profile.json 不正 → 分かりやすいメッセージ。
- `versionInfo` 不在 → FG3 フォーマット（分岐ミス）としてエラー。
- 必須ライブラリ取得不可 → 取得分で起動を試み、名前を警告。
- 冪等: universal・lib がディスクにあれば再取得しない。

## テスト観点（実機DIAG／既存手法。lint＋実機DIAGで検証）

1. `isForgeGradle3` 分岐: `1.12.2-14.23.5.2859`→true、`1.12.2-14.23.5.2768`→false、`1.7.10-10.13.4.1614-1.7.10`→false。
2. UIの MC<1.13 ガード撤去後、1.7.10 で Forge一覧が出て選択・作成できる。
3. レガシー実インストール（1.7.10）: `installLegacyForge` が universal を抽出し libs をDL、
   `Type.ForgeHosted` モジュール＋versionInfo（mainClass=`net.minecraft.launchwrapper.Launch`）を返す。
   unresolved が空 or 少数。
4. レガシー起動（1.7.10）: 作成→起動で ProcessBuilder が launchwrapper 経路のコマンドを構築し、
   起動プロセスが立ち上がる（Forge/FML ブートストラップがログに出る）。
5. モダン経路（1.20.1）に回帰が無い。
6. lint 増加なし（基準21）。

## 実装順（M-Forge2）

1. UI: MC<1.13 ガード撤去（overlay.js）。
2. `customforgelegacy.js`: install_profile 解析＋universal抽出＋lib解決＋ForgeHosted構築。
3. `customlaunch.js`: forge ブランチを `isForgeGradle3` で分岐。app.ejs にスクリプト追加。
4. 実機で 1.7.10 の作成→インストール→起動を検証、仕上げ。
