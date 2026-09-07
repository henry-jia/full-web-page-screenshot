# AMO Listing Copy

## English

### Summary

Capture an entire scrolling web page as one local PNG, including the main in-page scroll container.

### Description

Full Web Page Screenshot captures the complete width and height of the current page and downloads the result as one PNG. It supports ordinary document scrolling and the large nested scroll containers commonly used by dashboards and web applications.

The extension warms up lazy-loaded content, handles fixed and sticky elements during stitching, restores the page after capture, and safely downscales exceptionally large results instead of silently cropping them.

Everything is processed locally inside Firefox. Screenshots and page content are never uploaded. There are no accounts, analytics, advertisements, telemetry, or remote services.

### Reviewer notes

1. Open any normal HTTP or HTTPS page with scrollable content.
2. Click the toolbar icon and select the green capture button.
3. The extension scrolls the page, restores its state, stitches the image locally, and downloads a PNG.
4. The extension intentionally fails closed on protected Firefox pages and pages that continuously prevent exact scroll positioning.
5. The source is plain, unminified JavaScript. No build step is required to review the submitted extension files.
6. Data collection permission is declared as `required: ["none"]` because no data leaves the add-on or local browser.

## 繁體中文

### 摘要

將整個可捲動網頁擷取成一張本機 PNG，並支援頁面內主要捲動容器。

### 說明

Firefox 完整網頁截圖會擷取目前頁面的完整寬度與高度，並下載成一張 PNG。除了普通文件捲動，也支援儀表板及 Web 應用程式常用的大型內嵌捲動容器。

擷取前會預熱延遲載入內容，拼接時處理 fixed／sticky 元素，完成後還原頁面；極端大頁面會安全等比例縮小，不會默默裁掉內容。

所有處理都在 Firefox 本機完成。截圖與頁面內容永遠不會上傳，也沒有帳號、分析、廣告、遙測或遠端服務。

## 日本語

### 概要

ページ内の主要なスクロール領域を含む Web ページ全体を、1 枚のローカル PNG として保存します。

### 説明

Firefox ページ全体スクリーンショットは、現在のページの幅と高さをすべてキャプチャし、1 枚の PNG として保存します。通常のページスクロールだけでなく、ダッシュボードや Web アプリで使われる大きなネスト型スクロールコンテナにも対応します。

遅延読み込み内容を事前に読み込み、結合時に fixed／sticky 要素を処理し、完了後はページを元の状態へ戻します。非常に大きな結果は内容を切り取らず、安全なサイズまで縮小します。

すべて Firefox 内でローカル処理されます。画像やページ内容がアップロードされることはなく、アカウント、分析、広告、テレメトリー、リモートサービスもありません。

