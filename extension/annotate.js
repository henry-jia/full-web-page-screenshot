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
    "badge",
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

  function contrastTextColor(background) {
    const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(
      String(background),
    );
    if (!match) {
      return "#ffffff";
    }
    const luminance =
      (0.2126 * parseInt(match[1], 16) +
        0.7152 * parseInt(match[2], 16) +
        0.0722 * parseInt(match[3], 16)) /
      255;
    return luminance > 0.6 ? "#000000" : "#ffffff";
  }

  function textLineHeight(size) {
    return Math.round(size * 1.25);
  }

  function wrapTextLine(context, text, maxWidth) {
    if (
      !Number.isFinite(maxWidth) ||
      maxWidth <= 0 ||
      context.measureText(text).width <= maxWidth
    ) {
      return [text];
    }
    const lines = [];
    let current = "";
    for (const char of text) {
      const candidate = current + char;
      if (current && context.measureText(candidate).width > maxWidth) {
        const spaceIndex = current.lastIndexOf(" ");
        if (spaceIndex > 0) {
          lines.push(current.slice(0, spaceIndex));
          current = current.slice(spaceIndex + 1) + char;
        } else {
          lines.push(current);
          current = char;
        }
      } else {
        current = candidate;
      }
    }
    lines.push(current);
    return lines;
  }

  const metricsCache = new WeakMap();

  function measureTextBlock(context, command) {
    context.font = `${command.size}px ${command.fontFamily || "system-ui, sans-serif"}`;
    const cacheKey = [
      command.size,
      command.fontFamily || "",
      command.maxWidth || 0,
      command.text,
    ].join("\t");
    const cached = metricsCache.get(command);
    if (cached && cached.key === cacheKey) {
      return cached.metrics;
    }
    const maxWidth =
      Number.isFinite(command.maxWidth) && command.maxWidth > 0
        ? command.maxWidth
        : null;
    const lines = [];
    for (const hardLine of String(command.text).split("\n")) {
      if (maxWidth) {
        lines.push(...wrapTextLine(context, hardLine, maxWidth));
      } else {
        lines.push(hardLine);
      }
    }
    const lineHeight = textLineHeight(command.size);
    let width = 0;
    const lineWidths = lines.map((line) => {
      const lineWidth = context.measureText(line).width;
      width = Math.max(width, lineWidth);
      return lineWidth;
    });
    const metrics = Object.freeze({
      width,
      height: lineHeight * lines.length,
      lineHeight,
      lines,
      lineWidths,
    });
    metricsCache.set(command, { key: cacheKey, metrics });
    return metrics;
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
        context.textBaseline = "top";
        context.textAlign = "left";
        const metrics = measureTextBlock(context, command);
        metrics.lines.forEach((line, index) => {
          const lineY = command.y + index * metrics.lineHeight;
          if (command.background) {
            context.save();
            context.globalAlpha = Number.isFinite(command.backgroundAlpha)
              ? command.backgroundAlpha
              : 0.4;
            context.fillStyle = command.background;
            context.fillRect(
              command.x,
              lineY,
              metrics.lineWidths[index],
              metrics.lineHeight,
            );
            context.restore();
          }
          context.fillStyle = command.color;
          context.fillText(line, command.x, lineY);
        });
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
      case "badge": {
        const radius = command.radius || 16;
        context.fillStyle = command.color;
        context.beginPath();
        context.arc(command.x, command.y, radius, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = contrastTextColor(command.color);
        context.font = `bold ${Math.round(radius * 1.1)}px system-ui, sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(String(command.number), command.x, command.y);
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
    contrastTextColor,
    drawCommand,
    measureTextBlock,
    mosaicSampleSize,
    normalizeRect,
    replayCommands,
    textLineHeight,
    wrapTextLine,
  });
});
