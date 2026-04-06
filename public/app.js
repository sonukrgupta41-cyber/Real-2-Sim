(function () {
  const state = {
    token: null,
    ws: null,
    session: null,
    currentMember: null,
    currentTool: "pen",
    boardItems: [],
    draftPoints: [],
    drawing: false,
    clientId: Math.random().toString(36).slice(2),
    deviceScale: window.devicePixelRatio || 1
  };

  const tools = [
    { id: "pen", icon: "✎", label: "Pen" },
    { id: "line", icon: "／", label: "Line" },
    { id: "rectangle", icon: "▭", label: "Rectangle" },
    { id: "ellipse", icon: "◯", label: "Ellipse" },
    { id: "arrow", icon: "➜", label: "Arrow" },
    { id: "eraser", icon: "⌫", label: "Eraser" }
  ];
  const appEls = {
    authPanel: document.getElementById("authPanel"),
    authStatus: document.getElementById("authStatus"),
    workspace: document.getElementById("workspace"),
    createForm: document.getElementById("createForm"),
    joinForm: document.getElementById("joinForm"),
    toolButtons: document.getElementById("toolButtons"),
    colorInput: document.getElementById("colorInput"),
    widthInput: document.getElementById("widthInput"),
    shapeAssist: document.getElementById("shapeAssist"),
    clearBtn: document.getElementById("clearBtn"),
    undoBtn: document.getElementById("undoBtn"),
    membersList: document.getElementById("membersList"),
    permissionsLegend: document.getElementById("permissionsLegend"),
    sessionTitle: document.getElementById("sessionTitle"),
    sessionIdText: document.getElementById("sessionIdText"),
    shareLinkInput: document.getElementById("shareLinkInput"),
    copyLinkBtn: document.getElementById("copyLinkBtn"),
    currentRole: document.getElementById("currentRole"),
    statusBar: document.getElementById("statusBar"),
    canvas: document.getElementById("board")
  };

  const ctx = appEls.canvas.getContext("2d");

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
        state.currentTool = tool.id;
        resetToolButtons();
      });
      appEls.toolButtons.appendChild(button);
    });
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
      ctx.setLineDash([12, 10]);
      ctx.globalAlpha = 0.75;
    }

    switch (item.kind) {
      case "stroke":
        renderStrokePath(item.points || []);
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

    if (variance < 18) {
      return {
        kind: "ellipse",
        start: { x: box.minX, y: box.minY },
        end: { x: box.maxX, y: box.maxY }
      };
    }

    return null;
  }

  function buildDraftItem() {
    const color = appEls.colorInput.value;
    const width = Number(appEls.widthInput.value);
    const start = state.draftPoints[0];
    const end = state.draftPoints[state.draftPoints.length - 1];

    switch (state.currentTool) {
      case "line":
      case "rectangle":
      case "ellipse":
      case "arrow":
        return { kind: state.currentTool, start, end, color, width };
      case "eraser":
        return { kind: "stroke", points: state.draftPoints, color: "#fffdf9", width: width * 2 };
      default:
        return { kind: "stroke", points: state.draftPoints, color, width };
    }
  }

  function finalizeDraft() {
    const draftItem = buildDraftItem();
    let finalItem = draftItem;

    if (state.currentTool === "pen" && appEls.shapeAssist.checked) {
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
          enterWorkspace();
          render();
          break;
        case "board:itemAdded":
          state.boardItems.push(message.payload);
          render();
          break;
        case "board:itemRemoved":
          state.boardItems = state.boardItems.filter((item) => item.id !== message.payload.itemId);
          render();
          break;
        case "board:cleared":
          state.boardItems = [];
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

    state.drawing = true;
    state.draftPoints = [point];
    appEls.canvas.setPointerCapture(event.pointerId);
    render();
  });

  appEls.canvas.addEventListener("pointermove", (event) => {
    if (!state.drawing) {
      return;
    }
    state.draftPoints.push(getPoint(event));
    render();
  });

  function finishDraw() {
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
  appEls.undoBtn.addEventListener("click", () => {
    if (!can("erase")) {
      return;
    }
    const latestOwnItem = [...state.boardItems].reverse().find((item) => item.authorId === state.currentMember.id);
    if (latestOwnItem) {
      sendMessage("board:removeItem", { itemId: latestOwnItem.id });
    }
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

  window.addEventListener("resize", resizeCanvas);

  resetToolButtons();
  resizeCanvas();
})();
