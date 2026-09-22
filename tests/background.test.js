"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const CapturePlan = require("../extension/capture-plan.js");
const FwpsI18n = require("../extension/i18n.js");

const zhTwCatalog = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "..", "extension", "_locales", "zh_TW", "messages.json"),
    "utf8",
  ),
);

const backgroundSource = fs.readFileSync(
  path.join(__dirname, "..", "extension", "background.js"),
  "utf8",
);

function createBackgroundHarness({
  tab,
  captureVisibleTab,
  documentApi = {},
  download = async () => 1,
  executeScript = async () => [],
  getTab,
  ImageClass = class Image {},
  queryTabs,
  sendMessage,
  timer = setTimeout,
  urlApi = URL,
}) {
  let messageListener = null;
  let tabRemovedListener = null;
  const badgeCalls = [];
  let popupOpenCount = 0;
  const browser = {
    browserAction: {
      openPopup() {
        popupOpenCount += 1;
        return Promise.resolve();
      },
      setBadgeBackgroundColor(details) {
        badgeCalls.push({ color: details.color, tabId: details.tabId });
        return Promise.resolve();
      },
      setBadgeText(details) {
        badgeCalls.push({ text: details.text, tabId: details.tabId });
        return Promise.resolve();
      },
    },
    runtime: {
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        },
      },
    },
    tabs: {
      get: getTab || (async () => tab),
      executeScript,
      query: queryTabs || (async () => [tab]),
      captureVisibleTab,
      sendMessage,
      onRemoved: {
        addListener(listener) {
          tabRemovedListener = listener;
        },
      },
    },
    downloads: {
      download,
    },
    i18n: {
      getMessage(key, substitutions) {
        const entry = zhTwCatalog[key];
        if (!entry) {
          return "";
        }
        return FwpsI18n.formatMessage(entry.message, substitutions);
      },
      getUILanguage() {
        return "zh-TW";
      },
    },
  };
  const context = vm.createContext({
    browser,
    CapturePlan,
    FwpsI18n,
    console,
    Date,
    Image: ImageClass,
    URL: urlApi,
    document: documentApi,
    setTimeout: timer,
    clearTimeout,
  });
  context.globalThis = context;
  new vm.Script(backgroundSource, { filename: "background.js" }).runInContext(context);

  return {
    badgeCalls,
    get popupOpenCount() {
      return popupOpenCount;
    },
    removeTab(tabId) {
      tabRemovedListener(tabId);
    },
    sendRuntimeMessage(message, sender) {
      return messageListener(message, sender);
    },
  };
}

async function waitForTerminalState(harness, tabId) {
  for (let attempts = 0; attempts < 20; attempts += 1) {
    const state = await harness.sendRuntimeMessage({
      type: "GET_CAPTURE_STATE",
      tabId,
    });
    if (state.status === "success" || state.status === "error") {
      return state;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error("Capture did not reach a terminal state.");
}

test("unsupported browser pages fail without injecting a content script", async () => {
  let contentMessages = 0;
  const tab = { id: 7, windowId: 2, active: true, url: "about:config" };
  const harness = createBackgroundHarness({
    tab,
    captureVisibleTab: async () => "unused",
    sendMessage: async () => {
      contentMessages += 1;
      return { ok: true, value: {} };
    },
  });

  await harness.sendRuntimeMessage({ type: "START_CAPTURE", tabId: tab.id });
  const state = await waitForTerminalState(harness, tab.id);

  assert.equal(state.status, "error");
  assert.equal(state.errorCode, "UNSUPPORTED_PAGE");
  assert.equal(contentMessages, 0);
});

test("restricted Mozilla domains fail with a clear message before script injection", async () => {
  let injectionAttempts = 0;
  const tab = {
    id: 72,
    windowId: 2,
    active: true,
    url: "https://addons.mozilla.org/en-US/developers/",
  };
  const harness = createBackgroundHarness({
    tab,
    captureVisibleTab: async () => "unused",
    executeScript: async () => {
      injectionAttempts += 1;
      return [];
    },
    sendMessage: async () => ({ ok: true, value: {} }),
  });

  await harness.sendRuntimeMessage({ type: "START_CAPTURE", tabId: tab.id });
  const state = await waitForTerminalState(harness, tab.id);

  assert.equal(state.status, "error");
  assert.equal(state.errorCode, "RESTRICTED_PAGE");
  assert.match(state.message, /官方網域/);
  assert.equal(injectionAttempts, 0);
});

test("a refused content-script injection reports CONTENT_SCRIPT_UNAVAILABLE", async () => {
  const tab = { id: 73, windowId: 2, active: true, url: "https://example.test/" };
  const harness = createBackgroundHarness({
    tab,
    captureVisibleTab: async () => "unused",
    executeScript: async () => {
      throw new Error("Missing host permission for the tab");
    },
    sendMessage: async () => ({ ok: true, value: {} }),
  });

  await harness.sendRuntimeMessage({ type: "START_CAPTURE", tabId: tab.id });
  const state = await waitForTerminalState(harness, tab.id);

  assert.equal(state.status, "error");
  assert.equal(state.errorCode, "CONTENT_SCRIPT_UNAVAILABLE");
});

test("scroll mismatch diagnostics reach the user-facing capture state", async () => {
  const tab = { id: 70, windowId: 2, active: true, url: "https://example.test/" };
  const details = {
    actualX: 0,
    actualY: 510,
    attempts: 3,
    connected: true,
    maxX: 0,
    maxY: 1000,
    mode: "element",
    requestedX: 0,
    requestedY: 500,
  };
  const harness = createBackgroundHarness({
    tab,
    captureVisibleTab: async () => {
      throw new Error("A mismatched segment must not be captured.");
    },
    sendMessage: async (_tabId, message) => {
      if (message.type === "PREPARE_CAPTURE") {
        return {
          ok: true,
          value: {
            metrics: {
              documentWidth: 800,
              documentHeight: 1200,
              viewportWidth: 800,
              viewportHeight: 600,
              devicePixelRatio: 1,
            },
            pageUrl: tab.url,
            title: "Example",
          },
        };
      }
      if (message.type === "SCROLL_CAPTURE") {
        return {
          ok: false,
          error: { code: "SCROLL_POSITION_MISMATCH", details },
        };
      }
      if (message.type === "CLEANUP_CAPTURE") {
        return { ok: true, value: { cleaned: true } };
      }
      throw new Error(`Unexpected command: ${message.type}`);
    },
  });

  await harness.sendRuntimeMessage({ type: "START_CAPTURE", tabId: tab.id });
  const state = await waitForTerminalState(harness, tab.id);

  assert.equal(state.status, "error");
  assert.equal(state.errorCode, "SCROLL_POSITION_MISMATCH");
  assert.deepEqual(JSON.parse(JSON.stringify(state.errorDetails)), details);
  assert.match(state.message, /要求 \(0, 500\).*實際 \(0, 510\).*上限 \(0, 1000\)/);
  assert.match(state.message, /target 已連線/);
});

test("malformed scroll diagnostics use safe fallback labels", async () => {
  const tab = { id: 71, windowId: 2, active: true, url: "https://example.test/" };
  const harness = createBackgroundHarness({
    tab,
    captureVisibleTab: async () => {
      throw new Error("A mismatched segment must not be captured.");
    },
    sendMessage: async (_tabId, message) => {
      if (message.type === "PREPARE_CAPTURE") {
        return {
          ok: true,
          value: {
            metrics: {
              documentWidth: 800,
              documentHeight: 1200,
              viewportWidth: 800,
              viewportHeight: 600,
              devicePixelRatio: 1,
            },
            pageUrl: tab.url,
            title: "Example",
          },
        };
      }
      if (message.type === "SCROLL_CAPTURE") {
        return {
          ok: false,
          error: {
            code: "SCROLL_POSITION_MISMATCH",
            details: {
              actualX: 0,
              actualY: 510,
              attempts: 1.5,
              connected: null,
              maxX: 0,
              maxY: 1000,
              mode: "unexpected",
              requestedX: 0,
              requestedY: 500,
            },
          },
        };
      }
      if (message.type === "CLEANUP_CAPTURE") {
        return { ok: true, value: { cleaned: true } };
      }
      throw new Error(`Unexpected command: ${message.type}`);
    },
  });

  await harness.sendRuntimeMessage({ type: "START_CAPTURE", tabId: tab.id });
  const state = await waitForTerminalState(harness, tab.id);

  assert.match(state.message, /診斷：unknown/);
  assert.match(state.message, /嘗試 0 次/);
  assert.match(state.message, /target 狀態未知/);
});

test("a viewport capture failure still sends exactly one cleanup command", async () => {
  let cleanupCalls = 0;
  const tab = { id: 8, windowId: 2, active: true, url: "https://example.test/" };
  const metrics = {
    documentWidth: 800,
    documentHeight: 600,
    viewportWidth: 800,
    viewportHeight: 600,
    devicePixelRatio: 1,
  };
  const harness = createBackgroundHarness({
    tab,
    captureVisibleTab: async () => {
      throw new Error("Synthetic capture failure.");
    },
    sendMessage: async (_tabId, message) => {
      if (message.type === "PREPARE_CAPTURE") {
        return {
          ok: true,
          value: { metrics, pageUrl: tab.url, title: "Example" },
        };
      }
      if (message.type === "SCROLL_CAPTURE") {
        return {
          ok: true,
          value: { actualX: 0, actualY: 0, metrics },
        };
      }
      if (message.type === "CLEANUP_CAPTURE") {
        cleanupCalls += 1;
        return { ok: true, value: { cleaned: true } };
      }
      throw new Error(`Unexpected command: ${message.type}`);
    },
  });

  await harness.sendRuntimeMessage({ type: "START_CAPTURE", tabId: tab.id });
  const state = await waitForTerminalState(harness, tab.id);

  assert.equal(state.status, "error");
  assert.equal(cleanupCalls, 1);
});

test("switching tabs before bitmap capture aborts instead of capturing the wrong page", async () => {
  let queryCalls = 0;
  let captureCalls = 0;
  let cleanupCalls = 0;
  const tab = { id: 9, windowId: 2, active: true, url: "https://example.test/" };
  const metrics = {
    documentWidth: 800,
    documentHeight: 600,
    viewportWidth: 800,
    viewportHeight: 600,
    devicePixelRatio: 1,
  };
  const harness = createBackgroundHarness({
    tab,
    queryTabs: async () => {
      queryCalls += 1;
      return queryCalls === 1 ? [tab] : [{ ...tab, id: 99 }];
    },
    captureVisibleTab: async () => {
      captureCalls += 1;
      throw new Error("Frame shift should have aborted before capture.");
    },
    sendMessage: async (_tabId, message) => {
      if (message.type === "PREPARE_CAPTURE") {
        return { ok: true, value: { metrics, pageUrl: tab.url, title: "Example" } };
      }
      if (message.type === "SCROLL_CAPTURE") {
        return { ok: true, value: { actualX: 0, actualY: 0, metrics } };
      }
      if (message.type === "CLEANUP_CAPTURE") {
        cleanupCalls += 1;
        return { ok: true, value: { cleaned: true } };
      }
      throw new Error(`Unexpected command: ${message.type}`);
    },
  });

  await harness.sendRuntimeMessage({ type: "START_CAPTURE", tabId: tab.id });
  const state = await waitForTerminalState(harness, tab.id);

  assert.equal(state.status, "error");
  assert.equal(state.errorCode, "TAB_NOT_ACTIVE");
  assert.equal(captureCalls, 0);
  assert.equal(cleanupCalls, 1);
});

test("the busy state is locked before tab lookup resolves", async () => {
  let resolveTab;
  let getCalls = 0;
  const tab = { id: 10, windowId: 2, active: true, url: "about:config" };
  const tabPromise = new Promise((resolve) => {
    resolveTab = resolve;
  });
  const harness = createBackgroundHarness({
    tab,
    getTab: async () => {
      getCalls += 1;
      return tabPromise;
    },
    captureVisibleTab: async () => "unused",
    sendMessage: async () => ({ ok: true, value: {} }),
  });

  const firstStart = harness.sendRuntimeMessage({
    type: "START_CAPTURE",
    tabId: tab.id,
  });
  const secondStart = await harness.sendRuntimeMessage({
    type: "START_CAPTURE",
    tabId: tab.id,
  });

  assert.equal(secondStart.accepted, false);
  assert.equal(getCalls, 1);
  resolveTab(tab);
  const firstResult = await firstStart;
  assert.equal(firstResult.accepted, true);
});

test("terminal viewport overlap is cropped before drawing to the canvas", async () => {
  const drawCalls = [];
  const context2d = {
    imageSmoothingEnabled: true,
    drawImage(...args) {
      drawCalls.push(args);
    },
    fillRect() {},
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext() {
      return context2d;
    },
    toBlob(callback) {
      callback({ type: "image/png" });
    },
  };
  class LoadedImage {
    constructor() {
      this.naturalWidth = 800;
      this.naturalHeight = 600;
    }
    set src(_value) {
      Promise.resolve().then(() => this.onload());
    }
  }
  const tab = { id: 11, windowId: 2, active: true, url: "https://example.test/" };
  const metrics = {
    documentWidth: 800,
    documentHeight: 900,
    viewportWidth: 800,
    viewportHeight: 600,
    devicePixelRatio: 1,
  };
  const harness = createBackgroundHarness({
    tab,
    captureVisibleTab: async () => "data:image/png;base64,fixture",
    documentApi: { createElement: () => canvas },
    ImageClass: LoadedImage,
    sendMessage: async (_tabId, message) => {
      if (message.type === "PREPARE_CAPTURE") {
        return { ok: true, value: { metrics, pageUrl: tab.url, title: "Example" } };
      }
      if (message.type === "SCROLL_CAPTURE") {
        return {
          ok: true,
          value: {
            actualX: message.segment.x,
            actualY: message.segment.y,
            metrics,
          },
        };
      }
      if (message.type === "CLEANUP_CAPTURE") {
        return { ok: true, value: { cleaned: true } };
      }
      throw new Error(`Unexpected command: ${message.type}`);
    },
    timer(callback) {
      callback();
      return 1;
    },
    urlApi: {
      createObjectURL: () => "blob:fixture",
      revokeObjectURL() {},
    },
  });

  await harness.sendRuntimeMessage({ type: "START_CAPTURE", tabId: tab.id });
  const state = await waitForTerminalState(harness, tab.id);

  assert.equal(state.status, "success");
  assert.equal(drawCalls.length, 2);
  assert.deepEqual(drawCalls[1].slice(1), [0, 300, 800, 300, 0, 600, 800, 300]);
});

test("a sub-pixel scroll shortfall is stitched at the actual scroll position", async () => {
  const drawCalls = [];
  const context2d = {
    imageSmoothingEnabled: true,
    drawImage(...args) {
      drawCalls.push(args);
    },
    fillRect() {},
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext() {
      return context2d;
    },
    toBlob(callback) {
      callback({ type: "image/png" });
    },
  };
  class LoadedImage {
    constructor() {
      this.naturalWidth = 800;
      this.naturalHeight = 600;
    }
    set src(_value) {
      Promise.resolve().then(() => this.onload());
    }
  }
  const tab = { id: 71, windowId: 2, active: true, url: "https://example.test/" };
  const metrics = {
    documentWidth: 800,
    documentHeight: 900,
    viewportWidth: 800,
    viewportHeight: 600,
    devicePixelRatio: 1.5,
  };
  const harness = createBackgroundHarness({
    tab,
    captureVisibleTab: async () => "data:image/png;base64,fixture",
    documentApi: { createElement: () => canvas },
    ImageClass: LoadedImage,
    sendMessage: async (_tabId, message) => {
      if (message.type === "PREPARE_CAPTURE") {
        return { ok: true, value: { metrics, pageUrl: tab.url, title: "Example" } };
      }
      if (message.type === "SCROLL_CAPTURE") {
        const actualY = message.segment.y > 0
          ? message.segment.y - 0.5
          : message.segment.y;
        return {
          ok: true,
          value: { actualX: message.segment.x, actualY, metrics },
        };
      }
      if (message.type === "CLEANUP_CAPTURE") {
        return { ok: true, value: { cleaned: true } };
      }
      throw new Error(`Unexpected command: ${message.type}`);
    },
    timer(callback) {
      callback();
      return 1;
    },
    urlApi: {
      createObjectURL: () => "blob:fixture",
      revokeObjectURL() {},
    },
  });

  await harness.sendRuntimeMessage({ type: "START_CAPTURE", tabId: tab.id });
  const state = await waitForTerminalState(harness, tab.id);

  assert.equal(state.status, "success");
  assert.equal(drawCalls.length, 2);
  assert.deepEqual(drawCalls[0].slice(1), [0, 0, 800, 600, 0, 0, 800, 600]);
  assert.deepEqual(drawCalls[1].slice(1), [0, 301, 800, 299, 0, 600, 800, 300]);
});

test("a nested scroller keeps the outer viewport and stitches only its frame", async () => {
  const drawCalls = [];
  const fillCalls = [];
  const context2d = {
    fillStyle: "",
    imageSmoothingEnabled: true,
    drawImage(...args) {
      drawCalls.push(args);
    },
    fillRect(...args) {
      fillCalls.push(args);
    },
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext() {
      return context2d;
    },
    toBlob(callback) {
      callback({ type: "image/png" });
    },
  };
  class LoadedImage {
    constructor() {
      this.naturalWidth = 800;
      this.naturalHeight = 600;
    }
    set src(_value) {
      Promise.resolve().then(() => this.onload());
    }
  }
  const tab = { id: 13, windowId: 2, active: true, url: "https://example.test/app" };
  const metrics = {
    documentWidth: 600,
    documentHeight: 1500,
    viewportWidth: 600,
    viewportHeight: 500,
    devicePixelRatio: 1,
  };
  const capture = {
    backgroundColor: "rgb(4, 12, 15)",
    bitmapViewportHeight: 600,
    bitmapViewportWidth: 800,
    frame: { x: 200, y: 100, width: 600, height: 500 },
    mode: "element",
    outputHeight: 1600,
    outputWidth: 800,
  };
  const harness = createBackgroundHarness({
    tab,
    captureVisibleTab: async () => "data:image/png;base64,fixture",
    documentApi: { createElement: () => canvas },
    ImageClass: LoadedImage,
    sendMessage: async (_tabId, message) => {
      if (message.type === "PREPARE_CAPTURE") {
        return {
          ok: true,
          value: { capture, metrics, pageUrl: tab.url, title: "App" },
        };
      }
      if (message.type === "SCROLL_CAPTURE") {
        return {
          ok: true,
          value: {
            actualX: message.segment.x,
            actualY: message.segment.y,
            capture,
            metrics,
          },
        };
      }
      if (message.type === "CLEANUP_CAPTURE") {
        return { ok: true, value: { cleaned: true } };
      }
      throw new Error(`Unexpected command: ${message.type}`);
    },
    timer(callback) {
      callback();
      return 1;
    },
    urlApi: {
      createObjectURL: () => "blob:fixture",
      revokeObjectURL() {},
    },
  });

  await harness.sendRuntimeMessage({ type: "START_CAPTURE", tabId: tab.id });
  const state = await waitForTerminalState(harness, tab.id);

  assert.equal(state.status, "success");
  assert.equal(canvas.width, 800);
  assert.equal(canvas.height, 1600);
  assert.deepEqual(fillCalls, [[0, 0, 800, 1600]]);
  assert.equal(context2d.fillStyle, capture.backgroundColor);
  assert.deepEqual(drawCalls[0].slice(1), [0, 0]);
  assert.deepEqual(drawCalls[1].slice(1), [200, 100, 600, 500, 200, 600, 600, 500]);
  assert.deepEqual(drawCalls[2].slice(1), [200, 100, 600, 500, 200, 1100, 600, 500]);
});

test("nested content expansion relocates trailing viewport chrome", async () => {
  const drawCalls = [];
  const context2d = {
    fillStyle: "",
    imageSmoothingEnabled: true,
    drawImage(...args) {
      drawCalls.push(args);
    },
    fillRect() {},
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext() {
      return context2d;
    },
    toBlob(callback) {
      callback({ type: "image/png" });
    },
  };
  class LoadedImage {
    constructor() {
      this.naturalWidth = 800;
      this.naturalHeight = 600;
    }
    set src(_value) {
      Promise.resolve().then(() => this.onload());
    }
  }
  const tab = { id: 14, windowId: 2, active: true, url: "https://example.test/app" };
  const metrics = {
    documentWidth: 900,
    documentHeight: 900,
    viewportWidth: 600,
    viewportHeight: 400,
    devicePixelRatio: 1,
  };
  const capture = {
    backgroundColor: "rgb(4, 12, 15)",
    bitmapViewportHeight: 600,
    bitmapViewportWidth: 800,
    frame: { x: 100, y: 100, width: 600, height: 400 },
    mode: "element",
    outputHeight: 1100,
    outputWidth: 1100,
  };
  const harness = createBackgroundHarness({
    tab,
    captureVisibleTab: async () => "data:image/png;base64,fixture",
    documentApi: { createElement: () => canvas },
    ImageClass: LoadedImage,
    sendMessage: async (_tabId, message) => {
      if (message.type === "PREPARE_CAPTURE") {
        return { ok: true, value: { capture, metrics, pageUrl: tab.url, title: "App" } };
      }
      if (message.type === "SCROLL_CAPTURE") {
        return {
          ok: true,
          value: {
            actualX: message.segment.x,
            actualY: message.segment.y,
            capture,
            metrics,
          },
        };
      }
      if (message.type === "CLEANUP_CAPTURE") {
        return { ok: true, value: { cleaned: true } };
      }
      throw new Error(`Unexpected command: ${message.type}`);
    },
    timer(callback) {
      callback();
      return 1;
    },
    urlApi: {
      createObjectURL: () => "blob:fixture",
      revokeObjectURL() {},
    },
  });

  await harness.sendRuntimeMessage({ type: "START_CAPTURE", tabId: tab.id });
  const state = await waitForTerminalState(harness, tab.id);

  assert.equal(state.status, "success");
  assert.equal(canvas.width, 1100);
  assert.equal(canvas.height, 1100);
  assert.equal(drawCalls.some((call) => call.length === 3), false);
  assert.ok(drawCalls.some((call) =>
    JSON.stringify(call.slice(1)) === JSON.stringify([0, 0, 700, 100, 0, 0, 700, 100])
  ));
  assert.ok(drawCalls.some((call) =>
    JSON.stringify(call.slice(1)) === JSON.stringify([700, 0, 100, 100, 1000, 0, 100, 100])
  ));
  assert.ok(drawCalls.some((call) =>
    JSON.stringify(call.slice(1)) === JSON.stringify([700, 100, 100, 400, 1000, 100, 100, 400])
  ));
  assert.ok(drawCalls.some((call) =>
    JSON.stringify(call.slice(1)) === JSON.stringify([0, 500, 700, 100, 0, 1000, 700, 100])
  ));
  assert.ok(drawCalls.some((call) =>
    JSON.stringify(call.slice(1)) === JSON.stringify([700, 500, 100, 100, 1000, 1000, 100, 100])
  ));
});

test("a moving nested frame aborts before bitmap capture", async () => {
  let captureCalls = 0;
  let cleanupCalls = 0;
  const tab = { id: 15, windowId: 2, active: true, url: "https://example.test/app" };
  const metrics = {
    documentWidth: 600,
    documentHeight: 900,
    viewportWidth: 600,
    viewportHeight: 400,
    devicePixelRatio: 1,
  };
  const capture = {
    backgroundColor: "rgb(4, 12, 15)",
    bitmapViewportHeight: 600,
    bitmapViewportWidth: 800,
    frame: { x: 100, y: 100, width: 600, height: 400 },
    mode: "element",
    outputHeight: 1100,
    outputWidth: 800,
  };
  const harness = createBackgroundHarness({
    tab,
    captureVisibleTab: async () => {
      captureCalls += 1;
      return "unused";
    },
    sendMessage: async (_tabId, message) => {
      if (message.type === "PREPARE_CAPTURE") {
        return { ok: true, value: { capture, metrics, pageUrl: tab.url, title: "App" } };
      }
      if (message.type === "SCROLL_CAPTURE") {
        return {
          ok: true,
          value: {
            actualX: message.segment.x,
            actualY: message.segment.y,
            capture: { ...capture, frame: { ...capture.frame, y: 80 } },
            metrics,
          },
        };
      }
      if (message.type === "CLEANUP_CAPTURE") {
        cleanupCalls += 1;
        return { ok: true, value: { cleaned: true } };
      }
      throw new Error(`Unexpected command: ${message.type}`);
    },
    timer(callback) {
      callback();
      return 1;
    },
  });

  await harness.sendRuntimeMessage({ type: "START_CAPTURE", tabId: tab.id });
  const state = await waitForTerminalState(harness, tab.id);

  assert.equal(state.status, "error");
  assert.equal(state.errorCode, "PAGE_SIZE_CHANGED");
  assert.equal(captureCalls, 0);
  assert.equal(cleanupCalls, 1);
});

test("an oversized page is downscaled and downloaded instead of rejected", async () => {
  const drawCalls = [];
  const context2d = {
    fillStyle: "",
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low",
    drawImage(...args) {
      drawCalls.push(args);
    },
    fillRect() {},
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext() {
      return context2d;
    },
    toBlob(callback) {
      callback({ type: "image/png" });
    },
  };
  class LoadedImage {
    constructor() {
      this.naturalWidth = 3840;
      this.naturalHeight = 2000;
    }
    set src(_value) {
      Promise.resolve().then(() => this.onload());
    }
  }
  const tab = { id: 16, windowId: 2, active: true, url: "https://example.test/large" };
  const metrics = {
    documentWidth: 3840,
    documentHeight: 20000,
    viewportWidth: 3840,
    viewportHeight: 2000,
    devicePixelRatio: 1,
  };
  const harness = createBackgroundHarness({
    tab,
    captureVisibleTab: async () => "data:image/png;base64,fixture",
    documentApi: { createElement: () => canvas },
    ImageClass: LoadedImage,
    sendMessage: async (_tabId, message) => {
      if (message.type === "PREPARE_CAPTURE") {
        return { ok: true, value: { metrics, pageUrl: tab.url, title: "Large" } };
      }
      if (message.type === "SCROLL_CAPTURE") {
        return {
          ok: true,
          value: { actualX: message.segment.x, actualY: message.segment.y, metrics },
        };
      }
      if (message.type === "CLEANUP_CAPTURE") {
        return { ok: true, value: { cleaned: true } };
      }
      throw new Error(`Unexpected command: ${message.type}`);
    },
    timer(callback) {
      callback();
      return 1;
    },
    urlApi: {
      createObjectURL: () => "blob:fixture",
      revokeObjectURL() {},
    },
  });

  await harness.sendRuntimeMessage({ type: "START_CAPTURE", tabId: tab.id });
  const state = await waitForTerminalState(harness, tab.id);

  assert.equal(state.status, "success");
  assert.equal(state.outputScaled, true);
  assert.match(state.message, /自動縮放/);
  assert.ok(canvas.width < metrics.documentWidth);
  assert.ok(canvas.height < metrics.documentHeight);
  assert.ok(canvas.width * canvas.height <= 64000000);
  assert.equal(drawCalls.length, 10);
  assert.equal(context2d.imageSmoothingEnabled, true);
  assert.equal(context2d.imageSmoothingQuality, "high");
});

test("an oversized nested scroller keeps full source crops while output is scaled", async () => {
  const drawCalls = [];
  const context2d = {
    fillStyle: "",
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low",
    drawImage(...args) {
      drawCalls.push(args);
    },
    fillRect() {},
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext() {
      return context2d;
    },
    toBlob(callback) {
      callback({ type: "image/png" });
    },
  };
  class LoadedImage {
    constructor() {
      this.naturalWidth = 3840;
      this.naturalHeight = 2000;
    }
    set src(_value) {
      Promise.resolve().then(() => this.onload());
    }
  }
  const tab = { id: 17, windowId: 2, active: true, url: "https://example.test/large-app" };
  const metrics = {
    documentWidth: 3340,
    documentHeight: 20000,
    viewportWidth: 3340,
    viewportHeight: 1800,
    devicePixelRatio: 1,
  };
  const capture = {
    backgroundColor: "rgb(4, 12, 15)",
    bitmapViewportHeight: 2000,
    bitmapViewportWidth: 3840,
    frame: { x: 500, y: 200, width: 3340, height: 1800 },
    mode: "element",
    outputHeight: 20200,
    outputWidth: 3840,
  };
  const harness = createBackgroundHarness({
    tab,
    captureVisibleTab: async () => "data:image/png;base64,fixture",
    documentApi: { createElement: () => canvas },
    ImageClass: LoadedImage,
    sendMessage: async (_tabId, message) => {
      if (message.type === "PREPARE_CAPTURE") {
        return { ok: true, value: { capture, metrics, pageUrl: tab.url, title: "Large app" } };
      }
      if (message.type === "SCROLL_CAPTURE") {
        return {
          ok: true,
          value: {
            actualX: message.segment.x,
            actualY: message.segment.y,
            capture,
            metrics,
          },
        };
      }
      if (message.type === "CLEANUP_CAPTURE") {
        return { ok: true, value: { cleaned: true } };
      }
      throw new Error(`Unexpected command: ${message.type}`);
    },
    timer(callback) {
      callback();
      return 1;
    },
    urlApi: {
      createObjectURL: () => "blob:fixture",
      revokeObjectURL() {},
    },
  });

  await harness.sendRuntimeMessage({ type: "START_CAPTURE", tabId: tab.id });
  const state = await waitForTerminalState(harness, tab.id);

  assert.equal(state.status, "success");
  assert.equal(state.outputScaled, true);
  assert.equal(drawCalls.length, 12);
  assert.deepEqual(drawCalls[0].slice(1, 5), [0, 0, 3840, 2000]);
  assert.ok(drawCalls[0][7] < 3840);
  assert.deepEqual(drawCalls[1].slice(1, 5), [500, 200, 3340, 1800]);
  assert.ok(drawCalls[1][7] < 3340);
  assert.ok(canvas.width * canvas.height <= 64000000);
});

test("an in-flight capture cannot recreate state after its tab closes", async () => {
  let rejectCapture;
  const capturePromise = new Promise((_, reject) => {
    rejectCapture = reject;
  });
  const tab = { id: 12, windowId: 2, active: true, url: "https://example.test/" };
  const metrics = {
    documentWidth: 800,
    documentHeight: 600,
    viewportWidth: 800,
    viewportHeight: 600,
    devicePixelRatio: 1,
  };
  const harness = createBackgroundHarness({
    tab,
    captureVisibleTab: async () => capturePromise,
    sendMessage: async (_tabId, message) => {
      if (message.type === "PREPARE_CAPTURE") {
        return { ok: true, value: { metrics, pageUrl: tab.url, title: "Example" } };
      }
      if (message.type === "SCROLL_CAPTURE") {
        return { ok: true, value: { actualX: 0, actualY: 0, metrics } };
      }
      if (message.type === "CLEANUP_CAPTURE") {
        return { ok: true, value: { cleaned: true } };
      }
      throw new Error(`Unexpected command: ${message.type}`);
    },
  });

  await harness.sendRuntimeMessage({ type: "START_CAPTURE", tabId: tab.id });
  await new Promise((resolve) => setTimeout(resolve, 0));
  harness.removeTab(tab.id);
  rejectCapture(new Error("Tab closed."));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const state = await harness.sendRuntimeMessage({
    type: "GET_CAPTURE_STATE",
    tabId: tab.id,
  });

  assert.equal(state.status, "idle");
});

test("a region capture crops to the picked element frame after the user picks it", async () => {
  const drawCalls = [];
  const fillCalls = [];
  const contentMessages = [];
  const context2d = {
    fillStyle: "",
    imageSmoothingEnabled: true,
    drawImage(...args) {
      drawCalls.push(args);
    },
    fillRect(...args) {
      fillCalls.push(args);
    },
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext() {
      return context2d;
    },
    toBlob(callback) {
      callback({ type: "image/png" });
    },
  };
  class LoadedImage {
    constructor() {
      this.naturalWidth = 800;
      this.naturalHeight = 600;
    }
    set src(_value) {
      Promise.resolve().then(() => this.onload());
    }
  }
  const tab = { id: 80, windowId: 2, active: true, url: "https://example.test/app" };
  const metrics = {
    documentWidth: 596,
    documentHeight: 1496,
    viewportWidth: 596,
    viewportHeight: 496,
    devicePixelRatio: 1,
  };
  const capture = {
    backgroundColor: "rgb(4, 12, 15)",
    bitmapViewportHeight: 600,
    bitmapViewportWidth: 800,
    frame: { x: 202, y: 102, width: 596, height: 496 },
    mode: "region",
    outputHeight: 1496,
    outputWidth: 596,
  };
  const harness = createBackgroundHarness({
    tab,
    captureVisibleTab: async () => "data:image/png;base64,fixture",
    documentApi: { createElement: () => canvas },
    ImageClass: LoadedImage,
    sendMessage: async (_tabId, message) => {
      contentMessages.push(message.type);
      if (message.type === "ENTER_REGION_PICKER") {
        return { ok: true, value: { active: true } };
      }
      if (message.type === "PREPARE_REGION_CAPTURE") {
        return {
          ok: true,
          value: { capture, metrics, pageUrl: tab.url, title: "App" },
        };
      }
      if (message.type === "SCROLL_CAPTURE") {
        return {
          ok: true,
          value: {
            actualX: message.segment.x,
            actualY: message.segment.y,
            capture,
            metrics,
          },
        };
      }
      if (message.type === "CLEANUP_CAPTURE") {
        return { ok: true, value: { cleaned: true } };
      }
      throw new Error(`Unexpected command: ${message.type}`);
    },
    timer(callback) {
      callback();
      return 1;
    },
    urlApi: {
      createObjectURL: () => "blob:fixture",
      revokeObjectURL() {},
    },
  });

  const started = await harness.sendRuntimeMessage({
    type: "START_REGION_CAPTURE",
    tabId: tab.id,
  });
  assert.equal(started.accepted, true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const picking = await harness.sendRuntimeMessage({
    type: "GET_CAPTURE_STATE",
    tabId: tab.id,
  });
  assert.equal(picking.status, "picking");
  assert.deepEqual(contentMessages, ["ENTER_REGION_PICKER"]);

  const picked = await harness.sendRuntimeMessage(
    { type: "REGION_PICKED" },
    { tab: { id: tab.id } },
  );
  assert.equal(picked.accepted, true);
  assert.equal(harness.popupOpenCount, 1);
  const state = await waitForTerminalState(harness, tab.id);

  assert.equal(state.status, "success");
  assert.match(state.message, /區域截圖已儲存/);
  assert.match(state.filename, /^region-example\.test-/);
  assert.equal(canvas.width, 596);
  assert.equal(canvas.height, 1496);
  assert.deepEqual(fillCalls, [[0, 0, 596, 1496]]);
  assert.equal(drawCalls.length, 4);
  assert.ok(drawCalls.every((call) => call.length === 9));
  assert.deepEqual(drawCalls[0].slice(1), [202, 102, 596, 496, 0, 0, 596, 496]);
  assert.deepEqual(drawCalls[1].slice(1), [202, 102, 596, 496, 0, 496, 596, 496]);
  assert.deepEqual(drawCalls[2].slice(1), [202, 102, 596, 496, 0, 992, 596, 496]);
  assert.deepEqual(drawCalls[3].slice(1), [202, 590, 596, 8, 0, 1488, 596, 8]);
  assert.deepEqual(contentMessages, [
    "ENTER_REGION_PICKER",
    "PREPARE_REGION_CAPTURE",
    "SCROLL_CAPTURE",
    "SCROLL_CAPTURE",
    "SCROLL_CAPTURE",
    "SCROLL_CAPTURE",
    "SCROLL_CAPTURE",
    "SCROLL_CAPTURE",
    "SCROLL_CAPTURE",
    "SCROLL_CAPTURE",
    "CLEANUP_CAPTURE",
  ]);
});

test("region picking can be cancelled and returns to idle", async () => {
  const contentMessages = [];
  const tab = { id: 81, windowId: 2, active: true, url: "https://example.test/" };
  const harness = createBackgroundHarness({
    tab,
    captureVisibleTab: async () => {
      throw new Error("A cancelled picker must not capture.");
    },
    sendMessage: async (_tabId, message) => {
      contentMessages.push(message.type);
      if (message.type === "ENTER_REGION_PICKER") {
        return { ok: true, value: { active: true } };
      }
      throw new Error(`Unexpected command: ${message.type}`);
    },
  });

  await harness.sendRuntimeMessage({ type: "START_REGION_CAPTURE", tabId: tab.id });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const cancelled = await harness.sendRuntimeMessage(
    { type: "REGION_PICK_CANCELLED" },
    { tab: { id: tab.id } },
  );

  assert.equal(cancelled.dismissed, true);
  assert.equal(harness.popupOpenCount, 0);
  const state = await harness.sendRuntimeMessage({
    type: "GET_CAPTURE_STATE",
    tabId: tab.id,
  });
  assert.equal(state.status, "idle");
  assert.match(state.message, /已取消區域選取/);
  assert.deepEqual(contentMessages, ["ENTER_REGION_PICKER"]);
});

test("a picked region without an active picker is ignored", async () => {
  const tab = { id: 82, windowId: 2, active: true, url: "https://example.test/" };
  const harness = createBackgroundHarness({
    tab,
    captureVisibleTab: async () => "unused",
    sendMessage: async () => {
      throw new Error("No content command is expected without a picker.");
    },
  });

  const picked = await harness.sendRuntimeMessage(
    { type: "REGION_PICKED" },
    { tab: { id: tab.id } },
  );
  assert.equal(picked.accepted, false);
  const state = await harness.sendRuntimeMessage({
    type: "GET_CAPTURE_STATE",
    tabId: tab.id,
  });
  assert.equal(state.status, "idle");
});

test("starting a full-page capture exits an active picker first", async () => {
  const contentMessages = [];
  const context2d = {
    imageSmoothingEnabled: true,
    drawImage() {},
    fillRect() {},
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext() {
      return context2d;
    },
    toBlob(callback) {
      callback({ type: "image/png" });
    },
  };
  class LoadedImage {
    constructor() {
      this.naturalWidth = 800;
      this.naturalHeight = 600;
    }
    set src(_value) {
      Promise.resolve().then(() => this.onload());
    }
  }
  const tab = { id: 83, windowId: 2, active: true, url: "https://example.test/" };
  const metrics = {
    documentWidth: 800,
    documentHeight: 600,
    viewportWidth: 800,
    viewportHeight: 600,
    devicePixelRatio: 1,
  };
  const harness = createBackgroundHarness({
    tab,
    captureVisibleTab: async () => "data:image/png;base64,fixture",
    documentApi: { createElement: () => canvas },
    ImageClass: LoadedImage,
    sendMessage: async (_tabId, message) => {
      contentMessages.push(message.type);
      if (message.type === "ENTER_REGION_PICKER") {
        return { ok: true, value: { active: true } };
      }
      if (message.type === "EXIT_REGION_PICKER") {
        return { ok: true, value: { active: false } };
      }
      if (message.type === "PREPARE_CAPTURE") {
        return { ok: true, value: { metrics, pageUrl: tab.url, title: "Example" } };
      }
      if (message.type === "SCROLL_CAPTURE") {
        return { ok: true, value: { actualX: 0, actualY: 0, metrics } };
      }
      if (message.type === "CLEANUP_CAPTURE") {
        return { ok: true, value: { cleaned: true } };
      }
      throw new Error(`Unexpected command: ${message.type}`);
    },
    timer(callback) {
      callback();
      return 1;
    },
    urlApi: {
      createObjectURL: () => "blob:fixture",
      revokeObjectURL() {},
    },
  });

  await harness.sendRuntimeMessage({ type: "START_REGION_CAPTURE", tabId: tab.id });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await harness.sendRuntimeMessage({ type: "START_CAPTURE", tabId: tab.id });
  const state = await waitForTerminalState(harness, tab.id);

  assert.equal(state.status, "success");
  assert.deepEqual(contentMessages.slice(0, 3), [
    "ENTER_REGION_PICKER",
    "EXIT_REGION_PICKER",
    "PREPARE_CAPTURE",
  ]);
});

test("a region target rejected at prepare time reports a region error without cleanup", async () => {
  const contentMessages = [];
  const tab = { id: 84, windowId: 2, active: true, url: "https://example.test/app" };
  const harness = createBackgroundHarness({
    tab,
    captureVisibleTab: async () => {
      throw new Error("A rejected region must not be captured.");
    },
    sendMessage: async (_tabId, message) => {
      contentMessages.push(message.type);
      if (message.type === "ENTER_REGION_PICKER") {
        return { ok: true, value: { active: true } };
      }
      if (message.type === "PREPARE_REGION_CAPTURE") {
        return { ok: false, error: { code: "REGION_TARGET_INVALID" } };
      }
      if (message.type === "CLEANUP_CAPTURE") {
        return { ok: true, value: { cleaned: true } };
      }
      throw new Error(`Unexpected command: ${message.type}`);
    },
  });

  await harness.sendRuntimeMessage({ type: "START_REGION_CAPTURE", tabId: tab.id });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await harness.sendRuntimeMessage(
    { type: "REGION_PICKED" },
    { tab: { id: tab.id } },
  );
  const state = await waitForTerminalState(harness, tab.id);

  assert.equal(state.status, "error");
  assert.equal(state.errorCode, "REGION_TARGET_INVALID");
  assert.match(state.message, /重新選取/);
  assert.deepEqual(contentMessages, [
    "ENTER_REGION_PICKER",
    "PREPARE_REGION_CAPTURE",
  ]);
});

test("page size changes include before and after geometry in the user message", async () => {
  const context2d = {
    imageSmoothingEnabled: true,
    drawImage() {},
    fillRect() {},
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext() {
      return context2d;
    },
    toBlob(callback) {
      callback({ type: "image/png" });
    },
  };
  class LoadedImage {
    constructor() {
      this.naturalWidth = 800;
      this.naturalHeight = 600;
    }
    set src(_value) {
      Promise.resolve().then(() => this.onload());
    }
  }
  const tab = { id: 85, windowId: 2, active: true, url: "https://example.test/" };
  const metrics = {
    documentWidth: 800,
    documentHeight: 1200,
    viewportWidth: 800,
    viewportHeight: 600,
    devicePixelRatio: 1,
  };
  const harness = createBackgroundHarness({
    tab,
    captureVisibleTab: async () => "data:image/png;base64,fixture",
    documentApi: { createElement: () => canvas },
    ImageClass: LoadedImage,
    sendMessage: async (_tabId, message) => {
      if (message.type === "PREPARE_CAPTURE") {
        return { ok: true, value: { metrics, pageUrl: tab.url, title: "Example" } };
      }
      if (message.type === "SCROLL_CAPTURE") {
        const shifted = message.segment.index === 0
          ? metrics
          : { ...metrics, documentHeight: 1250 };
        return {
          ok: true,
          value: { actualX: message.segment.x, actualY: message.segment.y, metrics: shifted },
        };
      }
      if (message.type === "CLEANUP_CAPTURE") {
        return { ok: true, value: { cleaned: true } };
      }
      throw new Error(`Unexpected command: ${message.type}`);
    },
    timer(callback) {
      callback();
      return 1;
    },
    urlApi: {
      createObjectURL: () => "blob:fixture",
      revokeObjectURL() {},
    },
  });

  await harness.sendRuntimeMessage({ type: "START_CAPTURE", tabId: tab.id });
  const state = await waitForTerminalState(harness, tab.id);

  assert.equal(state.status, "error");
  assert.equal(state.errorCode, "PAGE_SIZE_CHANGED");
  assert.match(state.message, /文件 800 × 1200 → 800 × 1250/);
  assert.match(state.message, /視窗 800 × 600 → 800 × 600/);
});

test("a moving capture frame reports before and after frame diagnostics", async () => {
  const tab = { id: 86, windowId: 2, active: true, url: "https://example.test/app" };
  const metrics = {
    documentWidth: 600,
    documentHeight: 900,
    viewportWidth: 600,
    viewportHeight: 400,
    devicePixelRatio: 1,
  };
  const capture = {
    backgroundColor: "rgb(4, 12, 15)",
    bitmapViewportHeight: 600,
    bitmapViewportWidth: 800,
    frame: { x: 100, y: 100, width: 600, height: 400 },
    mode: "element",
    outputHeight: 1100,
    outputWidth: 800,
  };
  const harness = createBackgroundHarness({
    tab,
    captureVisibleTab: async () => "data:image/png;base64,fixture",
    sendMessage: async (_tabId, message) => {
      if (message.type === "PREPARE_CAPTURE") {
        return {
          ok: true,
          value: { capture, metrics, pageUrl: tab.url, title: "App" },
        };
      }
      if (message.type === "SCROLL_CAPTURE") {
        return {
          ok: true,
          value: {
            actualX: message.segment.x,
            actualY: message.segment.y,
            capture: { ...capture, frame: { ...capture.frame, y: 80.25 } },
            metrics,
          },
        };
      }
      if (message.type === "CLEANUP_CAPTURE") {
        return { ok: true, value: { cleaned: true } };
      }
      throw new Error(`Unexpected command: ${message.type}`);
    },
  });

  await harness.sendRuntimeMessage({ type: "START_CAPTURE", tabId: tab.id });
  const state = await waitForTerminalState(harness, tab.id);

  assert.equal(state.status, "error");
  assert.equal(state.errorCode, "PAGE_SIZE_CHANGED");
  assert.match(state.message, /區域框 \(100, 100, 600 × 400\) → \(100, 80\.25, 600 × 400\)/);
});

test("capture progress and completion are mirrored to the toolbar badge", async () => {
  const context2d = {
    imageSmoothingEnabled: true,
    drawImage() {},
    fillRect() {},
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext() {
      return context2d;
    },
    toBlob(callback) {
      callback({ type: "image/png" });
    },
  };
  class LoadedImage {
    constructor() {
      this.naturalWidth = 800;
      this.naturalHeight = 600;
    }
    set src(_value) {
      Promise.resolve().then(() => this.onload());
    }
  }
  const tab = { id: 87, windowId: 2, active: true, url: "https://example.test/" };
  const metrics = {
    documentWidth: 800,
    documentHeight: 1200,
    viewportWidth: 800,
    viewportHeight: 600,
    devicePixelRatio: 1,
  };
  const harness = createBackgroundHarness({
    tab,
    captureVisibleTab: async () => "data:image/png;base64,fixture",
    documentApi: { createElement: () => canvas },
    ImageClass: LoadedImage,
    sendMessage: async (_tabId, message) => {
      if (message.type === "PREPARE_CAPTURE") {
        return { ok: true, value: { metrics, pageUrl: tab.url, title: "Example" } };
      }
      if (message.type === "SCROLL_CAPTURE") {
        return {
          ok: true,
          value: { actualX: message.segment.x, actualY: message.segment.y, metrics },
        };
      }
      if (message.type === "CLEANUP_CAPTURE") {
        return { ok: true, value: { cleaned: true } };
      }
      throw new Error(`Unexpected command: ${message.type}`);
    },
    timer(callback) {
      callback();
      return 1;
    },
    urlApi: {
      createObjectURL: () => "blob:fixture",
      revokeObjectURL() {},
    },
  });

  await harness.sendRuntimeMessage({ type: "START_CAPTURE", tabId: tab.id });
  const state = await waitForTerminalState(harness, tab.id);

  assert.equal(state.status, "success");
  const texts = harness.badgeCalls
    .filter((call) => Object.prototype.hasOwnProperty.call(call, "text"))
    .map((call) => call.text);
  assert.deepEqual(texts, ["…", "0%", "50%", "100%", "輸出", ""]);
  assert.ok(
    harness.badgeCalls
      .filter((call) => Object.prototype.hasOwnProperty.call(call, "color"))
      .every((call) => call.color === "#3f8f5f"),
  );
});

test("the badge shows picking state and clears after cancellation", async () => {
  const tab = { id: 88, windowId: 2, active: true, url: "https://example.test/" };
  const harness = createBackgroundHarness({
    tab,
    captureVisibleTab: async () => "unused",
    sendMessage: async (_tabId, message) => {
      if (message.type === "ENTER_REGION_PICKER") {
        return { ok: true, value: { active: true } };
      }
      throw new Error(`Unexpected command: ${message.type}`);
    },
  });

  await harness.sendRuntimeMessage({ type: "START_REGION_CAPTURE", tabId: tab.id });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await harness.sendRuntimeMessage(
    { type: "REGION_PICK_CANCELLED" },
    { tab: { id: tab.id } },
  );

  const texts = harness.badgeCalls
    .filter((call) => Object.prototype.hasOwnProperty.call(call, "text"))
    .map((call) => call.text);
  assert.deepEqual(texts, ["…", "選取", ""]);
});

test("a failed capture flags the badge with an error mark", async () => {
  const tab = { id: 89, windowId: 2, active: true, url: "https://example.test/" };
  const metrics = {
    documentWidth: 800,
    documentHeight: 600,
    viewportWidth: 800,
    viewportHeight: 600,
    devicePixelRatio: 1,
  };
  const harness = createBackgroundHarness({
    tab,
    captureVisibleTab: async () => {
      throw new Error("Synthetic capture failure.");
    },
    sendMessage: async (_tabId, message) => {
      if (message.type === "PREPARE_CAPTURE") {
        return { ok: true, value: { metrics, pageUrl: tab.url, title: "Example" } };
      }
      if (message.type === "SCROLL_CAPTURE") {
        return { ok: true, value: { actualX: 0, actualY: 0, metrics } };
      }
      if (message.type === "CLEANUP_CAPTURE") {
        return { ok: true, value: { cleaned: true } };
      }
      throw new Error(`Unexpected command: ${message.type}`);
    },
  });

  await harness.sendRuntimeMessage({ type: "START_CAPTURE", tabId: tab.id });
  const state = await waitForTerminalState(harness, tab.id);

  assert.equal(state.status, "error");
  const texts = harness.badgeCalls
    .filter((call) => Object.prototype.hasOwnProperty.call(call, "text"))
    .map((call) => call.text);
  assert.equal(texts[texts.length - 1], "!");
  const colors = harness.badgeCalls
    .filter((call) => Object.prototype.hasOwnProperty.call(call, "color"))
    .map((call) => call.color);
  assert.equal(colors[colors.length - 1], "#b33747");
});

function createCapturingHarness({ tab, metrics, onScrollCommand }) {
  const drawCalls = [];
  const context2d = {
    fillStyle: "",
    imageSmoothingEnabled: true,
    drawImage(...args) {
      drawCalls.push(args);
    },
    fillRect() {},
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext() {
      return context2d;
    },
    toBlob(callback) {
      callback({ type: "image/png" });
    },
  };
  class LoadedImage {
    constructor() {
      this.naturalWidth = 800;
      this.naturalHeight = 600;
    }
    set src(_value) {
      Promise.resolve().then(() => this.onload());
    }
  }

  const state = { captureCount: 0, downloadCount: 0 };
  const harness = createBackgroundHarness({
    tab,
    captureVisibleTab: async () => {
      state.captureCount += 1;
      return "data:image/png;base64,fixture";
    },
    documentApi: { createElement: () => canvas },
    download: async () => {
      state.downloadCount += 1;
      return 1;
    },
    ImageClass: LoadedImage,
    sendMessage: async (_tabId, message) => {
      if (message.type === "PREPARE_CAPTURE") {
        return { ok: true, value: { metrics, pageUrl: tab.url, title: "Example" } };
      }
      if (message.type === "SCROLL_CAPTURE") {
        return onScrollCommand(message);
      }
      if (message.type === "CLEANUP_CAPTURE") {
        return { ok: true, value: { cleaned: true } };
      }
      throw new Error(`Unexpected command: ${message.type}`);
    },
    timer(callback) {
      callback();
      return 1;
    },
    urlApi: {
      createObjectURL: () => "blob:fixture",
      revokeObjectURL() {},
    },
  });

  return { drawCalls, harness, state };
}

test("a segment whose scroll drifts after capture is re-scrolled and re-captured", async () => {
  const tab = { id: 90, windowId: 2, active: true, url: "https://example.test/" };
  const metrics = {
    documentWidth: 800,
    documentHeight: 1200,
    viewportWidth: 800,
    viewportHeight: 600,
    devicePixelRatio: 1,
  };
  let driftsRemaining = 1;
  const { drawCalls, harness, state } = createCapturingHarness({
    tab,
    metrics,
    onScrollCommand(message) {
      if (message.segment.verifyOnly && driftsRemaining > 0) {
        driftsRemaining -= 1;
        return {
          ok: false,
          error: {
            code: "SEGMENT_SCROLL_LOST",
            details: {
              actualX: 0,
              actualY: 0,
              requestedX: message.segment.x,
              requestedY: message.segment.y,
            },
          },
        };
      }
      return {
        ok: true,
        value: {
          actualX: message.segment.x,
          actualY: message.segment.y,
          metrics,
        },
      };
    },
  });

  await harness.sendRuntimeMessage({ type: "START_CAPTURE", tabId: tab.id });
  const result = await waitForTerminalState(harness, tab.id);

  assert.equal(result.status, "success");
  assert.equal(driftsRemaining, 0);
  assert.equal(state.captureCount, 3);
  assert.equal(state.downloadCount, 1);
  assert.equal(drawCalls.length, 2);
});

test("a segment re-rendered after capture is re-captured", async () => {
  const tab = { id: 91, windowId: 2, active: true, url: "https://example.test/" };
  const metrics = {
    documentWidth: 800,
    documentHeight: 1200,
    viewportWidth: 800,
    viewportHeight: 600,
    devicePixelRatio: 1,
  };
  let mutationDrifts = 1;
  const { drawCalls, harness, state } = createCapturingHarness({
    tab,
    metrics,
    onScrollCommand(message) {
      if (message.segment.verifyOnly && mutationDrifts > 0) {
        mutationDrifts -= 1;
        return {
          ok: true,
          value: {
            actualX: message.segment.x,
            actualY: message.segment.y,
            metrics,
            mutations: 8,
          },
        };
      }
      return {
        ok: true,
        value: {
          actualX: message.segment.x,
          actualY: message.segment.y,
          metrics,
          mutations: 5,
        },
      };
    },
  });

  await harness.sendRuntimeMessage({ type: "START_CAPTURE", tabId: tab.id });
  const result = await waitForTerminalState(harness, tab.id);

  assert.equal(result.status, "success");
  assert.equal(mutationDrifts, 0);
  assert.equal(state.captureCount, 3);
  assert.equal(state.downloadCount, 1);
  assert.equal(drawCalls.length, 2);
});

test("a segment that keeps drifting fails closed without downloading", async () => {
  const tab = { id: 92, windowId: 2, active: true, url: "https://example.test/" };
  const metrics = {
    documentWidth: 800,
    documentHeight: 1200,
    viewportWidth: 800,
    viewportHeight: 600,
    devicePixelRatio: 1,
  };
  const { drawCalls, harness, state } = createCapturingHarness({
    tab,
    metrics,
    onScrollCommand(message) {
      if (message.segment.verifyOnly) {
        return {
          ok: false,
          error: {
            code: "SEGMENT_SCROLL_LOST",
            details: {
              actualX: 0,
              actualY: 0,
              requestedX: message.segment.x,
              requestedY: message.segment.y,
            },
          },
        };
      }
      return {
        ok: true,
        value: {
          actualX: message.segment.x,
          actualY: message.segment.y,
          metrics,
        },
      };
    },
  });

  await harness.sendRuntimeMessage({ type: "START_CAPTURE", tabId: tab.id });
  const result = await waitForTerminalState(harness, tab.id);

  assert.equal(result.status, "error");
  assert.equal(result.errorCode, "SEGMENT_SCROLL_LOST");
  assert.match(result.message, /自行捲動或更新/);
  assert.equal(state.captureCount, 3);
  assert.equal(state.downloadCount, 0);
  assert.equal(drawCalls.length, 0);
});
