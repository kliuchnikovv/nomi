# sandbox-sidecar

A Node sidecar that re-implements the `sandbox-controller` HTTP contract on top of the
**Railway Sandboxes** TypeScript SDK (`railway`). It gives the agent sandbox a real
per-user, kernel-isolated VM (with its own Docker daemon) instead of the local-subprocess
backend that shares the controller's container.

It speaks the **exact same HTTP API** the Python plugin (`plugins/sandbox/server/service.py`)
already calls, so switching backends is a one-line env change — no Python or Go changes:

```
SANDBOX_CONTROLLER_URL=http://sandbox-sidecar.railway.internal:8090   # Railway
SANDBOX_CONTROLLER_URL=http://sandbox-sidecar:8090                     # docker-compose
```

## Run locally

Requires Railway credentials with Sandboxes access:

```bash
cp .env.example .env   # fill RAILWAY_API_TOKEN + RAILWAY_ENVIRONMENT_ID
npm install
SANDBOX_CONTROLLER_TOKEN=dev-token \
RAILWAY_API_TOKEN=... RAILWAY_ENVIRONMENT_ID=... \
npm start
```

## Smoke test

```bash
T='-H X-Controller-Token:dev-token -H Content-Type:application/json'
B=http://localhost:8090

# create
ID=$(curl -s $T -X POST $B/api/sandboxes -d '{"user_id":"u1"}' | jq -r .id)

# exec
curl -s $T -X POST $B/api/sandboxes/$ID/exec -d '{"command":["echo","hello"],"timeout":30}'

# Docker-in-sandbox proof
curl -s $T -X POST $B/api/sandboxes/$ID/exec \
  -d '{"command":["docker","run","--rm","hello-world"],"timeout":120}'

# files
curl -s $T -X POST $B/api/sandboxes/$ID/upload -d '{"path":"/workspace/a.txt","content":"hi"}'
curl -s $T "$B/api/sandboxes/$ID/files?path=/workspace"
curl -s $T "$B/api/sandboxes/$ID/download?path=/workspace/a.txt"

# destroy
curl -s $T -X DELETE $B/api/sandboxes/$ID
```

## Deploying on Railway — gotchas

These all bit us during the first deploy (2026-06-13). The local smoke test passes but the
deployed service fails differently because the container env differs from a dev machine.

1. **Set `SANDBOX_CONTROLLER_TOKEN` on the service or it crash-loops.** The server fails closed
   (`process.exit(1)`) when the token is unset. A crashed sidecar shows up at `back` as a
   `ClientConnectorError`, not an auth error.

2. **Pin `PORT=8090`.** Railway injects its own `PORT` (we saw `8080`), the app obeys it
   (`process.env.PORT`), but `back` targets `…railway.internal:8090` → connection refused →
   `ClientConnectorError`. Set `PORT=8090` as a service variable so the listen port, the
   healthcheck, and `back`'s URL all agree. (Alternatively point `back` at the injected port,
   but pinning is deterministic and matches the Go controller.)

3. **Bind IPv6 (`::`), not `0.0.0.0`.** Railway's private network is IPv6-only. `app.listen`
   already passes `"::"` in `server.ts` — keep it; an IPv4-only bind makes the service
   unreachable at `<service>.railway.internal` (also surfaces as `ClientConnectorError`).

4. **Node ≥ 22 base image.** The `railway` SDK streams `exec` over a WebSocket and uses the
   global `WebSocket`, which only exists in Node ≥ 22 (`Dockerfile` uses `node:22-slim`). On
   Node 20 exec fails with *"No WebSocket implementation found. Pass `webSocketImpl`…"*. (The
   alternative is installing `ws` and passing `webSocketImpl` in the SDK config.)

Note the shared failure mode: gotchas 1–3 all manifest as `ClientConnectorError` at `back`.
First check the **sidecar's own logs** — a healthy boot prints `listening on [::]:8090`; if a
request reached it, you'll see the route log line (e.g. `POST …/exec failed: …`).

## Lifecycle: reaping + workspace checkpoints

Railway's `idleTimeoutMinutes` only destroys *idle* sandboxes — a leftover process (a
server, `tail -f`, a hung install) keeps a sandbox "active" forever, so it leaks. A
server-side **reaper** (`setInterval`, every `SANDBOX_REAP_INTERVAL_MS`) backstops this:
it lists sandboxes via `Sandbox.list()` and destroys any that are idle past
`SANDBOX_REAP_IDLE_MINUTES` (no sidecar request touched them — a leftover process makes no
calls, so this catches it) or older than `SANDBOX_MAX_AGE_MINUTES` (hard cap). Active tasks
delegate `exec`/`files` every step, so their sandbox stays fresh and is never reaped. The
reaper queries Railway directly, so it works across sidecar restarts.

**Workspace continuity** (`SANDBOX_CHECKPOINTS=1`, default on): before the reaper destroys a
sandbox it snapshots the disk into a checkpoint keyed by a hash of the (user, project) pair
(one kept per key — older ones pruned). The name is hashed, not `nomi-{user}-{project}`,
because user ids are dash-containing UUIDs and `project_id` is client-supplied, so a readable
form is ambiguous and two tenants could craft a colliding key. The reaper checkpoints **only**
when it has trusted in-process metadata for the sandbox — never tags read from inside the
sandbox (the agent could spoof another tenant's id). The next get-or-create boots from that checkpoint, so a cloned
repo + edits + generated files survive a reap and the user resumes where they left off. The
reaper's idle threshold is intentionally `< idleTimeoutMinutes`, so *we* destroy first and
get to checkpoint (Railway's own idle-destroy can't be hooked). Disable with
`SANDBOX_CHECKPOINTS=0` to avoid snapshot storage cost.

## Prototype scope / follow-ups

Implements create/exec/files/destroy, per-(user,project) keying, destroyed-state recovery
(maps dead sandboxes to 404 so the Python client recreates), the reaper, and workspace
checkpoints. **Not yet:** durable user→sandbox mapping across sidecar restarts (recoverable
via `Sandbox.list()` + the `NOMI_USER_ID`/`NOMI_PROJECT_ID` env tags set at create),
artifact export to durable storage, streaming-exec polish, and concurrency-limit handling.
