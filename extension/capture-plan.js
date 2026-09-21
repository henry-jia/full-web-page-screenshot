(function exposeCapturePlan(root, factory) {
  "use strict";

  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.CapturePlan = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function buildCapturePlanApi() {
  "use strict";

  const DEFAULT_LIMITS = Object.freeze({
    maxDimension: 32767,
    maxPixelArea: 64000000,
    maxSegments: 500,
  });

  class CapturePlanError extends Error {
    constructor(code, message) {
      super(message);
      this.name = "CapturePlanError";
      this.code = code;
    }
  }

  function requirePositiveFinite(value, fieldName) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new CapturePlanError(
        "INVALID_GEOMETRY",
        `${fieldName} must be a positive finite number.`,
      );
    }

    return value;
  }

  function normalizeMetrics(metrics) {
    if (!metrics || typeof metrics !== "object") {
      throw new CapturePlanError("INVALID_GEOMETRY", "Page metrics are required.");
    }

    const documentWidth = Math.ceil(
      requirePositiveFinite(metrics.documentWidth, "documentWidth"),
    );
    const documentHeight = Math.ceil(
      requirePositiveFinite(metrics.documentHeight, "documentHeight"),
    );
    const viewportWidth = Math.floor(
      requirePositiveFinite(metrics.viewportWidth, "viewportWidth"),
    );
    const viewportHeight = Math.floor(
      requirePositiveFinite(metrics.viewportHeight, "viewportHeight"),
    );
    const devicePixelRatio = requirePositiveFinite(
      metrics.devicePixelRatio || 1,
      "devicePixelRatio",
    );

    return Object.freeze({
      documentWidth: Math.max(documentWidth, viewportWidth),
      documentHeight: Math.max(documentHeight, viewportHeight),
      viewportWidth,
      viewportHeight,
      devicePixelRatio,
    });
  }

  function buildAxisStops(totalSize, viewportSize) {
    const lastStart = Math.max(0, totalSize - viewportSize);
    const stops = [];

    for (let position = 0; position < lastStart; position += viewportSize) {
      stops.push(position);
    }

    if (stops.length === 0 || stops[stops.length - 1] !== lastStart) {
      stops.push(lastStart);
    }

    return stops;
  }

  function buildAxisSlices(totalSize, viewportSize) {
    const slices = [];

    for (let destination = 0; destination < totalSize; destination += viewportSize) {
      const size = Math.min(viewportSize, totalSize - destination);
      const capture = Math.min(destination, Math.max(0, totalSize - viewportSize));

      slices.push(
        Object.freeze({
          capture,
          source: destination - capture,
          destination,
          size,
        }),
      );
    }

    return Object.freeze(slices);
  }

  function validateOutputDimensions(
    documentWidth,
    documentHeight,
    scaleX,
    scaleY,
    limits = DEFAULT_LIMITS,
  ) {
    requirePositiveFinite(scaleX, "scaleX");
    requirePositiveFinite(scaleY, "scaleY");

    const outputWidth = Math.round(
      requirePositiveFinite(documentWidth, "documentWidth") * scaleX,
    );
    const outputHeight = Math.round(
      requirePositiveFinite(documentHeight, "documentHeight") * scaleY,
    );
    const maxDimension = limits.maxDimension || DEFAULT_LIMITS.maxDimension;
    const maxPixelArea = limits.maxPixelArea || DEFAULT_LIMITS.maxPixelArea;

    if (outputWidth > maxDimension || outputHeight > maxDimension) {
      throw new CapturePlanError(
        "CANVAS_DIMENSION_EXCEEDED",
        `Output dimensions ${outputWidth}x${outputHeight} exceed ${maxDimension}px.`,
      );
    }

    if (outputWidth * outputHeight > maxPixelArea) {
      throw new CapturePlanError(
        "CANVAS_AREA_EXCEEDED",
        `Output pixel area exceeds the ${maxPixelArea} pixel safety budget.`,
      );
    }

    return Object.freeze({ outputWidth, outputHeight });
  }

  function fitOutputDimensions(
    documentWidth,
    documentHeight,
    sourceScaleX,
    sourceScaleY,
    limits = DEFAULT_LIMITS,
  ) {
    const width = requirePositiveFinite(documentWidth, "documentWidth");
    const height = requirePositiveFinite(documentHeight, "documentHeight");
    requirePositiveFinite(sourceScaleX, "sourceScaleX");
    requirePositiveFinite(sourceScaleY, "sourceScaleY");

    const naturalWidth = width * sourceScaleX;
    const naturalHeight = height * sourceScaleY;
    const maxDimension = limits.maxDimension || DEFAULT_LIMITS.maxDimension;
    const maxPixelArea = limits.maxPixelArea || DEFAULT_LIMITS.maxPixelArea;
    let fitRatio = Math.min(
      1,
      maxDimension / naturalWidth,
      maxDimension / naturalHeight,
      Math.sqrt(maxPixelArea / (naturalWidth * naturalHeight)),
    );
    function calculateOutput(ratio) {
      return {
        outputWidth: Math.max(1, Math.round(naturalWidth * ratio)),
        outputHeight: Math.max(1, Math.round(naturalHeight * ratio)),
      };
    }

    function isSafe(output) {
      return (
        output.outputWidth <= maxDimension &&
        output.outputHeight <= maxDimension &&
        output.outputWidth * output.outputHeight <= maxPixelArea
      );
    }

    let output = calculateOutput(fitRatio);
    if (!isSafe(output)) {
      let safeRatio = 0;
      let unsafeRatio = fitRatio;

      for (let iteration = 0; iteration < 60; iteration += 1) {
        const candidateRatio = (safeRatio + unsafeRatio) / 2;
        const candidate = calculateOutput(candidateRatio);

        if (isSafe(candidate)) {
          safeRatio = candidateRatio;
        } else {
          unsafeRatio = candidateRatio;
        }
      }

      fitRatio = safeRatio;
      output = calculateOutput(fitRatio);
    }

    const scaled = fitRatio < 1;

    return Object.freeze({
      outputHeight: output.outputHeight,
      outputWidth: output.outputWidth,
      scaleX: sourceScaleX * fitRatio,
      scaleY: sourceScaleY * fitRatio,
      scaled,
    });
  }

  function createCapturePlan(metrics, limits = DEFAULT_LIMITS) {
    const normalized = normalizeMetrics(metrics);

    const columnCount = Math.ceil(
      normalized.documentWidth / normalized.viewportWidth,
    );
    const rowCount = Math.ceil(
      normalized.documentHeight / normalized.viewportHeight,
    );
    const maxSegments = limits.maxSegments || DEFAULT_LIMITS.maxSegments;

    if (columnCount * rowCount > maxSegments) {
      throw new CapturePlanError(
        "TOO_MANY_SEGMENTS",
        `Capture requires more than ${maxSegments} viewport segments.`,
      );
    }

    const xSlices = buildAxisSlices(
      normalized.documentWidth,
      normalized.viewportWidth,
    );
    const ySlices = buildAxisSlices(
      normalized.documentHeight,
      normalized.viewportHeight,
    );
    const segments = [];

    for (const ySlice of ySlices) {
      for (const xSlice of xSlices) {
        segments.push(
          Object.freeze({
            index: segments.length,
            x: xSlice.capture,
            y: ySlice.capture,
            sourceX: xSlice.source,
            sourceY: ySlice.source,
            destinationX: xSlice.destination,
            destinationY: ySlice.destination,
            width: xSlice.size,
            height: ySlice.size,
          }),
        );
      }
    }

    return Object.freeze({
      ...normalized,
      segments: Object.freeze(segments),
    });
  }

  function toPixelPlacement(segment, scaleX, scaleY, origins = {}) {
    requirePositiveFinite(scaleX, "scaleX");
    requirePositiveFinite(scaleY, "scaleY");

    if (!segment || typeof segment !== "object") {
      throw new CapturePlanError("INVALID_SEGMENT", "A capture segment is required.");
    }

    const fields = [
      "sourceX",
      "sourceY",
      "destinationX",
      "destinationY",
      "width",
      "height",
    ];
    for (const field of fields) {
      if (!Number.isFinite(segment[field]) || segment[field] < 0) {
        throw new CapturePlanError(
          "INVALID_SEGMENT",
          `${field} must be a non-negative finite number.`,
        );
      }
    }
    requirePositiveFinite(segment.width, "width");
    requirePositiveFinite(segment.height, "height");
    const destinationScaleX = origins.destinationScaleX === undefined
      ? scaleX
      : requirePositiveFinite(origins.destinationScaleX, "destinationScaleX");
    const destinationScaleY = origins.destinationScaleY === undefined
      ? scaleY
      : requirePositiveFinite(origins.destinationScaleY, "destinationScaleY");

    const originFields = ["sourceX", "sourceY", "destinationX", "destinationY"];
    for (const field of originFields) {
      if (origins[field] !== undefined && (!Number.isFinite(origins[field]) || origins[field] < 0)) {
        throw new CapturePlanError(
          "INVALID_SEGMENT",
          `${field} origin must be a non-negative finite number.`,
        );
      }
    }

    const sourceOriginX = origins.sourceX || 0;
    const sourceOriginY = origins.sourceY || 0;
    const destinationOriginX = origins.destinationX || 0;
    const destinationOriginY = origins.destinationY || 0;
    const sourceX = Math.round((sourceOriginX + segment.sourceX) * scaleX);
    const sourceY = Math.round((sourceOriginY + segment.sourceY) * scaleY);
    const destinationX = Math.round(
      (destinationOriginX + segment.destinationX) * destinationScaleX,
    );
    const destinationY = Math.round(
      (destinationOriginY + segment.destinationY) * destinationScaleY,
    );

    return Object.freeze({
      sourceX,
      sourceY,
      sourceWidth:
        Math.round((sourceOriginX + segment.sourceX + segment.width) * scaleX) -
        sourceX,
      sourceHeight:
        Math.round((sourceOriginY + segment.sourceY + segment.height) * scaleY) -
        sourceY,
      destinationX,
      destinationY,
      destinationWidth:
        Math.round(
          (destinationOriginX + segment.destinationX + segment.width) *
            destinationScaleX,
        ) -
        destinationX,
      destinationHeight:
        Math.round(
          (destinationOriginY + segment.destinationY + segment.height) *
            destinationScaleY,
        ) -
        destinationY,
    });
  }

  function adjustSegmentForScroll(
    segment,
    actualX,
    actualY,
    viewportWidth,
    viewportHeight,
  ) {
    if (!segment || typeof segment !== "object") {
      throw new CapturePlanError("INVALID_SEGMENT", "A capture segment is required.");
    }

    for (const field of ["x", "y", "sourceX", "sourceY", "destinationX", "destinationY"]) {
      if (!Number.isFinite(segment[field])) {
        throw new CapturePlanError(
          "INVALID_SEGMENT",
          `${field} must be a finite number.`,
        );
      }
    }
    requirePositiveFinite(segment.width, "width");
    requirePositiveFinite(segment.height, "height");
    requirePositiveFinite(viewportWidth, "viewportWidth");
    requirePositiveFinite(viewportHeight, "viewportHeight");
    if (!Number.isFinite(actualX) || !Number.isFinite(actualY)) {
      throw new CapturePlanError(
        "INVALID_SEGMENT",
        "The actual scroll position must be finite.",
      );
    }

    const deltaX = actualX - segment.x;
    const deltaY = actualY - segment.y;

    if (deltaX === 0 && deltaY === 0) {
      return segment;
    }

    let sourceX = segment.sourceX - deltaX;
    let sourceY = segment.sourceY - deltaY;
    let destinationX = segment.destinationX;
    let destinationY = segment.destinationY;
    let width = segment.width;
    let height = segment.height;

    if (sourceX < 0) {
      destinationX -= sourceX;
      width += sourceX;
      sourceX = 0;
    }
    if (sourceY < 0) {
      destinationY -= sourceY;
      height += sourceY;
      sourceY = 0;
    }
    width = Math.min(width, viewportWidth - sourceX);
    height = Math.min(height, viewportHeight - sourceY);

    return Object.freeze({
      index: segment.index,
      x: actualX,
      y: actualY,
      sourceX,
      sourceY,
      destinationX,
      destinationY,
      width: Math.max(0, width),
      height: Math.max(0, height),
    });
  }

  function createFilename(pageUrl, timestamp = new Date(), prefix = "full-page") {
    let host = "web-page";

    try {
      host = new URL(pageUrl).hostname || host;
    } catch (error) {
      if (!(error instanceof TypeError)) {
        throw error;
      }
    }

    const safeHost = host
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
      .replace(/\s+/g, "-")
      .replace(/\.+$/g, "")
      .slice(0, 80) || "web-page";
    const safeTimestamp = timestamp
      .toISOString()
      .replace(/\.\d{3}Z$/, "Z")
      .replace(/[:]/g, "-");

    const safePrefix = /^[a-z0-9-]+$/.test(prefix) ? prefix : "full-page";

    return `${safePrefix}-${safeHost}-${safeTimestamp}.png`;
  }

  return Object.freeze({
    CapturePlanError,
    DEFAULT_LIMITS,
    adjustSegmentForScroll,
    buildAxisSlices,
    buildAxisStops,
    createCapturePlan,
    createFilename,
    fitOutputDimensions,
    normalizeMetrics,
    toPixelPlacement,
    validateOutputDimensions,
  });
});
