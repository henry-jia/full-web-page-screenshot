"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const FwpsI18n = require("../extension/i18n.js");
const FwpsAnnotate = require("../extension/annotate.js");

const editorSource = fs.readFileSync(
  path.join(__dirname, "..", "extension", "editor", "editor.js"),
  "utf8",
);

function createContextRecorder() {
  const calls = [];
  const recorder = {
    calls,
    measureText(text) {
      return { width: String(text).length * 20 };
    },
    beginPath() {
      calls.push(["beginPath"]);
    },
    moveTo(x, y) {
      calls.push(["moveTo", x, y]);
    },
    lineTo(x, y) {
      calls.push(["lineTo", x, y]);
    },
    stroke() {
      calls.push(["stroke"]);
    },
    strokeRect(...args) {
      calls.push(["strokeRect", ...args]);
    },
    fillRect(...args) {
      calls.push(["fillRect", ...args]);
    },
    ellipse(...args) {
      calls.push(["ellipse", ...args]);
    },
    arc(...args) {
      calls.push(["arc", ...args]);
    },
    fill() {
      calls.push(["fill"]);
    },
    fillText(...args) {
      calls.push(["fillText", ...args]);
    },
    drawImage(...args) {
      calls.push(["drawImage", ...args]);
    },
    clearRect(...args) {
      calls.push(["clearRect", ...args]);
    },
    save() {
      calls.push(["save"]);
    },
    restore() {
      calls.push(["restore"]);
    },
    setLineDash(...args) {
      calls.push(["setLineDash", ...args]);
    },
  };
  for (const property of ["fillStyle", "strokeStyle"]) {
    let value = "";
    Object.defineProperty(recorder, property, {
      get: () => value,
      set(next) {
        value = next;
        calls.push([property, next]);
      },
    });
  }
  let alphaValue = 1;
  Object.defineProperty(recorder, "globalAlpha", {
    get: () => alphaValue,
    set(next) {
      alphaValue = next;
      calls.push(["globalAlpha", next]);
    },
  });
  return recorder;
}

function createElementStub(id) {
  const listeners = new Map();
  return {
    id,
    dataset: {},
    style: {},
    classList: { toggle() {} },
    disabled: false,
    hidden: false,
    textContent: "",
    value: "",
    clientWidth: 800,
    clientHeight: 600,
    scrollLeft: 0,
    scrollTop: 0,
    setAttribute() {},
    focus() {},
    setPointerCapture() {},
    addEventListener(type, handler) {
      if (!listeners.has(type)) {
        listeners.set(type, []);
      }
      listeners.get(type).push(handler);
    },
    fire(type, event) {
      for (const handler of listeners.get(type) || []) {
        handler(event);
      }
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 800, height: 600 };
    },
  };
}

function pointerEvent(clientX, clientY, extra = {}) {
  return {
    clientX,
    clientY,
    pointerId: 1,
    button: 0,
    ctrlKey: false,
    metaKey: false,
    preventDefault() {
      this.prevented = true;
    },
    ...extra,
  };
}

function createEditorHarness() {
  const elements = new Map();
  const baseContext = createContextRecorder();
  const overlayContext = createContextRecorder();
  const globalListeners = new Map();
  const documentListeners = new Map();
  const wrapChildren = [];

  function element(id) {
    if (!elements.has(id)) {
      elements.set(id, createElementStub(id));
    }
    return elements.get(id);
  }

  for (const id of ["base-canvas", "overlay-canvas"]) {
    const canvas = element(id);
    canvas.width = 0;
    canvas.height = 0;
    canvas.getContext = () =>
      id === "base-canvas" ? baseContext : overlayContext;
    canvas.toBlob = (callback) => callback({ type: "image/png" });
  }

  const wrap = element("canvas-wrap");
  wrap.appendChild = (child) => {
    wrapChildren.push(child);
  };

  const context = vm.createContext({
    FwpsI18n,
    FwpsAnnotate,
    URLSearchParams,
    console,
    URL: {
      createObjectURL: () => "blob:edited",
      revokeObjectURL() {},
    },
    location: { search: "?src=blob%3Asource&name=demo.png" },
    document: {
      documentElement: { lang: "" },
      getElementById: element,
      querySelectorAll: () => [],
      addEventListener(type, handler) {
        if (!documentListeners.has(type)) {
          documentListeners.set(type, []);
        }
        documentListeners.get(type).push(handler);
      },
      createElement: (tag) => {
        const stub = createElementStub(tag);
        if (tag === "canvas") {
          stub.getContext = () => createContextRecorder();
        }
        if (tag === "textarea") {
          stub.remove = () => {
            const index = wrapChildren.indexOf(stub);
            if (index >= 0) {
              wrapChildren.splice(index, 1);
            }
          };
        }
        return stub;
      },
    },
    browser: {
      i18n: {
        getMessage: (key) => key,
        getUILanguage: () => "en",
      },
      downloads: {
        download: async () => 42,
        search: async () => [{ filename: "/tmp/demo-edited.png" }],
      },
    },
    Image: class {
      constructor() {
        this.naturalWidth = 1000;
        this.naturalHeight = 800;
      }
      set src(_value) {
        Promise.resolve().then(() => this.onload());
      }
    },
    setTimeout: () => 1,
    addEventListener(type, handler) {
      if (!globalListeners.has(type)) {
        globalListeners.set(type, []);
      }
      globalListeners.get(type).push(handler);
    },
  });
  context.globalThis = context;
  new vm.Script(editorSource, { filename: "editor.js" }).runInContext(context);

  const ready = new Promise((resolve) => setImmediate(resolve));

  return {
    baseContext,
    overlayContext,
    element,
    ready,
    wrapChildren,
    fireGlobal(type, event) {
      for (const handler of globalListeners.get(type) || []) {
        handler(event);
      }
    },
    selectTool(tool) {
      element("tool-group").fire("click", { target: { dataset: { tool } } });
    },
    activeTextarea() {
      return wrapChildren[wrapChildren.length - 1] || null;
    },
    fireDocument(type, event) {
      for (const handler of documentListeners.get(type) || []) {
        handler(event);
      }
    },
  };
}

function lastReplayCalls(context) {
  const calls = context.calls;
  const lastBase = calls.map((call) => call[0]).lastIndexOf("drawImage");
  return lastBase === -1 ? calls : calls.slice(lastBase + 1);
}

function addText(harness, clientX, clientY, value) {
  harness.selectTool("text");
  harness.element("overlay-canvas").fire("pointerdown", pointerEvent(clientX, clientY));
  const textarea = harness.activeTextarea();
  textarea.value = value;
  textarea.fire("keydown", { key: "Enter", shiftKey: false, preventDefault() {} });
}

test("the text tool opens a textarea on click and commits with Enter", async () => {
  const harness = createEditorHarness();
  await harness.ready;

  harness.selectTool("text");
  const down = pointerEvent(149, 74.5);
  harness.element("overlay-canvas").fire("pointerdown", down);

  assert.equal(down.prevented, true, "pointerdown must be prevented to keep focus");
  const textarea = harness.activeTextarea();
  assert.ok(textarea, "a textarea should appear where the user clicked");

  textarea.value = "你好";
  textarea.fire("keydown", { key: "Enter", shiftKey: false, preventDefault() {} });

  assert.equal(harness.activeTextarea(), null);
  const fillTextCalls = harness.baseContext.calls.filter(
    (call) => call[0] === "fillText",
  );
  assert.equal(fillTextCalls.length, 1);
  assert.equal(fillTextCalls[0][1], "你好");
  assert.ok(Math.abs(fillTextCalls[0][2] - 200) < 0.5);
  assert.ok(Math.abs(fillTextCalls[0][3] - 100) < 0.5);
});

test("existing text can be dragged to a new position", async () => {
  const harness = createEditorHarness();
  await harness.ready;

  addText(harness, 149, 74.5, "hello");

  harness.element("overlay-canvas").fire("pointerdown", pointerEvent(149, 74.5));
  harness.element("overlay-canvas").fire("pointermove", pointerEvent(223.5, 111.75));
  harness.element("overlay-canvas").fire("pointerup", pointerEvent(223.5, 111.75));

  const fillTextCalls = lastReplayCalls(harness.baseContext).filter(
    (call) => call[0] === "fillText",
  );
  assert.equal(fillTextCalls.length, 1);
  assert.ok(Math.abs(fillTextCalls[0][2] - 300) < 0.5);
  assert.ok(Math.abs(fillTextCalls[0][3] - 150) < 0.5);
});

test("dragging text previews on the overlay without repainting it on the base", async () => {
  const harness = createEditorHarness();
  await harness.ready;

  addText(harness, 149, 74.5, "hello");

  harness.element("overlay-canvas").fire("pointerdown", pointerEvent(149, 74.5));
  harness.element("overlay-canvas").fire("pointermove", pointerEvent(223.5, 111.75));

  const baseDuringDrag = lastReplayCalls(harness.baseContext);
  assert.equal(
    baseDuringDrag.filter((call) => call[0] === "fillText").length,
    0,
    "the base canvas must not repaint the dragged text mid-drag",
  );
  assert.ok(
    harness.overlayContext.calls.some((call) => call[0] === "fillText"),
    "the overlay should preview the dragged text",
  );

  harness.element("overlay-canvas").fire("pointerup", pointerEvent(223.5, 111.75));
  const baseAfterDrop = lastReplayCalls(harness.baseContext);
  assert.equal(
    baseAfterDrop.filter((call) => call[0] === "fillText").length,
    1,
    "dropping commits the text back to the base canvas",
  );
});

test("double-clicking text reopens it for editing", async () => {
  const harness = createEditorHarness();
  await harness.ready;

  addText(harness, 149, 74.5, "hello");
  harness.element("overlay-canvas").fire("dblclick", pointerEvent(149, 74.5));

  const textarea = harness.activeTextarea();
  assert.ok(textarea, "double-click should reopen the editor");
  assert.equal(textarea.value, "hello");

  textarea.value = "world";
  textarea.fire("keydown", { key: "Enter", shiftKey: false, preventDefault() {} });

  const fillTextCalls = lastReplayCalls(harness.baseContext).filter(
    (call) => call[0] === "fillText",
  );
  assert.deepEqual(fillTextCalls.map((call) => call[1]), ["world"]);
});

test("single click selects text without the style bar; double-click opens it", async () => {
  const harness = createEditorHarness();
  await harness.ready;

  addText(harness, 149, 74.5, "hello");

  harness.element("overlay-canvas").fire("pointerdown", pointerEvent(149, 74.5));
  harness.element("overlay-canvas").fire("pointerup", pointerEvent(149, 74.5));
  assert.equal(harness.element("text-style-bar").hidden, true);

  harness.element("overlay-canvas").fire("dblclick", pointerEvent(149, 74.5));
  assert.equal(harness.element("text-style-bar").hidden, false);
  assert.ok(harness.activeTextarea(), "double-click should reopen the editor");
});

test("ctrl+click multi-selects text and Delete removes the whole selection", async () => {
  const harness = createEditorHarness();
  await harness.ready;

  addText(harness, 149, 74.5, "first");
  addText(harness, 447, 149, "second");

  harness.element("overlay-canvas").fire("pointerdown", pointerEvent(149, 74.5));
  harness.element("overlay-canvas").fire("pointerup", pointerEvent(149, 74.5));
  harness.element("overlay-canvas").fire(
    "pointerdown",
    pointerEvent(447, 149, { ctrlKey: true }),
  );
  harness.element("overlay-canvas").fire(
    "pointerup",
    pointerEvent(447, 149, { ctrlKey: true }),
  );

  harness.fireGlobal("keydown", {
    key: "Delete",
    ctrlKey: false,
    metaKey: false,
    target: {},
    preventDefault() {},
  });

  const replayed = lastReplayCalls(harness.baseContext);
  assert.equal(replayed.filter((call) => call[0] === "fillText").length, 0);
});

test("highlight toggles a translucent background behind selected text", async () => {
  const harness = createEditorHarness();
  await harness.ready;

  addText(harness, 149, 74.5, "marked");
  harness.element("overlay-canvas").fire("dblclick", pointerEvent(149, 74.5));
  harness.element("text-bg-group").fire("click", {
    target: { dataset: { bgcolor: "#3e9bff" } },
  });

  const replayed = lastReplayCalls(harness.baseContext);
  assert.ok(replayed.some((call) => call[0] === "fillRect"));
  assert.ok(replayed.some((call) => call[0] === "fillText" && call[1] === "marked"));
});

test("the opacity slider adjusts the highlight transparency per text", async () => {
  const harness = createEditorHarness();
  await harness.ready;

  addText(harness, 149, 74.5, "marked");
  harness.element("overlay-canvas").fire("dblclick", pointerEvent(149, 74.5));
  harness.element("text-bg-group").fire("click", {
    target: { dataset: { bgcolor: "#3e9bff" } },
  });

  const slider = harness.element("text-alpha");
  slider.value = "80";
  slider.fire("input", {});

  const replayed = lastReplayCalls(harness.baseContext);
  const alphaCall = replayed.find((call) => call[0] === "globalAlpha");
  assert.ok(alphaCall, "a translucent fill should set globalAlpha");
  assert.equal(alphaCall[1], 0.8);
});

test("styling one text box leaves other text boxes untouched", async () => {
  const harness = createEditorHarness();
  await harness.ready;

  addText(harness, 149, 74.5, "first");
  addText(harness, 447, 149, "second");

  harness.element("overlay-canvas").fire("dblclick", pointerEvent(149, 74.5));
  harness.element("text-color-group").fire("click", {
    target: { dataset: { color: "#00ff00" } },
  });

  const colors = lastReplayCalls(harness.baseContext)
    .filter((call) => call[0] === "fillStyle")
    .map((call) => call[1]);
  assert.deepEqual(colors, ["#00ff00", "#e5484d"]);
});

test("newly placed text reuses the style last applied to a text box", async () => {
  const harness = createEditorHarness();
  await harness.ready;

  addText(harness, 149, 74.5, "first");
  harness.element("overlay-canvas").fire("dblclick", pointerEvent(149, 74.5));
  harness.element("text-color-group").fire("click", {
    target: { dataset: { color: "#00ff00" } },
  });

  addText(harness, 745, 372.5, "third");

  const colors = lastReplayCalls(harness.baseContext)
    .filter((call) => call[0] === "fillStyle")
    .map((call) => call[1]);
  assert.deepEqual(colors, ["#00ff00", "#00ff00"]);
});

test("the textarea width becomes the final wrapping layout", async () => {
  const harness = createEditorHarness();
  await harness.ready;

  harness.selectTool("text");
  harness.element("overlay-canvas").fire("pointerdown", pointerEvent(149, 74.5));
  const textarea = harness.activeTextarea();
  assert.ok(textarea);

  textarea.clientWidth = 200;
  textarea.value = "aaaa bbbb cccc";
  textarea.fire("keydown", { key: "Enter", shiftKey: false, preventDefault() {} });

  const texts = lastReplayCalls(harness.baseContext)
    .filter((call) => call[0] === "fillText")
    .map((call) => call[1]);
  assert.deepEqual(texts, ["aaaa bbbb", "cccc"]);
});

test("the textarea is clamped to the remaining image area", async () => {
  const harness = createEditorHarness();
  await harness.ready;

  harness.selectTool("text");
  harness.element("overlay-canvas").fire("pointerdown", pointerEvent(149, 74.5));
  const textarea = harness.activeTextarea();
  assert.ok(textarea);

  assert.equal(textarea.style.maxWidth, "596px");
  assert.equal(textarea.style.maxHeight, "521.5px");
});

test("hovering existing text shows the move cursor", async () => {
  const harness = createEditorHarness();
  await harness.ready;

  addText(harness, 149, 74.5, "hello");
  const overlay = harness.element("overlay-canvas");

  overlay.fire("pointermove", pointerEvent(149, 74.5));
  assert.equal(overlay.style.cursor, "move");

  overlay.fire("pointermove", pointerEvent(745, 521.5));
  assert.equal(overlay.style.cursor, "");
});

test("holding the right mouse button pans the canvas view", async () => {
  const harness = createEditorHarness();
  await harness.ready;

  const wrap = harness.element("canvas-wrap");
  const down = {
    button: 2,
    clientX: 500,
    clientY: 400,
    pointerId: 9,
    preventDefault() {
      this.prevented = true;
    },
  };
  wrap.fire("pointerdown", down);
  wrap.fire("pointermove", { button: 2, clientX: 450, clientY: 380, pointerId: 9 });
  wrap.fire("pointerup", { button: 2, clientX: 450, clientY: 380, pointerId: 9 });

  assert.equal(down.prevented, true);
  assert.equal(wrap.scrollLeft, 50);
  assert.equal(wrap.scrollTop, 20);

  const menu = {
    preventDefault() {
      this.prevented = true;
    },
  };
  wrap.fire("contextmenu", menu);
  assert.equal(menu.prevented, true);
});

test("the text editor survives focus theft and only commits on outside click", async () => {
  const harness = createEditorHarness();
  await harness.ready;

  harness.selectTool("text");
  harness.element("overlay-canvas").fire("pointerdown", pointerEvent(149, 74.5));
  const textarea = harness.activeTextarea();
  assert.ok(textarea);

  textarea.fire("blur", {});
  assert.equal(
    harness.activeTextarea(),
    textarea,
    "losing focus must not destroy the editor",
  );

  textarea.value = "留下來";
  harness.fireDocument("pointerdown", { target: harness.element("undo-button") });

  assert.equal(harness.activeTextarea(), null);
  const fillTextCalls = harness.baseContext.calls.filter(
    (call) => call[0] === "fillText",
  );
  assert.deepEqual(fillTextCalls.map((call) => call[1]), ["留下來"]);
});

test("the badge tool stamps incrementing numbers on each click", async () => {
  const harness = createEditorHarness();
  await harness.ready;

  harness.selectTool("badge");
  harness.element("overlay-canvas").fire("pointerdown", pointerEvent(50, 50));
  harness.element("overlay-canvas").fire("pointerdown", pointerEvent(100, 100, { pointerId: 2 }));

  const badgeTexts = lastReplayCalls(harness.baseContext)
    .filter((call) => call[0] === "fillText")
    .map((call) => call[1]);
  assert.deepEqual(badgeTexts, ["1", "2"]);
  assert.ok(harness.baseContext.calls.some((call) => call[0] === "arc"));
  assert.ok(harness.baseContext.calls.some((call) => call[0] === "fill"));
});

test("undo and redo replay the command history symmetrically", async () => {
  const harness = createEditorHarness();
  await harness.ready;

  harness.selectTool("badge");
  harness.element("overlay-canvas").fire("pointerdown", pointerEvent(50, 50));
  harness.element("overlay-canvas").fire("pointerdown", pointerEvent(100, 100, { pointerId: 2 }));
  assert.equal(harness.element("undo-button").disabled, false);

  harness.fireGlobal("keydown", {
    key: "z",
    ctrlKey: true,
    shiftKey: false,
    target: {},
    preventDefault() {},
  });
  let replayed = lastReplayCalls(harness.baseContext);
  assert.deepEqual(
    replayed.filter((call) => call[0] === "fillText").map((call) => call[1]),
    ["1"],
  );
  assert.equal(harness.element("redo-button").disabled, false);

  harness.fireGlobal("keydown", {
    key: "y",
    ctrlKey: true,
    shiftKey: false,
    target: {},
    preventDefault() {},
  });
  replayed = lastReplayCalls(harness.baseContext);
  assert.deepEqual(
    replayed.filter((call) => call[0] === "fillText").map((call) => call[1]),
    ["1", "2"],
  );
});

test("zoom controls rescale the display without touching the image pixels", async () => {
  const harness = createEditorHarness();
  await harness.ready;

  const overlay = harness.element("overlay-canvas");
  assert.equal(overlay.width, 1000);
  assert.equal(overlay.style.width, "745px");
  assert.equal(harness.element("zoom-level").textContent, "75%");

  harness.element("zoom-in").fire("click", {});
  assert.equal(overlay.style.width, "750px");
  assert.equal(harness.element("zoom-level").textContent, "75%");

  harness.element("zoom-in").fire("click", {});
  assert.equal(overlay.style.width, "1000px");
  assert.equal(harness.element("zoom-level").textContent, "100%");

  harness.element("zoom-fit").fire("click", {});
  assert.equal(harness.element("zoom-level").textContent, "75%");
  assert.equal(overlay.width, 1000);
});

test("saving downloads the edited PNG and shows the resolved path", async () => {
  const harness = createEditorHarness();
  await harness.ready;

  harness.element("save-button").fire("click", {});
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.element("editor-status").textContent, "editor_saved_at");
  assert.equal(harness.element("saved-path").textContent, "/tmp/demo-edited.png");
});
