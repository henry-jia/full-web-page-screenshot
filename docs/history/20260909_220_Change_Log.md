# Change Log

## [20260907] Sign version 0.1.0 via AMO self-distribution and publish on GitHub

- **類型**：Config
- **影響範圍**：docs, README, release
- **內容**：版本 0.1.0 經 AMO 自行分發（非公開）管道提交並通過審核（0 errors, 0 warnings），取得 Mozilla 簽名 XPI，可永久安裝、重啟不消失；初始化 git 倉庫、標記 v0.1.0 並發布至 GitHub `henry-jia/full-web-page-screenshot`，Release 附加確定性 ZIP、SHA-256 與簽名 XPI；三語 README 安裝段落與路線圖同步更新。
- **關聯文件**：README ×3, 100, 220, 600
- **操作人**：Kimi Code

## [20260825] Prepare version 0.1.0 for GitHub and AMO

- **類型**：Config
- **影響範圍**：manifest, build, docs, release
- **內容**：加入 Firefox 無資料收集聲明與永久 add-on ID；新增固定排序與時間戳的確定性 ZIP／SHA-256 建置流程、英中日 README、隱私聲明、MPL-2.0 授權、AMO 商店文案及 GitHub／AMO 發布操作說明。
- **關聯文件**：README, LICENSE, PRIVACY, 100, 220, 600, AMO_LISTING
- **操作人**：Codex

## [20260825] Accept Firefox half-pixel scroll quantization

- **類型**：Bugfix
- **影響範圍**：extension, tests, docs
- **內容**：實頁診斷證實 Firefox 將要求的 `1259` CSS px 表示為 `1259.3333740234375`；捲動校驗改為半實體像素加 `0.001` CSS px 浮點裕量，真實案例可通過但一個實體像素與完整 CSS 像素仍被拒絕；錯誤狀態保留安全的 requested/actual/max 診斷，37 項測試通過。
- **關聯文件**：README, 200, 300, 400, 500, 810
- **操作人**：Codex

## [20260825] Stabilize lazy nested scrolling before capture

- **類型**：Bugfix
- **影響範圍**：extension, tests, docs
- **內容**：擷取主要內嵌容器時暫停 `overflow-anchor`，每個片段最多精確重新定位三次；短暫的 lazy-layout 位移可自動恢復，持續改寫捲動位置仍會 fail closed，cleanup 會還原原始 inline style；34 項測試通過。
- **關聯文件**：README, 200, 300, 400, 500, 810
- **操作人**：Codex

## [20260825] Downscale oversized captures instead of rejecting them

- **類型**：Bugfix
- **影響範圍**：extension, tests, docs
- **內容**：將固定像素預算由拒絕閘門改為自適應輸出規劃；截圖片段保留來源解析度，目的 Canvas 等比例縮放至安全邊長與 6,400 萬像素內，下載成功訊息顯示最終尺寸；31 項測試及 100,000 組隨機尺寸不變量檢查通過。
- **關聯文件**：README, 200, 300, 400, 500, 810
- **操作人**：Codex

## [20260825] Capture full content inside application scroll containers

- **類型**：Bugfix
- **影響範圍**：extension, tests, docs
- **內容**：自動辨識主要內嵌滾動容器，水平與垂直預熱延遲載入內容，依容器框線偏移拼接並搬移尾端 UI；擷取期間驗證 frame 穩定性，部分遮蔽時 fail closed，cleanup 依三階段安全順序還原；26 項測試通過。
- **關聯文件**：README, 200, 300, 400, 500, 810
- **操作人**：Codex

## [20260825] Implement full-page capture extension

- **類型**：Feature
- **影響範圍**：extension, tests, docs
- **內容**：完成二維分段與尾端裁切、頁面預熱與還原、fixed/sticky 去重、PNG 拼接下載、進度介面及安全邊界；16 項核心、協調與 cleanup 測試通過。
- **關聯文件**：100, 200, 300, 320, 400, 500, 600, 810, DESIGN, REQ-20260825-001
- **操作人**：Codex
