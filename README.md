# LiveCollab Whiteboard

LiveCollab is a collaborative online whiteboard built with Express and WebSockets. It supports password-protected sessions, per-member roles, admin moderation, smooth pen strokes, shape-aware sketching, shared vector state, and browser-based invite flows.

## Features

- Password-protected whiteboard sessions with shareable room links
- WebSocket synchronization for board actions and member presence
- Roles: `admin`, `editor`, `viewer`
- Admin controls for role changes, board clearing, and kicking members
- Smooth pen strokes using quadratic interpolation
- Shape tools: line, rectangle, ellipse, arrow
- Shape detection that converts rough pen sketches into clean primitives
- Eraser and undo-last-item flows
- Responsive single-page UI without a separate frontend build step

## Stack

- Node.js
- Express
- `ws`
- HTML/CSS/vanilla JS frontend

## Run

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Session Flow

1. Create a session with title, password, and display name.
2. Share the generated join link and password with collaborators.
3. Joining users open the link, confirm their display name, enter the password, and connect as `editor` by default.
4. Admins can downgrade users to `viewer`, promote back to `editor`, or kick them.

## Whiteboard Notes

- All board items are stored as vector objects in memory on the server.
- Pen strokes are rendered smoothly via quadratic curves.
- When shape detection is enabled, a rough hand-drawn line, box, or ellipse is normalized into a clean object after pointer release.
- `viewer` users can observe but cannot draw or erase.

## Limitations

- Session state is currently in-memory; restarting the server resets rooms.
- Authentication is session-token based and intentionally lightweight for hackathon delivery.
- There is no voice chat or persistence layer yet.

See [PERMISSIONS.md](/home/tdynamos/Downloads/Real-2-Sim/PERMISSIONS.md) for the admin/member model and kick behavior.
