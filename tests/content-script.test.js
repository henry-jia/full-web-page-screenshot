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
  nestedScrollWidth = 600,
  redirectScroll = false,
  rootScrollHeight = 600,
  scrollerRect = {},
} = {}) {
  const rootAttributes = new Map();
  const events = [];
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
          const actualValue = value > 0 && nestedRedirectsRemaining > 0
            ? value + nestedRedirectOffset
            : value;
          if (value > 0 && nestedRedirectsRemaining > 0) {
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
    scrollTo(x, y) {
      events.push(`windowScroll:${x},${y}`);
      const shouldRedirect = redirectScroll || windowRedirectsRemaining > 0;
      if (windowRedirectsRemaining > 0) {
        windowRedirectsRemaining -= 1;
      }
      context.scrollX = shouldRedirect ? x + 10 : x;
      context.scrollY = y;
    },
  });
  context.globalThis = context;
  new vm.Script(contentSource, { filename: "content-script.js" }).runInContext(context);

  return {
    context,
    events,
    fixed,
    frame,
    scroller,
    sticky,
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
