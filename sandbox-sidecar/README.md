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

## Prototype scope / follow-ups

Implements create/exec/files/destroy + the per-(user,project) keying. **Not yet:**
checkpoints / persistent workspaces (relies on `idleTimeoutMinutes` auto-destroy), durable
user→sandbox mapping across sidecar restarts (recoverable via `Sandbox.list()` + the
`NOMI_USER_ID`/`NOMI_PROJECT_ID` env tags set at create), streaming-exec polish,
concurrency-limit handling, and cost guardrails.
