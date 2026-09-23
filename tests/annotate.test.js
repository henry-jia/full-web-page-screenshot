"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const FwpsAnnotate = require("../extension/annotate.js");

function createContextRecorder() {
  const calls = [];
  return {
    calls,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    font: "",
    textBaseline: "",
    textAlign: "",
    globalAlpha: 1,
    imageSmoothingEnabled: true,
    measureText(text) {
      return { width: String(text).length * 10 };
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
    strokeRect(x, y, width, height) {
      calls.push(["strokeRect", x, y, width, height]);
    },
    fillRect(...args) {
      calls.push(["fillRect", ...args]);
    },
    arc(...args) {
      calls.push(["arc", ...args]);
    },
    fill() {
      calls.push(["fill"]);
    },
    save() {
      calls.push(["save"]);
    },
    restore() {
      calls.push(["restore"]);
    },
    ellipse(x, y, radiusX, radiusY, rotation, start, end) {
      calls.push(["ellipse", x, y, radiusX, radiusY, rotation, start, end]);
    },
    fillText(text, x, y) {
      calls.push(["fillText", text, x, y]);
    },
    drawImage(...args) {
      calls.push(["drawImage", ...args]);
    },
  };
}

function createScratchFactory(record) {
  return (width, height) => {
    const scratch = {
      width,
      height,
      getContext() {
        return createContextRecorder();
      },
    };
    record.push(scratch);
    return scratch;
  };
}

test("normalizeRect handles corners dragged in any direction", () => {
  assert.deepEqual(FwpsAnnotate.normalizeRect(10, 20, 40, 60), {
    x: 10,
    y: 20,
    width: 30,
    height: 40,
  });
  assert.deepEqual(FwpsAnnotate.normalizeRect(40, 60, 10, 20), {
    x: 10,
    y: 20,
    width: 30,
    height: 40,
  });
});

test("arrowHeadPoints places symmetric wings behind the tip", () => {
  const head = FwpsAnnotate.arrowHeadPoints(0, 0, 100, 0, 10);
  assert.ok(head);
  assert.equal(head.length, 2);
  const expectedX = 100 - 10 * Math.cos(0.45);
  const expectedY = 10 * Math.sin(0.45);
  for (const point of head) {
    assert.ok(Math.abs(point.x - expectedX) < 1e-9, `wing x ${point.x}`);
    assert.ok(Math.abs(Math.abs(point.y) - expectedY) < 1e-9, `wing y ${point.y}`);
  }
  assert.equal(head[0].y, -head[1].y);
});

test("arrowHeadPoints returns null for a degenerate line", () => {
  assert.equal(FwpsAnnotate.arrowHeadPoints(5, 5, 5, 5, 10), null);
});

test("mosaicSampleSize divides a region into blocks with a floor of one", () => {
  assert.deepEqual(FwpsAnnotate.mosaicSampleSize(120, 60, 12), {
    width: 10,
    height: 5,
  });
  assert.deepEqual(FwpsAnnotate.mosaicSampleSize(3, 3, 12), {
    width: 1,
    height: 1,
  });
});

test("rect commands stroke the normalized rectangle with the chosen style", () => {
  const context = createContextRecorder();
  FwpsAnnotate.drawCommand(context, {
    type: "rect",
    x: 10,
    y: 20,
    width: 30,
    height: 40,
    color: "#ff0000",
    lineWidth: 6,
  });

  assert.equal(context.strokeStyle, "#ff0000");
  assert.equal(context.lineWidth, 6);
  assert.deepEqual(context.calls, [["strokeRect", 10, 20, 30, 40]]);
});

test("ellipse commands draw through the ellipse path API", () => {
  const context = createContextRecorder();
  FwpsAnnotate.drawCommand(context, {
    type: "ellipse",
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    color: "#00ff00",
    lineWidth: 3,
  });

  assert.deepEqual(context.calls[0], ["beginPath"]);
  assert.deepEqual(context.calls[1], [
    "ellipse",
    50,
    25,
    50,
    25,
    0,
    0,
    Math.PI * 2,
  ]);
  assert.deepEqual(context.calls[2], ["stroke"]);
});

test("arrow commands stroke the shaft and both head wings", () => {
  const context = createContextRecorder();
  FwpsAnnotate.drawCommand(context, {
    type: "arrow",
    x1: 0,
    y1: 0,
    x2: 100,
    y2: 0,
    color: "#ffffff",
    lineWidth: 4,
  });

  const strokes = context.calls.filter((call) => call[0] === "stroke");
  const lineTos = context.calls.filter((call) => call[0] === "lineTo");
  assert.equal(strokes.length, 2);
  assert.equal(lineTos.length, 3);
});

test("text commands fill text at the image position", () => {
  const context = createContextRecorder();
  FwpsAnnotate.drawCommand(context, {
    type: "text",
    x: 12,
    y: 34,
    text: "標註",
    color: "#ffff00",
    size: 24,
  });

  assert.equal(context.fillStyle, "#ffff00");
  assert.equal(context.textBaseline, "top");
  assert.deepEqual(context.calls, [["fillText", "標註", 12, 34]]);
});

test("mosaic resamples through a scratch canvas with smoothing disabled", () => {
  const context = createContextRecorder();
  const scratchCanvases = [];
  const sourceCanvas = { id: "source" };

  FwpsAnnotate.drawCommand(
    context,
    { type: "mosaic", x: 10, y: 20, width: 120, height: 60, blockSize: 12 },
    {
      createCanvas: createScratchFactory(scratchCanvases),
      sourceCanvas,
    },
  );

  assert.equal(scratchCanvases.length, 1);
  assert.equal(scratchCanvases[0].width, 10);
  assert.equal(scratchCanvases[0].height, 5);

  const finalDraw = context.calls.find(
    (call) => call[0] === "drawImage" && call[1] === scratchCanvases[0],
  );
  assert.deepEqual(finalDraw.slice(2), [0, 0, 10, 5, 10, 20, 120, 60]);
  assert.equal(context.imageSmoothingEnabled, true);
});

test("replayCommands redraws the base image then replays every command in order", () => {
  const context = createContextRecorder();
  const baseImage = { id: "base" };
  const commands = [
    { type: "rect", x: 1, y: 1, width: 10, height: 10, color: "#f00", lineWidth: 3 },
    { type: "line", x1: 0, y1: 0, x2: 9, y2: 9, color: "#0f0", lineWidth: 3 },
  ];

  FwpsAnnotate.replayCommands(context, baseImage, commands);
  assert.deepEqual(context.calls[0], ["drawImage", { id: "base" }, 0, 0]);
  assert.ok(context.calls.some((call) => call[0] === "strokeRect"));
  assert.ok(context.calls.some((call) => call[0] === "stroke"));

  const afterUndo = createContextRecorder();
  FwpsAnnotate.replayCommands(afterUndo, baseImage, commands.slice(0, 1));
  assert.ok(afterUndo.calls.some((call) => call[0] === "strokeRect"));
  assert.ok(afterUndo.calls.every((call) => call[0] !== "stroke"));
});

test("unknown commands are rejected", () => {
  const context = createContextRecorder();
  assert.throws(
    () => FwpsAnnotate.drawCommand(context, { type: "spray" }),
    /Unknown annotation command/,
  );
});

test("badge commands draw a filled circle with a contrasted number", () => {
  const context = createContextRecorder();
  FwpsAnnotate.drawCommand(context, {
    type: "badge",
    x: 50,
    y: 60,
    number: 3,
    color: "#e5484d",
    radius: 20,
  });

  const arc = context.calls.find((call) => call[0] === "arc");
  assert.deepEqual(arc, ["arc", 50, 60, 20, 0, Math.PI * 2]);
  const label = context.calls.find((call) => call[0] === "fillText");
  assert.deepEqual(label, ["fillText", "3", 50, 60]);
  assert.equal(context.textAlign, "center");
  assert.equal(context.textBaseline, "middle");
});

test("contrastTextColor picks black on light backgrounds and white on dark", () => {
  assert.equal(FwpsAnnotate.contrastTextColor("#ffffff"), "#000000");
  assert.equal(FwpsAnnotate.contrastTextColor("#f5a623"), "#000000");
  assert.equal(FwpsAnnotate.contrastTextColor("#e5484d"), "#ffffff");
  assert.equal(FwpsAnnotate.contrastTextColor("#000000"), "#ffffff");
  assert.equal(FwpsAnnotate.contrastTextColor("bogus"), "#ffffff");
});

test("text commands draw a translucent highlight behind each line", () => {
  const context = createContextRecorder();
  FwpsAnnotate.drawCommand(context, {
    type: "text",
    x: 10,
    y: 20,
    text: "ab\ncde",
    color: "#ffffff",
    size: 20,
    fontFamily: "monospace",
    background: "#f5a623",
  });

  const fills = context.calls.filter((call) => call[0] === "fillRect");
  assert.equal(fills.length, 2);
  assert.deepEqual(fills[0], ["fillRect", 10, 20, 20, 25]);
  assert.deepEqual(fills[1], ["fillRect", 10, 45, 30, 25]);
  const texts = context.calls.filter((call) => call[0] === "fillText");
  assert.deepEqual(texts, [
    ["fillText", "ab", 10, 20],
    ["fillText", "cde", 10, 45],
  ]);
  assert.equal(context.font, "20px monospace");
});

test("text highlight uses the command backgroundAlpha and defaults to 0.4", () => {
  const custom = createContextRecorder();
  FwpsAnnotate.drawCommand(custom, {
    type: "text",
    x: 0,
    y: 0,
    text: "ab",
    color: "#ffffff",
    size: 20,
    fontFamily: "monospace",
    background: "#f5a623",
    backgroundAlpha: 0.85,
  });
  assert.equal(custom.globalAlpha, 0.85);

  const fallback = createContextRecorder();
  FwpsAnnotate.drawCommand(fallback, {
    type: "text",
    x: 0,
    y: 0,
    text: "ab",
    color: "#ffffff",
    size: 20,
    fontFamily: "monospace",
    background: "#f5a623",
  });
  assert.equal(fallback.globalAlpha, 0.4);
});

test("text commands wrap lines at maxWidth and measure the wrapped block", () => {
  const context = createContextRecorder();
  const command = {
    type: "text",
    x: 10,
    y: 20,
    text: "aaaa bbbb cccc",
    color: "#ffffff",
    size: 20,
    fontFamily: "monospace",
    maxWidth: 70,
  };

  const metrics = FwpsAnnotate.measureTextBlock(context, command);
  assert.deepEqual(metrics.lines, ["aaaa", "bbbb", "cccc"]);
  assert.equal(metrics.width, 40);
  assert.equal(metrics.height, 75);

  FwpsAnnotate.drawCommand(context, command);
  const texts = context.calls.filter((call) => call[0] === "fillText");
  assert.deepEqual(texts, [
    ["fillText", "aaaa", 10, 20],
    ["fillText", "bbbb", 10, 45],
    ["fillText", "cccc", 10, 70],
  ]);
});

test("measureTextBlock reports the widest line and total height", () => {
  const context = createContextRecorder();
  const metrics = FwpsAnnotate.measureTextBlock(context, {
    type: "text",
    x: 0,
    y: 0,
    text: "ab\ncde",
    size: 20,
  });

  assert.equal(metrics.width, 30);
  assert.equal(metrics.height, 50);
  assert.equal(metrics.lineHeight, 25);
});
