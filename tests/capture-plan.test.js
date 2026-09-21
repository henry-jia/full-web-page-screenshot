"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const CapturePlan = require("../extension/capture-plan.js");

test("a viewport-sized page produces one complete capture segment", () => {
  const plan = CapturePlan.createCapturePlan({
    documentWidth: 1280,
    documentHeight: 720,
    viewportWidth: 1280,
    viewportHeight: 720,
    devicePixelRatio: 1,
  });

  assert.equal(plan.segments.length, 1);
  assert.deepEqual(plan.segments[0], {
    index: 0,
    x: 0,
    y: 0,
    sourceX: 0,
    sourceY: 0,
    destinationX: 0,
    destinationY: 0,
    width: 1280,
    height: 720,
  });
});

test("a page is tiled in both axes and terminal segments align to the edges", () => {
  const plan = CapturePlan.createCapturePlan({
    documentWidth: 2500,
    documentHeight: 1700,
    viewportWidth: 1000,
    viewportHeight: 700,
    devicePixelRatio: 1,
  });

  assert.equal(plan.segments.length, 9);
  assert.deepEqual(
    plan.segments.map(({ x, y }) => [x, y]),
    [
      [0, 0],
      [1000, 0],
      [1500, 0],
      [0, 700],
      [1000, 700],
      [1500, 700],
      [0, 1000],
      [1000, 1000],
      [1500, 1000],
    ],
  );
  assert.deepEqual(plan.segments.at(-1), {
    index: 8,
    x: 1500,
    y: 1000,
    sourceX: 500,
    sourceY: 400,
    destinationX: 2000,
    destinationY: 1400,
    width: 500,
    height: 300,
  });
});

test("terminal tile crop metadata maps only uncovered pixels", () => {
  const plan = CapturePlan.createCapturePlan({
    documentWidth: 2500,
    documentHeight: 1700,
    viewportWidth: 1000,
    viewportHeight: 700,
    devicePixelRatio: 1,
  });
  const placement = CapturePlan.toPixelPlacement(plan.segments.at(-1), 1, 1);

  assert.deepEqual(placement, {
    sourceX: 500,
    sourceY: 400,
    sourceWidth: 500,
    sourceHeight: 300,
    destinationX: 2000,
    destinationY: 1400,
    destinationWidth: 500,
    destinationHeight: 300,
  });
});

test("frame origins remain pixel-aligned at fractional bitmap scale", () => {
  const placement = CapturePlan.toPixelPlacement(
    {
      sourceX: 0,
      sourceY: 0,
      destinationX: 0,
      destinationY: 500,
      width: 600,
      height: 500,
    },
    1.25,
    1.25,
    {
      sourceX: 200,
      sourceY: 100,
      destinationX: 200,
      destinationY: 100,
    },
  );

  assert.deepEqual(placement, {
    sourceX: 250,
    sourceY: 125,
    sourceWidth: 750,
    sourceHeight: 625,
    destinationX: 250,
    destinationY: 750,
    destinationWidth: 750,
    destinationHeight: 625,
  });
});

test("destination tiles can downscale while source crops stay full resolution", () => {
  const placement = CapturePlan.toPixelPlacement(
    {
      sourceX: 0,
      sourceY: 300,
      destinationX: 0,
      destinationY: 600,
      width: 800,
      height: 300,
    },
    2,
    2,
    { destinationScaleX: 1, destinationScaleY: 1 },
  );

  assert.deepEqual(placement, {
    sourceX: 0,
    sourceY: 600,
    sourceWidth: 1600,
    sourceHeight: 600,
    destinationX: 0,
    destinationY: 600,
    destinationWidth: 800,
    destinationHeight: 300,
  });
});

test("fractional metrics are normalized without leaving uncovered document pixels", () => {
  const metrics = CapturePlan.normalizeMetrics({
    documentWidth: 1000.2,
    documentHeight: 1200.8,
    viewportWidth: 800.9,
    viewportHeight: 600.7,
    devicePixelRatio: 1.25,
  });

  assert.deepEqual(metrics, {
    documentWidth: 1001,
    documentHeight: 1201,
    viewportWidth: 800,
    viewportHeight: 600,
    devicePixelRatio: 1.25,
  });
});

test("invalid geometry is rejected with a stable error code", () => {
  assert.throws(
    () =>
      CapturePlan.createCapturePlan({
        documentWidth: 1000,
        documentHeight: 0,
        viewportWidth: 800,
        viewportHeight: 600,
        devicePixelRatio: 1,
      }),
    (error) => error.code === "INVALID_GEOMETRY",
  );
});

test("unsafe canvas dimensions and pixel areas fail closed", () => {
  assert.throws(
    () => CapturePlan.validateOutputDimensions(20000, 1000, 2, 2),
    (error) => error.code === "CANVAS_DIMENSION_EXCEEDED",
  );

  assert.throws(
    () => CapturePlan.validateOutputDimensions(9000, 8000, 1, 1),
    (error) => error.code === "CANVAS_AREA_EXCEEDED",
  );
});

test("oversized output is uniformly scaled to the safe canvas budget", () => {
  const plan = CapturePlan.createCapturePlan({
    documentWidth: 3840,
    documentHeight: 20000,
    viewportWidth: 3840,
    viewportHeight: 2000,
    devicePixelRatio: 1,
  });
  const profile = CapturePlan.fitOutputDimensions(
    plan.documentWidth,
    plan.documentHeight,
    1,
    1,
  );

  assert.equal(plan.segments.length, 10);
  assert.equal(profile.scaled, true);
  assert.ok(profile.outputWidth < plan.documentWidth);
  assert.ok(profile.outputHeight < plan.documentHeight);
  assert.ok(profile.outputWidth * profile.outputHeight <= 64000000);
  assert.ok(profile.outputWidth <= 32767);
  assert.ok(profile.outputHeight <= 32767);
  assert.equal(profile.scaleX, profile.scaleY);
});

test("output fitting remains inside the pixel budget after integer rounding", () => {
  const profile = CapturePlan.fitOutputDimensions(
    75777.50963789661,
    25328.434546180673,
    2.558259521732579,
    1.8216494172347306,
  );

  assert.ok(profile.outputWidth <= 32767);
  assert.ok(profile.outputHeight <= 32767);
  assert.ok(profile.outputWidth * profile.outputHeight <= 64000000);
});

test("capture plans with excessive segment counts fail before allocation", () => {
  assert.throws(
    () =>
      CapturePlan.createCapturePlan({
        documentWidth: 1000,
        documentHeight: 1000,
        viewportWidth: 10,
        viewportHeight: 10,
        devicePixelRatio: 1,
      }),
    (error) => error.code === "TOO_MANY_SEGMENTS",
  );
});

test("download filenames include a sanitized host and deterministic timestamp", () => {
  const filename = CapturePlan.createFilename(
    "https://例子.test/report?quarter=2",
    new Date("2026-08-25T08:09:10.123Z"),
  );

  assert.equal(
    filename,
    "full-page-xn--fsqu00a.test-2026-08-25T08-09-10Z.png",
  );
});

test("download filenames accept a region prefix and reject unsafe prefixes", () => {
  const timestamp = new Date("2026-09-21T04:00:00Z");

  assert.equal(
    CapturePlan.createFilename("https://example.test/app", timestamp, "region"),
    "region-example.test-2026-09-21T04-00-00Z.png",
  );
  assert.equal(
    CapturePlan.createFilename("https://example.test/app", timestamp, "bad prefix!"),
    "full-page-example.test-2026-09-21T04-00-00Z.png",
  );
});

test("scroll adjustment returns the segment unchanged when the position is exact", () => {
  const plan = CapturePlan.createCapturePlan({
    documentWidth: 1000,
    documentHeight: 1700,
    viewportWidth: 1000,
    viewportHeight: 700,
    devicePixelRatio: 1,
  });
  const segment = plan.segments.at(-1);

  const adjusted = CapturePlan.adjustSegmentForScroll(
    segment,
    segment.x,
    segment.y,
    1000,
    700,
  );

  assert.equal(adjusted, segment);
});

test("scroll adjustment shifts the source window when the page settles short", () => {
  const plan = CapturePlan.createCapturePlan({
    documentWidth: 1000,
    documentHeight: 1700,
    viewportWidth: 1000,
    viewportHeight: 700,
    devicePixelRatio: 1,
  });
  const segment = plan.segments.at(-1);

  const adjusted = CapturePlan.adjustSegmentForScroll(
    segment,
    segment.x,
    segment.y - 0.666,
    1000,
    700,
  );

  assert.equal(adjusted.index, segment.index);
  assert.equal(adjusted.x, segment.x);
  assert.equal(adjusted.y, segment.y - 0.666);
  assert.ok(Math.abs(adjusted.sourceY - (segment.sourceY + 0.666)) < 1e-9);
  assert.equal(adjusted.destinationY, segment.destinationY);
  assert.ok(Math.abs(adjusted.height - (segment.height - 0.666)) < 1e-9);
  assert.ok(adjusted.sourceY + adjusted.height <= 700);
});

test("scroll adjustment clips the leading edge when the page settles past the target", () => {
  const plan = CapturePlan.createCapturePlan({
    documentWidth: 1000,
    documentHeight: 1700,
    viewportWidth: 1000,
    viewportHeight: 700,
    devicePixelRatio: 1,
  });
  const segment = plan.segments[1];

  const adjusted = CapturePlan.adjustSegmentForScroll(
    segment,
    segment.x,
    segment.y + 0.5,
    1000,
    700,
  );

  assert.equal(adjusted.sourceY, 0);
  assert.ok(Math.abs(adjusted.destinationY - (segment.destinationY + 0.5)) < 1e-9);
  assert.ok(Math.abs(adjusted.height - (segment.height - 0.5)) < 1e-9);
});

test("scroll adjustment rejects invalid geometry", () => {
  assert.throws(
    () => CapturePlan.adjustSegmentForScroll(null, 0, 0, 100, 100),
    (error) => error.code === "INVALID_SEGMENT",
  );
  assert.throws(
    () =>
      CapturePlan.adjustSegmentForScroll(
        { x: 0, y: 0, sourceX: 0, sourceY: 0, destinationX: 0, destinationY: 0, width: 0, height: 10 },
        0,
        0,
        100,
        100,
      ),
    (error) => error.code === "INVALID_GEOMETRY",
  );
  assert.throws(
    () =>
      CapturePlan.adjustSegmentForScroll(
        { x: 0, y: 0, sourceX: 0, sourceY: 0, destinationX: 0, destinationY: 0, width: 10, height: 10 },
        Number.NaN,
        0,
        100,
        100,
      ),
    (error) => error.code === "INVALID_SEGMENT",
  );
});
