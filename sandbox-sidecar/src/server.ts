/**
 * Sandbox sidecar.
 *
 * Re-implements the HTTP contract of `sandbox-controller` (the Go service the
 * Python `plugins/sandbox` talks to) on top of the Railway Sandboxes TypeScript
 * SDK. The Python client (`plugins/sandbox/server/service.py`) and the Go JSON
 * shapes (`sandbox-controller/internal/sandbox/models.go`) are the source of
 * truth for routes and field names — match them exactly.
 *
 * Switch from the Go controller to this sidecar by pointing the plugin at it:
 *   SANDBOX_CONTROLLER_URL=http://sandbox-sidecar.railway.internal:8090
 * No Python or Go code changes required.
 */
import { timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { Sandbox } from "railway";

const PORT = Number(process.env.PORT ?? 8090);
const CONTROLLER_TOKEN = process.env.SANDBOX_CONTROLLER_TOKEN ?? "";
const IDLE_TIMEOUT_MINUTES = Number(process.env.SANDBOX_IDLE_TIMEOUT_MINUTES ?? 30);

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
// re-creates (recoverable later via Sandbox.list() + the GENIE_* env tags).
// ---------------------------------------------------------------------------
const userIndex = new Map<string, string>(); // "user:project" -> sandboxId
const meta = new Map<string, { userId: string; projectId: string; createdAt: string }>();

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
        await Sandbox.connect(existing);
        return void res.status(201).json(sandboxJSON(existing));
      } catch (err) {
        if (!isNotFound(err)) throw err;
        userIndex.delete(key);
        meta.delete(existing);
      }
    }

    const sandbox = await Sandbox.create({
      idleTimeoutMinutes: IDLE_TIMEOUT_MINUTES,
      networkIsolation: "ISOLATED",
      env: { GENIE_USER_ID: userId, GENIE_PROJECT_ID: projectId },
    });
    userIndex.set(key, sandbox.id);
    meta.set(sandbox.id, { userId, projectId, createdAt: new Date().toISOString() });
    res.status(201).json(sandboxJSON(sandbox.id));
  })
);

// GET /api/sandboxes/:id  — sandbox object or 404.
app.get(
  "/api/sandboxes/:id",
  h(async (req, res) => {
    try {
      await Sandbox.connect(req.params.id);
      res.status(200).json(sandboxJSON(req.params.id));
    } catch (err) {
      if (isNotFound(err)) return void res.status(404).json({ error: "not found" });
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
      res.status(200).json({ phase: "Running", ready: true });
    } catch (err) {
      if (isNotFound(err)) return void res.status(404).json({ error: "not found" });
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

    let sandbox: Sandbox;
    try {
      sandbox = await Sandbox.connect(req.params.id);
    } catch (err) {
      if (isNotFound(err)) return void res.status(404).json({ error: "not found" });
      throw err;
    }

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
      if (isNotFound(err)) return void res.status(404).json({ error: "not found" });
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
      if (isNotFound(err)) return void res.status(404).json({ error: "not found" });
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
      if (isNotFound(err)) return void res.status(404).json({ error: "not found" });
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

app.listen(PORT, () => {
  console.log(`sandbox-sidecar listening on :${PORT} (idle timeout ${IDLE_TIMEOUT_MINUTES}m)`);
});
