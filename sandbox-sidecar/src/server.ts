/**
 * Sandbox sidecar — the agent sandbox backend.
 *
 * Serves the HTTP contract that the Python sandbox plugin
 * (`plugins/sandbox/server/service.py`) calls, backed by per-user isolated VMs
 * via the Railway Sandboxes TypeScript SDK. The plugin reaches it through:
 *   SANDBOX_CONTROLLER_URL=http://sandbox-sidecar.railway.internal:8090
 *
 * (This contract was originally defined by the now-removed Go `sandbox-controller`;
 * `service.py` remains the source of truth for routes and JSON field names.)
 */
import { createHash, timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { Sandbox } from "railway";

const PORT = Number(process.env.PORT ?? 8090);
const CONTROLLER_TOKEN = process.env.SANDBOX_CONTROLLER_TOKEN ?? "";
const IDLE_TIMEOUT_MINUTES = Number(process.env.SANDBOX_IDLE_TIMEOUT_MINUTES ?? 30);

// Server-side reaper. Railway's idle timeout doesn't fire if the agent leaves a
// process running (a server, `tail -f`, a hung install) — the sandbox never
// looks idle and leaks. We reap on two rules, checked periodically:
//   1. Inactivity: no sidecar request touched the sandbox for REAP_IDLE_MINUTES.
//      A leftover process generates no sidecar calls, so this catches it; an
//      active task delegates exec/files every step, so its sandbox stays fresh.
//   2. Absolute cap: any sandbox older than MAX_AGE_MINUTES, no matter what.
const REAP_IDLE_MS = Number(process.env.SANDBOX_REAP_IDLE_MINUTES ?? 20) * 60_000;
const MAX_AGE_MS = Number(process.env.SANDBOX_MAX_AGE_MINUTES ?? 180) * 60_000;
const REAP_INTERVAL_MS = Number(process.env.SANDBOX_REAP_INTERVAL_MS ?? 300_000);

// Workspace continuity: before we destroy a sandbox, snapshot its disk into a
// named checkpoint keyed by (user, project). The next get-or-create boots from
// that checkpoint, so a user's cloned repo + edits + generated files survive a
// reap and they resume where they left off. (Railway's own idle-destroy can't be
// hooked, but our reaper's idle threshold is < Railway's, so we destroy first.)
const CHECKPOINTS_ENABLED = (process.env.SANDBOX_CHECKPOINTS ?? "1") !== "0";

// Fail closed: never run without a token (an unset token must not disable auth).
if (!CONTROLLER_TOKEN) {
  console.error("SANDBOX_CONTROLLER_TOKEN is required");
  process.exit(1);
}
const TOKEN_BUF = Buffer.from(CONTROLLER_TOKEN);

/** Constant-time token compare (avoids length/timing leaks). */
function tokenValid(provided: string | undefined): boolean {
  if (!provided) return false;
  const buf = Buffer.from(provided);
  return buf.length === TOKEN_BUF.length && timingSafeEqual(buf, TOKEN_BUF);
}

// ---------------------------------------------------------------------------
// In-memory state
//
// The Go controller keys exactly one sandbox per (user_id, project_id). We
// replicate that with an in-memory map. This is enough for a prototype: the
// Python client already caches sandbox ids and re-creates on 404, and idle
// Railway sandboxes auto-destroy. On restart the map is lost and Python
// re-creates (recoverable later via Sandbox.list() + the NOMI_* env tags).
// ---------------------------------------------------------------------------
const userIndex = new Map<string, string>(); // "user:project" -> sandboxId
const meta = new Map<string, { userId: string; projectId: string; createdAt: string }>();
// id -> last-access ISO timestamp. Decoupled from `meta` so it survives even
// when the full metadata is unknown (e.g. an in-flight sandbox after a sidecar
// restart): the first request re-arms its inactivity clock immediately.
const lastSeen = new Map<string, string>();

const userKey = (userId: string, projectId: string) => `${userId}:${projectId}`;

/** Mirror of the Go `Sandbox` JSON shape (models.go). */
function sandboxJSON(id: string) {
  const m = meta.get(id);
  return {
    id,
    user_id: m?.userId ?? "",
    project_id: m?.projectId ?? "",
    pod_name: id,
    pvc_name: "",
    status: "running",
    last_activity: new Date().toISOString(),
    created_at: m?.createdAt ?? new Date().toISOString(),
  };
}

/** POSIX single-quote one argument so an args array can be passed to exec (which takes a string). */
function shellQuote(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

function isNotFound(err: unknown): boolean {
  const name = (err as { name?: string } | undefined)?.name ?? "";
  return name === "SandboxNotFoundError" || name === "SandboxFileNotFoundError";
}

// A sandbox can be idle-destroyed (or fail) while its id is still cached. The
// SDK doesn't surface that as a not-found error: `Sandbox.connect()` succeeds,
// but the actual exec/files op throws a RailwayConnectionError ("...is not
// running (status: DESTROYED)") or a SandboxFailedError. Treat those like a
// 404 so the Python client's recreate-on-404 path kicks in instead of failing.
// A bare SDK status token (`sb.status` is exactly "RUNNING" / "DESTROYED" / …).
function isTerminalStatus(status: string): boolean {
  return status === "DESTROYED" || status === "DESTROYING" || status === "FAILED";
}
// Matched against an error *message* (prose) — anchor FAILED to a status token so
// an unrelated "...request failed" message doesn't evict a live sandbox.
const DEAD_MSG_RE = /not running|status:\s*(?:DESTROYED|DESTROYING|FAILED)/i;
function isDeadSandbox(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | undefined;
  const name = e?.name ?? "";
  return (
    name === "SandboxFailedError" ||
    name === "RailwayConnectionError" ||
    DEAD_MSG_RE.test(e?.message ?? "")
  );
}

/** Forget a sandbox id everywhere (cache miss → recover/create on next call). */
function evictById(id: string): void {
  for (const [key, sid] of userIndex) if (sid === id) userIndex.delete(key);
  meta.delete(id);
  lastSeen.delete(id);
}

// Sandbox.create()/checkpoint-boot resolve BEFORE the VM can accept exec/file
// ops. Returning 201 immediately makes the client's first op hit a dead-state
// error → 404 → recreate, in a loop that spawns a new VM each round. Poll a
// trivial exec until the box is actually usable before reporting it ready.
const READY_TIMEOUT_MS = Number(process.env.SANDBOX_READY_TIMEOUT_MS ?? 60000);
const READY_POLL_MS = Number(process.env.SANDBOX_READY_POLL_MS ?? 1000);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Block until a freshly created/booted sandbox can run a command, or the
 * deadline passes. Not-yet-ready symptoms (connection / dead-state / not-found)
 * mean "keep waiting"; any other error means the box is reachable so we stop.
 * Never throws — on timeout we return and let the normal op-level 404/recreate
 * path handle a genuinely broken sandbox.
 */
async function waitUntilReady(sandbox: Sandbox): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let attempt = 0;
  for (;;) {
    try {
      await sandbox.exec("true", { timeoutSec: 5 });
      return;
    } catch (err) {
      if (!isDeadSandbox(err) && !isNotFound(err)) {
        console.error(`waitUntilReady ${sandbox.id}: unexpected error:`, err);
        return;
      }
      if (Date.now() >= deadline) {
        console.warn(
          `waitUntilReady ${sandbox.id}: still not ready after ${READY_TIMEOUT_MS}ms`
        );
        return;
      }
      attempt++;
      await sleep(Math.min(READY_POLL_MS * attempt, 3000));
    }
  }
}

// ---------------------------------------------------------------------------
// Checkpoints (workspace continuity)
// ---------------------------------------------------------------------------

/**
 * Deterministic checkpoint name for a (user, project) pair. Hashed over the RAW
 * inputs so it's collision-free: a readable `nomi-{user}-{project}` form is
 * ambiguous because user ids are dash-containing UUIDs and `project_id` is
 * client-supplied, so two tenants could craft the same key and share a checkpoint.
 */
function checkpointName(userId: string, projectId: string): string {
  const digest = createHash("sha256")
    .update(JSON.stringify([userId, projectId]))
    .digest("hex");
  return `nomi-${digest.slice(0, 32)}`;
}

/** Find an existing checkpoint by its key, or null. */
async function findCheckpoint(name: string): Promise<{ id: string; key: string } | null> {
  try {
    const list = await Sandbox.checkpoints();
    return list.find((c: { key: string }) => c.key === name) ?? null;
  } catch (err) {
    console.error("checkpoint: list failed:", err);
    return null;
  }
}

/**
 * Snapshot a sandbox's disk so the next get-or-create can boot from it. Keeps a
 * single checkpoint per (user, project): after creating the fresh one, deletes
 * older checkpoints with the same key to bound storage. Best-effort — a failure
 * here must never block the destroy that follows it.
 */
async function snapshotForReuse(
  sb: Sandbox,
  userId: string,
  projectId: string
): Promise<void> {
  if (!CHECKPOINTS_ENABLED) return;
  const name = checkpointName(userId, projectId);
  try {
    const created = await sb.checkpoint(name);
    console.log(`checkpointed ${sb.id} -> "${name}" (${created.id})`);
    try {
      const list = await Sandbox.checkpoints();
      for (const c of list) {
        if (c.key === name && c.id !== created.id) {
          await Sandbox.deleteCheckpoint(c.id);
        }
      }
    } catch (err) {
      console.error("checkpoint: prune failed:", err);
    }
  } catch (err) {
    console.error(`checkpoint: snapshot ${sb.id} failed:`, err);
  }
}

/**
 * Reap sandboxes that are idle past REAP_IDLE_MS or older than MAX_AGE_MS, and
 * sweep terminal leftovers out of the local maps. Queries Railway directly via
 * Sandbox.list() so it works across sidecar restarts (in-memory maps may be empty).
 */
async function reap(): Promise<void> {
  let infos;
  try {
    infos = await Sandbox.list();
  } catch (err) {
    console.error("reap: Sandbox.list() failed:", err);
    return;
  }
  const now = Date.now();
  for (const info of infos) {
    if (isTerminalStatus(info.status)) {
      evictById(info.id); // already gone — just drop stale local references
      continue;
    }
    const createdMs = Date.parse(info.createdAt) || now;
    const seen = lastSeen.get(info.id);
    const lastActMs = seen ? Date.parse(seen) : createdMs;
    const idleMs = now - lastActMs;
    const ageMs = now - createdMs;
    if (idleMs < REAP_IDLE_MS && ageMs < MAX_AGE_MS) continue;
    const reason =
      ageMs >= MAX_AGE_MS
        ? `max age ${Math.round(ageMs / 60_000)}m`
        : `idle ${Math.round(idleMs / 60_000)}m`;
    try {
      const sb = await Sandbox.connect(info.id);
      // Snapshot the workspace before destroying so the user can resume. Use
      // ONLY the trusted in-process meta for the (user, project) name — never
      // tags read from inside the sandbox: the agent has shell access there and
      // could spoof another tenant's id, poisoning their checkpoint. If meta is
      // missing (e.g. created before a sidecar restart), skip the checkpoint.
      if (CHECKPOINTS_ENABLED) {
        const m = meta.get(info.id);
        if (m) await snapshotForReuse(sb, m.userId, m.projectId);
        else console.warn(`reap: no trusted meta for ${info.id} — skipping checkpoint`);
      }
      await sb.destroy();
      console.log(`reaped sandbox ${info.id} (${reason})`);
    } catch (err) {
      console.error(`reap: destroy ${info.id} failed:`, err);
    }
    evictById(info.id);
  }
}

/** True if a no-longer-usable sandbox should be reported as not-found (404). */
function isGone(err: unknown): boolean {
  return isNotFound(err) || isDeadSandbox(err);
}

/**
 * Recover an existing sandbox for (user, project) after an in-memory cache miss
 * (e.g. the sidecar restarted while a sandbox is still alive). The SDK's
 * `Sandbox.list()` does NOT expose the sandbox env, so we can't match the
 * NOMI_* tags from metadata — instead we connect to each RUNNING sandbox and
 * read the tags back with a tiny exec. This only runs on a create cache miss,
 * and the personal-scope environment holds very few sandboxes, so the probe is
 * cheap. Returns the matching SandboxInfo, or null.
 */
async function recoverSandbox(
  userId: string,
  projectId: string
): Promise<{ id: string; createdAt: string } | null> {
  let infos;
  try {
    infos = await Sandbox.list();
  } catch (err) {
    console.error("recover: Sandbox.list() failed:", err);
    return null;
  }
  for (const info of infos) {
    if (info.status !== "RUNNING") continue;
    try {
      const sb = await Sandbox.connect(info.id);
      const r = await sb.exec('echo "$NOMI_USER_ID|$NOMI_PROJECT_ID"', { timeoutSec: 10 });
      const line = (r.stdout ?? "").trim();
      const sep = line.indexOf("|");
      if (sep === -1) continue;
      if (line.slice(0, sep) === userId && line.slice(sep + 1) === projectId) {
        return { id: info.id, createdAt: info.createdAt };
      }
    } catch {
      // Unreachable/unreadable sandbox — skip it.
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: "50mb" }));

app.get("/health", (_req, res) => res.status(200).json({ ok: true }));

// Auth for every /api route.
app.use("/api", (req: Request, res: Response, next: NextFunction) => {
  if (!tokenValid(req.header("X-Controller-Token"))) {
    return res.status(401).json({ error: "invalid controller token" });
  }
  next();
});

// Re-arm the inactivity clock on every access to a specific sandbox (any
// :id route — exec, files, upload, download, status). Keeps actively-used
// sandboxes (including in-flight tasks) from being reaped.
app.param("id", (_req, _res, next, id: string) => {
  lastSeen.set(id, new Date().toISOString());
  next();
});

// Wrap an async handler so rejections become 500s instead of crashing.
const h =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response) =>
    fn(req, res).catch((err) => {
      console.error(`${req.method} ${req.path} failed:`, err);
      if (!res.headersSent) res.status(500).json({ error: String((err as Error)?.message ?? err) });
    });

// POST /api/sandboxes  — get-or-create one sandbox per (user, project).
app.post(
  "/api/sandboxes",
  h(async (req, res) => {
    const userId: string = req.body?.user_id ?? "";
    const projectId: string = req.body?.project_id ?? "";
    const key = userKey(userId, projectId);

    const existing = userIndex.get(key);
    if (existing) {
      try {
        const sb = await Sandbox.connect(existing);
        // connect() succeeds even on a destroyed/failed sandbox — the fetched
        // status tells us if it's still usable. Reuse only a live one.
        if (!isTerminalStatus(sb.status)) {
          lastSeen.set(existing, new Date().toISOString());
          return void res.status(201).json(sandboxJSON(existing));
        }
        evictById(existing);
      } catch (err) {
        if (!isGone(err)) throw err;
        evictById(existing);
      }
    }

    // Cache miss — the sidecar may have restarted while a sandbox is still
    // alive. Recover it before creating a duplicate.
    const recovered = await recoverSandbox(userId, projectId);
    if (recovered) {
      userIndex.set(key, recovered.id);
      meta.set(recovered.id, { userId, projectId, createdAt: recovered.createdAt });
      lastSeen.set(recovered.id, new Date().toISOString());
      console.log(`recovered sandbox ${recovered.id} for ${key}`);
      return void res.status(201).json(sandboxJSON(recovered.id));
    }

    // No live sandbox — boot from a saved checkpoint if one exists (resume the
    // user's workspace), otherwise create a fresh one. Either way re-set the
    // NOMI_* tags so recovery/checkpointing keep working.
    const createOpts = {
      idleTimeoutMinutes: IDLE_TIMEOUT_MINUTES,
      networkIsolation: "ISOLATED" as const,
      env: { NOMI_USER_ID: userId, NOMI_PROJECT_ID: projectId },
    };
    let sandbox: Sandbox;
    const cpName = CHECKPOINTS_ENABLED ? checkpointName(userId, projectId) : "";
    const cp = cpName ? await findCheckpoint(cpName) : null;
    if (cp) {
      sandbox = await Sandbox.create(cpName, createOpts);
      console.log(`booted sandbox ${sandbox.id} from checkpoint "${cpName}"`);
    } else {
      sandbox = await Sandbox.create(createOpts);
    }
    // Don't report the sandbox ready until it can actually run ops, or the
    // client's first exec/file call will 404 and trigger the recreate loop.
    await waitUntilReady(sandbox);
    userIndex.set(key, sandbox.id);
    const nowIso = new Date().toISOString();
    meta.set(sandbox.id, { userId, projectId, createdAt: nowIso });
    lastSeen.set(sandbox.id, nowIso);
    res.status(201).json(sandboxJSON(sandbox.id));
  })
);

// GET /api/sandboxes/:id  — sandbox object or 404.
app.get(
  "/api/sandboxes/:id",
  h(async (req, res) => {
    try {
      const sb = await Sandbox.connect(req.params.id);
      if (isTerminalStatus(sb.status)) {
        evictById(req.params.id);
        return void res.status(404).json({ error: "not found" });
      }
      res.status(200).json(sandboxJSON(req.params.id));
    } catch (err) {
      if (isGone(err)) {
        evictById(req.params.id);
        return void res.status(404).json({ error: "not found" });
      }
      throw err;
    }
  })
);

// GET /api/sandboxes/:id/status  — PodStatus shape.
app.get(
  "/api/sandboxes/:id/status",
  h(async (req, res) => {
    try {
      const sandbox = await Sandbox.connect(req.params.id);
      await sandbox.refresh?.();
      if (isTerminalStatus(sandbox.status)) {
        evictById(req.params.id);
        return void res.status(404).json({ error: "not found" });
      }
      res.status(200).json({ phase: "Running", ready: true });
    } catch (err) {
      if (isGone(err)) {
        evictById(req.params.id);
        return void res.status(404).json({ error: "not found" });
      }
      throw err;
    }
  })
);

// POST /api/sandboxes/:id/exec  — {command:[], timeout, stream}.
app.post(
  "/api/sandboxes/:id/exec",
  h(async (req, res) => {
    const command: string[] = req.body?.command ?? [];
    const timeout: number = req.body?.timeout ?? 60;
    const stream: boolean = req.body?.stream ?? false;
    const cmd = command.map(shellQuote).join(" ");

    // connect() succeeds on a destroyed sandbox — the dead-state error only
    // surfaces from exec() itself, so the whole op must be inside this try.
    try {
      const sandbox = await Sandbox.connect(req.params.id);

      if (stream) {
        // Best-effort streaming: pipe stdout/stderr chunks straight to the body.
        res.status(200);
        res.setHeader("Content-Type", "application/octet-stream");
        const write = (chunk: string) => res.write(chunk);
        await sandbox.exec(cmd, { timeoutSec: timeout, onStdout: write, onStderr: write });
        return void res.end();
      }

      const result = await sandbox.exec(cmd, { timeoutSec: timeout });
      res.status(200).json({
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        exit_code: result.exitCode ?? -1,
      });
    } catch (err) {
      // If a stream already flushed headers we can't change the status; the
      // wrapper `h` will swallow it. Otherwise map a gone sandbox to 404.
      if (isGone(err) && !res.headersSent) {
        evictById(req.params.id);
        return void res.status(404).json({ error: "not found" });
      }
      throw err;
    }
  })
);

// POST /api/sandboxes/:id/upload  — {path, content}.
app.post(
  "/api/sandboxes/:id/upload",
  h(async (req, res) => {
    const path: string = req.body?.path;
    const content: string = req.body?.content ?? "";
    try {
      const sandbox = await Sandbox.connect(req.params.id);
      await sandbox.files.write(path, content);
      res.status(200).json({ ok: true });
    } catch (err) {
      if (isGone(err)) {
        evictById(req.params.id);
        return void res.status(404).json({ error: "not found" });
      }
      throw err;
    }
  })
);

// GET /api/sandboxes/:id/download?path=  — raw file text.
app.get(
  "/api/sandboxes/:id/download",
  h(async (req, res) => {
    const path = String(req.query.path ?? "");
    try {
      const sandbox = await Sandbox.connect(req.params.id);
      const content = await sandbox.files.read(path);
      res.status(200).type("text/plain").send(content);
    } catch (err) {
      if (isGone(err)) {
        evictById(req.params.id);
        return void res.status(404).json({ error: "not found" });
      }
      throw err;
    }
  })
);

// GET /api/sandboxes/:id/files?path=  — {files:[FileInfo]}.
app.get(
  "/api/sandboxes/:id/files",
  h(async (req, res) => {
    const dir = String(req.query.path ?? "/workspace");
    try {
      const sandbox = await Sandbox.connect(req.params.id);
      const entries = await sandbox.files.list(dir);
      const files = entries.map((e: { name: string; size?: number; isDir?: boolean }) => ({
        name: e.name,
        path: `${dir.replace(/\/$/, "")}/${e.name}`,
        size: e.size ?? 0,
        is_dir: e.isDir ?? false,
        mode: "",
      }));
      res.status(200).json({ files });
    } catch (err) {
      if (isGone(err)) {
        evictById(req.params.id);
        return void res.status(404).json({ error: "not found" });
      }
      throw err;
    }
  })
);

// DELETE /api/sandboxes/:id?delete_pvc=  — destroy (delete_pvc ignored on Railway).
app.delete(
  "/api/sandboxes/:id",
  h(async (req, res) => {
    const id = req.params.id;
    try {
      const sandbox = await Sandbox.connect(id);
      await sandbox.destroy();
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
    for (const [key, sid] of userIndex) if (sid === id) userIndex.delete(key);
    meta.delete(id);
    res.status(200).json({ ok: true });
  })
);

// Bind on IPv6 unspecified (`::`) — Railway's private network is IPv6-only, so
// an IPv4-only `0.0.0.0` bind makes the service unreachable at
// `<service>.railway.internal`. Dual-stack also accepts IPv4 locally.
app.listen(PORT, "::", () => {
  console.log(
    `sandbox-sidecar listening on [::]:${PORT} ` +
      `(idle ${IDLE_TIMEOUT_MINUTES}m, reap idle ${REAP_IDLE_MS / 60_000}m / ` +
      `max age ${MAX_AGE_MS / 60_000}m every ${REAP_INTERVAL_MS / 60_000}m)`
  );
});

// Periodic reaper. unref() so it never keeps the process alive on its own.
setInterval(() => {
  reap().catch((err) => console.error("reap: unexpected failure:", err));
}, REAP_INTERVAL_MS).unref();
