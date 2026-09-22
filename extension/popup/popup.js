(function installCapturePopup() {
  "use strict";

  const t = FwpsI18n.createBrowserTranslator(browser);
  const captureButton = document.getElementById("capture-button");
  const regionButton = document.getElementById("region-button");
  const statusPanel = document.getElementById("status-panel");
  const statusLabel = document.getElementById("status-label");
  const statusMessage = document.getElementById("status-message");
  const segmentCount = document.getElementById("segment-count");
  const progressTrack = document.getElementById("progress-track");
  const progressFill = document.getElementById("progress-fill");
  let activeTabId = null;
  let pollTimer = null;

  const statusLabelKeys = {
    idle: "status_idle",
    picking: "status_picking",
    capturing: "status_capturing",
    encoding: "status_encoding",
    success: "status_success",
    error: "status_error",
  };

  function localizeStaticText() {
    try {
      document.documentElement.lang = browser.i18n.getUILanguage();
    } catch {
    }

    for (const element of document.querySelectorAll("[data-i18n]")) {
      element.textContent = t(element.dataset.i18n);
    }
    for (const element of document.querySelectorAll("[data-i18n-aria-label]")) {
      element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel));
    }
  }

  function isBusy(state) {
    return (
      state.status === "capturing" ||
      state.status === "encoding" ||
      state.status === "picking"
    );
  }

  function renderState(state) {
    const completed = Number.isFinite(state.completed) ? state.completed : 0;
    const total = Number.isFinite(state.total) ? state.total : 0;
    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
    const busy = isBusy(state);
    const statusKey = statusLabelKeys[state.status];

    statusPanel.dataset.state = state.status;
    statusLabel.textContent = statusKey ? t(statusKey) : t("status_label_unknown");
    statusMessage.textContent = state.message || t("status_message_unavailable");
    segmentCount.textContent = `${completed} / ${total}`;
    captureButton.disabled = busy;
    captureButton.textContent = state.status === "picking"
      ? t("button_waiting_pick")
      : busy
        ? t("button_busy")
        : t("button_capture_full");
    regionButton.disabled = busy;
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
        message: t("error_background_unreachable"),
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
        message: t("error_start_capture"),
      });
    }
  }

  async function startRegionCapture() {
    if (!Number.isInteger(activeTabId)) {
      return;
    }

    regionButton.disabled = true;

    try {
      const result = await browser.runtime.sendMessage({
        type: "START_REGION_CAPTURE",
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
        message: t("error_start_region"),
      });
    }
  }

  async function initialize() {
    localizeStaticText();

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
        message: t("error_no_active_tab"),
      });
    }
  }

  captureButton.addEventListener("click", startCapture);
  regionButton.addEventListener("click", startRegionCapture);
  globalThis.addEventListener("unload", () => {
    if (pollTimer !== null) {
      globalThis.clearInterval(pollTimer);
    }
  });

  initialize();
})();
