(function installCapturePopup() {
  "use strict";

  const captureButton = document.getElementById("capture-button");
  const statusPanel = document.getElementById("status-panel");
  const statusLabel = document.getElementById("status-label");
  const statusMessage = document.getElementById("status-message");
  const segmentCount = document.getElementById("segment-count");
  const progressTrack = document.getElementById("progress-track");
  const progressFill = document.getElementById("progress-fill");
  let activeTabId = null;
  let pollTimer = null;

  const statusLabels = {
    idle: "待命",
    capturing: "擷取中",
    encoding: "正在輸出",
    success: "完成",
    error: "無法完成",
  };

  function isBusy(state) {
    return state.status === "capturing" || state.status === "encoding";
  }

  function renderState(state) {
    const completed = Number.isFinite(state.completed) ? state.completed : 0;
    const total = Number.isFinite(state.total) ? state.total : 0;
    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
    const busy = isBusy(state);

    statusPanel.dataset.state = state.status;
    statusLabel.textContent = statusLabels[state.status] || "狀態";
    statusMessage.textContent = state.message || "擷取狀態暫時無法取得。";
    segmentCount.textContent = `${completed} / ${total}`;
    captureButton.disabled = busy;
    captureButton.textContent = busy ? "擷取進行中" : "擷取完整頁面";
    progressTrack.hidden = !busy || total === 0;
    progressTrack.setAttribute("aria-valuenow", String(progress));
    progressFill.style.width = `${progress}%`;
  }

  async function queryState() {
    if (!Number.isInteger(activeTabId)) {
      return;
    }

    try {
      const state = await browser.runtime.sendMessage({
        type: "GET_CAPTURE_STATE",
        tabId: activeTabId,
      });
      renderState(state);

      if (!isBusy(state) && pollTimer !== null) {
        globalThis.clearInterval(pollTimer);
        pollTimer = null;
      }
    } catch (error) {
      renderState({
        status: "error",
        completed: 0,
        total: 0,
        message: "無法連接擴充套件背景程序。請重新開啟面板。",
      });
    }
  }

  function beginPolling() {
    if (pollTimer === null) {
      pollTimer = globalThis.setInterval(queryState, 250);
    }
  }

  async function startCapture() {
    if (!Number.isInteger(activeTabId)) {
      return;
    }

    captureButton.disabled = true;

    try {
      const result = await browser.runtime.sendMessage({
        type: "START_CAPTURE",
        tabId: activeTabId,
      });
      renderState(result.state);
      if (result.accepted || isBusy(result.state)) {
        beginPolling();
      }
    } catch (error) {
      renderState({
        status: "error",
        completed: 0,
        total: 0,
        message: "無法啟動擷取。請重新載入頁面後再試。",
      });
    }
  }

  async function initialize() {
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (tabs.length !== 1 || !Number.isInteger(tabs[0].id)) {
        throw new Error("Active tab not found.");
      }

      activeTabId = tabs[0].id;
      await queryState();
      const state = await browser.runtime.sendMessage({
        type: "GET_CAPTURE_STATE",
        tabId: activeTabId,
      });
      if (isBusy(state)) {
        beginPolling();
      }
    } catch (error) {
      captureButton.disabled = true;
      renderState({
        status: "error",
        completed: 0,
        total: 0,
        message: "找不到可擷取的目前分頁。",
      });
    }
  }

  captureButton.addEventListener("click", startCapture);
  globalThis.addEventListener("unload", () => {
    if (pollTimer !== null) {
      globalThis.clearInterval(pollTimer);
    }
  });

  initialize();
})();

