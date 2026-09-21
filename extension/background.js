(function installCaptureBackground() {
  "use strict";

  const captureStates = new Map();
  const closedTabIds = new Set();
  const CAPTURE_INTERVAL_MS = 550;
  const RESTRICTED_HOSTS = new Set([
    "accounts-static.cdn.mozilla.net",
    "accounts.firefox.com",
    "addons.cdn.mozilla.net",
    "addons.mozilla.org",
    "api.accounts.firefox.com",
    "content.cdn.mozilla.net",
    "discovery.addons.mozilla.org",
    "install.mozilla.org",
    "oauth.accounts.firefox.com",
    "profile.accounts.firefox.com",
    "support.mozilla.org",
    "sync.services.mozilla.com",
    "testpilot.firefox.com",
  ]);

  class CaptureError extends Error {
    constructor(code, message, details) {
      super(message);
      this.name = "CaptureError";
      this.code = code;
      this.details = details;
    }
  }

  function wait(milliseconds) {
    return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
  }

  function getCaptureState(tabId) {
    return captureStates.get(tabId) || {
      status: "idle",
      completed: 0,
      total: 0,
      message: "準備好擷取目前頁面。",
    };
  }

  function updateCaptureState(tabId, state) {
    if (closedTabIds.has(tabId)) {
      return;
    }

    const next = { ...getCaptureState(tabId), ...state };
    captureStates.set(tabId, next);
    syncBadge(next);
  }

  const BADGE_ACTIVE_COLOR = "#3f8f5f";
  const BADGE_ERROR_COLOR = "#b33747";

  function syncBadge(state) {
    let color = BADGE_ACTIVE_COLOR;
    let text = "";

    if (state.status === "picking") {
      text = "選取";
    } else if (state.status === "capturing") {
      text = state.total > 0
        ? `${Math.round((state.completed / state.total) * 100)}%`
        : "…";
    } else if (state.status === "encoding") {
      text = "輸出";
    } else if (state.status === "error") {
      color = BADGE_ERROR_COLOR;
      text = "!";
    }

    try {
      Promise.resolve(
        browser.browserAction.setBadgeBackgroundColor({ color }),
      ).catch((error) => {
        console.warn("[fwps] badge color update failed", error);
      });
      Promise.resolve(
        browser.browserAction.setBadgeText({ text }),
      ).catch((error) => {
        console.warn("[fwps] badge text update failed", error);
      });
    } catch (error) {
      console.warn("[fwps] badge update threw", error);
    }
  }

  function userMessageFor(error) {
    const messages = {
      UNSUPPORTED_PAGE: "Firefox 不允許擷取這個頁面；請改用一般網站分頁。",
      RESTRICTED_PAGE: "Firefox 出於安全考量，禁止所有擴充功能在 addons.mozilla.org 等官方網域運作；請改用一般網站分頁。",
      CONTENT_SCRIPT_UNAVAILABLE: "無法讀取目前頁面；請重新載入一般網站後再試。",
      TAB_NOT_ACTIVE: "擷取期間分頁已切換。請保持目標分頁在前景後重試。",
      PAGE_SIZE_CHANGED: "頁面在擷取期間持續改變尺寸，為避免裁切已停止。",
      SCROLL_POSITION_MISMATCH: "頁面阻止了精確捲動，為避免產生空白區已停止。",
      SCROLL_TARGET_NOT_FULLY_VISIBLE: "捲動區域未完整顯示在視窗內（區域需小於視窗並完整可見），為避免漏拍已停止。",
      REGION_TARGET_INVALID: "選取的捲動區域已失效（被移除或不再可捲動）；請重新選取。",
      CANVAS_DIMENSION_EXCEEDED: "頁面太長或太寬，超過 Firefox 的安全圖片尺寸。",
      CANVAS_AREA_EXCEEDED: "頁面像素量太大，為避免瀏覽器耗盡記憶體已停止。",
      TOO_MANY_SEGMENTS: "頁面需要的截圖片段過多，為避免長時間佔用瀏覽器已停止。",
      CAPTURE_ALREADY_ACTIVE: "這個分頁正在擷取中。",
      DOWNLOAD_FAILED: "圖片已建立，但 Firefox 無法開始下載。",
      CLEANUP_FAILED: "頁面狀態無法完整還原；請重新載入此分頁。",
    };

    const message = messages[error && error.code] || "擷取失敗。請重新載入頁面後再試。";
    const details = error && error.details;

    if (
      error &&
      error.code === "SCROLL_POSITION_MISMATCH" &&
      details &&
      Number.isFinite(details.requestedX) &&
      Number.isFinite(details.requestedY) &&
      Number.isFinite(details.actualX) &&
      Number.isFinite(details.actualY) &&
      Number.isFinite(details.maxX) &&
      Number.isFinite(details.maxY)
    ) {
      const mode = details.mode === "window" || details.mode === "element"
        ? details.mode
        : "unknown";
      const attempts = Number.isInteger(details.attempts) ? details.attempts : 0;
      const connection = details.connected === true
        ? "已連線"
        : details.connected === false
          ? "已斷線"
          : "狀態未知";
      return `${message} 診斷：${mode}，要求 (${details.requestedX}, ${details.requestedY})，實際 (${details.actualX}, ${details.actualY})，上限 (${details.maxX}, ${details.maxY})，嘗試 ${attempts} 次，target ${connection}。`;
    }

    if (error && error.code === "PAGE_SIZE_CHANGED" && details) {
      const geometryFields = [
        "expectedDocumentWidth",
        "expectedDocumentHeight",
        "expectedViewportWidth",
        "expectedViewportHeight",
        "actualDocumentWidth",
        "actualDocumentHeight",
        "actualViewportWidth",
        "actualViewportHeight",
      ];

      if (geometryFields.every((field) => Number.isFinite(details[field]))) {
        return `${message} 診斷：文件 ${details.expectedDocumentWidth} × ${details.expectedDocumentHeight} → ${details.actualDocumentWidth} × ${details.actualDocumentHeight}，視窗 ${details.expectedViewportWidth} × ${details.expectedViewportHeight} → ${details.actualViewportWidth} × ${details.actualViewportHeight}。`;
      }

      const expectedFrame = details.expectedFrame;
      const actualFrame = details.actualFrame;
      const frameValues = expectedFrame && actualFrame
        ? [
            expectedFrame.x,
            expectedFrame.y,
            expectedFrame.width,
            expectedFrame.height,
            actualFrame.x,
            actualFrame.y,
            actualFrame.width,
            actualFrame.height,
          ]
        : [];

      if (frameValues.length === 8 && frameValues.every(Number.isFinite)) {
        const format = (value) => Math.round(value * 100) / 100;
        return `${message} 診斷：區域框 (${format(expectedFrame.x)}, ${format(expectedFrame.y)}, ${format(expectedFrame.width)} × ${format(expectedFrame.height)}) → (${format(actualFrame.x)}, ${format(actualFrame.y)}, ${format(actualFrame.width)} × ${format(actualFrame.height)})。`;
      }
    }

    return message;
  }

  async function sendToContent(tabId, message) {
    let response;

    try {
      response = await browser.tabs.sendMessage(tabId, message);
    } catch (error) {
      throw new CaptureError(
        "CONTENT_SCRIPT_UNAVAILABLE",
        "The content script could not receive a capture command.",
      );
    }

    if (!response || response.ok !== true) {
      throw new CaptureError(
        response && response.error && response.error.code
          ? response.error.code
          : "CONTENT_CAPTURE_FAILED",
        "The content script rejected a capture command.",
        response && response.error ? response.error.details : undefined,
      );
    }

    return response.value;
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(
        new CaptureError("IMAGE_DECODE_FAILED", "A captured segment could not be decoded."),
      );
      image.src = dataUrl;
    });
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new CaptureError("IMAGE_ENCODE_FAILED", "The PNG could not be encoded."));
        }
      }, "image/png");
    });
  }

  async function assertTargetTabIsActive(tabId, windowId) {
    const activeTabs = await browser.tabs.query({ active: true, windowId });

    if (activeTabs.length !== 1 || activeTabs[0].id !== tabId) {
      throw new CaptureError("TAB_NOT_ACTIVE", "The target tab is no longer active.");
    }
  }

  function assertPageSizeStable(expected, actual) {
    const actualDocumentWidth = Math.ceil(actual.documentWidth);
    const actualDocumentHeight = Math.ceil(actual.documentHeight);
    const actualViewportWidth = Math.floor(actual.viewportWidth);
    const actualViewportHeight = Math.floor(actual.viewportHeight);

    if (
      actualDocumentWidth !== expected.documentWidth ||
      actualDocumentHeight !== expected.documentHeight ||
      actualViewportWidth !== expected.viewportWidth ||
      actualViewportHeight !== expected.viewportHeight
    ) {
      throw new CaptureError(
        "PAGE_SIZE_CHANGED",
        "Page geometry changed during capture.",
        {
          actualDocumentWidth,
          actualDocumentHeight,
          actualViewportWidth,
          actualViewportHeight,
          expectedDocumentWidth: expected.documentWidth,
          expectedDocumentHeight: expected.documentHeight,
          expectedViewportWidth: expected.viewportWidth,
          expectedViewportHeight: expected.viewportHeight,
        },
      );
    }
  }

  function assertCaptureDescriptorStable(expected, actual) {
    if (
      !expected ||
      (expected.mode !== "element" && expected.mode !== "region")
    ) {
      return;
    }

    const expectedFrame = expected.frame;
    const actualFrame = actual && actual.frame;
    const stable =
      actual &&
      actual.mode === expected.mode &&
      actual.bitmapViewportWidth === expected.bitmapViewportWidth &&
      actual.bitmapViewportHeight === expected.bitmapViewportHeight &&
      actual.outputWidth === expected.outputWidth &&
      actual.outputHeight === expected.outputHeight &&
      expectedFrame &&
      actualFrame &&
      Math.abs(actualFrame.x - expectedFrame.x) <= 0.25 &&
      Math.abs(actualFrame.y - expectedFrame.y) <= 0.25 &&
      Math.abs(actualFrame.width - expectedFrame.width) <= 0.25 &&
      Math.abs(actualFrame.height - expectedFrame.height) <= 0.25;

    if (!stable) {
      throw new CaptureError(
        "PAGE_SIZE_CHANGED",
        "The nested capture frame moved or resized during capture.",
        {
          actualFrame: actualFrame
            ? {
                x: actualFrame.x,
                y: actualFrame.y,
                width: actualFrame.width,
                height: actualFrame.height,
              }
            : null,
          expectedFrame: expectedFrame
            ? {
                x: expectedFrame.x,
                y: expectedFrame.y,
                width: expectedFrame.width,
                height: expectedFrame.height,
              }
            : null,
          frameMode: expected.mode,
        },
      );
    }
  }

  async function downloadBlob(blob, filename) {
    const objectUrl = URL.createObjectURL(blob);

    try {
      const downloadId = await browser.downloads.download({
        url: objectUrl,
        filename,
        saveAs: false,
      });
      globalThis.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
      return downloadId;
    } catch (error) {
      URL.revokeObjectURL(objectUrl);
      throw new CaptureError("DOWNLOAD_FAILED", "Firefox rejected the download.");
    }
  }

  function normalizeCaptureDescriptor(plan, capture) {
    if (capture && (capture.mode === "element" || capture.mode === "region")) {
      return capture;
    }

    return {
      backgroundColor: capture && capture.backgroundColor
        ? capture.backgroundColor
        : "rgb(255, 255, 255)",
      bitmapViewportHeight: capture && capture.bitmapViewportHeight
        ? capture.bitmapViewportHeight
        : plan.viewportHeight,
      bitmapViewportWidth: capture && capture.bitmapViewportWidth
        ? capture.bitmapViewportWidth
        : plan.viewportWidth,
      frame: null,
      mode: "window",
      outputHeight: capture && capture.outputHeight
        ? capture.outputHeight
        : plan.documentHeight,
      outputWidth: capture && capture.outputWidth
        ? capture.outputWidth
        : plan.documentWidth,
    };
  }

  function createStitcher(plan, image, capture) {
    const descriptor = normalizeCaptureDescriptor(plan, capture);
    const sourceScaleX = image.naturalWidth / descriptor.bitmapViewportWidth;
    const sourceScaleY = image.naturalHeight / descriptor.bitmapViewportHeight;
    const output = CapturePlan.fitOutputDimensions(
      descriptor.outputWidth,
      descriptor.outputHeight,
      sourceScaleX,
      sourceScaleY,
    );
    const canvas = document.createElement("canvas");
    canvas.width = output.outputWidth;
    canvas.height = output.outputHeight;
    const context = canvas.getContext("2d", { alpha: false });

    if (!context) {
      throw new CaptureError("CANVAS_UNAVAILABLE", "A 2D canvas could not be created.");
    }
    context.imageSmoothingEnabled = output.scaled;
    if (output.scaled) {
      context.imageSmoothingQuality = "high";
    }
    context.fillStyle = descriptor.backgroundColor;
    context.fillRect(0, 0, canvas.width, canvas.height);

    return {
      canvas,
      capture: descriptor,
      context,
      outputScaleX: output.scaleX,
      outputScaleY: output.scaleY,
      outputScaled: output.scaled,
      sourceScaleX,
      sourceScaleY,
      viewportPixelWidth: image.naturalWidth,
      viewportPixelHeight: image.naturalHeight,
    };
  }

  function drawSegment(stitcher, image, segment) {
    if (
      Math.abs(image.naturalWidth - stitcher.viewportPixelWidth) > 1 ||
      Math.abs(image.naturalHeight - stitcher.viewportPixelHeight) > 1
    ) {
      throw new CaptureError(
        "VIEWPORT_SIZE_CHANGED",
        "The captured viewport size changed during capture.",
      );
    }

    if (stitcher.capture.mode === "element" && segment.index === 0) {
      const frame = stitcher.capture.frame;
      const frameRight = Math.round(
        (frame.x + frame.width) * stitcher.sourceScaleX,
      );
      const frameBottom = Math.round(
        (frame.y + frame.height) * stitcher.sourceScaleY,
      );

      if (
        frameRight === stitcher.viewportPixelWidth &&
        frameBottom === stitcher.viewportPixelHeight
      ) {
        if (stitcher.outputScaled) {
          stitcher.context.drawImage(
            image,
            0,
            0,
            image.naturalWidth,
            image.naturalHeight,
            0,
            0,
            Math.round(
              stitcher.capture.bitmapViewportWidth * stitcher.outputScaleX,
            ),
            Math.round(
              stitcher.capture.bitmapViewportHeight * stitcher.outputScaleY,
            ),
          );
        } else {
          stitcher.context.drawImage(image, 0, 0);
        }
        return;
      }

      drawOuterViewportChrome(stitcher, image);
    }

    const frame = stitcher.capture.frame;
    const regionOnly = stitcher.capture.mode === "region";
    const origins = frame
      ? {
          sourceX: frame.x,
          sourceY: frame.y,
          destinationX: regionOnly ? 0 : frame.x,
          destinationY: regionOnly ? 0 : frame.y,
          destinationScaleX: stitcher.outputScaleX,
          destinationScaleY: stitcher.outputScaleY,
        }
      : {
          destinationScaleX: stitcher.outputScaleX,
          destinationScaleY: stitcher.outputScaleY,
        };
    const placement = CapturePlan.toPixelPlacement(
      segment,
      stitcher.sourceScaleX,
      stitcher.sourceScaleY,
      origins,
    );
    stitcher.context.drawImage(
      image,
      placement.sourceX,
      placement.sourceY,
      placement.sourceWidth,
      placement.sourceHeight,
      placement.destinationX,
      placement.destinationY,
      placement.destinationWidth,
      placement.destinationHeight,
    );
  }

  function drawOuterViewportChrome(stitcher, image) {
    const frame = stitcher.capture.frame;
    const left = Math.round(frame.x * stitcher.sourceScaleX);
    const top = Math.round(frame.y * stitcher.sourceScaleY);
    const right = Math.round(
      (frame.x + frame.width) * stitcher.sourceScaleX,
    );
    const bottom = Math.round(
      (frame.y + frame.height) * stitcher.sourceScaleY,
    );
    const destinationLeft = Math.round(frame.x * stitcher.outputScaleX);
    const destinationTop = Math.round(frame.y * stitcher.outputScaleY);
    const destinationRight = Math.round(
      (frame.x + frame.width) * stitcher.outputScaleX,
    );
    const destinationBottom = Math.round(
      (frame.y + frame.height) * stitcher.outputScaleY,
    );
    const sourceWidth = stitcher.viewportPixelWidth;
    const sourceHeight = stitcher.viewportPixelHeight;
    const destinationViewportWidth = Math.round(
      stitcher.capture.bitmapViewportWidth * stitcher.outputScaleX,
    );
    const destinationViewportHeight = Math.round(
      stitcher.capture.bitmapViewportHeight * stitcher.outputScaleY,
    );
    const trailingX = stitcher.canvas.width -
      (destinationViewportWidth - destinationRight);
    const trailingY = stitcher.canvas.height -
      (destinationViewportHeight - destinationBottom);

    function drawRegion(
      sourceX,
      sourceY,
      sourceRegionWidth,
      sourceRegionHeight,
      destinationX,
      destinationY,
      destinationWidth,
      destinationHeight,
    ) {
      if (
        sourceRegionWidth <= 0 ||
        sourceRegionHeight <= 0 ||
        destinationWidth <= 0 ||
        destinationHeight <= 0
      ) {
        return;
      }
      stitcher.context.drawImage(
        image,
        sourceX,
        sourceY,
        sourceRegionWidth,
        sourceRegionHeight,
        destinationX,
        destinationY,
        destinationWidth,
        destinationHeight,
      );
    }

    drawRegion(0, 0, right, top, 0, 0, destinationRight, destinationTop);
    drawRegion(
      right,
      0,
      sourceWidth - right,
      top,
      trailingX,
      0,
      stitcher.canvas.width - trailingX,
      destinationTop,
    );
    drawRegion(
      0,
      top,
      left,
      bottom - top,
      0,
      destinationTop,
      destinationLeft,
      destinationBottom - destinationTop,
    );
    drawRegion(
      right,
      top,
      sourceWidth - right,
      bottom - top,
      trailingX,
      destinationTop,
      stitcher.canvas.width - trailingX,
      destinationBottom - destinationTop,
    );
    drawRegion(
      0,
      bottom,
      right,
      sourceHeight - bottom,
      0,
      trailingY,
      destinationRight,
      stitcher.canvas.height - trailingY,
    );
    drawRegion(
      right,
      bottom,
      sourceWidth - right,
      sourceHeight - bottom,
      trailingX,
      trailingY,
      stitcher.canvas.width - trailingX,
      stitcher.canvas.height - trailingY,
    );
  }

  async function captureSegments(tab, plan, capture) {
    let stitcher = null;
    let lastCaptureTime = 0;
    const descriptor = normalizeCaptureDescriptor(plan, capture);
    const sourceBoundWidth = descriptor.frame
      ? descriptor.frame.width
      : descriptor.bitmapViewportWidth;
    const sourceBoundHeight = descriptor.frame
      ? descriptor.frame.height
      : descriptor.bitmapViewportHeight;

    for (const segment of plan.segments) {
      const remainingDelay = CAPTURE_INTERVAL_MS - (Date.now() - lastCaptureTime);
      if (remainingDelay > 0) {
        await wait(remainingDelay);
      }

      await assertTargetTabIsActive(tab.id, tab.windowId);
      const scrolled = await sendToContent(tab.id, {
        type: "SCROLL_CAPTURE",
        segment,
      });
      assertPageSizeStable(plan, scrolled.metrics);
      assertCaptureDescriptorStable(capture, scrolled.capture);

      await assertTargetTabIsActive(tab.id, tab.windowId);
      const dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, {
        format: "png",
      });
      lastCaptureTime = Date.now();
      await assertTargetTabIsActive(tab.id, tab.windowId);
      const image = await loadImage(dataUrl);

      if (!stitcher) {
        stitcher = createStitcher(plan, image, capture);
      }
      drawSegment(
        stitcher,
        image,
        CapturePlan.adjustSegmentForScroll(
          segment,
          scrolled.actualX,
          scrolled.actualY,
          sourceBoundWidth,
          sourceBoundHeight,
        ),
      );

      updateCaptureState(tab.id, {
        status: "capturing",
        completed: segment.index + 1,
        total: plan.segments.length,
        message: `正在擷取第 ${segment.index + 1} / ${plan.segments.length} 段。`,
      });
    }

    return {
      canvas: stitcher.canvas,
      outputHeight: stitcher.canvas.height,
      outputScaled: stitcher.outputScaled,
      outputWidth: stitcher.canvas.width,
    };
  }

  const FULL_PAGE_CAPTURE = Object.freeze({
    filenamePrefix: "full-page",
    noun: "完整頁面",
    prepareType: "PREPARE_CAPTURE",
  });
  const REGION_CAPTURE = Object.freeze({
    filenamePrefix: "region",
    noun: "區域截圖",
    prepareType: "PREPARE_REGION_CAPTURE",
  });

  function assertCapturableTab(tab) {
    if (!/^https?:/i.test(tab.url || "")) {
      throw new CaptureError("UNSUPPORTED_PAGE", "Only HTTP and HTTPS pages are supported.");
    }

    const hostMatch = /^https?:\/\/([a-z0-9.-]+)/i.exec(tab.url);
    if (hostMatch && RESTRICTED_HOSTS.has(hostMatch[1].toLowerCase())) {
      throw new CaptureError(
        "RESTRICTED_PAGE",
        "Firefox blocks extensions on this restricted domain.",
      );
    }
  }

  async function injectContentScript(tabId) {
    try {
      await browser.tabs.executeScript(tabId, { file: "/content-script.js" });
    } catch {
      throw new CaptureError(
        "CONTENT_SCRIPT_UNAVAILABLE",
        "Firefox refused to inject the content script into this page.",
      );
    }
  }

  async function performCapture(tab, options = FULL_PAGE_CAPTURE) {
    let prepared = false;

    try {
      assertCapturableTab(tab);
      await injectContentScript(tab.id);
      const preparedPage = await sendToContent(tab.id, { type: options.prepareType });
      prepared = true;
      const plan = CapturePlan.createCapturePlan(preparedPage.metrics);

      updateCaptureState(tab.id, {
        status: "capturing",
        completed: 0,
        total: plan.segments.length,
        message: `準備擷取 ${plan.segments.length} 個分段。`,
      });

      const stitched = await captureSegments(tab, plan, preparedPage.capture);

      updateCaptureState(tab.id, {
        status: "encoding",
        message: "正在建立 PNG。",
      });
      const blob = await canvasToBlob(stitched.canvas);

      await sendToContent(tab.id, { type: "CLEANUP_CAPTURE" });
      prepared = false;

      const filename = CapturePlan.createFilename(
        preparedPage.pageUrl,
        new Date(),
        options.filenamePrefix,
      );
      const downloadId = await downloadBlob(blob, filename);
      updateCaptureState(tab.id, {
        status: "success",
        completed: plan.segments.length,
        total: plan.segments.length,
        message: stitched.outputScaled
          ? `${options.noun}已自動縮放至 ${stitched.outputWidth} × ${stitched.outputHeight} 像素並儲存。`
          : `${options.noun}已儲存到下載資料夾。`,
        filename,
        downloadId,
        outputHeight: stitched.outputHeight,
        outputScaled: stitched.outputScaled,
        outputWidth: stitched.outputWidth,
      });
    } catch (error) {
      if (prepared) {
        try {
          await sendToContent(tab.id, { type: "CLEANUP_CAPTURE" });
          prepared = false;
        } catch {
          error = new CaptureError("CLEANUP_FAILED", "The page could not be restored.");
        }
      }

      updateCaptureState(tab.id, {
        status: "error",
        message: userMessageFor(error),
        errorCode: error && error.code ? error.code : "CAPTURE_FAILED",
        errorDetails: error && error.details ? error.details : null,
      });
    }
  }

  async function startCapture(tabId) {
    if (!Number.isInteger(tabId)) {
      throw new CaptureError("INVALID_TAB", "A valid tab ID is required.");
    }

    closedTabIds.delete(tabId);

    if (getCaptureState(tabId).status === "capturing" || getCaptureState(tabId).status === "encoding") {
      return { accepted: false, state: getCaptureState(tabId) };
    }

    if (getCaptureState(tabId).status === "picking") {
      try {
        await sendToContent(tabId, { type: "EXIT_REGION_PICKER" });
      } catch {
      }
    }

    updateCaptureState(tabId, {
      status: "capturing",
      completed: 0,
      total: 0,
      message: "正在分析頁面尺寸。",
      filename: null,
      downloadId: null,
      errorCode: null,
      errorDetails: null,
      outputHeight: null,
      outputScaled: null,
      outputWidth: null,
    });

    let tab;
    try {
      tab = await browser.tabs.get(tabId);
    } catch (error) {
      const captureError = new CaptureError("INVALID_TAB", "The target tab is unavailable.");
      updateCaptureState(tabId, {
        status: "error",
        message: userMessageFor(captureError),
        errorCode: captureError.code,
      });
      return { accepted: false, state: getCaptureState(tabId) };
    }

    performCapture(tab);
    return { accepted: true, state: getCaptureState(tabId) };
  }

  async function startRegionCapture(tabId) {
    if (!Number.isInteger(tabId)) {
      throw new CaptureError("INVALID_TAB", "A valid tab ID is required.");
    }

    closedTabIds.delete(tabId);

    const current = getCaptureState(tabId);
    if (
      current.status === "capturing" ||
      current.status === "encoding" ||
      current.status === "picking"
    ) {
      return { accepted: false, state: current };
    }

    updateCaptureState(tabId, {
      status: "capturing",
      completed: 0,
      total: 0,
      message: "正在準備區域選取。",
      filename: null,
      downloadId: null,
      errorCode: null,
      errorDetails: null,
      outputHeight: null,
      outputScaled: null,
      outputWidth: null,
    });

    let tab;
    try {
      tab = await browser.tabs.get(tabId);
    } catch (error) {
      const captureError = new CaptureError("INVALID_TAB", "The target tab is unavailable.");
      updateCaptureState(tabId, {
        status: "error",
        message: userMessageFor(captureError),
        errorCode: captureError.code,
      });
      return { accepted: false, state: getCaptureState(tabId) };
    }

    prepareRegionPicker(tab);
    return { accepted: true, state: getCaptureState(tabId) };
  }

  async function prepareRegionPicker(tab) {
    try {
      assertCapturableTab(tab);
      await injectContentScript(tab.id);
      await sendToContent(tab.id, { type: "ENTER_REGION_PICKER" });
      updateCaptureState(tab.id, {
        status: "picking",
        completed: 0,
        total: 0,
        message: "請在頁面中點擊要擷取的捲動區域，按 Esc 取消。",
      });
    } catch (error) {
      updateCaptureState(tab.id, {
        status: "error",
        message: userMessageFor(error),
        errorCode: error && error.code ? error.code : "CAPTURE_FAILED",
        errorDetails: error && error.details ? error.details : null,
      });
    }
  }

  function handleRegionPicked(tabId) {
    if (!Number.isInteger(tabId) || getCaptureState(tabId).status !== "picking") {
      return { accepted: false };
    }

    updateCaptureState(tabId, {
      status: "capturing",
      completed: 0,
      total: 0,
      message: "正在分析區域尺寸。",
    });
    tryOpenPopup();

    browser.tabs.get(tabId).then(
      (tab) => performCapture(tab, REGION_CAPTURE),
      () => {
        const error = new CaptureError("INVALID_TAB", "The target tab is unavailable.");
        updateCaptureState(tabId, {
          status: "error",
          message: userMessageFor(error),
          errorCode: error.code,
        });
      },
    );

    return { accepted: true };
  }

  function tryOpenPopup() {
    try {
      Promise.resolve(browser.browserAction.openPopup()).catch(() => {});
    } catch {
    }
  }

  function handleRegionPickCancelled(tabId) {
    if (!Number.isInteger(tabId) || getCaptureState(tabId).status !== "picking") {
      return { dismissed: false };
    }

    updateCaptureState(tabId, {
      status: "idle",
      completed: 0,
      total: 0,
      message: "已取消區域選取。",
    });

    return { dismissed: true };
  }

  browser.tabs.onRemoved.addListener((tabId) => {
    closedTabIds.add(tabId);
    captureStates.delete(tabId);
  });

  browser.runtime.onMessage.addListener((message, sender) => {
    if (!message || typeof message !== "object") {
      return undefined;
    }

    if (message.type === "GET_CAPTURE_STATE") {
      return Promise.resolve(getCaptureState(message.tabId));
    }

    if (message.type === "START_CAPTURE") {
      return startCapture(message.tabId).catch((error) => ({
        accepted: false,
        state: {
          status: "error",
          completed: 0,
          total: 0,
          message: userMessageFor(error),
          errorCode: error && error.code ? error.code : "CAPTURE_FAILED",
        },
      }));
    }

    if (message.type === "START_REGION_CAPTURE") {
      return startRegionCapture(message.tabId).catch((error) => ({
        accepted: false,
        state: {
          status: "error",
          completed: 0,
          total: 0,
          message: userMessageFor(error),
          errorCode: error && error.code ? error.code : "CAPTURE_FAILED",
        },
      }));
    }

    if (message.type === "REGION_PICKED" || message.type === "REGION_PICK_CANCELLED") {
      const senderTabId = sender && sender.tab && Number.isInteger(sender.tab.id)
        ? sender.tab.id
        : message.tabId;
      return Promise.resolve(
        message.type === "REGION_PICKED"
          ? handleRegionPicked(senderTabId)
          : handleRegionPickCancelled(senderTabId),
      );
    }

    return undefined;
  });
})();
