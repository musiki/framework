# Live Events Protocol

## Transport

- SSE stream: `/sse/live?courseId=<courseId>`
- REST fallback snapshot: `GET /api/live/active?courseId=<courseId>`
- Optional session snapshot: `GET /api/live/active?sessionId=<sessionId>`

## Server -> Client events

### `live.snapshot`
Initial state (on connect/reconnect).

```json
{
  "active": true,
  "courseId": "cym06",
  "sessionId": "session-123",
  "interactionId": "cym06-poll-engagement-test",
  "type": "poll",
  "prompt": "...",
  "options": [{ "id": "opt-1", "text": "Claro" }],
  "anonymous": false,
  "allowMultiple": false,
  "showResults": true,
  "startedAt": "2026-03-05T15:00:00.000Z",
  "endsAt": "2026-03-05T15:01:00.000Z",
  "timed": true,
  "totalResponses": 7,
  "optionCounts": { "opt-1": 3, "opt-2": 2, "opt-3": 2 }
}
```

When there is no active interaction:

```json
{ "active": false }
```

### `live.started`
Emitted when a teacher starts an interaction.
Payload shape is the same as active `live.snapshot`.

### `live.updated`
Emitted on live interaction updates (responses, timer changes, content updates).
Payload shape is the same as active `live.snapshot`.

### `live.ended`
Emitted when an interaction is manually closed, replaced, or timed out.

```json
{
  "courseId": "cym06",
  "sessionId": "session-123",
  "interactionId": "cym06-poll-engagement-test",
  "type": "poll",
  "reason": "ended",
  "endedAt": "2026-03-05T15:01:00.000Z"
}
```

## Client -> Server endpoints

- `POST /api/live/start`
- `POST /api/live/update`
- `POST /api/live/end`
- `POST /api/live/respond`

## Notes

- One active interaction per course (`start` replaces existing active session).
- Countdown clients should rely on `endsAt` and local ticking (`mm:ss`).
- Reconnection is deterministic: consume `live.snapshot` first, then incremental events.
