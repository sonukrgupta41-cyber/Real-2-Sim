const crypto = require("crypto");
const path = require("path");
const express = require("express");
const { WebSocketServer } = require("ws");

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

const server = app.listen(process.env.PORT || 3000, () => {
  console.log(`LiveCollab listening on http://localhost:${server.address().port}`);
});
const wss = new WebSocketServer({ server, path: "/ws" });
const sessions = new Map();
const tokens = new Map();
const ROLE_PERMISSIONS = {
  admin: {
    draw: true,
    erase: true,
    manageMembers: true,
    clearBoard: true
  },
  editor: {
    draw: true,
    erase: true,
    manageMembers: false,
    clearBoard: false
  },
  viewer: {
    draw: false,
    erase: false,
    manageMembers: false,
    clearBoard: false
  }
};

function createId(size = 10) {
  return crypto.randomBytes(size).toString("hex").slice(0, size);
}

function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

function safeMember(member) {
  return {
    id: member.id,
    name: member.name,
    role: member.role,
    online: member.online,
    joinedAt: member.joinedAt
  };
}

function sessionSnapshot(session) {
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    boardItems: session.boardItems,
    members: Array.from(session.members.values()).map(safeMember),
    permissions: ROLE_PERMISSIONS
  };
}

function send(ws, type, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type, payload }));
  }
}

function broadcastToSession(session, type, payload) {
  session.sockets.forEach((ws) => send(ws, type, payload));
}

function requireSession(sessionId) {
  return sessions.get(sessionId);
}

app.post("/api/sessions", (req, res) => {
  const title = String(req.body?.title || "").trim();
  const password = String(req.body?.password || "");
  const displayName = String(req.body?.displayName || "").trim();

  if (!title || !password || !displayName) {
    return res.status(400).json({ error: "title, password, and displayName are required" });
  }

  const sessionId = createId(8);
  const memberId = createId(10);
  const token = createId(24);

  const admin = {
    id: memberId,
    name: displayName,
    role: "admin",
    online: false,
    joinedAt: new Date().toISOString()
  };

  const session = {
    id: sessionId,
    title,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
    members: new Map([[memberId, admin]]),
    boardItems: [],
    sockets: new Set()
  };

  sessions.set(sessionId, session);
  tokens.set(token, { sessionId, memberId });

  return res.status(201).json({
    token,
    session: sessionSnapshot(session),
    currentMember: safeMember(admin)
  });
});

app.post("/api/sessions/join", (req, res) => {
  const sessionId = String(req.body?.sessionId || "").trim();
  const password = String(req.body?.password || "");
  const displayName = String(req.body?.displayName || "").trim();
  const session = requireSession(sessionId);

  if (!sessionId || !password || !displayName) {
    return res.status(400).json({ error: "sessionId, password, and displayName are required" });
  }

  if (!session) {
    return res.status(404).json({ error: "Unable to find the session you are trying to join." });
  }

  if (session.passwordHash !== hashPassword(password)) {
    return res.status(403).json({ error: "Incorrect password for this session." });
  }

  const memberId = createId(10);
  const token = createId(24);
  const member = {
    id: memberId,
    name: displayName,
    role: "editor",
    online: false,
    joinedAt: new Date().toISOString()
  };

  session.members.set(memberId, member);
  tokens.set(token, { sessionId: session.id, memberId });

  broadcastToSession(session, "members:update", {
    members: Array.from(session.members.values()).map(safeMember)
  });

  return res.json({
    token,
    session: sessionSnapshot(session),
    currentMember: safeMember(member)
  });
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, sessions: sessions.size });
});

function assertPermission(session, memberId, permission) {
  const member = session.members.get(memberId);
  return Boolean(member && ROLE_PERMISSIONS[member.role]?.[permission]);
}

function removeSocket(session, ws) {
  session.sockets.delete(ws);
}

wss.on("connection", (ws) => {
  let auth = null;

  ws.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch (error) {
      send(ws, "error", { message: "Malformed JSON payload" });
      return;
    }

    if (message.type === "auth") {
      const tokenData = tokens.get(message.payload?.token);
      if (!tokenData) {
        send(ws, "error", { message: "Invalid websocket token" });
        ws.close();
        return;
      }

      const session = requireSession(tokenData.sessionId);
      const member = session?.members.get(tokenData.memberId);

      if (!session || !member) {
        send(ws, "error", { message: "Session not found" });
        ws.close();
        return;
      }

      auth = tokenData;
      ws.memberId = member.id;
      ws.sessionId = session.id;
      session.sockets.add(ws);
      member.online = true;

      send(ws, "session:init", {
        session: sessionSnapshot(session),
        currentMember: safeMember(member)
      });

      broadcastToSession(session, "members:update", {
        members: Array.from(session.members.values()).map(safeMember)
      });
      return;
    }

    if (!auth) {
      send(ws, "error", { message: "Authenticate before sending events" });
      return;
    }

    const session = requireSession(auth.sessionId);
    const actor = session?.members.get(auth.memberId);

    if (!session || !actor) {
      send(ws, "error", { message: "Session is no longer available" });
      return;
    }

    switch (message.type) {
      case "board:addItem": {
        if (!assertPermission(session, actor.id, "draw")) {
          send(ws, "error", { message: "You do not have drawing permission" });
          return;
        }

        const item = {
          ...message.payload,
          id: createId(12),
          authorId: actor.id,
          createdAt: new Date().toISOString()
        };
        session.boardItems.push(item);
        broadcastToSession(session, "board:itemAdded", item);
        return;
      }
      case "board:removeItem": {
        if (!assertPermission(session, actor.id, "erase")) {
          send(ws, "error", { message: "You do not have erase permission" });
          return;
        }

        const itemIndex = session.boardItems.findIndex((item) => item.id === message.payload?.itemId);
        if (itemIndex === -1) {
          return;
        }

        const item = session.boardItems[itemIndex];
        if (actor.role !== "admin" && item.authorId !== actor.id) {
          send(ws, "error", { message: "You can only remove your own items" });
          return;
        }

        session.boardItems.splice(itemIndex, 1);
        broadcastToSession(session, "board:itemRemoved", { itemId: item.id });
        return;
      }
      case "board:clear": {
        if (!assertPermission(session, actor.id, "clearBoard")) {
          send(ws, "error", { message: "Only admins can clear the board" });
          return;
        }

        session.boardItems = [];
        broadcastToSession(session, "board:cleared", {});
        return;
      }
      case "member:updateRole": {
        if (!assertPermission(session, actor.id, "manageMembers")) {
          send(ws, "error", { message: "Only admins can change roles" });
          return;
        }

        const { memberId, role } = message.payload || {};
        if (!ROLE_PERMISSIONS[role] || memberId === actor.id) {
          send(ws, "error", { message: "Invalid role update" });
          return;
        }

        const target = session.members.get(memberId);
        if (!target) {
          return;
        }

        target.role = role;
        broadcastToSession(session, "members:update", {
          members: Array.from(session.members.values()).map(safeMember)
        });
        return;
      }
      case "member:kick": {
        if (!assertPermission(session, actor.id, "manageMembers")) {
          send(ws, "error", { message: "Only admins can kick members" });
          return;
        }

        const memberId = message.payload?.memberId;
        if (!memberId || memberId === actor.id) {
          send(ws, "error", { message: "Invalid kick target" });
          return;
        }

        const target = session.members.get(memberId);
        if (!target) {
          return;
        }

        session.members.delete(memberId);
        for (const [token, tokenData] of tokens.entries()) {
          if (tokenData.sessionId === session.id && tokenData.memberId === memberId) {
            tokens.delete(token);
          }
        }

        session.sockets.forEach((client) => {
          if (client.memberId === memberId) {
            send(client, "member:kicked", { message: "You were removed by the admin" });
            client.close();
          }
        });

        broadcastToSession(session, "members:update", {
          members: Array.from(session.members.values()).map(safeMember)
        });
        return;
      }
      default:
        send(ws, "error", { message: `Unsupported event: ${message.type}` });
    }
  });

  ws.on("close", () => {
    if (!auth) {
      return;
    }

    const session = requireSession(auth.sessionId);
    const member = session?.members.get(auth.memberId);

    if (!session || !member) {
      return;
    }

    member.online = false;
    removeSocket(session, ws);
    broadcastToSession(session, "members:update", {
      members: Array.from(session.members.values()).map(safeMember)
    });
  });
});
