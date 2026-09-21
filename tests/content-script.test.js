"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const contentSource = fs.readFileSync(
  path.join(__dirname, "..", "extension", "content-script.js"),
  "utf8",
);

function createInlineStyle(onChange = () => {}) {
  const properties = new Map();
  return {
    getPropertyValue(name) {
      return properties.get(name)?.value || "";
    },
    getPropertyPriority(name) {
      return properties.get(name)?.priority || "";
    },
    setProperty(name, value, priority = "") {
      properties.set(name, { value, priority });
      onChange(`style:set:${name}:${value}`);
    },
    removeProperty(name) {
      properties.delete(name);
      onChange(`style:remove:${name}`);
    },
  };
}

function createElement(position) {
  return {
    computedPosition: position,
    isConnected: true,
    style: createInlineStyle(),
  };
}

function createContentHarness({
  devicePixelRatio = 1,
  nestedScroller = false,
  nestedScrollMaxTop = Infinity,
  nestedScrollWidth = 600,
  redirectScroll = false,
  rootScrollHeight = 600,
  scrollerRect = {},
  windowScrollMaxY = Infinity,
} = {}) {
  const rootAttributes = new Map();
  const documentListeners = new Map();
  const windowListeners = new Map();
  const rootChildren = [];
  const events = [];

  function addListener(map, type, handler) {
    if (!map.has(type)) {
      map.set(type, []);
    }
    map.get(type).push(handler);
  }

  function removeListener(map, type, handler) {
    const list = map.get(type) || [];
    const index = list.indexOf(handler);
    if (index >= 0) {
      list.splice(index, 1);
    }
  }
  const frame = {
    bottom: 600,
    height: 500,
    left: 200,
    right: 800,
    top: 100,
    width: 600,
    ...scrollerRect,
  };
  const fixed = createElement("fixed");
  const sticky = createElement("sticky");
  let nestedScrollLeft = 0;
  let nestedScrollTop = 75;
  let nestedRedirectOffset = 10;
  let nestedRedirectsRemaining = 0;
  let windowRedirectsRemaining = 0;
  const scroller = nestedScroller
    ? {
        computedPosition: "static",
        clientHeight: 500,
        clientLeft: 0,
        clientTop: 0,
        clientWidth: 600,
        isConnected: true,
        scrollHeight: 1500,
        scrollWidth: nestedScrollWidth,
        style: createInlineStyle((event) => events.push(event)),
        getBoundingClientRect() {
          return { ...frame };
        },
      }
    : null;
  if (scroller) {
    Object.defineProperties(scroller, {
      scrollLeft: {
        get() {
          return nestedScrollLeft;
        },
        set(value) {
          nestedScrollLeft = value;
          events.push(`scrollLeft:${value}`);
        },
      },
      scrollTop: {
        get() {
          return nestedScrollTop;
        },
        set(value) {
          const clampedValue = Math.min(value, nestedScrollMaxTop);
          const actualValue = clampedValue > 0 && nestedRedirectsRemaining > 0
            ? clampedValue + nestedRedirectOffset
            : clampedValue;
          if (clampedValue > 0 && nestedRedirectsRemaining > 0) {
            nestedRedirectsRemaining -= 1;
          }
          nestedScrollTop = actualValue;
          events.push(`scrollTop:${actualValue}`);
        },
      },
    });
  }
  let styleElement = null;
  let messageListener = null;
  const root = {
    scrollWidth: 800,
    offsetWidth: 800,
    clientWidth: 800,
    scrollHeight: rootScrollHeight,
    offsetHeight: rootScrollHeight,
    clientHeight: 600,
    appendChild(element) {
      element.isConnected = true;
      rootChildren.push(element);
      return element;
    },
    getAttribute(name) {
      return rootAttributes.has(name) ? rootAttributes.get(name) : null;
    },
    setAttribute(name, value) {
      rootAttributes.set(name, value);
    },
    removeAttribute(name) {
      rootAttributes.delete(name);
    },
  };
  const body = {
    scrollWidth: 800,
    offsetWidth: 800,
    clientWidth: 800,
    scrollHeight: rootScrollHeight,
    offsetHeight: rootScrollHeight,
    clientHeight: 600,
  };
  const document = {
    documentElement: root,
    body,
    title: "Fixture",
    addEventListener(type, handler) {
      addListener(documentListeners, type, handler);
    },
    removeEventListener(type, handler) {
      removeListener(documentListeners, type, handler);
    },
    head: {
      appendChild(element) {
        styleElement = element;
        element.isConnected = true;
      },
    },
    getElementById(id) {
      return styleElement && styleElement.id === id && styleElement.isConnected
        ? styleElement
        : null;
    },
    createElement() {
      return {
        id: "",
        textContent: "",
        isConnected: false,
        parentElement: null,
        style: {},
        remove() {
          this.isConnected = false;
          events.push("capture-style:remove");
        },
      };
    },
    querySelectorAll() {
      return scroller ? [fixed, sticky, scroller] : [fixed, sticky];
    },
  };
  const browser = {
    runtime: {
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        },
      },
      sendMessage(message) {
        events.push(`runtime:${message && message.type}`);
        return Promise.resolve({ accepted: true });
      },
    },
  };
  const context = vm.createContext({
    browser,
    console,
    document,
    innerWidth: 800,
    innerHeight: 600,
    devicePixelRatio,
    scrollX: 12,
    scrollY: 34,
    location: { href: "https://example.test/" },
    getComputedStyle(element) {
      return {
        backgroundColor: "rgb(7, 14, 16)",
        overflowX: element === scroller && nestedScrollWidth > 600 ? "auto" : "hidden",
        overflowY: element === scroller ? "auto" : "visible",
        position: element.computedPosition,
      };
    },
    requestAnimationFrame(callback) {
      callback();
    },
    setTimeout(callback) {
      callback();
    },
    addEventListener(type, handler) {
      addListener(windowListeners, type, handler);
    },
    removeEventListener(type, handler) {
      removeListener(windowListeners, type, handler);
    },
    scrollBy(dx, dy) {
      events.push(`windowScrollBy:${dx},${dy}`);
      context.scrollX += dx;
      context.scrollY += dy;
      frame.left -= dx;
      frame.right -= dx;
      frame.top -= dy;
      frame.bottom -= dy;
    },
    scrollTo(x, y) {
      events.push(`windowScroll:${x},${y}`);
      const shouldRedirect = redirectScroll || windowRedirectsRemaining > 0;
      if (windowRedirectsRemaining > 0) {
        windowRedirectsRemaining -= 1;
      }
      const nextX = shouldRedirect ? x + 10 : x;
      const nextY = Math.min(y, windowScrollMaxY);
      frame.left -= nextX - context.scrollX;
      frame.right -= nextX - context.scrollX;
      frame.top -= nextY - context.scrollY;
      frame.bottom -= nextY - context.scrollY;
      context.scrollX = nextX;
      context.scrollY = nextY;
    },
  });
  context.globalThis = context;
  new vm.Script(contentSource, { filename: "content-script.js" }).runInContext(context);

  return {
    context,
    events,
    fixed,
    frame,
    rootChildren,
    scroller,
    sticky,
    dispatch(type, event) {
      for (const handler of documentListeners.get(type) || []) {
        handler(event);
      }
    },
    dispatchWindow(type, event) {
      for (const handler of windowListeners.get(type) || []) {
        handler(event);
      }
    },
    redirectNextNestedScroll(attempts = 1, offset = 10) {
      nestedRedirectsRemaining = attempts;
      nestedRedirectOffset = offset;
    },
    redirectNextWindowScroll(attempts = 1) {
      windowRedirectsRemaining = attempts;
    },
    send(message) {
      return messageListener(message);
    },
  };
}

test("sticky elements remain in document flow and cleanup does not wait for rAF", async () => {
  const harness = createContentHarness();
  const prepared = await harness.send({ type: "PREPARE_CAPTURE" });
  assert.equal(prepared.ok, true);
  assert.equal(harness.sticky.style.getPropertyValue("position"), "static");

  const scrolled = await harness.send({
    type: "SCROLL_CAPTURE",
    segment: { index: 1, x: 0, y: 0 },
  });
  assert.equal(scrolled.ok, true);
  assert.equal(harness.fixed.style.getPropertyValue("visibility"), "hidden");

  harness.context.requestAnimationFrame = () => {};
  const cleaned = await Promise.race([
    harness.send({ type: "CLEANUP_CAPTURE" }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Cleanup waited for rAF.")), 50),
    ),
  ]);

  assert.equal(cleaned.ok, true);
  assert.equal(harness.sticky.style.getPropertyValue("position"), "");
  assert.equal(harness.fixed.style.getPropertyValue("visibility"), "");
  assert.equal(harness.context.scrollX, 12);
  assert.equal(harness.context.scrollY, 34);
});

test("a redirected scroll is rejected instead of creating a silent gap", async () => {
  const harness = createContentHarness({ redirectScroll: true });
  await harness.send({ type: "PREPARE_CAPTURE" });
  const response = await harness.send({
    type: "SCROLL_CAPTURE",
    segment: { index: 0, x: 0, y: 0 },
  });

  assert.equal(response.ok, false);
  assert.equal(response.error.code, "SCROLL_POSITION_MISMATCH");
  const cleaned = await harness.send({ type: "CLEANUP_CAPTURE" });
  assert.equal(cleaned.ok, true);
});

test("a transient window scroll displacement is corrected before capture", async () => {
  const harness = createContentHarness();
  await harness.send({ type: "PREPARE_CAPTURE" });
  harness.redirectNextWindowScroll(1);

  const response = await harness.send({
    type: "SCROLL_CAPTURE",
    segment: { index: 0, x: 0, y: 0 },
  });

  assert.equal(response.ok, true);
  assert.equal(response.value.actualX, 0);
  assert.ok(harness.events.includes("windowScroll:0,0"));
  const cleaned = await harness.send({ type: "CLEANUP_CAPTURE" });
  assert.equal(cleaned.ok, true);
});

test("a transient nested scroll displacement is corrected before capture", async () => {
  const harness = createContentHarness({ nestedScroller: true });
  harness.scroller.style.setProperty("overflow-anchor", "auto", "important");
  const prepared = await harness.send({ type: "PREPARE_CAPTURE" });
  assert.equal(prepared.ok, true);
  assert.equal(harness.scroller.style.getPropertyValue("overflow-anchor"), "none");
  harness.redirectNextNestedScroll(1);

  const response = await harness.send({
    type: "SCROLL_CAPTURE",
    segment: { index: 1, x: 0, y: 500 },
  });

  assert.equal(response.ok, true);
  assert.equal(response.value.actualY, 500);
  assert.equal(harness.scroller.scrollTop, 500);
  assert.ok(harness.events.includes("scrollTop:510"));
  await harness.send({ type: "CLEANUP_CAPTURE" });
  assert.equal(harness.scroller.style.getPropertyValue("overflow-anchor"), "auto");
  assert.equal(
    harness.scroller.style.getPropertyPriority("overflow-anchor"),
    "important",
  );
});

test("a persistently redirected nested scroll still fails closed", async () => {
  const harness = createContentHarness({ nestedScroller: true });
  await harness.send({ type: "PREPARE_CAPTURE" });
  harness.redirectNextNestedScroll(3);

  const response = await harness.send({
    type: "SCROLL_CAPTURE",
    segment: { index: 1, x: 0, y: 500 },
  });

  assert.equal(response.ok, false);
  assert.equal(response.error.code, "SCROLL_POSITION_MISMATCH");
  assert.deepEqual(JSON.parse(JSON.stringify(response.error.details)), {
    actualX: 0,
    actualY: 510,
    attempts: 3,
    connected: true,
    maxX: 0,
    maxY: 1000,
    mode: "element",
    requestedX: 0,
    requestedY: 500,
  });
  const cleaned = await harness.send({ type: "CLEANUP_CAPTURE" });
  assert.equal(cleaned.ok, true);
});

test("Firefox device-pixel scroll quantization is accepted up to one physical pixel", async () => {
  const harness = createContentHarness({
    devicePixelRatio: 1.5,
    nestedScroller: true,
  });
  await harness.send({ type: "PREPARE_CAPTURE" });
  const firefoxRoundingOffset = 0.3333740234375;
  harness.redirectNextNestedScroll(3, firefoxRoundingOffset);

  const response = await harness.send({
    type: "SCROLL_CAPTURE",
    segment: { index: 1, x: 0, y: 500 },
  });

  assert.equal(response.ok, true);
  assert.equal(response.value.actualY, 500 + firefoxRoundingOffset);

  harness.redirectNextNestedScroll(3, 1 / 1.5);
  const onePhysicalPixelResponse = await harness.send({
    type: "SCROLL_CAPTURE",
    segment: { index: 1, x: 0, y: 500 },
  });
  assert.equal(onePhysicalPixelResponse.ok, true);
  assert.equal(onePhysicalPixelResponse.value.actualY, 500 + 1 / 1.5);

  harness.redirectNextNestedScroll(3, 1.5 / 1.5);
  const beyondOnePixelResponse = await harness.send({
    type: "SCROLL_CAPTURE",
    segment: { index: 1, x: 0, y: 500 },
  });
  assert.equal(beyondOnePixelResponse.ok, false);
  assert.equal(
    beyondOnePixelResponse.error.code,
    "SCROLL_POSITION_MISMATCH",
  );

  harness.redirectNextNestedScroll(0);
  const cleaned = await harness.send({ type: "CLEANUP_CAPTURE" });
  assert.equal(cleaned.ok, true);
});

test("a window scroll clamped one pixel below the requested maximum settles at the scroll edge", async () => {
  const harness = createContentHarness({
    devicePixelRatio: 1.5,
    rootScrollHeight: 13000,
    windowScrollMaxY: 12399,
  });
  const prepared = await harness.send({ type: "PREPARE_CAPTURE" });
  assert.equal(prepared.ok, true);

  const response = await harness.send({
    type: "SCROLL_CAPTURE",
    segment: { index: 1, x: 0, y: 12400 },
  });

  assert.equal(response.ok, true);
  assert.equal(response.value.actualY, 12399);
  assert.ok(harness.events.includes("windowScroll:0,12400"));
  const cleaned = await harness.send({ type: "CLEANUP_CAPTURE" });
  assert.equal(cleaned.ok, true);
});

test("a nested scroll clamped one pixel below the requested maximum settles at the scroll edge", async () => {
  const harness = createContentHarness({
    devicePixelRatio: 1.5,
    nestedScroller: true,
    nestedScrollMaxTop: 999,
  });
  const prepared = await harness.send({ type: "PREPARE_CAPTURE" });
  assert.equal(prepared.ok, true);

  const response = await harness.send({
    type: "SCROLL_CAPTURE",
    segment: { index: 1, x: 0, y: 1000 },
  });

  assert.equal(response.ok, true);
  assert.equal(response.value.actualY, 999);
  const cleaned = await harness.send({ type: "CLEANUP_CAPTURE" });
  assert.equal(cleaned.ok, true);
});

test("a clamped scroll away from the scroll edge is still rejected", async () => {
  const harness = createContentHarness({
    devicePixelRatio: 1.5,
    rootScrollHeight: 13000,
    windowScrollMaxY: 499,
  });
  await harness.send({ type: "PREPARE_CAPTURE" });

  const response = await harness.send({
    type: "SCROLL_CAPTURE",
    segment: { index: 1, x: 0, y: 500 },
  });

  assert.equal(response.ok, false);
  assert.equal(response.error.code, "SCROLL_POSITION_MISMATCH");
  const cleaned = await harness.send({ type: "CLEANUP_CAPTURE" });
  assert.equal(cleaned.ok, true);
});

test("a dominant nested scroller is measured, scrolled, and restored", async () => {
  const harness = createContentHarness({ nestedScroller: true });
  const prepared = await harness.send({ type: "PREPARE_CAPTURE" });

  assert.equal(prepared.ok, true);
  assert.equal(prepared.value.capture.mode, "element");
  assert.deepEqual(JSON.parse(JSON.stringify(prepared.value.metrics)), {
    documentWidth: 600,
    documentHeight: 1500,
    viewportWidth: 600,
    viewportHeight: 500,
    devicePixelRatio: 1,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(prepared.value.capture.frame)), {
    x: 200,
    y: 100,
    width: 600,
    height: 500,
  });
  assert.equal(prepared.value.capture.outputWidth, 800);
  assert.equal(prepared.value.capture.outputHeight, 1600);

  const scrolled = await harness.send({
    type: "SCROLL_CAPTURE",
    segment: { index: 1, x: 0, y: 500 },
  });
  assert.equal(scrolled.ok, true);
  assert.equal(harness.scroller.scrollTop, 500);
  assert.equal(harness.context.scrollY, 34);

  const cleaned = await harness.send({ type: "CLEANUP_CAPTURE" });
  assert.equal(cleaned.ok, true);
  assert.equal(harness.scroller.scrollTop, 75);
});

test("a partially off-screen nested scroller fails closed", async () => {
  const harness = createContentHarness({
    nestedScroller: true,
    scrollerRect: { left: -50, right: 550 },
  });
  const prepared = await harness.send({ type: "PREPARE_CAPTURE" });

  assert.equal(prepared.ok, false);
  assert.equal(prepared.error.code, "SCROLL_TARGET_NOT_FULLY_VISIBLE");
});

test("nested frame geometry is reported per segment and styles restore before scroll", async () => {
  const harness = createContentHarness({ nestedScroller: true });
  const prepared = await harness.send({ type: "PREPARE_CAPTURE" });
  assert.equal(prepared.ok, true);

  harness.frame.top = 80;
  harness.frame.bottom = 580;
  const scrolled = await harness.send({
    type: "SCROLL_CAPTURE",
    segment: { index: 1, x: 0, y: 500 },
  });
  assert.equal(scrolled.ok, true);
  assert.equal(scrolled.value.capture.frame.y, 80);

  const cleanupStart = harness.events.length;
  const cleaned = await harness.send({ type: "CLEANUP_CAPTURE" });
  assert.equal(cleaned.ok, true);
  const cleanupEvents = harness.events.slice(cleanupStart);
  assert.ok(
    cleanupEvents.indexOf("style:remove:scrollbar-width") <
      cleanupEvents.lastIndexOf("scrollTop:75"),
  );
  assert.ok(
    cleanupEvents.lastIndexOf("scrollTop:75") <
      cleanupEvents.indexOf("style:remove:scroll-behavior"),
  );
  assert.ok(
    cleanupEvents.lastIndexOf("scrollTop:75") <
      cleanupEvents.indexOf("style:remove:scroll-snap-type"),
  );
});

test("window scroll restores before capture styles release smooth scrolling", async () => {
  const harness = createContentHarness();
  const prepared = await harness.send({ type: "PREPARE_CAPTURE" });
  assert.equal(prepared.ok, true);

  const cleanupStart = harness.events.length;
  const cleaned = await harness.send({ type: "CLEANUP_CAPTURE" });
  assert.equal(cleaned.ok, true);
  const cleanupEvents = harness.events.slice(cleanupStart);

  assert.ok(
    cleanupEvents.lastIndexOf("windowScroll:12,34") <
      cleanupEvents.indexOf("capture-style:remove"),
  );
});

test("minor root overflow does not mask a much larger nested scroller", async () => {
  const harness = createContentHarness({
    nestedScroller: true,
    rootScrollHeight: 610,
  });
  const prepared = await harness.send({ type: "PREPARE_CAPTURE" });

  assert.equal(prepared.ok, true);
  assert.equal(prepared.value.capture.mode, "element");
  await harness.send({ type: "CLEANUP_CAPTURE" });
});

test("nested warmup traverses horizontal overflow before capture", async () => {
  const harness = createContentHarness({
    nestedScroller: true,
    nestedScrollWidth: 900,
  });
  const prepared = await harness.send({ type: "PREPARE_CAPTURE" });

  assert.equal(prepared.ok, true);
  assert.equal(prepared.value.metrics.documentWidth, 900);
  assert.ok(harness.events.includes("scrollLeft:300"));
  assert.equal(harness.scroller.scrollLeft, 0);
  await harness.send({ type: "CLEANUP_CAPTURE" });
});

test("region picker highlights the scrollable ancestor and region prepare crops to its frame", async () => {
  const harness = createContentHarness({ nestedScroller: true });
  const entered = await harness.send({ type: "ENTER_REGION_PICKER" });
  assert.equal(entered.ok, true);
  assert.equal(entered.value.active, true);

  const child = { parentElement: harness.scroller };
  harness.dispatch("mousemove", { target: child });
  const highlight = harness.rootChildren[harness.rootChildren.length - 1];
  assert.equal(highlight.id, "__fwps-region-picker-highlight");
  assert.equal(highlight.style.display, "block");
  assert.equal(highlight.style.left, "200px");
  assert.equal(highlight.style.top, "100px");
  assert.equal(highlight.style.width, "600px");
  assert.equal(highlight.style.height, "500px");

  harness.dispatch("click", {
    target: child,
    preventDefault() {},
    stopPropagation() {},
  });
  assert.ok(harness.events.includes("runtime:REGION_PICKED"));
  assert.equal(highlight.isConnected, false);

  const prepared = await harness.send({ type: "PREPARE_REGION_CAPTURE" });
  assert.equal(prepared.ok, true);
  assert.equal(prepared.value.capture.mode, "region");
  assert.equal(prepared.value.capture.outputWidth, 600);
  assert.equal(prepared.value.capture.outputHeight, 1500);
  assert.deepEqual(JSON.parse(JSON.stringify(prepared.value.capture.frame)), {
    x: 200,
    y: 100,
    width: 600,
    height: 500,
  });
  assert.equal(prepared.value.metrics.documentHeight, 1500);
  assert.equal(prepared.value.metrics.viewportHeight, 500);

  const indicator = harness.rootChildren[harness.rootChildren.length - 1];
  assert.equal(indicator.id, "__fwps-region-frame");
  assert.equal(indicator.style.boxSizing, "border-box");
  assert.equal(indicator.style.border, "3px solid rgba(76, 154, 255, 0.95)");
  assert.equal(indicator.style.background, "transparent");
  assert.equal(indicator.style.left, "197px");
  assert.equal(indicator.style.top, "97px");
  assert.equal(indicator.style.width, "606px");
  assert.equal(indicator.style.height, "506px");

  const scrolled = await harness.send({
    type: "SCROLL_CAPTURE",
    segment: { index: 0, x: 0, y: 0 },
  });
  assert.equal(scrolled.ok, true);
  assert.equal(scrolled.value.capture.mode, "region");
  assert.equal(scrolled.value.capture.outputWidth, 600);
  assert.equal(scrolled.value.capture.outputHeight, 1500);
  assert.deepEqual(JSON.parse(JSON.stringify(scrolled.value.capture.frame)), {
    x: 200,
    y: 100,
    width: 600,
    height: 500,
  });

  const cleaned = await harness.send({ type: "CLEANUP_CAPTURE" });
  assert.equal(cleaned.ok, true);
  assert.equal(indicator.isConnected, false);
  assert.equal(harness.scroller.scrollTop, 75);
  assert.equal(harness.scroller.style.getPropertyValue("scrollbar-width"), "");
  assert.equal(harness.context.scrollX, 12);
  assert.equal(harness.context.scrollY, 34);
});

test("Escape cancels the region picker and nothing is left behind", async () => {
  const harness = createContentHarness({ nestedScroller: true });
  await harness.send({ type: "ENTER_REGION_PICKER" });
  const highlight = harness.rootChildren[harness.rootChildren.length - 1];

  harness.dispatch("keydown", {
    key: "Escape",
    preventDefault() {},
    stopPropagation() {},
  });

  assert.ok(harness.events.includes("runtime:REGION_PICK_CANCELLED"));
  assert.equal(highlight.isConnected, false);

  const prepared = await harness.send({ type: "PREPARE_REGION_CAPTURE" });
  assert.equal(prepared.ok, false);
  assert.equal(prepared.error.code, "REGION_TARGET_INVALID");
});

test("clicking a non-scrollable point keeps the picker active", async () => {
  const harness = createContentHarness({ nestedScroller: true });
  await harness.send({ type: "ENTER_REGION_PICKER" });

  harness.dispatch("click", {
    target: harness.fixed,
    preventDefault() {},
    stopPropagation() {},
  });
  assert.ok(!harness.events.includes("runtime:REGION_PICKED"));

  const again = await harness.send({ type: "ENTER_REGION_PICKER" });
  assert.equal(again.ok, true);
  assert.equal(harness.rootChildren.length, 1);

  const child = { parentElement: harness.scroller };
  harness.dispatch("mousemove", { target: child });
  const highlight = harness.rootChildren[harness.rootChildren.length - 1];
  assert.equal(highlight.style.display, "block");

  const exited = await harness.send({ type: "EXIT_REGION_PICKER" });
  assert.equal(exited.ok, true);
  assert.equal(exited.value.active, false);
  assert.equal(highlight.isConnected, false);
});

test("starting a full-page prepare dismisses an active region picker", async () => {
  const harness = createContentHarness({ nestedScroller: true });
  await harness.send({ type: "ENTER_REGION_PICKER" });
  const highlight = harness.rootChildren[harness.rootChildren.length - 1];

  const prepared = await harness.send({ type: "PREPARE_CAPTURE" });
  assert.equal(prepared.ok, true);
  assert.equal(highlight.isConnected, false);

  await harness.send({ type: "CLEANUP_CAPTURE" });
});

test("region capture scrolls a partially off-screen region into view before preparing", async () => {
  const harness = createContentHarness({
    nestedScroller: true,
    scrollerRect: { top: 700, bottom: 1200 },
  });
  await harness.send({ type: "ENTER_REGION_PICKER" });
  const child = { parentElement: harness.scroller };
  harness.dispatch("click", {
    target: child,
    preventDefault() {},
    stopPropagation() {},
  });

  const prepared = await harness.send({ type: "PREPARE_REGION_CAPTURE" });
  assert.equal(prepared.ok, true);
  assert.ok(harness.events.includes("windowScrollBy:0,600"));
  assert.equal(harness.context.scrollY, 634);
  assert.equal(prepared.value.capture.frame.y, 100);

  const cleaned = await harness.send({ type: "CLEANUP_CAPTURE" });
  assert.equal(cleaned.ok, true);
  assert.equal(harness.context.scrollY, 34);
  assert.equal(harness.frame.top, 700);
});

test("a region taller than the viewport fails closed", async () => {
  const harness = createContentHarness({
    nestedScroller: true,
    scrollerRect: { top: -100, bottom: 800, height: 900 },
  });
  await harness.send({ type: "ENTER_REGION_PICKER" });
  const child = { parentElement: harness.scroller };
  harness.dispatch("click", {
    target: child,
    preventDefault() {},
    stopPropagation() {},
  });

  const prepared = await harness.send({ type: "PREPARE_REGION_CAPTURE" });
  assert.equal(prepared.ok, false);
  assert.equal(prepared.error.code, "SCROLL_TARGET_NOT_FULLY_VISIBLE");
  assert.equal(harness.scroller.style.getPropertyValue("scrollbar-width"), "");
  assert.equal(harness.context.scrollY, 34);
});

test("a full-page capture does not create a region frame indicator", async () => {
  const harness = createContentHarness();
  const prepared = await harness.send({ type: "PREPARE_CAPTURE" });
  assert.equal(prepared.ok, true);
  assert.equal(
    harness.rootChildren.some((child) => child.id === "__fwps-region-frame"),
    false,
  );
  await harness.send({ type: "CLEANUP_CAPTURE" });
});
