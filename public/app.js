(function () {
  const state = {
    token: null,
    ws: null,
    session: null,
    currentMember: null,
    currentTool: "pen",
    selectedItemId: null,
    currentColor: "#0f172a",
    currentWidth: 3,
    shapeAssistEnabled: true,
    theme: localStorage.getItem("livecollab-theme") || "light",
    boardItems: [],
    draftPoints: [],
    drawing: false,
    dragState: null,
    clientId: Math.random().toString(36).slice(2),
    deviceScale: window.devicePixelRatio || 1
  };

  const tools = [
    { id: "select", icon: "⬚", label: "Select" },
    { id: "pen", icon: "✎", label: "Pen" },
    { id: "line", icon: "／", label: "Line" },
    { id: "rectangle", icon: "▭", label: "Rectangle" },
    { id: "ellipse", icon: "◯", label: "Ellipse" },
    { id: "arrow", icon: "➜", label: "Arrow" },
    { id: "eraser", icon: "⌦", label: "Eraser" }
  ];
  const colors = ["#0f172a", "#cb4b16", "#236a4b", "#2563eb", "#be123c", "#7c3aed", "#111827", "#ffffff"];
  const widths = [2, 3, 5, 8, 12];
  const appEls = {
    authPanel: document.getElementById("authPanel"),
    authStatus: document.getElementById("authStatus"),
    workspace: document.getElementById("workspace"),
    createForm: document.getElementById("createForm"),
    joinForm: document.getElementById("joinForm"),
    authTabs: Array.from(document.querySelectorAll("[data-auth-tab]")),
    authTabTriggers: Array.from(document.querySelectorAll("[data-auth-tab-trigger]")),
    authPanels: {
      create: document.getElementById("createPanel"),
      join: document.getElementById("joinPanel")
    },
    addChartBtn: document.getElementById("addChartBtn"),
    chartModal: document.getElementById("chartModal"),
    chartForm: document.getElementById("chartForm"),
    closeChartModalBtn: document.getElementById("closeChartModalBtn"),
    toolButtons: document.getElementById("toolButtons"),
    colorPalette: document.getElementById("colorPalette"),
    customColorPicker: document.getElementById("customColorPicker"),
    widthButtons: document.getElementById("widthButtons"),
    shapeAssistToggle: document.getElementById("shapeAssistToggle"),
    deleteSelectionBtn: document.getElementById("deleteSelectionBtn"),
    clearBtn: document.getElementById("clearBtn"),
    undoBtn: document.getElementById("undoBtn"),
    membersList: document.getElementById("membersList"),
    permissionsLegend: document.getElementById("permissionsLegend"),
    sessionTitle: document.getElementById("sessionTitle"),
    sessionIdText: document.getElementById("sessionIdText"),
    shareLinkInput: document.getElementById("shareLinkInput"),
    copyLinkBtn: document.getElementById("copyLinkBtn"),
    themeToggle: document.getElementById("themeToggle"),
    themeToggleIcon: document.getElementById("themeToggleIcon"),
    currentRole: document.getElementById("currentRole"),
    statusBar: document.getElementById("statusBar"),
    canvas: document.getElementById("board")
  };

  const ctx = appEls.canvas.getContext("2d");
  let pickr = null;
  const chartImageCache = new Map();
  const chartRenderJobs = new Map();

  function switchAuthTab(tab) {
    const nextTab = tab === "join" ? "join" : "create";

    appEls.authTabs.forEach((button) => {
      const active = button.dataset.authTab === nextTab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });

    Object.entries(appEls.authPanels).forEach(([panelName, panel]) => {
      const active = panelName === nextTab;
      panel.classList.toggle("hidden", !active);
      panel.classList.toggle("active", active);
    });
  }

  function can(permission) {
    const role = state.currentMember?.role;
    return Boolean(role && state.session?.permissions?.[role]?.[permission]);
  }

  function setStatus(text, error) {
    appEls.statusBar.textContent = text;
    appEls.statusBar.style.color = error ? "var(--danger)" : "var(--success)";

    if (appEls.authPanel.classList.contains("hidden")) {
      appEls.authStatus.classList.add("hidden");
      return;
    }

    appEls.authStatus.textContent = text;
    appEls.authStatus.classList.remove("hidden", "error", "success");
    appEls.authStatus.classList.add(error ? "error" : "success");
  }

  function clearAuthStatus() {
    appEls.authStatus.textContent = "";
    appEls.authStatus.classList.add("hidden");
    appEls.authStatus.classList.remove("error", "success");
  }

  function formatPermissionLabel(permission) {
    switch (permission) {
      case "draw":
        return "Draw";
      case "erase":
        return "Erase";
      case "manageMembers":
        return "Manage members";
      case "clearBoard":
        return "Clear board";
      default:
        return permission;
    }
  }

  function permissionNamesForRole(role) {
    return Object.entries(state.session?.permissions?.[role] || {})
      .filter(([, allowed]) => allowed)
      .map(([permission]) => formatPermissionLabel(permission));
  }

  function renderPermissionChips(container, role) {
    const names = permissionNamesForRole(role);
    names.forEach((name) => {
      const chip = document.createElement("span");
      chip.className = "permission-chip enabled";
      chip.textContent = name;
      container.appendChild(chip);
    });
  }

  function renderPermissionsLegend() {
    if (!state.session) {
      return;
    }
    appEls.permissionsLegend.innerHTML = "";
    permissionNamesForRole(state.currentMember.role).forEach((name) => {
      const chip = document.createElement("span");
      chip.className = "permission-chip enabled";
      chip.textContent = name;
      appEls.permissionsLegend.appendChild(chip);
    });
  }

  function buildToolButtons() {
    tools.forEach((tool) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = tool.icon;
      button.title = tool.label;
      button.setAttribute("aria-label", tool.label);
      button.className = tool.id === state.currentTool ? "active" : "";
      button.addEventListener("click", () => {
        setCurrentTool(tool.id);
      });
      appEls.toolButtons.appendChild(button);
    });
  }

  function setCurrentTool(toolId) {
    state.currentTool = toolId;
    state.drawing = false;
    state.draftPoints = [];
    if (toolId !== "select") {
      state.selectedItemId = null;
    }
    resetToolButtons();
    updatePermissionsUi();
    render();
  }

  function buildColorPalette() {
    appEls.colorPalette.innerHTML = "";
    colors.forEach((color) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = color === state.currentColor ? "swatch active" : "swatch";
      button.style.setProperty("--swatch-color", color);
      button.setAttribute("aria-label", `Select color ${color}`);
      button.title = color;
      button.addEventListener("click", () => {
        state.currentColor = color;
        buildColorPalette();
        syncPickrColor();
      });
      appEls.colorPalette.appendChild(button);
    });
  }

  function buildWidthButtons() {
    appEls.widthButtons.innerHTML = "";
    widths.forEach((width) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = width === state.currentWidth ? "width-chip active" : "width-chip";
      button.title = `Stroke width ${width}`;
      button.setAttribute("aria-label", `Stroke width ${width}`);

      const line = document.createElement("span");
      line.style.width = "22px";
      line.style.height = `${width}px`;
      button.appendChild(line);

      const label = document.createElement("strong");
      label.textContent = String(width);
      button.appendChild(label);

      button.addEventListener("click", () => {
        state.currentWidth = width;
        buildWidthButtons();
      });
      appEls.widthButtons.appendChild(button);
    });
  }

  function syncShapeAssistToggle() {
    appEls.shapeAssistToggle.classList.toggle("active", state.shapeAssistEnabled);
    appEls.shapeAssistToggle.setAttribute("aria-pressed", String(state.shapeAssistEnabled));
  }

  function syncPickrColor() {
    if (pickr) {
      pickr.setColor(state.currentColor, true);
    }
  }

  function getBoardSurfaceColor() {
    return state.theme === "dark" ? "#0f1620" : "#fffdf9";
  }

  function initCustomColorPicker() {
    if (!window.Pickr || !appEls.customColorPicker) {
      return;
    }

    pickr = window.Pickr.create({
      el: appEls.customColorPicker,
      theme: "nano",
      default: state.currentColor,
      components: {
        preview: true,
        opacity: false,
        hue: true,
        interaction: {
          hex: true,
          input: true,
          save: true
        }
      }
    });

    pickr.on("save", (color) => {
      if (!color) {
        return;
      }
      state.currentColor = color.toHEXA().toString();
      buildColorPalette();
      syncPickrColor();
      pickr.hide();
    });
  }

  function syncTheme() {
    document.body.setAttribute("data-theme", state.theme);
    appEls.themeToggle.setAttribute("aria-pressed", String(state.theme === "dark"));
    appEls.themeToggle.title = state.theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
    appEls.themeToggleIcon.textContent = state.theme === "dark" ? "☀" : "◐";
    localStorage.setItem("livecollab-theme", state.theme);
    chartImageCache.clear();
    chartRenderJobs.clear();
    render();
  }

  function buildShareLink(sessionId) {
    const url = new URL(window.location.href);
    url.searchParams.set("sessionId", sessionId);
    return url.toString();
  }

  function resetToolButtons() {
    appEls.toolButtons.innerHTML = "";
    buildToolButtons();
  }

  function resizeCanvas() {
    const rect = appEls.canvas.getBoundingClientRect();
    appEls.canvas.width = rect.width * state.deviceScale;
    appEls.canvas.height = rect.height * state.deviceScale;
    ctx.setTransform(state.deviceScale, 0, 0, state.deviceScale, 0, 0);
    render();
  }

  function getChartBounds(item) {
    return {
      x: Number(item.x ?? 96),
      y: Number(item.y ?? 88),
      width: Math.max(220, Number(item.width ?? 320)),
      height: Math.max(180, Number(item.height ?? 220))
    };
  }

  function getChartPalette() {
    if (state.theme === "dark") {
      return {
        text: "#f5f1e8",
        muted: "#b7b0a5",
        grid: "rgba(255, 245, 229, 0.12)",
        frame: "#223041",
        surface: "#111923",
        accent: "#f97316",
        fill: "rgba(249, 115, 22, 0.22)",
        series: ["#f97316", "#38bdf8", "#4ade80", "#facc15", "#fb7185", "#c084fc"]
      };
    }

    return {
      text: "#1b1d22",
      muted: "#615a52",
      grid: "rgba(27, 29, 34, 0.1)",
      frame: "#d9d1c8",
      surface: "#fffdf9",
      accent: "#cb4b16",
      fill: "rgba(203, 75, 22, 0.18)",
      series: ["#cb4b16", "#2563eb", "#236a4b", "#eab308", "#be123c", "#7c3aed"]
    };
  }

  function clearChartCacheForItem(itemId) {
    Array.from(chartImageCache.keys()).forEach((key) => {
      if (key.startsWith(`${itemId}:`)) {
        chartImageCache.delete(key);
      }
    });
    Array.from(chartRenderJobs.keys()).forEach((key) => {
      if (key.startsWith(`${itemId}:`)) {
        chartRenderJobs.delete(key);
      }
    });
  }

  function getChartCacheKey(item) {
    return `${item.id || "draft"}:${state.theme}`;
  }

  function getSelectedItem() {
    return state.boardItems.find((item) => item.id === state.selectedItemId) || null;
  }

  function canRemoveItem(item) {
    if (!item || !can("erase")) {
      return false;
    }
    return state.currentMember?.role === "admin" || item.authorId === state.currentMember?.id;
  }

  function canMoveItem(item) {
    if (!item || !can("draw")) {
      return false;
    }
    return state.currentMember?.role === "admin" || item.authorId === state.currentMember?.id;
  }

  function deleteSelectedItem() {
    const selectedItem = getSelectedItem();
    if (!canRemoveItem(selectedItem)) {
      return;
    }
    sendMessage("board:removeItem", { itemId: selectedItem.id });
  }

  function itemBounds(item) {
    if (item.kind === "stroke") {
      const points = item.points || [];
      return {
        minX: Math.min(...points.map((point) => point.x)),
        minY: Math.min(...points.map((point) => point.y)),
        maxX: Math.max(...points.map((point) => point.x)),
        maxY: Math.max(...points.map((point) => point.y))
      };
    }
    if (item.kind === "chart") {
      const bounds = getChartBounds(item);
      return {
        minX: bounds.x,
        minY: bounds.y,
        maxX: bounds.x + bounds.width,
        maxY: bounds.y + bounds.height
      };
    }
    return {
      minX: Math.min(item.start.x, item.end.x),
      minY: Math.min(item.start.y, item.end.y),
      maxX: Math.max(item.start.x, item.end.x),
      maxY: Math.max(item.start.y, item.end.y)
    };
  }

  function buildMovedItem(item, deltaX, deltaY) {
    if (item.kind === "stroke") {
      return {
        ...item,
        points: (item.points || []).map((point) => ({
          x: point.x + deltaX,
          y: point.y + deltaY
        }))
      };
    }
    if (item.kind === "chart") {
      return {
        ...item,
        x: item.x + deltaX,
        y: item.y + deltaY
      };
    }
    return {
      ...item,
      start: {
        x: item.start.x + deltaX,
        y: item.start.y + deltaY
      },
      end: {
        x: item.end.x + deltaX,
        y: item.end.y + deltaY
      }
    };
  }

  function itemUpdatePayload(item) {
    if (item.kind === "stroke") {
      return { points: item.points };
    }
    if (item.kind === "chart") {
      return { x: item.x, y: item.y };
    }
    return { start: item.start, end: item.end };
  }

  function drawChartPlaceholder(item) {
    const bounds = getChartBounds(item);
    const palette = getChartPalette();
    ctx.save();
    ctx.fillStyle = palette.surface;
    ctx.strokeStyle = palette.frame;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(bounds.x, bounds.y, bounds.width, bounds.height, 18);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = palette.text;
    ctx.font = '600 14px "Avenir Next", "Trebuchet MS", sans-serif';
    ctx.fillText(item.title || "Chart", bounds.x + 16, bounds.y + 24);
    ctx.fillStyle = palette.muted;
    ctx.font = '500 12px "Avenir Next", "Trebuchet MS", sans-serif';
    ctx.fillText("Rendering chart...", bounds.x + 16, bounds.y + 46);
    ctx.restore();
  }

  function buildChartImage(item) {
    const cacheKey = getChartCacheKey(item);
    if (chartImageCache.has(cacheKey) || chartRenderJobs.has(cacheKey) || !window.Chart) {
      return;
    }

    const bounds = getChartBounds(item);
    const palette = getChartPalette();
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bounds.width * 2);
    canvas.height = Math.round(bounds.height * 2);

    const chart = new window.Chart(canvas.getContext("2d"), {
      type: item.chartType || "bar",
      data: {
        labels: item.labels || [],
        datasets: [
          {
            label: item.datasetLabel || item.title || "Series",
            data: item.values || [],
            backgroundColor:
              item.chartType === "line"
                ? palette.fill
                : (item.values || []).map((_, index) => palette.series[index % palette.series.length]),
            borderColor:
              item.chartType === "line"
                ? palette.accent
                : (item.values || []).map((_, index) => palette.series[index % palette.series.length]),
            borderWidth: 2,
            tension: 0.32,
            fill: item.chartType === "line",
            pointRadius: item.chartType === "line" ? 3 : 0
          }
        ]
      },
      options: {
        animation: false,
        responsive: false,
        maintainAspectRatio: false,
        devicePixelRatio: 1,
        plugins: {
          legend: {
            display: item.chartType !== "bar" || Boolean(item.datasetLabel),
            labels: {
              color: palette.text,
              boxWidth: 12
            }
          },
          title: {
            display: Boolean(item.title),
            text: item.title || "",
            color: palette.text,
            font: {
              size: 14,
              weight: "600"
            }
          }
        },
        scales:
          item.chartType === "pie"
            ? {}
            : {
                x: {
                  ticks: { color: palette.muted },
                  grid: { color: palette.grid }
                },
                y: {
                  beginAtZero: true,
                  ticks: { color: palette.muted },
                  grid: { color: palette.grid }
                }
              }
      }
    });

    chartRenderJobs.set(cacheKey, true);
    chart.update();

    const image = new Image();
    image.onload = () => {
      chart.destroy();
      chartImageCache.set(cacheKey, image);
      chartRenderJobs.delete(cacheKey);
      render();
    };
    image.onerror = () => {
      chart.destroy();
      chartRenderJobs.delete(cacheKey);
    };
    image.src = canvas.toDataURL("image/png");
  }

  function drawChartItem(item) {
    const bounds = getChartBounds(item);
    const cacheKey = getChartCacheKey(item);
    const image = chartImageCache.get(cacheKey);

    if (!image) {
      buildChartImage(item);
      drawChartPlaceholder(item);
      return;
    }

    ctx.drawImage(image, bounds.x, bounds.y, bounds.width, bounds.height);
  }

  function drawSelectionOutline(item) {
    if (!item) {
      return;
    }

    const { minX, minY, maxX, maxY } = itemBounds(item);

    ctx.save();
    ctx.setLineDash([8, 6]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = state.theme === "dark" ? "#f97316" : "#cb4b16";
    ctx.strokeRect(minX - 8, minY - 8, maxX - minX + 16, maxY - minY + 16);
    ctx.restore();
  }

  function openChartModal() {
    appEls.chartModal.classList.remove("hidden");
    appEls.chartModal.setAttribute("aria-hidden", "false");
    const firstInput = appEls.chartForm.elements.namedItem("chartType");
    if (firstInput) {
      firstInput.focus();
    }
  }

  function closeChartModal() {
    appEls.chartModal.classList.add("hidden");
    appEls.chartModal.setAttribute("aria-hidden", "true");
  }

  function parseCommaSeparatedValues(value) {
    return String(value || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  function renderStrokePath(points) {
    if (points.length < 2) {
      return;
    }

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length - 1; i += 1) {
      const midX = (points[i].x + points[i + 1].x) / 2;
      const midY = (points[i].y + points[i + 1].y) / 2;
      ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
    }
    const last = points[points.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
  }

  function drawItem(item, preview = false) {
    ctx.save();
    ctx.strokeStyle = item.color || "#0f172a";
    ctx.lineWidth = item.width || 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (preview) {
      const dashSize = Math.max(8, (item.width || 3) * 3);
      const gapSize = Math.max(6, (item.width || 3) * 2.4);
      ctx.setLineDash([dashSize, gapSize]);
      ctx.globalAlpha = 0.75;
    }

    switch (item.kind) {
      case "stroke":
        renderStrokePath(item.points || []);
        break;
      case "chart":
        drawChartItem(item);
        break;
      case "line":
      case "arrow":
        ctx.beginPath();
        ctx.moveTo(item.start.x, item.start.y);
        ctx.lineTo(item.end.x, item.end.y);
        ctx.stroke();
        if (item.kind === "arrow") {
          drawArrowHead(item.start, item.end, item.color, item.width);
        }
        break;
      case "rectangle":
        ctx.strokeRect(
          Math.min(item.start.x, item.end.x),
          Math.min(item.start.y, item.end.y),
          Math.abs(item.end.x - item.start.x),
          Math.abs(item.end.y - item.start.y)
        );
        break;
      case "ellipse":
        ctx.beginPath();
        ctx.ellipse(
          (item.start.x + item.end.x) / 2,
          (item.start.y + item.end.y) / 2,
          Math.abs(item.end.x - item.start.x) / 2,
          Math.abs(item.end.y - item.start.y) / 2,
          0,
          0,
          Math.PI * 2
        );
        ctx.stroke();
        break;
      default:
        break;
    }

    ctx.restore();
  }

  function drawArrowHead(start, end, color, width) {
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const size = Math.max(10, (width || 3) * 4);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width || 3;
    ctx.beginPath();
    ctx.moveTo(end.x, end.y);
    ctx.lineTo(end.x - size * Math.cos(angle - Math.PI / 6), end.y - size * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(end.x, end.y);
    ctx.lineTo(end.x - size * Math.cos(angle + Math.PI / 6), end.y - size * Math.sin(angle + Math.PI / 6));
    ctx.stroke();
    ctx.restore();
  }

  function render() {
    const rect = appEls.canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    state.boardItems.forEach((item) => drawItem(item));
    drawSelectionOutline(getSelectedItem());

    if (state.drawing && state.draftPoints.length) {
      drawItem(buildDraftItem(), true);
    }
  }

  function getPoint(event) {
    const rect = appEls.canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function detectShape(points) {
    if (points.length < 4) {
      return null;
    }

    const start = points[0];
    const end = points[points.length - 1];
    const closed = distance(start, end) < 22;
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const box = {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys)
    };
    const width = box.maxX - box.minX;
    const height = box.maxY - box.minY;
    const aspectRatio = width / Math.max(height, 1);

    if (!closed) {
      const direct = distance(start, end);
      const travelled = points.slice(1).reduce((sum, point, index) => sum + distance(points[index], point), 0);
      if (travelled / Math.max(direct, 1) < 1.12) {
        return { kind: "line", start, end };
      }
      return null;
    }

    const corners = [
      { x: box.minX, y: box.minY },
      { x: box.maxX, y: box.minY },
      { x: box.maxX, y: box.maxY },
      { x: box.minX, y: box.maxY }
    ];
    const averageCornerDistance =
      corners.reduce((sum, corner) => {
        const nearest = Math.min(...points.map((point) => distance(point, corner)));
        return sum + nearest;
      }, 0) / corners.length;

    if (averageCornerDistance < 20) {
      return {
        kind: "rectangle",
        start: { x: box.minX, y: box.minY },
        end: { x: box.maxX, y: box.maxY }
      };
    }

    const center = { x: box.minX + width / 2, y: box.minY + height / 2 };
    const radii = points.map((point) => distance(point, center));
    const meanRadius = radii.reduce((sum, radius) => sum + radius, 0) / radii.length;
    const variance =
      radii.reduce((sum, radius) => sum + Math.abs(radius - meanRadius), 0) / Math.max(radii.length, 1);
    const normalizedVariance = variance / Math.max(meanRadius, 1);
    const sectorHits = new Set(
      points.map((point) => {
        const angle = Math.atan2(point.y - center.y, point.x - center.x) + Math.PI;
        return Math.floor((angle / (Math.PI * 2)) * 8);
      })
    ).size;

    if (
      normalizedVariance < 0.22 &&
      aspectRatio > 0.78 &&
      aspectRatio < 1.22 &&
      sectorHits >= 7 &&
      points.length > 18
    ) {
      return {
        kind: "ellipse",
        start: { x: box.minX, y: box.minY },
        end: { x: box.maxX, y: box.maxY }
      };
    }

    return null;
  }

  function buildDraftItem() {
    const color = state.currentColor;
    const width = Number(state.currentWidth);
    const start = state.draftPoints[0];
    const end = state.draftPoints[state.draftPoints.length - 1];

    switch (state.currentTool) {
      case "line":
      case "rectangle":
      case "ellipse":
      case "arrow":
        return { kind: state.currentTool, start, end, color, width };
      case "eraser":
        return { kind: "stroke", points: state.draftPoints, color: getBoardSurfaceColor(), width: width * 2 };
      default:
        return { kind: "stroke", points: state.draftPoints, color, width };
    }
  }

  function finalizeDraft() {
    const draftItem = buildDraftItem();
    let finalItem = draftItem;

    if (state.currentTool === "pen" && state.shapeAssistEnabled) {
      const detected = detectShape(state.draftPoints);
      if (detected) {
        finalItem = {
          ...detected,
          color: draftItem.color,
          width: draftItem.width
        };
      }
    }

    sendMessage("board:addItem", finalItem);
  }

  function sendMessage(type, payload) {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
      setStatus("Realtime channel unavailable", true);
      return;
    }
    state.ws.send(JSON.stringify({ type, payload }));
  }

  function connectSocket() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    state.ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    state.ws.addEventListener("open", () => {
      setStatus("Connected");
      sendMessage("auth", { token: state.token });
    });

    state.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      switch (message.type) {
        case "session:init":
          state.session = message.payload.session;
          state.currentMember = message.payload.currentMember;
          state.boardItems = state.session.boardItems || [];
          state.selectedItemId = null;
          enterWorkspace();
          render();
          break;
        case "board:itemAdded":
          state.boardItems.push(message.payload);
          updatePermissionsUi();
          render();
          break;
        case "board:itemRemoved":
          clearChartCacheForItem(message.payload.itemId);
          state.boardItems = state.boardItems.filter((item) => item.id !== message.payload.itemId);
          if (state.selectedItemId === message.payload.itemId) {
            state.selectedItemId = null;
          }
          updatePermissionsUi();
          render();
          break;
        case "board:itemUpdated":
          clearChartCacheForItem(message.payload.id);
          state.boardItems = state.boardItems.map((item) => (item.id === message.payload.id ? message.payload : item));
          updatePermissionsUi();
          render();
          break;
        case "board:cleared":
          state.boardItems = [];
          state.selectedItemId = null;
          chartImageCache.clear();
          chartRenderJobs.clear();
          updatePermissionsUi();
          render();
          break;
        case "members:update":
          state.session.members = message.payload.members;
          const current = message.payload.members.find((member) => member.id === state.currentMember?.id);
          if (current) {
            state.currentMember = current;
          }
          renderMembers();
          updatePermissionsUi();
          break;
        case "member:kicked":
          alert(message.payload.message);
          window.location.reload();
          break;
        case "error":
          setStatus(message.payload.message, true);
          break;
        default:
          break;
      }
    });

    state.ws.addEventListener("close", () => {
      setStatus("Disconnected", true);
    });
  }

  function enterWorkspace() {
    appEls.authPanel.classList.add("hidden");
    appEls.workspace.classList.remove("hidden");
    clearAuthStatus();
    appEls.sessionTitle.textContent = state.session.title;
    appEls.sessionIdText.textContent = state.session.id;
    appEls.shareLinkInput.value = buildShareLink(state.session.id);
    window.history.replaceState({}, "", `?sessionId=${encodeURIComponent(state.session.id)}`);
    renderMembers();
    updatePermissionsUi();
    resizeCanvas();
  }

  function updatePermissionsUi() {
    appEls.currentRole.textContent = `Role: ${state.currentMember.role}`;
    appEls.clearBtn.disabled = !can("clearBoard");
    appEls.undoBtn.disabled = !can("erase");
    appEls.deleteSelectionBtn.disabled = !canRemoveItem(getSelectedItem());
    renderPermissionsLegend();
  }

  function renderMembers() {
    appEls.membersList.innerHTML = "";
    (state.session.members || []).forEach((member) => {
      const row = document.createElement("article");
      row.className = "member";

      const header = document.createElement("header");
      header.innerHTML = `<strong>${member.name}</strong><small>${member.online ? "online" : "offline"}</small>`;
      row.appendChild(header);

      const info = document.createElement("div");
      info.className = "info";

      const meta = document.createElement("small");
      meta.textContent = `${member.role} · joined ${new Date(member.joinedAt).toLocaleTimeString()}`;
      info.appendChild(meta);

      const chips = document.createElement("div");
      chips.className = "permission-chips";
      renderPermissionChips(chips, member.role);
      info.appendChild(chips);
      row.appendChild(info);

      if (can("manageMembers") && member.id !== state.currentMember.id) {
        const controls = document.createElement("div");
        controls.className = "controls";

        const roleActions = document.createElement("div");
        roleActions.className = "role-actions";
        ["editor", "viewer"].forEach((role) => {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = role;
          button.className = member.role === role ? "active" : "";
          button.disabled = member.role === role;
          button.addEventListener("click", () => {
            sendMessage("member:updateRole", { memberId: member.id, role });
          });
          roleActions.appendChild(button);
        });

        const kick = document.createElement("button");
        kick.type = "button";
        kick.className = "danger";
        kick.textContent = "Kick";
        kick.addEventListener("click", () => {
          sendMessage("member:kick", { memberId: member.id });
        });

        controls.appendChild(roleActions);
        controls.appendChild(kick);
        row.appendChild(controls);
      }

      appEls.membersList.appendChild(row);
    });
  }

  function hitTest(point) {
    for (let index = state.boardItems.length - 1; index >= 0; index -= 1) {
      const item = state.boardItems[index];
      if (item.kind === "stroke") {
        const nearPoint = (item.points || []).some((candidate) => distance(candidate, point) < 12);
        if (nearPoint) {
          return item;
        }
      } else if (item.kind === "chart") {
        const bounds = getChartBounds(item);
        if (
          point.x >= bounds.x &&
          point.x <= bounds.x + bounds.width &&
          point.y >= bounds.y &&
          point.y <= bounds.y + bounds.height
        ) {
          return item;
        }
      } else {
        const minX = Math.min(item.start.x, item.end.x) - 10;
        const maxX = Math.max(item.start.x, item.end.x) + 10;
        const minY = Math.min(item.start.y, item.end.y) - 10;
        const maxY = Math.max(item.start.y, item.end.y) + 10;
        if (point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY) {
          return item;
        }
      }
    }
    return null;
  }

  appEls.canvas.addEventListener("pointerdown", (event) => {
    if (state.currentTool === "select") {
      state.drawing = false;
      state.draftPoints = [];
      const point = getPoint(event);
      const hit = hitTest(point);
      state.selectedItemId = hit?.id || null;
      if (hit && canMoveItem(hit)) {
        const bounds = itemBounds(hit);
        state.dragState = {
          itemId: hit.id,
          startPoint: point,
          originalItem: hit,
          bounds
        };
        appEls.canvas.setPointerCapture(event.pointerId);
      } else {
        state.dragState = null;
      }
      updatePermissionsUi();
      render();
      return;
    }

    if (!can("draw") && state.currentTool !== "eraser") {
      setStatus("Your role does not allow drawing", true);
      return;
    }
    if (!can("erase") && state.currentTool === "eraser") {
      setStatus("Your role does not allow erasing", true);
      return;
    }

    const point = getPoint(event);
    if (state.currentTool === "eraser") {
      const hit = hitTest(point);
      if (hit) {
        sendMessage("board:removeItem", { itemId: hit.id });
      }
      return;
    }

    state.selectedItemId = null;
    updatePermissionsUi();
    state.drawing = true;
    state.draftPoints = [point];
    appEls.canvas.setPointerCapture(event.pointerId);
    render();
  });

  appEls.canvas.addEventListener("pointermove", (event) => {
    if (state.currentTool === "select" && state.dragState) {
      const point = getPoint(event);
      const deltaX = point.x - state.dragState.startPoint.x;
      const deltaY = point.y - state.dragState.startPoint.y;
      state.boardItems = state.boardItems.map((item) =>
        item.id === state.dragState.itemId ? buildMovedItem(state.dragState.originalItem, deltaX, deltaY) : item
      );
      render();
      return;
    }
    if (!state.drawing) {
      return;
    }
    state.draftPoints.push(getPoint(event));
    render();
  });

  function finishDraw() {
    if (state.currentTool === "select" && state.dragState) {
      const movedItem = getSelectedItem();
      if (movedItem) {
        sendMessage("board:updateItem", {
          itemId: movedItem.id,
          updates: itemUpdatePayload(movedItem)
        });
      }
      state.dragState = null;
      return;
    }
    if (!state.drawing || !state.draftPoints.length) {
      return;
    }
    finalizeDraft();
    state.drawing = false;
    state.draftPoints = [];
    render();
  }

  appEls.canvas.addEventListener("pointerup", finishDraw);
  appEls.canvas.addEventListener("pointercancel", finishDraw);

  appEls.clearBtn.addEventListener("click", () => sendMessage("board:clear", {}));
  appEls.deleteSelectionBtn.addEventListener("click", () => {
    deleteSelectedItem();
  });
  appEls.undoBtn.addEventListener("click", () => {
    if (!can("erase")) {
      return;
    }
    const latestOwnItem = [...state.boardItems].reverse().find((item) => item.authorId === state.currentMember.id);
    if (latestOwnItem) {
      sendMessage("board:removeItem", { itemId: latestOwnItem.id });
    }
  });

  appEls.addChartBtn.addEventListener("click", () => {
    if (!can("draw")) {
      setStatus("Your role does not allow drawing", true);
      return;
    }
    openChartModal();
  });

  appEls.closeChartModalBtn.addEventListener("click", closeChartModal);
  appEls.chartModal.addEventListener("click", (event) => {
    if (event.target instanceof HTMLElement && event.target.dataset.closeChartModal === "true") {
      closeChartModal();
    }
  });

  appEls.chartForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!can("draw")) {
      setStatus("Your role does not allow drawing", true);
      return;
    }

    const formData = Object.fromEntries(new FormData(event.currentTarget).entries());
    const labels = parseCommaSeparatedValues(formData.labels);
    const values = parseCommaSeparatedValues(formData.values).map((entry) => Number(entry));

    if (!labels.length || labels.length !== values.length || values.some((value) => Number.isNaN(value))) {
      setStatus("Charts need matching comma-separated labels and numeric values.", true);
      return;
    }

    const boardRect = appEls.canvas.getBoundingClientRect();
    sendMessage("board:addItem", {
      kind: "chart",
      chartType: String(formData.chartType || "bar"),
      title: String(formData.title || "").trim(),
      datasetLabel: String(formData.datasetLabel || "").trim(),
      labels,
      values,
      x: Math.max(32, boardRect.width / 2 - 160),
      y: Math.max(32, boardRect.height / 2 - 110),
      width: Math.min(360, boardRect.width - 64),
      height: 220
    });

    event.currentTarget.reset();
    event.currentTarget.elements.namedItem("chartType").value = "bar";
    closeChartModal();
  });

  appEls.createForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus("Creating room...", false);
    const formData = Object.fromEntries(new FormData(event.currentTarget).entries());
    formData.displayName = String(formData.displayName || "").trim();
    formData.title = String(formData.title || "").trim();
    formData.password = String(formData.password || "");
    const response = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formData)
    });
    const data = await response.json();
    if (!response.ok) {
      setStatus(data.error || "Could not create session", true);
      return;
    }
    state.token = data.token;
    connectSocket();
  });

  appEls.joinForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus("Joining room...", false);
    const formData = Object.fromEntries(new FormData(event.currentTarget).entries());
    formData.displayName = String(formData.displayName || "").trim();
    formData.sessionId = String(formData.sessionId || "").trim();
    formData.password = String(formData.password || "");

    const response = await fetch("/api/sessions/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formData)
    });
    const data = await response.json();
    if (!response.ok) {
      setStatus(data.error || "Could not join session", true);
      return;
    }
    state.token = data.token;
    connectSocket();
  });

  appEls.copyLinkBtn.addEventListener("click", async () => {
    if (!appEls.shareLinkInput.value) {
      return;
    }
    try {
      await navigator.clipboard.writeText(appEls.shareLinkInput.value);
      setStatus("Join link copied");
    } catch (error) {
      setStatus("Unable to copy join link", true);
    }
  });

  (function hydrateJoinFormFromUrl() {
    const sessionId = new URLSearchParams(window.location.search).get("sessionId");
    if (!sessionId) {
      return;
    }
    switchAuthTab("join");
    const sessionIdInput = appEls.joinForm.elements.namedItem("sessionId");
    const passwordInput = appEls.joinForm.elements.namedItem("password");
    if (sessionIdInput) {
      sessionIdInput.value = sessionId;
    }
    if (passwordInput) {
      passwordInput.focus();
    }
    setStatus("Room link loaded. Enter your name and password to join.");
  })();

  appEls.shapeAssistToggle.addEventListener("click", () => {
    state.shapeAssistEnabled = !state.shapeAssistEnabled;
    syncShapeAssistToggle();
  });

  appEls.authTabs.forEach((button) => {
    button.addEventListener("click", () => {
      switchAuthTab(button.dataset.authTab);
    });
  });

  appEls.authTabTriggers.forEach((button) => {
    button.addEventListener("click", () => {
      switchAuthTab(button.dataset.authTabTrigger);
      const targetForm = button.dataset.authTabTrigger === "join" ? appEls.joinForm : appEls.createForm;
      targetForm.scrollIntoView({ behavior: "smooth", block: "nearest" });
      const firstInput = targetForm.querySelector("input");
      if (firstInput) {
        firstInput.focus();
      }
    });
  });

  window.addEventListener("keydown", (event) => {
    const target = event.target;
    const typingIntoField =
      target instanceof HTMLElement &&
      (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);

    if (event.key === "Escape" && !appEls.chartModal.classList.contains("hidden")) {
      closeChartModal();
      return;
    }

    if (!typingIntoField && (event.key === "Delete" || event.key === "Backspace")) {
      deleteSelectedItem();
    }
  });

  appEls.themeToggle.addEventListener("click", () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    syncTheme();
  });

  window.addEventListener("resize", resizeCanvas);

  syncTheme();
  resetToolButtons();
  buildColorPalette();
  initCustomColorPicker();
  buildWidthButtons();
  syncShapeAssistToggle();
  resizeCanvas();
})();
