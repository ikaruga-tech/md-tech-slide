# md-tech-slide

[English](./README.md) | 日本語

md-tech-slide は、Markdown から技術プレゼンテーションスライドを生成・プレビューするための Visual Studio Code 拡張機能です。

スライドを平坦な画像として出力する従来のツールとは異なり、md-tech-slide は再編集可能なネイティブの PowerPoint テキストボックス・図形・テーブルを生成し、ヘッドレスブラウザ連携による高品質な PDF スライドの出力にも対応しています。

---

## 主な特徴

- ネイティブ PowerPoint（PPTX）生成: PptxGenJS を採用し、画像化ではなく編集可能な図形・テキスト枠・表を出力。
- マルチカラムレイアウト: 直感的な Fenced Divs 記法（`::: columns`, `::: column`）による 2カラム・3カラム・比率指定（`ratio="2:1"` 等）レイアウト。
- シンタックスハイライト: Shiki エンジンによる美しいコードブロック描画と PowerPoint 書式付きテキスト枠へのマッピング。
- リアルタイムプレビュー: エディタと双方向スクロール同期する Webview スライドプレビュー。
- 高品質 PDF エクスポート: ローカル環境の Google Chrome や Microsoft Edge を自動検出し、余分な設定なしでスライド PDF を出力。
- エディタ入力支援: スライド区切りやカラム構造の入力スニペットと、閉じ忘れ等を検知するリアルタイム構文検証。

---

## 記法ガイド

### スライド区切り

連続するスライドの境界には、独立した行に 8 連シャープ（`########`）を記述します。

```markdown
---
title: "サンプルプレゼンテーション"
author: "開発チーム"
theme: "corporate"
aspectRatio: "16:9"
---

# タイトルスライド

md-tech-slide へようこそ。

########

# 次のスライド

スライド本文のコンテンツを記述します。
```

### マルチカラムレイアウト

`::: columns` および `::: column` ブロックを用いてスライドをカラム分割できます。

```markdown
::: columns ratio="2:1"
::: column
### 左カラム（メイン）

- 主要な技術的議論
- コード実装の解説

```typescript
export interface SlideDeck {
  readonly slides: readonly Slide[];
}
```
:::
::: column
### 右カラム（サイド）

- 補足事項
- アーキテクチャの要約
:::
:::
```

### スピーカーノート

各スライドの発表者用メモは `::: note` ブロックまたは HTML コメント形式（`<!-- note: ... -->`）で記述します。PowerPoint のノート領域へ出力されます。

```markdown
::: note
画像化されたスライドに対するネイティブテキストボックスの編集上の利点を説明してください。
:::
```

---

## 使い方

### 1. プレビューを開く

1. VS Code で Markdown プレゼンテーションファイルを開きます。
2. コマンドパレット（`Ctrl+Shift+P` / `Cmd+Shift+P`）を開きます。
3. `md-tech-slide: Open Slide Preview` を実行します（エディタ右上のアイコンからも開けます）。

### 2. PowerPoint（PPTX）へのエクスポート

1. コマンドパレット（`Ctrl+Shift+P` / `Cmd+Shift+P`）を開きます。
2. `md-tech-slide: Export to PowerPoint (PPTX)` を実行します。
3. 保存ダイアログで出力先ファイルを指定します。

### 3. PDF へのエクスポート

1. コマンドパレット（`Ctrl+Shift+P` / `Cmd+Shift+P`）を開きます。
2. `md-tech-slide: Export to PDF Slide` を実行します。
3. 保存ダイアログで出力先ファイルを指定します。

---

## 拡張機能の設定

VS Code の設定画面から以下の動作をカスタマイズできます。

- `mdTechSlide.defaultTheme`: デフォルトのテーマ（`default`, `corporate`, `dark`）。
- `mdTechSlide.defaultAspectRatio`: デフォルトのスライドアスペクト比（`16:9`, `4:3`）。
- `mdTechSlide.export.browserPath`: PDF 出力に使用する Google Chrome / Microsoft Edge の実行ファイルパスの手動指定。

---

## 提供コマンド一覧

| コマンド | 説明 |
| --- | --- |
| `md-tech-slide.openPreview` | 現在開いている Markdown ドキュメントのスライドプレビューを表示 |
| `md-tech-slide.exportPPTX` | 現在のスライドを PowerPoint（PPTX）形式でエクスポート |
| `md-tech-slide.exportPDF` | 現在のスライドを PDF スライド形式でエクスポート |

---

## ライセンス

[MIT License](LICENSE)
