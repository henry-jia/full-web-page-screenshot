# Firefox 完整網頁截圖

[English](README.md) | [日本語](README.ja.md)

將整個網頁——包括頁面內主要可捲動容器的內容——擷取並下載成一張 PNG。所有處理都留在 Firefox 本機，不會上傳截圖或頁面資料。

## 功能

- 擷取垂直、水平或雙向捲動頁面。
- 自動辨識現代 Web 應用程式使用的主要內嵌捲動容器。
- 擷取前預熱 lazy-loaded 內容。
- 避免 fixed／sticky 元素在拼接結果中重複出現。
- 超大頁面會等比例縮小至 Firefox 安全 Canvas 範圍，不裁掉內容。
- 成功或失敗後均會還原捲動位置與暫時套用的頁面樣式。
- 以繁體中文顯示進度和可操作的錯誤診斷。

## 隱私

本擴充套件沒有伺服器、分析、遙測、帳號或遠端服務。頁面像素只在本機處理，最後透過 Firefox Downloads API 儲存 PNG。詳見 [PRIVACY.md](PRIVACY.md)。

權限用途：

- `activeTab`：只有使用者點擊擴充套件後，才存取目前分頁。
- `downloads`：把完成的 PNG 儲存在本機。

## 系統需求

- Firefox 142 或更新版本
- Node.js 20 或更新版本（僅開發和測試需要）
- PowerShell 7（執行發布建置腳本）

## 安裝

### Firefox 官方附加元件商店

版本 0.1.0 已透過 AMO 自行分發管道（非公開）由 Mozilla 完成簽名（2026-09-07）。請安裝 GitHub Release 附加的已簽名 XPI；重新啟動瀏覽器後仍會保留，並像一般擴充套件一樣更新。若有更廣泛散佈的需求，之後仍可申請公開 AMO 上架。

### 臨時開發安裝

1. 在 Firefox 開啟 `about:debugging#/runtime/this-firefox`。
2. 選擇「臨時載入附加元件」。
3. 選取 `extension/manifest.json`。
4. 開啟一般網頁，按工具列上的擴充套件圖示，再選擇「擷取完整頁面」。

Firefox 重新啟動後，臨時安裝的擴充套件會被移除。

### GitHub Release 檔案

Release ZIP 是送交 Mozilla 的確定性建置套件；相同來源會產生相同檔案。一般 Firefox Release／Beta 版本只能安裝 Mozilla 已簽署的 XPI；請勿只把未簽署 ZIP 改名成 `.xpi`。Mozilla 完成簽署後，可將簽署版 XPI 附加到 GitHub Release。

## 建置

```powershell
npm run build
```

命令會在已忽略的 `dist/` 目錄建立：

- `full-web-page-screenshot-<version>.zip`
- `full-web-page-screenshot-<version>.zip.sha256`

ZIP 根目錄直接包含 `manifest.json`，符合 AMO 要求。

## 驗證

```powershell
npm test
npm run check
```

目前共 37 項自動測試，覆蓋擷取規劃、拼接、瀏覽器協調、內嵌捲動容器、狀態還原、超大頁面及 Firefox 子像素捲動位置。

## 專案結構

```text
extension/              Firefox 擴充套件根目錄
scripts/                確定性發布建置腳本
tests/                  Node.js 自動測試
docs/                   需求、架構、測試及發布文件
```

## 已知限制

- Firefox 內建頁面、AMO 頁面及其他受保護頁面不允許內容腳本擷取。
- 動畫、影片、WebGL 及持續變動的內容可能在不同片段顯示不同時間點。
- 同一頁有多個獨立大型捲動區時，只會完整展開最主要的一個。
- 頁面若持續覆寫指定捲動位置，擴充套件會停止，避免產生空白或缺頁。
- 需要超過 500 個視窗片段的極端頁面會停止，避免長時間鎖住瀏覽器。

## 發布與商店資料

- [Release 與 AMO 流程](docs/600_Deployment.md)
- [準備好的 AMO 商店文案](docs/AMO_LISTING.md)
- Firefox add-on ID：`full-web-page-screenshot@henry-jia.github.io`

## 授權

[Mozilla Public License 2.0](LICENSE)
