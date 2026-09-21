# Change Log

## [20260921] Mirror capture progress to the toolbar badge

- **類型**：Feature
- **影響範圍**：extension, tests, docs
- **內容**：區域截取需在頁面點擊、popup 關閉後沒有任何進度回饋；選定區域後現在以 `browserAction.openPopup()` 重新開啟 popup，呈現與整頁截取相同的進度面板，並同步到工具列圖示徽章（選取／百分比／輸出／錯誤 `!`／完成清除）；截取期間被截取區域保留藍色邊框指示（邊框外擴於區域框，不會出現在輸出圖中）；`PAGE_SIZE_CHANGED` 增加前後文件尺寸與區域框診斷；修正區域截取每段 descriptor 漏帶 `region` 模式導致穩定性檢查誤判的 bug；65 項測試通過。
- **關聯文件**：REQ-20260921-001, 220
- **操作人**：Kimi Code

## [20260921] Capture a user-selected scrollable sub-region

- **類型**：Feature
- **影響範圍**：extension, tests, docs
- **內容**：popup 新增「擷取捲動區域」入口；頁面內 picker 以高亮框即時標出命中的可捲動元素（自動解析最近的可捲動祖先），點擊確認、Esc 取消；選定後先把區域捲入視窗，再沿用既有 element 管線預熱、捲動驗證（含捲動邊緣容差）、fixed/sticky 處理、拼接與安全縮放，輸出裁切到該元素框的單張 PNG（檔名前綴 `region-`）；區域大於視窗或選取後失效時 fail closed；整頁擷取啟動時會先退出選取模式；59 項測試通過。
- **關聯文件**：REQ-20260921-001, 220
- **操作人**：Kimi Code

## [20260921] Bump version to 0.1.6 for the listed AMO channel

- **類型**：Config
- **影響範圍**：manifest, docs, release
- **內容**：0.1.5 誤傳至 AMO 自分發（非公開）管道，版本號被占用且 AMO 規則刪除後不得重用同號；依 0.1.2 先例直接遞增版本號至 0.1.6 重新提交公開（listed）管道，程式碼與 0.1.5 完全相同；47 項測試通過。
- **關聯文件**：220
- **操作人**：Kimi Code

## [20260909] Accept a one-pixel clamp at the scroll edge on long pages

- **類型**：Bugfix
- **影響範圍**：extension, tests, docs
- **內容**：長頁實測中文件實際高度為小數（如 `12936.4`），整數化上限為 `12937`，瀏覽器只能鉗制到 `12936`，DPR > 1 時 1 CSS px 偏差超過實體像素容差，最後一段報 `SCROLL_POSITION_MISMATCH` 中止整次擷取；捲動校驗改為先將請求位置鉗制到即時捲動上限，請求目標位於捲動邊緣時接受落在上限 ±(1 CSS px + 實體像素容差) 內的實際位置，拼接端沿用 `adjustSegmentForScroll` 補償；頁面中段的捲動校驗維持嚴格，持續阻止捲動的頁面仍 fail closed；47 項測試通過。
- **關聯文件**：220
- **操作人**：Kimi Code

## [20260909] Report restricted Mozilla domains and injection refusals clearly

- **類型**：Bugfix
- **影響範圍**：extension, tests, docs
- **內容**：在 addons.mozilla.org 等 Firefox 受限網域上，`executeScript` 被瀏覽器拒絕後落入通用「擷取失敗」訊息，誤導使用者重新整理頁面；新增 `RESTRICTED_HOSTS` 檢查，注入前先以明確訊息 fail closed，其他注入失敗統一回報 `CONTENT_SCRIPT_UNAVAILABLE`；44 項測試通過。
- **關聯文件**：220
- **操作人**：Kimi Code

## [20260909] Accept one-device-pixel scroll shortfall and stitch at the actual position

- **類型**：Bugfix
- **影響範圍**：extension, tests, docs
- **內容**：長頁實測中頁面只能停在 `27761.333984375` 而非要求的 `27762`（DPR 1.5 下恰差一個實體像素），原先半實體像素容差會在 22/23 段中止整次擷取；捲動校驗容差放寬至一個實體像素加 `0.001` CSS px 浮點裕量，超過一個實體像素仍 fail closed；新增 `CapturePlan.adjustSegmentForScroll`，拼接時以實際落點平移來源視窗並夾入可見範圍，消除亞像素接縫；42 項測試通過。
- **關聯文件**：220
- **操作人**：Kimi Code

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
