(function installFullPageCaptureContentScript() {
  "use strict";

  if (globalThis.__fullPageScreenshotContentScriptInstalled) {
    return;
  }
  globalThis.__fullPageScreenshotContentScriptInstalled = true;

  const CAPTURE_ATTRIBUTE = "data-fwps-capturing";
  const STYLE_ID = "__fwps-capture-style";
  const MAX_WARMUP_STEPS = 100;
  const MAX_SCROLL_ATTEMPTS = 3;
  const SCROLL_FLOAT_EPSILON_CSS_PX = 0.001;
  const SCROLL_EDGE_SLACK_CSS_PX = 1;
  const REGION_FRAME_BORDER_WIDTH = 3;
  const REGION_FRAME_INSET_CSS_PX = 2;
  let captureSession = null;
  let pickerSession = null;
  let pendingRegionElement = null;

  class ContentCaptureError extends Error {
    constructor(code, message, details) {
      super(message);
      this.name = "ContentCaptureError";
      this.code = code;
      this.details = details;
    }
  }

  function wait(milliseconds) {
    return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
  }

  function nextFrame() {
    return new Promise((resolve) => globalThis.requestAnimationFrame(resolve));
  }

  async function waitForPageToSettle() {
    await nextFrame();
    await nextFrame();
    await wait(140);
    await nextFrame();
  }

  function getWindowMetrics() {
    const root = document.documentElement;
    const body = document.body;
    const widths = [
      root.scrollWidth,
      root.offsetWidth,
      root.clientWidth,
      body ? body.scrollWidth : 0,
      body ? body.offsetWidth : 0,
      body ? body.clientWidth : 0,
    ];
    const heights = [
      root.scrollHeight,
      root.offsetHeight,
      root.clientHeight,
      body ? body.scrollHeight : 0,
      body ? body.offsetHeight : 0,
      body ? body.clientHeight : 0,
    ];

    return {
      documentWidth: Math.max(...widths),
      documentHeight: Math.max(...heights),
      viewportWidth: globalThis.innerWidth,
      viewportHeight: globalThis.innerHeight,
      devicePixelRatio: globalThis.devicePixelRatio || 1,
    };
  }

  function hasScrollRange(metrics) {
    return (
      metrics.documentWidth > metrics.viewportWidth + 1 ||
      metrics.documentHeight > metrics.viewportHeight + 1
    );
  }

  function getMaximumScrollRange(metrics) {
    return Math.max(
      0,
      metrics.documentWidth - metrics.viewportWidth,
      metrics.documentHeight - metrics.viewportHeight,
    );
  }

  function findDominantElementScroller() {
    let best = null;

    for (const element of document.querySelectorAll("body *")) {
      const style = globalThis.getComputedStyle(element);
      const scrollableX = /^(auto|scroll|overlay)$/.test(style.overflowX || "");
      const scrollableY = /^(auto|scroll|overlay)$/.test(style.overflowY || "");
      const rangeX = scrollableX
        ? Math.max(0, element.scrollWidth - element.clientWidth)
        : 0;
      const rangeY = scrollableY
        ? Math.max(0, element.scrollHeight - element.clientHeight)
        : 0;

      if (rangeX <= 1 && rangeY <= 1) {
        continue;
      }

      const rect = element.getBoundingClientRect();
      const visibleWidth = Math.max(
        0,
        Math.min(rect.right, globalThis.innerWidth) - Math.max(rect.left, 0),
      );
      const visibleHeight = Math.max(
        0,
        Math.min(rect.bottom, globalThis.innerHeight) - Math.max(rect.top, 0),
      );

      if (
        visibleWidth < globalThis.innerWidth * 0.2 ||
        visibleHeight < globalThis.innerHeight * 0.2
      ) {
        continue;
      }

      const score =
        visibleWidth *
        visibleHeight *
        (1 + Math.log2(1 + Math.max(rangeX, rangeY)));
      if (!best || score > best.score) {
        best = { element, score };
      }
    }

    return best ? best.element : null;
  }

  function preserveStyleProperty(element, name) {
    return {
      name,
      priority: element.style.getPropertyPriority(name),
      value: element.style.getPropertyValue(name),
    };
  }

  function restoreStyleProperty(element, property) {
    if (property.value) {
      element.style.setProperty(property.name, property.value, property.priority);
    } else {
      element.style.removeProperty(property.name);
    }
  }

  function createScrollTarget() {
    const windowMetrics = getWindowMetrics();
    const element = findDominantElementScroller();
    const windowRange = getMaximumScrollRange(windowMetrics);
    const minorWindowOverflow =
      windowRange <=
      Math.max(windowMetrics.viewportWidth, windowMetrics.viewportHeight) * 0.05;

    if (hasScrollRange(windowMetrics) && (!element || !minorWindowOverflow)) {
      return {
        mode: "window",
        originalX: globalThis.scrollX,
        originalY: globalThis.scrollY,
      };
    }

    if (!element) {
      return {
        mode: "window",
        originalX: globalThis.scrollX,
        originalY: globalThis.scrollY,
      };
    }

    const scrollbarWidth = preserveStyleProperty(element, "scrollbar-width");
    const overflowAnchor = preserveStyleProperty(element, "overflow-anchor");
    const scrollBehavior = preserveStyleProperty(element, "scroll-behavior");
    const scrollSnapType = preserveStyleProperty(element, "scroll-snap-type");
    element.style.setProperty("scrollbar-width", "none", "important");
    element.style.setProperty("overflow-anchor", "none", "important");
    element.style.setProperty("scroll-behavior", "auto", "important");
    element.style.setProperty("scroll-snap-type", "none", "important");

    return {
      element,
      mode: "element",
      originalX: element.scrollLeft,
      originalY: element.scrollTop,
      overflowAnchor,
      scrollbarWidth,
      scrollBehavior,
      scrollSnapType,
    };
  }

  function getTargetMetrics(target) {
    if (target.mode === "window") {
      return getWindowMetrics();
    }

    const inset = target.region ? REGION_FRAME_INSET_CSS_PX * 2 : 0;

    return {
      documentWidth: target.element.scrollWidth - inset,
      documentHeight: target.element.scrollHeight - inset,
      viewportWidth: target.element.clientWidth - inset,
      viewportHeight: target.element.clientHeight - inset,
      devicePixelRatio: globalThis.devicePixelRatio || 1,
    };
  }

  function setTargetScroll(target, x, y) {
    if (target.mode === "window") {
      globalThis.scrollTo(x, y);
    } else {
      target.element.scrollLeft = x;
      target.element.scrollTop = y;
    }
  }

  function getTargetScroll(target) {
    if (target.mode === "window") {
      return { x: globalThis.scrollX, y: globalThis.scrollY };
    }

    return { x: target.element.scrollLeft, y: target.element.scrollTop };
  }

  function getPageBackgroundColor() {
    const candidates = [document.body, document.documentElement];

    for (const element of candidates) {
      if (!element) {
        continue;
      }
      const color = globalThis.getComputedStyle(element).backgroundColor;
      if (color && color !== "transparent" && color !== "rgba(0, 0, 0, 0)") {
        return color;
      }
    }

    return "rgb(255, 255, 255)";
  }

  function isScrollableRegionCandidate(element) {
    if (
      !element ||
      element === document.documentElement ||
      element === document.body ||
      typeof element.scrollHeight !== "number"
    ) {
      return false;
    }

    const style = globalThis.getComputedStyle(element);
    const scrollableX = /^(auto|scroll|overlay)$/.test(style.overflowX || "");
    const scrollableY = /^(auto|scroll|overlay)$/.test(style.overflowY || "");

    return (
      (scrollableX && element.scrollWidth - element.clientWidth > 1) ||
      (scrollableY && element.scrollHeight - element.clientHeight > 1)
    );
  }

  function resolveScrollableRegion(start) {
    let current = start;

    while (
      current &&
      current !== document.documentElement &&
      current !== document.body
    ) {
      if (isScrollableRegionCandidate(current)) {
        return current;
      }
      current = current.parentElement;
    }

    return null;
  }

  function positionPickerHighlight(element) {
    const highlight = pickerSession.highlight;

    if (!element) {
      highlight.style.display = "none";
      return;
    }

    const rect = element.getBoundingClientRect();
    highlight.style.left = `${rect.left}px`;
    highlight.style.top = `${rect.top}px`;
    highlight.style.width = `${rect.width}px`;
    highlight.style.height = `${rect.height}px`;
    highlight.style.display = "block";
  }

  function exitRegionPicker() {
    if (!pickerSession) {
      return;
    }

    const session = pickerSession;
    pickerSession = null;
    document.removeEventListener("mousemove", session.onMouseMove, true);
    document.removeEventListener("click", session.onClick, true);
    document.removeEventListener("keydown", session.onKeyDown, true);
    globalThis.removeEventListener("scroll", session.onScroll, true);
    globalThis.removeEventListener("resize", session.onScroll);
    session.highlight.remove();
    session.cursorStyle.remove();
  }

  function enterRegionPicker() {
    if (captureSession) {
      throw new ContentCaptureError(
        "CAPTURE_ALREADY_ACTIVE",
        "A capture is already active in this page.",
      );
    }
    if (pickerSession) {
      return { active: true };
    }

    const highlight = document.createElement("div");
    highlight.id = "__fwps-region-picker-highlight";
    highlight.style.position = "fixed";
    highlight.style.pointerEvents = "none";
    highlight.style.zIndex = "2147483647";
    highlight.style.border = "2px solid rgba(76, 154, 255, 0.95)";
    highlight.style.background = "rgba(76, 154, 255, 0.12)";
    highlight.style.borderRadius = "3px";
    highlight.style.display = "none";
    (document.documentElement || document.body).appendChild(highlight);

    const cursorStyle = document.createElement("style");
    cursorStyle.textContent = "* { cursor: crosshair !important; }";
    (document.head || document.documentElement).appendChild(cursorStyle);

    pickerSession = {
      candidate: null,
      cursorStyle,
      highlight,
      onClick: null,
      onKeyDown: null,
      onMouseMove: null,
      onScroll: null,
    };

    pickerSession.onMouseMove = (event) => {
      if (!pickerSession) {
        return;
      }
      pickerSession.candidate = resolveScrollableRegion(event.target);
      positionPickerHighlight(pickerSession.candidate);
    };
    pickerSession.onClick = (event) => {
      if (!pickerSession) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const target = resolveScrollableRegion(event.target);
      if (!target) {
        return;
      }
      exitRegionPicker();
      pendingRegionElement = target;
      browser.runtime.sendMessage({ type: "REGION_PICKED" }).catch(() => {});
    };
    pickerSession.onKeyDown = (event) => {
      if (!pickerSession || event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      exitRegionPicker();
      browser.runtime
        .sendMessage({ type: "REGION_PICK_CANCELLED" })
        .catch(() => {});
    };
    pickerSession.onScroll = () => {
      if (pickerSession) {
        positionPickerHighlight(pickerSession.candidate);
      }
    };

    document.addEventListener("mousemove", pickerSession.onMouseMove, true);
    document.addEventListener("click", pickerSession.onClick, true);
    document.addEventListener("keydown", pickerSession.onKeyDown, true);
    globalThis.addEventListener("scroll", pickerSession.onScroll, true);
    globalThis.addEventListener("resize", pickerSession.onScroll);

    return { active: true };
  }

  function createRegionScrollTarget(element) {
    const scrollbarWidth = preserveStyleProperty(element, "scrollbar-width");
    const overflowAnchor = preserveStyleProperty(element, "overflow-anchor");
    const scrollBehavior = preserveStyleProperty(element, "scroll-behavior");
    const scrollSnapType = preserveStyleProperty(element, "scroll-snap-type");
    element.style.setProperty("scrollbar-width", "none", "important");
    element.style.setProperty("overflow-anchor", "none", "important");
    element.style.setProperty("scroll-behavior", "auto", "important");
    element.style.setProperty("scroll-snap-type", "none", "important");

    return {
      element,
      mode: "element",
      originalX: element.scrollLeft,
      originalY: element.scrollTop,
      overflowAnchor,
      scrollbarWidth,
      scrollBehavior,
      scrollSnapType,
      region: true,
    };
  }

  function scrollRegionIntoView(element) {
    const rect = element.getBoundingClientRect();
    let dx = 0;
    let dy = 0;

    if (rect.width <= globalThis.innerWidth) {
      if (rect.left < 0) {
        dx = rect.left;
      } else if (rect.right > globalThis.innerWidth) {
        dx = rect.right - globalThis.innerWidth;
      }
    }
    if (rect.height <= globalThis.innerHeight) {
      if (rect.top < 0) {
        dy = rect.top;
      } else if (rect.bottom > globalThis.innerHeight) {
        dy = rect.bottom - globalThis.innerHeight;
      }
    }

    if (dx !== 0 || dy !== 0) {
      globalThis.scrollBy(dx, dy);
    }
  }

  function createRegionFrameIndicator(frame) {
    const border = REGION_FRAME_BORDER_WIDTH;
    const indicator = document.createElement("div");
    indicator.id = "__fwps-region-frame";
    indicator.style.position = "fixed";
    indicator.style.pointerEvents = "none";
    indicator.style.zIndex = "2147483646";
    indicator.style.boxSizing = "border-box";
    indicator.style.border = `${border}px solid rgba(76, 154, 255, 0.95)`;
    indicator.style.borderRadius = "3px";
    indicator.style.background = "transparent";
    indicator.style.left = `${frame.x - border}px`;
    indicator.style.top = `${frame.y - border}px`;
    indicator.style.width = `${frame.width + border * 2}px`;
    indicator.style.height = `${frame.height + border * 2}px`;
    (document.documentElement || document.body).appendChild(indicator);
    return indicator;
  }

  function getCaptureDescriptor(target, metrics, region = false) {
    if (target.mode === "window") {
      return {
        backgroundColor: getPageBackgroundColor(),
        bitmapViewportHeight: globalThis.innerHeight,
        bitmapViewportWidth: globalThis.innerWidth,
        frame: null,
        mode: "window",
        outputHeight: metrics.documentHeight,
        outputWidth: metrics.documentWidth,
      };
    }

    const rect = target.element.getBoundingClientRect();
    const boxX = rect.left + target.element.clientLeft;
    const boxY = rect.top + target.element.clientTop;
    const boxWidth = target.element.clientWidth;
    const boxHeight = target.element.clientHeight;
    const visibilityTolerance = 0.5;

    if (
      boxX < -visibilityTolerance ||
      boxY < -visibilityTolerance ||
      boxX + boxWidth > globalThis.innerWidth + visibilityTolerance ||
      boxY + boxHeight > globalThis.innerHeight + visibilityTolerance
    ) {
      throw new ContentCaptureError(
        "SCROLL_TARGET_NOT_FULLY_VISIBLE",
        "The selected scroll container is not fully visible in the viewport.",
      );
    }

    const inset = region ? REGION_FRAME_INSET_CSS_PX : 0;

    return {
      backgroundColor: getPageBackgroundColor(),
      bitmapViewportHeight: globalThis.innerHeight,
      bitmapViewportWidth: globalThis.innerWidth,
      frame: {
        x: boxX + inset,
        y: boxY + inset,
        width: boxWidth - inset * 2,
        height: boxHeight - inset * 2,
      },
      mode: region ? "region" : "element",
      outputHeight: region
        ? metrics.documentHeight
        : globalThis.innerHeight + (metrics.documentHeight - boxHeight),
      outputWidth: region
        ? metrics.documentWidth
        : globalThis.innerWidth + (metrics.documentWidth - boxWidth),
    };
  }

  function installCaptureStyle() {
    if (document.getElementById(STYLE_ID)) {
      throw new ContentCaptureError(
        "CAPTURE_STYLE_CONFLICT",
        "The capture style marker already exists.",
      );
    }

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      html[${CAPTURE_ATTRIBUTE}] {
        scroll-behavior: auto !important;
        scroll-snap-type: none !important;
        scrollbar-width: none !important;
      }
      html[${CAPTURE_ATTRIBUTE}] body {
        scroll-snap-type: none !important;
      }
      html[${CAPTURE_ATTRIBUTE}]::-webkit-scrollbar,
      html[${CAPTURE_ATTRIBUTE}] body::-webkit-scrollbar {
        display: none !important;
      }
      html[${CAPTURE_ATTRIBUTE}] *,
      html[${CAPTURE_ATTRIBUTE}] *::before,
      html[${CAPTURE_ATTRIBUTE}] *::after {
        animation-play-state: paused !important;
        caret-color: transparent !important;
        transition-property: none !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
    return style;
  }

  async function warmScrollablePage(target) {
    let verticalSteps = 0;
    let y = 0;

    while (verticalSteps < MAX_WARMUP_STEPS) {
      const metrics = getTargetMetrics(target);
      const lastY = Math.max(0, metrics.documentHeight - metrics.viewportHeight);

      if (y >= lastY) {
        break;
      }

      y = Math.min(y + metrics.viewportHeight, lastY);
      setTargetScroll(target, 0, y);
      await wait(80);
      verticalSteps += 1;
    }

    let horizontalSteps = 0;
    let x = 0;
    while (horizontalSteps < MAX_WARMUP_STEPS) {
      const metrics = getTargetMetrics(target);
      const lastX = Math.max(0, metrics.documentWidth - metrics.viewportWidth);

      if (x >= lastX) {
        break;
      }

      x = Math.min(x + metrics.viewportWidth, lastX);
      setTargetScroll(target, x, 0);
      await wait(80);
      horizontalSteps += 1;
    }

    setTargetScroll(target, 0, 0);
    await waitForPageToSettle();
  }

  function collectPositionedElements() {
    const fixed = [];
    const sticky = [];

    for (const element of document.querySelectorAll("body *")) {
      const position = globalThis.getComputedStyle(element).position;

      if (position === "fixed") {
        fixed.push({
          element,
          visibility: element.style.getPropertyValue("visibility"),
          priority: element.style.getPropertyPriority("visibility"),
        });
      } else if (position === "sticky") {
        sticky.push({
          element,
          position: element.style.getPropertyValue("position"),
          priority: element.style.getPropertyPriority("position"),
        });
      }
    }

    return { fixed, sticky };
  }

  function setFixedVisibility(hidden) {
    if (!captureSession) {
      return;
    }

    for (const fixed of captureSession.fixed) {
      if (!fixed.element.isConnected) {
        continue;
      }

      if (hidden) {
        fixed.element.style.setProperty("visibility", "hidden", "important");
      } else if (fixed.visibility) {
        fixed.element.style.setProperty(
          "visibility",
          fixed.visibility,
          fixed.priority,
        );
      } else {
        fixed.element.style.removeProperty("visibility");
      }
    }
  }

  function neutralizeStickyElements() {
    for (const sticky of captureSession.sticky) {
      if (sticky.element.isConnected) {
        sticky.element.style.setProperty("position", "static", "important");
      }
    }
  }

  function restoreStickyElements(session) {
    for (const sticky of session.sticky) {
      if (!sticky.element.isConnected) {
        continue;
      }

      if (sticky.position) {
        sticky.element.style.setProperty("position", sticky.position, sticky.priority);
      } else {
        sticky.element.style.removeProperty("position");
      }
    }
  }

  async function prepareCapture() {
    return prepareCaptureSession(null);
  }

  async function prepareRegionCapture() {
    const element = pendingRegionElement;
    pendingRegionElement = null;

    if (!element || !element.isConnected) {
      throw new ContentCaptureError(
        "REGION_TARGET_INVALID",
        "The picked region is no longer attached to the page.",
      );
    }

    const rangeX = element.scrollWidth - element.clientWidth;
    const rangeY = element.scrollHeight - element.clientHeight;
    if (Math.max(rangeX, rangeY) <= 1) {
      throw new ContentCaptureError(
        "REGION_TARGET_INVALID",
        "The picked region is no longer scrollable.",
      );
    }
    if (
      element.clientWidth <= REGION_FRAME_INSET_CSS_PX * 2 ||
      element.clientHeight <= REGION_FRAME_INSET_CSS_PX * 2
    ) {
      throw new ContentCaptureError(
        "REGION_TARGET_INVALID",
        "The picked region is too small to capture.",
      );
    }

    return prepareCaptureSession(element);
  }

  async function prepareCaptureSession(regionElement) {
    if (captureSession) {
      throw new ContentCaptureError(
        "CAPTURE_ALREADY_ACTIVE",
        "A capture is already active in this page.",
      );
    }
    if (pickerSession) {
      exitRegionPicker();
    }

    const root = document.documentElement;
    captureSession = {
      mutationObserver: null,
      mutations: 0,
      originalX: globalThis.scrollX,
      originalY: globalThis.scrollY,
      previousCaptureAttribute: root.getAttribute(CAPTURE_ATTRIBUTE),
      frameIndicator: null,
      region: regionElement !== null,
      style: null,
      fixed: [],
      scrollTarget: null,
      sticky: [],
    };

    try {
      captureSession.style = installCaptureStyle();
      root.setAttribute(CAPTURE_ATTRIBUTE, "true");
      captureSession.scrollTarget = regionElement
        ? createRegionScrollTarget(regionElement)
        : createScrollTarget();
      if (regionElement) {
        scrollRegionIntoView(regionElement);
        await waitForPageToSettle();
      }
      await warmScrollablePage(captureSession.scrollTarget);
      const positioned = collectPositionedElements();
      captureSession.fixed = positioned.fixed;
      captureSession.sticky = positioned.sticky;
      neutralizeStickyElements();
      await waitForPageToSettle();

      if (
        captureSession.scrollTarget.mode === "element" &&
        typeof globalThis.MutationObserver === "function"
      ) {
        const session = captureSession;
        session.mutationObserver = new globalThis.MutationObserver(() => {
          session.mutations += 1;
        });
        session.mutationObserver.observe(captureSession.scrollTarget.element, {
          attributes: true,
          characterData: true,
          childList: true,
          subtree: true,
        });
      }
      const metrics = getTargetMetrics(captureSession.scrollTarget);
      const capture = getCaptureDescriptor(
        captureSession.scrollTarget,
        metrics,
        regionElement !== null,
      );

      if (regionElement && capture.frame) {
        captureSession.frameIndicator = createRegionFrameIndicator(capture.frame);
      }

      return {
        capture,
        metrics,
        pageUrl: globalThis.location.href,
        title: document.title,
      };
    } catch (error) {
      await cleanupCapture();
      throw error;
    }
  }

  function setFrameIndicatorVisibility(visible) {
    if (
      captureSession &&
      captureSession.frameIndicator &&
      captureSession.frameIndicator.isConnected
    ) {
      captureSession.frameIndicator.style.display = visible ? "" : "none";
    }
  }

  async function scrollForCapture(segment) {
    if (!captureSession) {
      throw new ContentCaptureError(
        "CAPTURE_NOT_PREPARED",
        "The page has not been prepared for capture.",
      );
    }

    if (
      !segment ||
      !Number.isInteger(segment.index) ||
      !Number.isFinite(segment.x) ||
      !Number.isFinite(segment.y)
    ) {
      throw new ContentCaptureError(
        "INVALID_SEGMENT",
        "The requested capture segment is invalid.",
      );
    }

    setFixedVisibility(segment.index > 0);
    const scrollTolerance =
      1 / Math.max(1, globalThis.devicePixelRatio || 1) +
      SCROLL_FLOAT_EPSILON_CSS_PX;
    const target = captureSession.scrollTarget;
    const scrollMetrics = getTargetMetrics(target);
    const maxX = Math.max(
      0,
      scrollMetrics.documentWidth - scrollMetrics.viewportWidth,
    );
    const maxY = Math.max(
      0,
      scrollMetrics.documentHeight - scrollMetrics.viewportHeight,
    );
    const expectedX = Math.min(Math.max(segment.x, 0), maxX);
    const expectedY = Math.min(Math.max(segment.y, 0), maxY);

    function axisSettled(actualValue, requestedValue, expectedValue, maximum) {
      if (Math.abs(actualValue - expectedValue) <= scrollTolerance) {
        return true;
      }

      return (
        requestedValue >= maximum &&
        Math.abs(actualValue - maximum) <=
          SCROLL_EDGE_SLACK_CSS_PX + scrollTolerance
      );
    }

    function positionSettled(position) {
      return (
        axisSettled(position.x, segment.x, expectedX, maxX) &&
        axisSettled(position.y, segment.y, expectedY, maxY)
      );
    }

    let actual = getTargetScroll(target);

    if (segment.verifyOnly === true) {
      setFrameIndicatorVisibility(true);

      if (!positionSettled(actual)) {
        throw new ContentCaptureError(
          "SEGMENT_SCROLL_LOST",
          "The scroll position drifted after the segment was captured.",
          {
            actualX: actual.x,
            actualY: actual.y,
            requestedX: segment.x,
            requestedY: segment.y,
          },
        );
      }

      const verifiedMetrics = getTargetMetrics(target);
      return {
        actualX: actual.x,
        actualY: actual.y,
        capture: getCaptureDescriptor(target, verifiedMetrics, captureSession.region),
        metrics: verifiedMetrics,
        mutations: captureSession.mutations,
      };
    }

    let attempts = 0;

    for (let attempt = 0; attempt < MAX_SCROLL_ATTEMPTS; attempt += 1) {
      attempts = attempt + 1;
      setTargetScroll(target, expectedX, expectedY);
      await waitForPageToSettle();
      actual = getTargetScroll(target);

      if (positionSettled(actual)) {
        break;
      }
    }

    if (!positionSettled(actual)) {
      const failureMetrics = getTargetMetrics(target);
      throw new ContentCaptureError(
        "SCROLL_POSITION_MISMATCH",
        "The page did not settle at the requested capture position.",
        {
          actualX: actual.x,
          actualY: actual.y,
          attempts,
          connected: target.mode === "window" || target.element.isConnected,
          maxX: Math.max(
            0,
            failureMetrics.documentWidth - failureMetrics.viewportWidth,
          ),
          maxY: Math.max(
            0,
            failureMetrics.documentHeight - failureMetrics.viewportHeight,
          ),
          mode: target.mode,
          requestedX: segment.x,
          requestedY: segment.y,
        },
      );
    }

    setFrameIndicatorVisibility(false);

    const metrics = getTargetMetrics(target);
    return {
      actualX: actual.x,
      actualY: actual.y,
      capture: getCaptureDescriptor(target, metrics, captureSession.region),
      metrics,
      mutations: captureSession.mutations,
    };
  }

  async function cleanupCapture() {
    if (!captureSession) {
      return { cleaned: true };
    }

    const session = captureSession;
    const root = document.documentElement;
    const failures = [];

    function attempt(operation) {
      try {
        operation();
      } catch (error) {
        failures.push(error);
      }
    }

    attempt(() => setFixedVisibility(false));
    attempt(() => {
      if (session.mutationObserver) {
        session.mutationObserver.disconnect();
      }
    });
    attempt(() => {
      if (session.frameIndicator && session.frameIndicator.isConnected) {
        session.frameIndicator.remove();
      }
    });
    attempt(() => restoreStickyElements(session));
    attempt(() => {
      if (session.scrollTarget && session.scrollTarget.mode === "element") {
        restoreStyleProperty(
          session.scrollTarget.element,
          session.scrollTarget.scrollbarWidth,
        );
      }
    });
    attempt(() => {
      if (session.scrollTarget) {
        setTargetScroll(
          session.scrollTarget,
          session.scrollTarget.originalX,
          session.scrollTarget.originalY,
        );
      }
    });
    attempt(() => globalThis.scrollTo(session.originalX, session.originalY));
    attempt(() => {
      if (session.scrollTarget && session.scrollTarget.mode === "element") {
        restoreStyleProperty(
          session.scrollTarget.element,
          session.scrollTarget.scrollBehavior,
        );
        restoreStyleProperty(
          session.scrollTarget.element,
          session.scrollTarget.overflowAnchor,
        );
        restoreStyleProperty(
          session.scrollTarget.element,
          session.scrollTarget.scrollSnapType,
        );
      }
    });
    attempt(() => {
      if (session.style && session.style.isConnected) {
        session.style.remove();
      }
    });
    attempt(() => {
      if (session.previousCaptureAttribute === null) {
        root.removeAttribute(CAPTURE_ATTRIBUTE);
      } else {
        root.setAttribute(CAPTURE_ATTRIBUTE, session.previousCaptureAttribute);
      }
    });
    captureSession = null;

    if (failures.length > 0) {
      throw new ContentCaptureError(
        "CLEANUP_FAILED",
        "One or more page properties could not be restored.",
      );
    }

    return { cleaned: true };
  }

  async function handleMessage(message) {
    switch (message && message.type) {
      case "PREPARE_CAPTURE":
        return prepareCapture();
      case "PREPARE_REGION_CAPTURE":
        return prepareRegionCapture();
      case "ENTER_REGION_PICKER":
        return enterRegionPicker();
      case "EXIT_REGION_PICKER":
        exitRegionPicker();
        return { active: false };
      case "SCROLL_CAPTURE":
        return scrollForCapture(message.segment);
      case "CLEANUP_CAPTURE":
        return cleanupCapture();
      default:
        throw new ContentCaptureError("UNKNOWN_MESSAGE", "Unknown capture command.");
    }
  }

  browser.runtime.onMessage.addListener((message) =>
    handleMessage(message)
      .then((value) => ({ ok: true, value }))
      .catch((error) => ({
        ok: false,
        error: {
          code: error && error.code ? error.code : "CONTENT_CAPTURE_FAILED",
          details: error && error.details ? error.details : undefined,
        },
      })),
  );
})();
