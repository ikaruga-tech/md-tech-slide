# md-tech-slide

日本語 | [English](README.md)

Markdown 文書からネイティブ Microsoft PowerPoint（`.pptx`）スライドおよび高品質ベクター PDF スライドを生成・プレビューする Visual Studio Code 拡張機能です。柔軟なマルチカラムレイアウトと、完全オフライン対応の Mermaid ダイアグラム描画をサポートしています。

## 主な特徴

- ネイティブ PowerPoint（PPTX）出力: 編集可能なネイティブ図形、テキストボックス、表、スピーカーノートを持つ正規の PowerPoint ファイルを直接生成。
- 高解像度 PDF スライド出力: ヘッドレスブラウザ（Chrome / Edge）経由で、ベクター品質を損なわない鮮明なスライド PDF を出力。
- 双方向スクロール連動プレビュー: 編集行とプレビュー位置がリアルタイムに双方向同期する専用 Webview プレビュー機能。
- 柔軟なマルチカラムレイアウト: 比率指定可能なカラムコンテナ構文（`::: columns ratio="2:1"`）。
- 完全オフライン Mermaid 対応: フローチャート、シーケンス図、クラス図、状態遷移図、ER図をネットワーク通信なしでベクター SVG として描画。
- 緻密な日本語タイポグラフィ制御: Frontmatter による簡易形式・詳細形式のフォント・サイズ設定、および日本語（East Asian）フォントの同期指定。
- リアルタイムはみ出し検知: スライド領域をはみ出すコンテンツをエディタ上で警告する Diagnostic 機能。

## 動作要件

- Visual Studio Code: バージョン `^1.101.0` 以上
- Node.js: バージョン `>=22.12.0`（Node.js 20 は非サポート）
- 対応 OS: macOS, Windows, Linux
- PDF 出力用ブラウザ: Google Chrome, Microsoft Edge, Brave, Chromium（または CI 環境の Chrome for Testing）

## インストール手順

### VSIX の手動インストール

GitHub Releases から最新の `.vsix` パッケージをダウンロードし、ターミナルからインストールします。

```bash
code --install-extension md-tech-slide-0.1.0.vsix
```

または VS Code の GUI からインストールします。

1. 拡張機能ビュー（`Ctrl+Shift+X` または `Cmd+Shift+X`）を開きます。
2. 右上のその他の操作メニュー（`...`）をクリックします。
3. VSIX からのインストール... を選択し、ダウンロードしたファイルを選択します。

## 記法ガイド

スライドは `########`（8個のハッシュ）または水平線 `---`（Frontmatter 以外）で区切ります。

### Frontmatter 設定リファレンス

Markdown 文書の先頭に YAML 形式でスライド全体のプロパティを記述します。

```yaml
---
title: '技術発表スライド'
author: '開発チーム'
theme: 'corporate'
aspectRatio: '16:9'
paginate: true
font: 'BIZ UDPGothic'
codeFont: 'Cascadia Code'
---
```

#### サポートされている全 Frontmatter キー

| キー名               | 型        | 既定値       | 説明および制約                                                                     |
| -------------------- | --------- | ------------ | ---------------------------------------------------------------------------------- |
| `title`              | `string`  | `""`         | 文書タイトルおよびタイトルスライドの見出し。最大256文字。                          |
| `author`             | `string`  | `""`         | 発表者名または組織名。最大128文字。                                                |
| `theme`              | `string`  | `"default"`  | スライドカラーテーマ。`default`, `corporate`, `dark` から選択。                    |
| `aspectRatio`        | `string`  | `"16:9"`     | スライド寸法比率。`16:9`（10x5.625インチ）または `4:3`（10x7.5インチ）。           |
| `paginate`           | `boolean` | `true`       | フッターのページ番号表示の有無。                                                   |
| `font`               | `string`  | テーマ既定値 | 見出し・本文共通の簡易フォント名指定。最大128文字、制御文字や `<>{};` は使用不可。 |
| `codeFont`           | `string`  | テーマ既定値 | コードブロックおよびインラインコード用の等幅フォント名。最大128文字。              |
| `fonts.body`         | `string`  | テーマ既定値 | 本文用の詳細フォント名指定。                                                       |
| `fonts.heading`      | `string`  | テーマ既定値 | 見出し用の詳細フォント名指定。                                                     |
| `fonts.code`         | `string`  | テーマ既定値 | コード用の詳細フォント名指定。                                                     |
| `fontSize.body`      | `number`  | テーマ既定値 | 本文フォントサイズ（pt単位、`8`〜`96`）。                                          |
| `fontSize.heading`   | `number`  | テーマ既定値 | 見出しフォントサイズ（pt単位、`8`〜`96`）。                                        |
| `fontSize`（数値型） | `number`  | -            | 旧形式互換の基準フォントサイズ（非推奨警告が出力されます）。                       |
| `fontFamily`         | `string`  | -            | 旧形式互換のフォント名指定（非推奨警告が出力されます）。                           |

### フォント解決の優先順位と代替仕様

1. 優先順位:
   `fonts.*` / `fontSize.*` > `font` / `codeFont` > `fontFamily` / 数値型 `fontSize` > テーマ設定 > システム既定値。
2. PPTX 出力時の言語別フォント指定:
   PPTX 生成時、PptxGenJS を通じて各テキスト要素の `a:latin` と `a:ea`（東アジア言語用フォント）に同一のフォント名を同期出力します。
3. システムフォントの代替（フォールバック）:
   指定されたフォントがスライドを表示・閲覧する端末にインストールされていない場合、PowerPoint および各ブラウザの代替フォント設定に従ってフォールバック表示されます。クロスプラットフォームで共有する場合は、標準的な日本語フォント（メイリオ、游ゴシック、Noto Sans JP 等）の指定を推奨します。

### マルチカラムレイアウト

`::: columns` および `::: column` ディレクティブを使用します。

```markdown
::: columns ratio="2:1"
::: column

### 左カラム（メイン解説）

- 主要なアーキテクチャ概要
- コンポーネントの責務分離

:::
::: column

### 右カラム（図解・補足）

![構成図](./images/arch.png)

:::
:::
```

対応比率フォーマット: `1:1`, `2:1`, `1:2`, `1:1:1`, `1:2:1` など。

### Mermaid ダイアグラム

`````mermaid のコードブロックを記述すると、完全オフラインでベクター SVG にレンダリングされます。

````markdown
```mermaid
flowchart TD
  Client[VS Code クライアント] --> Parser[Markdown パーサー]
  Parser --> IR[Slide Deck IR]
  IR --> PPTX[PowerPoint 生成]
  IR --> PDF[ヘッドレス PDF 生成]
`````

````

対応図種: フローチャート、シーケンス図、クラス図、状態遷移図、ER図。
バンドルされた `dist/mermaid-renderer.js` により、外部通信を一切行わずに安全に描画されます。

### 表とコードブロック

標準的な Markdown の表記法は、編集可能なネイティブ PowerPoint 表図形に変換されます。

```markdown
| コンポーネント | 責務 | 状態 |
| --- | --- | --- |
| Parser | Slide IR 生成 | 安定 |
| Exporter | PPTX & PDF 出力 | 安定 |
```

コードブロックは Shiki による構文ハイライト付きで表示されます。

```typescript
export interface SlideDeck {
  readonly slides: readonly Slide[];
}
```

### スピーカーノート

`::: note` ディレクティブでスピーカーノートを記述します。

```markdown
::: note
発表時のポイント:
- 完全オフライン動作であることを強調する。
- 日本語フォントがネイティブ出力される点に言及する。
:::
```

PowerPoint 出力時、スライド下部の発表者ノート欄にそのまま格納されます。

## 出力形式別の特徴と制約

### 編集可能な PowerPoint 要素

- タイトル・見出し・本文: フォントサイズ調整や文言修正が可能なネイティブテキスト枠。
- 表: セルのテキスト編集や行・列追加が可能なネイティブ表図形。
- 箇条書きリスト: インデント階層を保持したリスト図形。
- スピーカーノート: PowerPoint の発表者ノート領域に編集可能テキストとして配置。

### PowerPoint 上の制約事項

- Mermaid ダイアグラム: ベクター SVG 図形（`ppt/media/*.svg`）として挿入されます。図内の文字は PowerPoint のテキスト枠としては直接編集できません。
- 画像: 通常の画像図形として配置されます。
- コードブロック: ハイライトされたテキスト行として矩形内に配置されます。

## PDF 出力時のブラウザ自動検出

PDF 出力時は、以下の優先順位で Chromium 系ブラウザを自動探索します。

1. ユーザーカスタムパス: VS Code 設定 `mdTechSlide.export.browserPath`。
2. システムブラウザ自動検出: 各 OS の標準インストール先（Google Chrome, Microsoft Edge, Brave, Chromium）。
3. CI テスト用ブラウザ: CI 環境で自動キャッシュされた Chrome for Testing。

対応ブラウザが検出できない場合は、設定画面への誘導を含むエラーメッセージが表示されます。

## 拡張機能の設定項目

| 設定名 | 型 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `mdTechSlide.defaultTheme` | `string` | `"default"` | 既定のスライドテーマ（`default`, `corporate`, `dark`）。 |
| `mdTechSlide.defaultAspectRatio` | `string` | `"16:9"` | 既定のアスペクト比（`16:9`, `4:3`）。 |
| `mdTechSlide.export.browserPath` | `string` | `""` | PDF エクスポートに使用するブラウザ実行ファイルの絶対パス。 |

## 提供コマンド一覧

- `md-tech-slide.openPreview`: md-tech-slide: Open Slide Preview（スライドプレビューを開く）
- `md-tech-slide.exportPPTX`: md-tech-slide: Export to PowerPoint (PPTX)（PowerPoint 形式でエクスポート）
- `md-tech-slide.exportPDF`: md-tech-slide: Export to PDF Slide（PDF スライド形式でエクスポート）

## ライセンス

本プロジェクトは [MIT License](LICENSE) のもとで公開されています。
サードパーティ製ソフトウェアのライセンス条項は [THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt) を参照してください。
````
