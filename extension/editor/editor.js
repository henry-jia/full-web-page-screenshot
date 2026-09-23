(function installCaptureEditor() {
  "use strict";

  const t = FwpsI18n.createBrowserTranslator(browser);

  const wrap = document.getElementById("canvas-wrap");
  const baseCanvas = document.getElementById("base-canvas");
  const overlayCanvas = document.getElementById("overlay-canvas");
  const statusLabel = document.getElementById("editor-status");
  const savedPath = document.getElementById("saved-path");
  const undoButton = document.getElementById("undo-button");
  const redoButton = document.getElementById("redo-button");
  const saveButton = document.getElementById("save-button");
  const zoomInButton = document.getElementById("zoom-in");
  const zoomOutButton = document.getElementById("zoom-out");
  const zoomFitButton = document.getElementById("zoom-fit");
  const zoomLevel = document.getElementById("zoom-level");
  const textStyleBar = document.getElementById("text-style-bar");
  const textFontSelect = document.getElementById("text-font-select");
  const textSizeGroup = document.getElementById("text-size-group");
  const textColorGroup = document.getElementById("text-color-group");
  const textBgGroup = document.getElementById("text-bg-group");
  const textAlphaInput = document.getElementById("text-alpha");

  const TEXT_SIZES = { 3: 24, 6: 40, 12: 72 };
  const MOSAIC_BLOCK_SIZES = { 3: 8, 6: 12, 12: 20 };
  const BADGE_RADII = { 3: 14, 6: 20, 12: 30 };
  const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
  const MIN_DRAG_DISTANCE = 2;
  const HIGHLIGHT_ALPHA = 0.4;
  const DEFAULT_TEXT_MAX_WIDTH = 320;
  const TEXT_EDITOR_PADDING_X = 12;
  const TEXT_EDITOR_BORDER_X = 2;

  const params = new URLSearchParams(globalThis.location.search);
  const sourceUrl = params.get("src");
  const originalName = params.get("name") || "capture.png";

  let baseImage = null;
  let baseSource = null;
  let baseContext = null;
  let overlayContext = null;
  let fitScale = 1;
  let viewScale = 1;
  let zoomMode = "fit";
  const commands = [];
  const redoStack = [];
  let currentTool = "rect";
  let currentColor = "#e5484d";
  let currentLineWidth = 6;
  const textDefaults = {
    color: "#e5484d",
    size: TEXT_SIZES[6],
    fontFamily: "system-ui, sans-serif",
    background: null,
    backgroundAlpha: HIGHLIGHT_ALPHA,
    maxWidth: DEFAULT_TEXT_MAX_WIDTH,
  };
  let draft = null;
  let textSelection = [];
  let textDrag = null;
  let dragHidden = null;
  let activeTextEditor = null;
  let pan = null;
  let replayFrame = null;

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
    for (const element of document.querySelectorAll("[data-i18n-title]")) {
      element.setAttribute("title", t(element.dataset.i18nTitle));
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

  function measureText(command) {
    return FwpsAnnotate.measureTextBlock(baseContext, command);
  }

  function clearOverlay() {
    if (!overlayContext) {
      return;
    }
    overlayContext.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  }

  function renderSelection() {
    if (dragHidden) {
      return;
    }
    clearOverlay();
    updateTextStyleBar();
    if (textSelection.length === 0) {
      return;
    }
    overlayContext.save();
    overlayContext.setLineDash([5, 4]);
    overlayContext.strokeStyle = "#4c9aff";
    overlayContext.lineWidth = 1.5;
    for (const command of textSelection) {
      const metrics = measureText(command);
      overlayContext.strokeRect(
        command.x - 4,
        command.y - 4,
        metrics.width + 8,
        metrics.height + 8,
      );
    }
    overlayContext.restore();
  }

  function replay() {
    const visible = dragHidden
      ? commands.filter((command) => !dragHidden.has(command))
      : commands;
    FwpsAnnotate.replayCommands(baseContext, baseSource || baseImage, visible, {
      createCanvas: createScratchCanvas,
      sourceCanvas: baseCanvas,
    });
    undoButton.disabled = commands.length === 0;
    redoButton.disabled = redoStack.length === 0;
    textSelection = textSelection.filter((command) => commands.includes(command));
    renderSelection();
  }

  function scheduleReplay() {
    if (typeof globalThis.requestAnimationFrame !== "function") {
      replay();
      return;
    }
    if (replayFrame !== null) {
      return;
    }
    replayFrame = globalThis.requestAnimationFrame(() => {
      replayFrame = null;
      replay();
    });
  }

  function renderDragPreview() {
    if (!textDrag) {
      return;
    }
    clearOverlay();
    overlayContext.save();
    for (const { command } of textDrag.originals) {
      FwpsAnnotate.drawCommand(overlayContext, command);
    }
    overlayContext.setLineDash([5, 4]);
    overlayContext.strokeStyle = "#4c9aff";
    overlayContext.lineWidth = 1.5;
    for (const { command } of textDrag.originals) {
      const metrics = measureText(command);
      overlayContext.strokeRect(
        command.x - 4,
        command.y - 4,
        metrics.width + 8,
        metrics.height + 8,
      );
    }
    overlayContext.restore();
  }

  function applyScale() {
    if (!baseImage) {
      return;
    }
    viewScale = zoomMode === "fit" ? fitScale : zoomMode;
    const cssWidth = `${Math.round(baseCanvas.width * viewScale)}px`;
    const cssHeight = `${Math.round(baseCanvas.height * viewScale)}px`;
    baseCanvas.style.width = cssWidth;
    baseCanvas.style.height = cssHeight;
    overlayCanvas.style.width = cssWidth;
    overlayCanvas.style.height = cssHeight;
    zoomLevel.textContent = `${Math.round(viewScale * 100)}%`;
    updateTextStyleBar();
  }

  function refit() {
    if (!baseImage) {
      return;
    }
    fitScale = Math.min(
      1,
      (wrap.clientWidth - 4) / baseCanvas.width,
      (wrap.clientHeight - 4) / baseCanvas.height,
    );
    applyScale();
  }

  function stepZoom(direction) {
    const current = viewScale;
    const next =
      direction > 0
        ? ZOOM_STEPS.find((step) => step > current + 0.001) || ZOOM_STEPS[ZOOM_STEPS.length - 1]
        : [...ZOOM_STEPS].reverse().find((step) => step < current - 0.001) || ZOOM_STEPS[0];
    zoomMode = next;
    applyScale();
  }

  function zoomAtPointer(direction, event) {
    const rect = wrap.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    const contentX = wrap.scrollLeft + offsetX;
    const contentY = wrap.scrollTop + offsetY;
    const ratioX = contentX / Math.max(1, baseCanvas.width * viewScale);
    const ratioY = contentY / Math.max(1, baseCanvas.height * viewScale);

    stepZoom(direction);

    wrap.scrollLeft = ratioX * baseCanvas.width * viewScale - offsetX;
    wrap.scrollTop = ratioY * baseCanvas.height * viewScale - offsetY;
  }

  function toImagePoint(event) {
    const rect = overlayCanvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / viewScale,
      y: (event.clientY - rect.top) / viewScale,
    };
  }

  function pushCommand(command) {
    commands.push(command);
    redoStack.length = 0;
    replay();
  }

  function removeCommand(command) {
    const index = commands.indexOf(command);
    if (index >= 0) {
      commands.splice(index, 1);
      redoStack.length = 0;
      replay();
    }
  }

  function nextBadgeNumber() {
    return commands.filter((command) => command.type === "badge").length + 1;
  }

  function hitTestText(point) {
    for (let index = commands.length - 1; index >= 0; index -= 1) {
      const command = commands[index];
      if (command.type !== "text") {
        continue;
      }
      const metrics = measureText(command);
      if (
        point.x >= command.x - 4 &&
        point.x <= command.x + metrics.width + 4 &&
        point.y >= command.y - 4 &&
        point.y <= command.y + metrics.height + 4
      ) {
        return command;
      }
    }
    return null;
  }

  function styleOf(source) {
    return {
      color: source.color,
      size: source.size,
      fontFamily: source.fontFamily,
      background: source.background || null,
      backgroundAlpha: Number.isFinite(source.backgroundAlpha)
        ? source.backgroundAlpha
        : HIGHLIGHT_ALPHA,
    };
  }

  function rgba(hex, alpha) {
    const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex));
    if (!match) {
      return "";
    }
    const r = parseInt(match[1], 16);
    const g = parseInt(match[2], 16);
    const b = parseInt(match[3], 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function markActiveWithin(root, attribute, value) {
    if (!root || typeof root.querySelectorAll !== "function") {
      return;
    }
    for (const button of root.querySelectorAll("button")) {
      const active = button.dataset[attribute] === String(value);
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }

  function updateTextStyleBar() {
    const source = activeTextEditor ? activeTextEditor.source : null;
    if (!source) {
      textStyleBar.hidden = true;
      return;
    }
    textStyleBar.hidden = false;
    textStyleBar.style.left = `${Math.max(4, source.x * viewScale)}px`;
    textStyleBar.style.top = `${Math.max(4, source.y * viewScale - 56)}px`;
    textFontSelect.value = source.fontFamily;
    markActiveWithin(textSizeGroup, "textsize", source.size);
    markActiveWithin(textColorGroup, "color", source.color);
    markActiveWithin(textBgGroup, "bgcolor", source.background || "");
    textAlphaInput.value = String(Math.round(styleOf(source).backgroundAlpha * 100));
  }

  function refreshTextEditorElement() {
    if (!activeTextEditor) {
      return;
    }
    const { element, source } = activeTextEditor;
    element.style.color = source.color;
    element.style.fontSize = `${source.size * viewScale}px`;
    element.style.fontFamily = source.fontFamily;
    element.style.background = source.background
      ? rgba(source.background, styleOf(source).backgroundAlpha)
      : "";
  }

  function applyTextStyle(mutator) {
    if (!activeTextEditor) {
      return;
    }
    mutator(activeTextEditor.source);
    Object.assign(textDefaults, styleOf(activeTextEditor.source));
    refreshTextEditorElement();
    if (activeTextEditor.command) {
      scheduleReplay();
    } else {
      updateTextStyleBar();
    }
  }

  function openTextEditor(point, existingCommand) {
    commitTextEditor();

    const textarea = document.createElement("textarea");
    textarea.className = "text-editor";
    const source = existingCommand || {
      x: point.x,
      y: point.y,
      ...styleOf(textDefaults),
      maxWidth: textDefaults.maxWidth,
    };
    textarea.value = existingCommand ? existingCommand.text : "";
    textarea.style.left = `${source.x * viewScale}px`;
    textarea.style.top = `${source.y * viewScale}px`;
    const maxWidth = Number.isFinite(source.maxWidth) && source.maxWidth > 0
      ? source.maxWidth
      : DEFAULT_TEXT_MAX_WIDTH;
    textarea.style.width = `${maxWidth * viewScale + TEXT_EDITOR_PADDING_X + TEXT_EDITOR_BORDER_X}px`;
    if (baseImage) {
      textarea.style.maxWidth = `${Math.max(40, (baseCanvas.width - source.x) * viewScale)}px`;
      textarea.style.maxHeight = `${Math.max(20, (baseCanvas.height - source.y) * viewScale)}px`;
    }
    textarea.addEventListener("input", () => {
      if (!Number.isFinite(textarea.scrollHeight)) {
        return;
      }
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
    });
    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        commitTextEditor();
      } else if (event.key === "Escape") {
        event.preventDefault();
        cancelTextEditor();
      }
    });
    wrap.appendChild(textarea);
    activeTextEditor = { element: textarea, command: existingCommand || null, source };
    refreshTextEditorElement();
    textarea.focus();
    globalThis.setTimeout(() => {
      if (activeTextEditor && activeTextEditor.element === textarea) {
        textarea.focus();
      }
    }, 0);
    updateTextStyleBar();
  }

  function discardTextEditorElement() {
    if (!activeTextEditor) {
      return;
    }
    const { element } = activeTextEditor;
    activeTextEditor = null;
    element.remove();
    updateTextStyleBar();
  }

  function cancelTextEditor() {
    discardTextEditorElement();
  }

  function editorMaxWidth(element) {
    const inner = element.clientWidth - TEXT_EDITOR_PADDING_X;
    if (!Number.isFinite(inner) || inner <= 0 || viewScale <= 0) {
      return null;
    }
    return inner / viewScale;
  }

  function commitTextEditor() {
    if (!activeTextEditor) {
      return;
    }
    const { element, command, source } = activeTextEditor;
    const value = element.value.trim();
    const maxWidth = editorMaxWidth(element);
    discardTextEditorElement();

    if (maxWidth) {
      textDefaults.maxWidth = maxWidth;
    }

    if (command) {
      if (value) {
        command.text = value;
        if (maxWidth) {
          command.maxWidth = maxWidth;
        }
        replay();
      } else {
        removeCommand(command);
      }
      return;
    }

    if (value && baseImage) {
      pushCommand({
        type: "text",
        x: source.x,
        y: source.y,
        text: value,
        ...styleOf(source),
        ...(maxWidth ? { maxWidth } : {}),
      });
    }
  }

  function deleteSelectedText() {
    if (textSelection.length === 0) {
      return;
    }
    for (const command of textSelection) {
      const index = commands.indexOf(command);
      if (index >= 0) {
        commands.splice(index, 1);
      }
    }
    textSelection = [];
    redoStack.length = 0;
    replay();
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

  function markActive(groupId, attribute, value) {
    for (const button of document.querySelectorAll(`#${groupId} button`)) {
      const active = button.dataset[attribute] === String(value);
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }

  function selectTool(tool) {
    currentTool = tool;
    commitTextEditor();
    overlayCanvas.style.cursor = "";
    if (tool !== "text") {
      textSelection = [];
      renderSelection();
    }
    markActive("tool-group", "tool", tool);
    setStatus(t(tool === "text" ? "editor_text_hint" : "editor_hint"));
  }

  function undo() {
    if (commands.length === 0) {
      return;
    }
    redoStack.push(commands.pop());
    replay();
  }

  function redo() {
    if (redoStack.length === 0) {
      return;
    }
    commands.push(redoStack.pop());
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

  function handleTextPointerDown(point, event) {
    const hit = hitTestText(point);

    if (hit) {
      if (event.ctrlKey || event.metaKey) {
        if (textSelection.includes(hit)) {
          textSelection = textSelection.filter((command) => command !== hit);
        } else {
          textSelection = [...textSelection, hit];
        }
        renderSelection();
        return;
      }

      if (!textSelection.includes(hit)) {
        textSelection = [hit];
      }
      textDrag = {
        startX: point.x,
        startY: point.y,
        moved: false,
        originals: textSelection.map((command) => ({
          command,
          x: command.x,
          y: command.y,
        })),
      };
      renderSelection();
      return;
    }

    textSelection = [];
    renderSelection();
    openTextEditor(point, null);
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
    textFontSelect.addEventListener("change", () => {
      applyTextStyle((source) => {
        source.fontFamily = textFontSelect.value;
      });
    });
    textSizeGroup.addEventListener("click", (event) => {
      const size = event.target.dataset && event.target.dataset.textsize;
      if (size) {
        applyTextStyle((source) => {
          source.size = Number(size);
        });
      }
    });
    textColorGroup.addEventListener("click", (event) => {
      const color = event.target.dataset && event.target.dataset.color;
      if (color) {
        applyTextStyle((source) => {
          source.color = color;
        });
      }
    });
    textBgGroup.addEventListener("click", (event) => {
      const background = event.target.dataset && event.target.dataset.bgcolor;
      if (background !== undefined && background !== null) {
        applyTextStyle((source) => {
          source.background = background || null;
        });
      }
    });
    textAlphaInput.addEventListener("input", () => {
      const alpha = Number(textAlphaInput.value);
      if (Number.isFinite(alpha)) {
        applyTextStyle((source) => {
          source.backgroundAlpha = alpha / 100;
        });
      }
    });
    undoButton.addEventListener("click", undo);
    redoButton.addEventListener("click", redo);
    saveButton.addEventListener("click", save);
    zoomInButton.addEventListener("click", () => stepZoom(1));
    zoomOutButton.addEventListener("click", () => stepZoom(-1));
    zoomFitButton.addEventListener("click", () => {
      zoomMode = "fit";
      applyScale();
    });
    globalThis.addEventListener("keydown", (event) => {
      if (activeTextEditor && event.target === activeTextEditor.element) {
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        deleteSelectedText();
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "z" && event.shiftKey) {
        event.preventDefault();
        redo();
      } else if (key === "z") {
        event.preventDefault();
        undo();
      } else if (key === "y") {
        event.preventDefault();
        redo();
      }
    });
  }

  function wireCanvas() {
    document.addEventListener(
      "pointerdown",
      (event) => {
        const onStyleBar =
          event.target === textStyleBar ||
          (typeof textStyleBar.contains === "function" && textStyleBar.contains(event.target));
        if (activeTextEditor && event.target !== activeTextEditor.element && !onStyleBar) {
          commitTextEditor();
        }
      },
      true,
    );
    overlayCanvas.addEventListener("pointerdown", (event) => {
      if (!baseImage || (event.button || 0) !== 0) {
        return;
      }
      event.preventDefault();
      const point = toImagePoint(event);

      if (currentTool === "text") {
        handleTextPointerDown(point, event);
        return;
      }

      commitTextEditor();
      if (currentTool === "badge") {
        pushCommand({
          type: "badge",
          x: point.x,
          y: point.y,
          number: nextBadgeNumber(),
          color: currentColor,
          radius: BADGE_RADII[currentLineWidth] || 20,
        });
        return;
      }
      draft = { start: point, current: point };
      overlayCanvas.setPointerCapture(event.pointerId);
    });
    overlayCanvas.addEventListener("pointermove", (event) => {
      const point = toImagePoint(event);
      if (currentTool === "text" && !textDrag) {
        overlayCanvas.style.cursor = hitTestText(point) ? "move" : "";
      }
      if (textDrag) {
        const dx = point.x - textDrag.startX;
        const dy = point.y - textDrag.startY;
        if (!textDrag.moved && Math.hypot(dx, dy) < MIN_DRAG_DISTANCE) {
          return;
        }
        if (!textDrag.moved) {
          textDrag.moved = true;
          dragHidden = new Set(
            textDrag.originals.map((original) => original.command),
          );
          replay();
        }
        for (const original of textDrag.originals) {
          original.command.x = original.x + dx;
          original.command.y = original.y + dy;
        }
        renderDragPreview();
        return;
      }
      if (!draft) {
        return;
      }
      draft.current = point;
      renderDraft();
    });
    overlayCanvas.addEventListener("pointerup", (event) => {
      if (textDrag) {
        if (textDrag.moved) {
          redoStack.length = 0;
          dragHidden = null;
          replay();
        }
        textDrag = null;
        return;
      }
      if (!draft) {
        return;
      }
      draft.current = toImagePoint(event);
      const command = buildDragCommand(currentTool, draft.start, draft.current);
      draft = null;
      clearOverlay();
      if (command) {
        pushCommand(command);
      }
    });
    overlayCanvas.addEventListener("dblclick", (event) => {
      if (currentTool !== "text") {
        return;
      }
      const hit = hitTestText(toImagePoint(event));
      if (hit) {
        textSelection = [hit];
        openTextEditor({ x: hit.x, y: hit.y }, hit);
      }
    });
    overlayCanvas.addEventListener(
      "wheel",
      (event) => {
        if (!baseImage || !(event.ctrlKey || event.metaKey)) {
          return;
        }
        event.preventDefault();
        zoomAtPointer(event.deltaY < 0 ? 1 : -1, event);
      },
      { passive: false },
    );
    wrap.addEventListener("contextmenu", (event) => {
      event.preventDefault();
    });
    wrap.addEventListener("pointerdown", (event) => {
      if ((event.button || 0) !== 2 || !baseImage) {
        return;
      }
      pan = {
        startX: event.clientX,
        startY: event.clientY,
        scrollLeft: wrap.scrollLeft,
        scrollTop: wrap.scrollTop,
      };
      wrap.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    wrap.addEventListener("pointermove", (event) => {
      if (!pan) {
        return;
      }
      wrap.scrollLeft = pan.scrollLeft - (event.clientX - pan.startX);
      wrap.scrollTop = pan.scrollTop - (event.clientY - pan.startY);
    });
    wrap.addEventListener("pointerup", () => {
      pan = null;
    });
    wrap.addEventListener("pointercancel", () => {
      pan = null;
    });
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
      baseSource = createScratchCanvas(image.naturalWidth, image.naturalHeight);
      baseSource.getContext("2d").drawImage(image, 0, 0);
      baseCanvas.width = image.naturalWidth;
      baseCanvas.height = image.naturalHeight;
      overlayCanvas.width = image.naturalWidth;
      overlayCanvas.height = image.naturalHeight;
      baseContext = baseCanvas.getContext("2d");
      overlayContext = overlayCanvas.getContext("2d");
      replay();
      refit();
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
  globalThis.addEventListener("resize", () => {
    if (zoomMode === "fit") {
      refit();
    }
  });
  loadImage();
})();
