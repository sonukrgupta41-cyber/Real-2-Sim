# Roles, Permissions, and Kick Flow

## Roles

### Admin

- Full draw and erase access
- Can change other members between `editor` and `viewer`
- Can clear the board
- Can kick members from the session
- Cannot demote or kick themselves through the UI

### Editor

- Can draw with pen and structured shape tools
- Can erase their own objects
- Can undo their own latest item
- Cannot manage members
- Cannot clear the board

### Viewer

- Read-only whiteboard access
- Receives live board and member updates
- Cannot draw, erase, clear, or manage users

## Kick Behavior

1. The admin clicks `Kick` beside a member in the members panel.
2. The server removes the member from the session map and invalidates their issued token.
3. Any active websocket for that member receives a `member:kicked` event.
4. The kicked user is disconnected and sent back to a fresh page state on reload.
5. Remaining members receive an updated member list immediately.

## Invite Model

Each room has:

- `sessionId`
- `password`

The app generates a shareable join link containing the `sessionId` as a query parameter. Collaborators open that link, enter their display name and the room password, and join without manually copying a second invite code.
