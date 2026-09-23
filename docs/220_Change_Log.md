# Change Log

## [20260923] Release version 0.1.8: per-text styling, WYSIWYG wrapping, editor performance overhaul

- **類型**：Feature + Performance
- **影響範圍**：extension, tests, docs
- **內容**：(1) 文字樣式改為跟隨每個文字框——雙擊文字浮出樣式列（字體/字號/文字顏色/底色顏色/不透明度），只作用於該文字，頂部顏色與字號回歸圖形工具專用；單擊僅選取不再彈出樣式列。(2) 高亮底色透明度改為每段文字可調（指令新增 `backgroundAlpha`，舊指令預設 0.4）。(3) 所見即所得換行——輸入框可拖角調寬（`resize: both`），提交時框寬存入指令 `maxWidth`，annotate.js 新增 `wrapTextLine` 按寬換行（優先空格斷行），輸入框寬高鉗制在截圖剩餘範圍內，超邊即所見截斷。(4) 文字工具游標語義：懸停已有文字顯示 move 游標，按住拖曳移動；畫布支援右鍵按住平移並屏蔽右鍵選單。(5) 效能：拖動改為覆蓋層預覽（拖動全程不重繪底圖，落點才一次性重繪）、`measureTextBlock` 以 WeakMap 快取、連續操作（透明度滑桿）以 requestAnimationFrame 合併重繪、底圖預解碼為離屏 canvas 取代每次 drawImage 解碼。(6) 多選統一改樣式移除（樣式現以單框為單位），多選仍支援拖曳與 Delete 刪除。120 項測試通過。
- **關聯文件**：220, 600
- **操作人**：Kimi Code

## [20260923] Rework the editor text tool: focus fix, movable and re-editable text items

- **類型**：Bug Fix + Feature
- **影響範圍**：extension, tests
- **內容**：修復文字工具完全無反應的真因——pointerdown 的瀏覽器預設動作會把焦點從新開的輸入框搶回 canvas,blur 立刻提交空內容並隱藏輸入框（Node stub 無焦點預設動作，原測試未覆蓋）；現在文字工具點擊時 `preventDefault()`，並有測試鎖定。文字改為動態建立的 textarea（Enter 提交、Shift+Enter 換行、Esc 取消），文字指令升級為可互動項目：點擊選取（虛線框）、拖曳移動、雙擊重新編輯、Delete/Backspace 刪除、Ctrl+點擊多選後統一修改顏色/字號/字體（Sans/Serif/Mono)/底色高亮（40% 透明度色塊，逐行鋪底）；annotate.js 文字渲染支援多行與 `measureTextBlock` 命中測量；undo/redo 後選取集合自動過濾已移除指令。新增 editor/annotate 測試覆蓋文字提交、拖動、雙擊編輯、多選改色、高亮、徽章對比色；108 項測試通過。
- **關聯文件**：REQ-20260923-001, 220
- **操作人**：Kimi Code

## [20260923] Editor usability fixes: normal window, zoom, redo, numbered badges

- **類型**：Bug Fix + Feature
- **影響範圍**：extension, tests
- **內容**：依實機回饋修正編輯器——(1) 視窗改為 `type: "normal"`，可最大化與調整大小；(2) 新增縮放控制（放大／縮小／適應視窗／百分比顯示）與 Ctrl+滾輪以指標為錨點縮放，縮放只改顯示不影響輸出解析度；(3) 文字工具實測提交路徑正常，但預設字號在大圖縮放顯示下過小難以察覺，字號檔位提升為 24/40/72px 並讓輸入框字號隨縮放預覽；(4) 新增 Redo（按鈕 + Ctrl+Y / Ctrl+Shift+Z），新指令清空 redo 堆疊；(5) 新增「序號」工具：點擊即蓋上純色圓形數字徽章（1、2、3…自動遞增，數字顏色依徽章色亮度自動取黑或白）；新增 `tests/editor.test.js`（DOM stub 直接驗證 text/badge/undo/redo/zoom/save 路徑）與 annotate 徽章測試；100 項測試通過。
- **關聯文件**：REQ-20260923-001, 220
- **操作人**：Kimi Code

## [20260923] Post-capture thumbnail preview and in-extension image editor

- **類型**：Feature
- **影響範圍**：extension, tests, docs
- **內容**：截取成功後 background 保留原圖 object URL 並生成 ≤240px 縮圖存入 capture state，popup 成功態顯示縮圖，點擊即以 `browser.windows.create` 開啟新視窗編輯器（載入完整解析度原圖）；編輯器提供文字、矩形、橢圓、直線、箭頭、馬賽克六種工具，6 色 × 3 檔粗細，所有繪製經由 `extension/annotate.js` 的可序列化指令重放（undo 不存影像快照，大圖安全）；馬賽克為真像素化（降採樣+關閉平滑回繪）；儲存輸出 `<原名>-edited.png` 並顯示 `downloads.search` 回報的實際路徑；新截取或分頁關閉時釋放舊 object URL；新增 `tests/annotate.test.js`（幾何/重放/馬賽克）與 background 預覽生命週期測試；zh_TW/en 文案同步擴充；95 項測試通過。
- **關聯文件**：REQ-20260923-001, 220
- **操作人**：Kimi Code

## [20260922] Release version 0.1.7: WebExtension i18n and region capture stitching fixes

- **類型**：Release
- **影響範圍**：extension, tests, docs
- **內容**：介面全面改為 WebExtension i18n（`zh_TW` 預設 + `en`);修復捲動區域截取的三類缺陷——頁面 JS 中途改寫內容導致的錯位重複（截取後被動校驗 + 分段重試 + `SEGMENT_SCROLL_LOST` fail closed)、藍色邊框指示器邊緣被取整帶入輸出（截取瞬間隱藏指示器）、框外像素與圓角痕漏入接縫（裁剪框內縮 2 CSS px);81 項測試通過。
- **關聯文件**：REQ-20260921-001, REQ-20260921-002, 220
- **操作人**：Kimi Code

## [20260922] Inset the region crop frame so rounding can never leak outside pixels

- **類型**：Bug Fix
- **影響範圍**：extension, tests
- **內容**：區域截圖分段接縫仍有細線與圓角痕——上一輪隱藏指示器解決了藍線，但 CSS→物理像素四捨五入（dpr=0.9 時邊界最多內侵 ~0.56 CSS px）仍會把**區域框外**的像素（框外背景色、框的 border-radius 弧線區）帶進每個分段的裁剪邊緣；因為每個分段都裁同一個視口矩形，框頂/框底的邊緣行會在每條接縫重複出現。現在 region 模式的裁剪框固定內縮 2 CSS px（`REGION_FRAME_INSET_CSS_PX`,element 模式與整頁模式不受影響）,`getTargetMetrics`/`getCaptureDescriptor` 同步以內縮後的尺寸規劃分段與輸出，取整誤差永遠落在框內內容區；代價是輸出少一圈 2px（實務上落在元素 padding 區）；過小的區域（client 尺寸 ≤ 4px）fail closed 為 `REGION_TARGET_INVALID`。相關測試數值断言更新；81 項測試通過。
- **關聯文件**：REQ-20260921-001, 220
- **操作人**：Kimi Code

## [20260922] Keep the region frame indicator out of the captured pixels

- **類型**：Bug Fix
- **影響範圍**：extension, tests
- **內容**：區域截圖的分段接縫處出現細藍線——藍色邊框指示器雖外擴於區域框，但 CSS→物理像素取整（尤其在 90% 縮放、dpr=0.9 時，邊界最多內侵 ~0.56 CSS px）會把指示器邊框的邊緣像素帶進每個分段的裁剪範圍；整頁截取因無指示器而不受影響。現在 content script 在回應 SCROLL_CAPTURE 前隱藏指示器（`display:none`），使 captureVisibleTab 拍到的畫面保證不含指示器；verifyOnly 校驗時再恢復顯示，使用者看到的指示器幾乎不中斷；整頁模式無指示器、行為不變。新增 1 項 content 測試鎖定「截取時隱藏、校驗後復顯」；81 項測試通過。
- **關聯文件**：REQ-20260921-001, 220
- **操作人**：Kimi Code

## [20260922] Re-verify each captured segment and retry when the page moves mid-capture

- **類型**：Bug Fix
- **影響範圍**：extension, tests
- **內容**：修復捲動區域截取偶發錯位／內容重複——頁面自身的 JS（如 MusicForge 每 2.5–9 秒的 poll 重寫 `#d-lyrics` 的 innerHTML）會在「捲動驗證通過」與「captureVisibleTab 截圖」之間把捲動容器 scrollTop 歸零，導致某些分段拍到頂部內容。現在所有截取模式在截圖後立刻向 content script 做一次被動校驗（`SCROLL_CAPTURE` + `verifyOnly`）：核對捲動落點（沿用既有容差）、頁面幾何與 frame 穩定性，element/region 模式另以 MutationObserver 計數偵測截取窗口內的子樹改寫；漂移的分段不會繪入畫布，整段重捲重拍，最多 3 次，仍不穩定則 fail closed 並以新錯誤碼 `SEGMENT_SCROLL_LOST`（已加入 zh_TW/en 文案）回報；清理時保證斷開 observer。新增 3 項 background 測試與 2 項 content 測試；80 項測試通過。
- **關聯文件**：REQ-20260921-001, 220
- **操作人**：Kimi Code

## [20260922] Localize the extension with WebExtension i18n (zh_TW default + en)

- **類型**：Feature
- **影響範圍**：extension, tests, docs
- **內容**：所有使用者可見字串遷移至 `extension/_locales/`（`zh_TW` 為 `default_locale`，新增 `en`）；manifest 的 name/description/default_title 改用 `__MSG_` 佔位；popup 靜態文案以 `data-i18n` 屬性驅動，popup.js 與 background.js 的狀態、進度、錯誤與診斷訊息全部改由 `browser.i18n.getMessage` 取得，動態訊息改用 `$n` placeholder；新增獨立 `extension/i18n.js`（查表、`$n` 代入、缺鍵 fail-soft 回退，可比照 capture-plan.js 在 Node 測試）；新增 `tests/i18n.test.js` 覆蓋跨語系 key parity、placeholder 一致性、程式碼引用鍵完整性與查表回退；background 測試 harness 的 `browser.i18n` mock 改讀真實 zh_TW catalog；CLAUDE.md 文案規則更新為 i18n 架構；75 項測試通過。
- **關聯文件**：REQ-20260921-002, 220
- **操作人**：Kimi Code

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
