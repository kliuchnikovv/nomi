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

## Prototype scope / follow-ups

Implements create/exec/files/destroy + the per-(user,project) keying. **Not yet:**
checkpoints / persistent workspaces (relies on `idleTimeoutMinutes` auto-destroy), durable
user→sandbox mapping across sidecar restarts (recoverable via `Sandbox.list()` + the
`GENIE_USER_ID`/`GENIE_PROJECT_ID` env tags set at create), streaming-exec polish,
concurrency-limit handling, and cost guardrails.
