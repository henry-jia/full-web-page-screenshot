(function installCaptureEditor() {
  "use strict";

  const t = FwpsI18n.createBrowserTranslator(browser);

  const wrap = document.getElementById("canvas-wrap");
  const baseCanvas = document.getElementById("base-canvas");
  const overlayCanvas = document.getElementById("overlay-canvas");
  const textInput = document.getElementById("text-input");
  const statusLabel = document.getElementById("editor-status");
  const savedPath = document.getElementById("saved-path");
  const undoButton = document.getElementById("undo-button");
  const saveButton = document.getElementById("save-button");

  const STROKE_WIDTHS = [3, 6, 12];
  const TEXT_SIZES = { 3: 16, 6: 24, 12: 36 };
  const MOSAIC_BLOCK_SIZES = { 3: 8, 6: 12, 12: 20 };
  const MIN_DRAG_DISTANCE = 2;

  const params = new URLSearchParams(globalThis.location.search);
  const sourceUrl = params.get("src");
  const originalName = params.get("name") || "capture.png";

  let baseImage = null;
  let baseContext = null;
  let overlayContext = null;
  let displayScale = 1;
  const commands = [];
  let currentTool = "rect";
  let currentColor = "#e5484d";
  let currentLineWidth = 6;
  let draft = null;

  function localize() {
    try {
      document.documentElement.lang = browser.i18n.getUILanguage();
    } catch {
    }
    for (const element of document.querySelectorAll("[data-i18n]")) {
      element.textContent = t(element.dataset.i18n);
    }
    for (const element of document.querySelectorAll("[data-i18n-placeholder]")) {
      element.setAttribute("placeholder", t(element.dataset.i18nPlaceholder));
    }
  }

  function setStatus(message) {
    statusLabel.textContent = message || "";
  }

  function createScratchCanvas(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  function replay() {
    FwpsAnnotate.replayCommands(baseContext, baseImage, commands, {
      createCanvas: createScratchCanvas,
      sourceCanvas: baseCanvas,
    });
    undoButton.disabled = commands.length === 0;
  }

  function fitToWindow() {
    if (!baseImage) {
      return;
    }
    const availableWidth = wrap.clientWidth - 4;
    const availableHeight = wrap.clientHeight - 4;
    displayScale = Math.min(
      1,
      availableWidth / baseCanvas.width,
      availableHeight / baseCanvas.height,
    );
    const cssWidth = `${Math.round(baseCanvas.width * displayScale)}px`;
    const cssHeight = `${Math.round(baseCanvas.height * displayScale)}px`;
    baseCanvas.style.width = cssWidth;
    baseCanvas.style.height = cssHeight;
    overlayCanvas.style.width = cssWidth;
    overlayCanvas.style.height = cssHeight;
  }

  function toImagePoint(event) {
    const rect = overlayCanvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / displayScale,
      y: (event.clientY - rect.top) / displayScale,
    };
  }

  function buildDragCommand(tool, start, current) {
    if (tool === "rect" || tool === "ellipse" || tool === "mosaic") {
      const rect = FwpsAnnotate.normalizeRect(start.x, start.y, current.x, current.y);
      if (rect.width < MIN_DRAG_DISTANCE || rect.height < MIN_DRAG_DISTANCE) {
        return null;
      }
      if (tool === "mosaic") {
        return {
          type: "mosaic",
          ...rect,
          blockSize: MOSAIC_BLOCK_SIZES[currentLineWidth] || 12,
        };
      }
      return { type: tool, ...rect, color: currentColor, lineWidth: currentLineWidth };
    }

    if (tool === "line" || tool === "arrow") {
      if (Math.hypot(current.x - start.x, current.y - start.y) < MIN_DRAG_DISTANCE) {
        return null;
      }
      return {
        type: tool,
        x1: start.x,
        y1: start.y,
        x2: current.x,
        y2: current.y,
        color: currentColor,
        lineWidth: currentLineWidth,
      };
    }

    return null;
  }

  function clearOverlay() {
    overlayContext.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  }

  function renderDraft() {
    clearOverlay();
    if (!draft) {
      return;
    }
    const command = buildDragCommand(currentTool, draft.start, draft.current);
    if (!command) {
      return;
    }
    overlayContext.save();
    overlayContext.setLineDash([6, 4]);
    if (command.type === "mosaic") {
      overlayContext.strokeStyle = currentColor;
      overlayContext.lineWidth = 2;
      overlayContext.strokeRect(command.x, command.y, command.width, command.height);
    } else {
      FwpsAnnotate.drawCommand(overlayContext, command);
    }
    overlayContext.restore();
  }

  function openTextInput(point) {
    textInput.hidden = false;
    textInput.value = "";
    textInput.style.left = `${point.x * displayScale}px`;
    textInput.style.top = `${point.y * displayScale}px`;
    textInput.style.color = currentColor;
    textInput.style.fontSize = `${(TEXT_SIZES[currentLineWidth] || 24) * displayScale}px`;
    textInput.dataset.imageX = String(point.x);
    textInput.dataset.imageY = String(point.y);
    textInput.focus();
  }

  function commitTextInput() {
    const value = textInput.value.trim();
    textInput.hidden = true;
    if (!value) {
      return;
    }
    commands.push({
      type: "text",
      x: Number(textInput.dataset.imageX),
      y: Number(textInput.dataset.imageY),
      text: value,
      color: currentColor,
      size: TEXT_SIZES[currentLineWidth] || 24,
    });
    replay();
  }

  function markActive(groupId, attribute, value) {
    for (const button of document.querySelectorAll(`#${groupId} button`)) {
      const active = button.dataset[attribute] === String(value);
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }

  function selectTool(tool) {
    currentTool = tool;
    textInput.hidden = true;
    markActive("tool-group", "tool", tool);
  }

  function undo() {
    if (commands.length === 0) {
      return;
    }
    commands.pop();
    replay();
  }

  function editedFilename() {
    const base = originalName.replace(/\.png$/i, "");
    return `${base}-edited.png`;
  }

  async function save() {
    if (!baseImage) {
      return;
    }
    saveButton.disabled = true;
    savedPath.textContent = "";
    setStatus(t("editor_saving"));

    try {
      const blob = await new Promise((resolve, reject) => {
        baseCanvas.toBlob((result) => {
          if (result) {
            resolve(result);
          } else {
            reject(new Error("PNG encode failed."));
          }
        }, "image/png");
      });
      const url = URL.createObjectURL(blob);
      let downloadId;
      try {
        downloadId = await browser.downloads.download({
          url,
          filename: editedFilename(),
          saveAs: false,
        });
      } finally {
        globalThis.setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
      const items = await browser.downloads.search({ id: downloadId });
      const savedAs = items && items[0] && items[0].filename
        ? items[0].filename
        : editedFilename();
      setStatus(t("editor_saved_at"));
      savedPath.textContent = savedAs;
    } catch (error) {
      setStatus(t("editor_save_failed"));
    } finally {
      saveButton.disabled = false;
    }
  }

  function wireToolbar() {
    document.getElementById("tool-group").addEventListener("click", (event) => {
      const tool = event.target.dataset && event.target.dataset.tool;
      if (tool) {
        selectTool(tool);
      }
    });
    document.getElementById("color-group").addEventListener("click", (event) => {
      const color = event.target.dataset && event.target.dataset.color;
      if (color) {
        currentColor = color;
        markActive("color-group", "color", color);
      }
    });
    document.getElementById("size-group").addEventListener("click", (event) => {
      const width = event.target.dataset && event.target.dataset.linewidth;
      if (width) {
        currentLineWidth = Number(width);
        markActive("size-group", "linewidth", width);
      }
    });
    undoButton.addEventListener("click", undo);
    saveButton.addEventListener("click", save);
    globalThis.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
      }
    });
  }

  function wireCanvas() {
    overlayCanvas.addEventListener("pointerdown", (event) => {
      if (!baseImage) {
        return;
      }
      const point = toImagePoint(event);
      if (currentTool === "text") {
        openTextInput(point);
        return;
      }
      draft = { start: point, current: point };
      overlayCanvas.setPointerCapture(event.pointerId);
    });
    overlayCanvas.addEventListener("pointermove", (event) => {
      if (!draft) {
        return;
      }
      draft.current = toImagePoint(event);
      renderDraft();
    });
    overlayCanvas.addEventListener("pointerup", (event) => {
      if (!draft) {
        return;
      }
      draft.current = toImagePoint(event);
      const command = buildDragCommand(currentTool, draft.start, draft.current);
      draft = null;
      clearOverlay();
      if (command) {
        commands.push(command);
        replay();
      }
    });
    textInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commitTextInput();
      } else if (event.key === "Escape") {
        event.preventDefault();
        textInput.hidden = true;
      }
    });
    textInput.addEventListener("blur", commitTextInput);
  }

  function loadImage() {
    if (!sourceUrl) {
      setStatus(t("editor_load_failed"));
      saveButton.disabled = true;
      return;
    }

    const image = new Image();
    image.onload = () => {
      baseImage = image;
      baseCanvas.width = image.naturalWidth;
      baseCanvas.height = image.naturalHeight;
      overlayCanvas.width = image.naturalWidth;
      overlayCanvas.height = image.naturalHeight;
      baseContext = baseCanvas.getContext("2d");
      overlayContext = overlayCanvas.getContext("2d");
      replay();
      fitToWindow();
    };
    image.onerror = () => {
      setStatus(t("editor_load_failed"));
      saveButton.disabled = true;
    };
    image.src = sourceUrl;
  }

  localize();
  wireToolbar();
  wireCanvas();
  selectTool("rect");
  markActive("color-group", "color", currentColor);
  markActive("size-group", "linewidth", currentLineWidth);
  globalThis.addEventListener("resize", fitToWindow);
  loadImage();
})();
