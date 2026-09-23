(function exposeFwpsAnnotate(root, factory) {
  "use strict";

  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.FwpsAnnotate = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function buildFwpsAnnotateApi() {
  "use strict";

  const TOOL_TYPES = Object.freeze([
    "text",
    "rect",
    "ellipse",
    "line",
    "arrow",
    "mosaic",
  ]);

  const ARROW_HEAD_ANGLE = 0.45;
  const DEFAULT_MOSAIC_BLOCK_SIZE = 12;

  class AnnotateError extends Error {
    constructor(code, message) {
      super(message);
      this.name = "AnnotateError";
      this.code = code;
    }
  }

  function requireFinite(value, fieldName) {
    if (!Number.isFinite(value)) {
      throw new AnnotateError(
        "INVALID_COMMAND",
        `${fieldName} must be a finite number.`,
      );
    }
    return value;
  }

  function normalizeRect(x1, y1, x2, y2) {
    return Object.freeze({
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
    });
  }

  function arrowHeadPoints(x1, y1, x2, y2, headLength) {
    requireFinite(x1, "x1");
    requireFinite(y1, "y1");
    requireFinite(x2, "x2");
    requireFinite(y2, "y2");
    const length = Math.hypot(x2 - x1, y2 - y1);

    if (length < 1) {
      return null;
    }

    const angle = Math.atan2(y2 - y1, x2 - x1);
    const size = requireFinite(headLength, "headLength");

    return Object.freeze([
      Object.freeze({
        x: x2 - size * Math.cos(angle - ARROW_HEAD_ANGLE),
        y: y2 - size * Math.sin(angle - ARROW_HEAD_ANGLE),
      }),
      Object.freeze({
        x: x2 - size * Math.cos(angle + ARROW_HEAD_ANGLE),
        y: y2 - size * Math.sin(angle + ARROW_HEAD_ANGLE),
      }),
    ]);
  }

  function mosaicSampleSize(width, height, blockSize) {
    requireFinite(width, "width");
    requireFinite(height, "height");
    requireFinite(blockSize, "blockSize");

    return Object.freeze({
      width: Math.max(1, Math.round(width / blockSize)),
      height: Math.max(1, Math.round(height / blockSize)),
    });
  }

  function applyStrokeStyle(context, command) {
    context.strokeStyle = command.color;
    context.lineWidth = command.lineWidth;
    context.lineCap = "round";
    context.lineJoin = "round";
  }

  function strokeLine(context, x1, y1, x2, y2) {
    context.beginPath();
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
    context.stroke();
  }

  function drawCommand(context, command, helpers = {}) {
    if (!command || !TOOL_TYPES.includes(command.type)) {
      throw new AnnotateError("INVALID_COMMAND", "Unknown annotation command.");
    }

    switch (command.type) {
      case "text": {
        context.fillStyle = command.color;
        context.font = `${command.size}px system-ui, sans-serif`;
        context.textBaseline = "top";
        context.fillText(command.text, command.x, command.y);
        return;
      }
      case "rect": {
        applyStrokeStyle(context, command);
        context.strokeRect(command.x, command.y, command.width, command.height);
        return;
      }
      case "ellipse": {
        applyStrokeStyle(context, command);
        context.beginPath();
        context.ellipse(
          command.x + command.width / 2,
          command.y + command.height / 2,
          Math.max(0.5, command.width / 2),
          Math.max(0.5, command.height / 2),
          0,
          0,
          Math.PI * 2,
        );
        context.stroke();
        return;
      }
      case "line": {
        applyStrokeStyle(context, command);
        strokeLine(context, command.x1, command.y1, command.x2, command.y2);
        return;
      }
      case "arrow": {
        applyStrokeStyle(context, command);
        strokeLine(context, command.x1, command.y1, command.x2, command.y2);
        const head = arrowHeadPoints(
          command.x1,
          command.y1,
          command.x2,
          command.y2,
          command.lineWidth * 4,
        );
        if (head) {
          context.beginPath();
          context.moveTo(command.x2, command.y2);
          context.lineTo(head[0].x, head[0].y);
          context.moveTo(command.x2, command.y2);
          context.lineTo(head[1].x, head[1].y);
          context.stroke();
        }
        return;
      }
      case "mosaic": {
        const createCanvas = helpers.createCanvas;
        if (typeof createCanvas !== "function") {
          throw new AnnotateError(
            "CANVAS_UNAVAILABLE",
            "Mosaic requires a canvas factory.",
          );
        }
        const sample = mosaicSampleSize(
          command.width,
          command.height,
          command.blockSize || DEFAULT_MOSAIC_BLOCK_SIZE,
        );
        const scratch = createCanvas(sample.width, sample.height);
        const scratchContext = scratch.getContext("2d");
        scratchContext.drawImage(
          helpers.sourceCanvas,
          command.x,
          command.y,
          command.width,
          command.height,
          0,
          0,
          sample.width,
          sample.height,
        );
        const smoothing = context.imageSmoothingEnabled;
        context.imageSmoothingEnabled = false;
        context.drawImage(
          scratch,
          0,
          0,
          sample.width,
          sample.height,
          command.x,
          command.y,
          command.width,
          command.height,
        );
        context.imageSmoothingEnabled = smoothing;
        return;
      }
      default:
        throw new AnnotateError("INVALID_COMMAND", "Unknown annotation command.");
    }
  }

  function replayCommands(context, baseImage, commands, helpers = {}) {
    context.drawImage(baseImage, 0, 0);
    for (const command of commands) {
      drawCommand(context, command, helpers);
    }
  }

  return Object.freeze({
    DEFAULT_MOSAIC_BLOCK_SIZE,
    TOOL_TYPES,
    arrowHeadPoints,
    drawCommand,
    mosaicSampleSize,
    normalizeRect,
    replayCommands,
  });
});
