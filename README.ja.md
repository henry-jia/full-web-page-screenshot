# Firefox ページ全体スクリーンショット

[English](README.md) | [繁體中文](README.zh-TW.md)

ページ内の主要なスクロールコンテナを含む Web ページ全体をキャプチャし、1 枚の PNG として保存します。画像やページデータはアップロードされず、すべて Firefox 内で処理されます。

## 主な機能

- 縦、横、または両方向にスクロールするページをキャプチャします。
- モダンな Web アプリで使われる主要なページ内スクロールコンテナを検出します。
- キャプチャ前に遅延読み込みコンテンツを読み込みます。
- fixed／sticky 要素が結合画像内で重複するのを防ぎます。
- 非常に大きなページは、内容を切り取らず Firefox の安全な Canvas 上限まで縮小します。
- 成功時・失敗時ともにスクロール位置と一時的なページスタイルを復元します。
- 進行状況とエラー診断を繁体字中国語で表示します。

## プライバシー

サーバー、分析、テレメトリー、アカウント、リモートサービスは使用しません。ページのピクセルはローカルで処理され、完成した PNG は Firefox Downloads API で保存されます。詳細は [PRIVACY.md](PRIVACY.md) を参照してください。

権限の用途：

- `activeTab`：ユーザーが拡張機能をクリックした後に限り、現在のタブへアクセスします。
- `downloads`：完成した PNG をローカルに保存します。

## 動作要件

- Firefox 142 以降
- Node.js 20 以降（開発・テスト時のみ）
- PowerShell 7（リリースビルド用）

## インストール

### Firefox Add-ons

バージョン 0.1.0 は AMO の自己配布チャネル（非公開）で Mozilla により署名済みです（2026-09-07）。GitHub Release に添付された署名済み XPI をインストールしてください。ブラウザー再起動後も残り、通常の拡張機能と同様に更新されます。一般向けの公開 AMO リスティングは、必要になれば後から申請できます。

### 一時的な開発インストール

1. Firefox で `about:debugging#/runtime/this-firefox` を開きます。
2. **一時的なアドオンを読み込む**を選択します。
3. `extension/manifest.json` を選択します。
4. 通常の Web ページを開き、ツールバーの拡張機能アイコンから **擷取完整頁面** を選択します。

一時インストールは Firefox を再起動すると削除されます。

### GitHub Release の成果物

Release ZIP は Mozilla に提出する決定論的なパッケージで、同じソースから同じファイルを生成します。通常版および Beta 版 Firefox では Mozilla が署名した XPI が必要です。未署名 ZIP の拡張子を `.xpi` に変更してもインストールできません。Mozilla の署名後、署名済み XPI を GitHub Release に追加できます。

## ビルド

```powershell
npm run build
```

無視対象の `dist/` ディレクトリに次のファイルを生成します。

- `full-web-page-screenshot-<version>.zip`
- `full-web-page-screenshot-<version>.zip.sha256`

AMO の要件どおり、ZIP のルートに `manifest.json` が配置されます。

## 検証

```powershell
npm test
npm run check
```

現在 37 件の自動テストがあり、キャプチャ計画、画像結合、ブラウザー連携、ネストしたスクロール領域、状態復元、巨大ページ、Firefox のサブピクセルスクロールを検証します。

## プロジェクト構成

```text
extension/              Firefox 拡張機能のパッケージルート
scripts/                決定論的なリリースパッケージ作成
tests/                  Node.js 自動テスト
docs/                   要件、設計、テスト、リリース文書
```

## 既知の制限

- Firefox 内部ページ、AMO ページ、その他の保護ページはコンテンツスクリプトでキャプチャできません。
- アニメーション、動画、WebGL、常に変化する内容はセグメントごとに異なる時点が表示される場合があります。
- 独立した大きなスクロール領域が複数ある場合、最も主要な領域だけを完全に展開します。
- ページが指定スクロール位置を継続的に上書きする場合、空白や欠落を防ぐため停止します。
- 500 を超えるビューポートセグメントが必要なページは、ブラウザーの長時間停止を避けるため拒否されます。

## リリースとストア情報

- [Release／AMO 手順](docs/600_Deployment.md)
- [準備済み AMO 掲載文](docs/AMO_LISTING.md)
- Firefox add-on ID：`full-web-page-screenshot@henry-jia.github.io`

## ライセンス

[Mozilla Public License 2.0](LICENSE)
