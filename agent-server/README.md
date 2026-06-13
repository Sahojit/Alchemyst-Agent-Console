# Mock agent server

Implements the console's wire protocol on `ws://localhost:4747/ws`.

## Run

```bash
# directly
npm install
npm start              # normal mode
npm run start:chaos    # chaos mode

# or via Docker
docker compose up                # normal
MODE=chaos docker compose up     # chaos
```

## Behavior

- Gapless global `seq`, starting at 1; full frame log kept for RESUME replay.
- `RESUME { last_seq }` replays everything after `last_seq`, in order.
- PING every 9s (PONG expected; chaos sends empty challenges ~30% of the time).
- TOOL_CALL starts a 5s TOOL_ACK timer; late/duplicate ACKs are logged, not fatal.
- Chaos mode: 2–8s latency spikes, duplicate frames, natural reordering,
  rapid double TOOL_CALLs, ~600KB CONTEXT_SNAPSHOT blobs, random drops every ~15s.

## Chat commands (type in the console)

| Command | Effect |
| --- | --- |
| `/drop` | server hard-drops the socket |
| `/droptool` | drop mid-tool-call; TOOL_RESULT arrives via RESUME replay |
| `/error` | emits an ERROR frame |
