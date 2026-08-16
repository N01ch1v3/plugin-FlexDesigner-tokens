/**
 * Near-real-time Codex status/session provider backed by local rollout JSONL.
 *
 * Rollout files are an internal Codex persistence format, not a stable public
 * API. Keep parsing defensive and derive states only from explicit lifecycle
 * events; a quiet file is not treated as "waiting for input".
 */
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const SESSIONS_DIR = path.join(os.homedir(), ".codex", "sessions");
const HEAD_BYTES = 128 * 1024;
const TAIL_BYTES = 512 * 1024;
const MIN_REFRESH_MS = 1_000;

let cache = { at: 0, data: null };

async function collectRollouts(dir, out = []) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectRollouts(full, out);
    } else if (entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl")) {
      try {
        const { mtimeMs } = await fs.stat(full);
        out.push({ file: full, mtimeMs });
      } catch {
        /* file vanished while scanning */
      }
    }
  }
  return out;
}

async function readHeadAndTailLines(file) {
  const handle = await fs.open(file, "r");
  try {
    const { size } = await handle.stat();
    if (size <= HEAD_BYTES + TAIL_BYTES) {
      const buf = Buffer.alloc(size);
      await handle.read(buf, 0, size, 0);
      return buf.toString("utf8").split("\n");
    }

    const head = Buffer.alloc(HEAD_BYTES);
    const tail = Buffer.alloc(TAIL_BYTES);
    await handle.read(head, 0, HEAD_BYTES, 0);
    await handle.read(tail, 0, TAIL_BYTES, size - TAIL_BYTES);

    const headLines = head.toString("utf8").split("\n");
    headLines.pop(); // final head line may be truncated
    const tailLines = tail.toString("utf8").split("\n");
    tailLines.shift(); // first tail line starts in the middle of the file
    return headLines.concat(tailLines);
  } finally {
    await handle.close();
  }
}

function normaliseSource(value) {
  if (typeof value === "string") return value.toLowerCase();
  if (!value || typeof value !== "object") return null;
  const named = value.kind || value.type || value.source;
  if (typeof named === "string") return named.toLowerCase();
  const keys = Object.keys(value);
  return keys.length ? keys.join("+").toLowerCase() : null;
}

function extractSessionSource(lines) {
  for (const raw of lines) {
    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      continue;
    }
    if (event.type !== "session_meta" || !event.payload || typeof event.payload !== "object") continue;
    return normaliseSource(event.payload.source ?? event.payload.thread_source);
  }
  return null;
}

function projectName(cwd) {
  if (!cwd) return null;
  const parent = path.basename(path.dirname(cwd));
  return parent || path.basename(cwd);
}

function asTimestamp(value) {
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function toolAction(name, input) {
  const tool = String(name || "").toLowerCase();
  let detail = "";
  try {
    detail = typeof input === "string" ? input.toLowerCase() : JSON.stringify(input || {}).toLowerCase();
  } catch {
    detail = "";
  }
  const haystack = `${tool} ${detail}`;

  if (/npm test|node --test|pytest|vitest|jest|cargo test|go test|test\/|tests\//.test(haystack)) return "TESTING";
  if (/apply_patch|patch|write|edit/.test(tool)) return "EDITING";
  if (/web|search/.test(tool)) return "SEARCHING";
  if (/git|github/.test(haystack)) return "GIT";
  if (/read|view|find|grep|\brg\b/.test(haystack)) return "READING";
  if (/image/.test(tool)) return "GENERATING";
  return "RUNNING";
}

function sandboxName(context) {
  const value = context.sandbox_policy ?? context.file_system_sandbox_policy;
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return null;
  return value.type || value.mode || value.policy || null;
}

/** Pure parser used by tests and by the on-disk provider. */
function parseActivityLines(lines, opts = {}) {
  let session = {};
  let context = {};
  let state = "idle";
  let turnId = null;
  let startedAt = null;
  let completedAt = null;
  let durationMs = null;
  let timeToFirstTokenMs = null;
  let reason = null;
  let lastEventAt = null;
  const activeCalls = new Map();

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    const payload = event.payload && typeof event.payload === "object" ? event.payload : {};
    const timestamp = asTimestamp(event.timestamp) || asTimestamp(payload.timestamp);
    if (timestamp) lastEventAt = timestamp;

    if (event.type === "session_meta") {
      session = { ...session, ...payload };
      continue;
    }
    if (event.type === "turn_context") {
      context = { ...context, ...payload };
      continue;
    }

    if (payload.type === "task_started") {
      state = "working";
      turnId = payload.turn_id || turnId;
      startedAt = asTimestamp(payload.started_at) || timestamp || startedAt;
      completedAt = null;
      durationMs = null;
      timeToFirstTokenMs = null;
      reason = null;
      activeCalls.clear();
      continue;
    }
    if (payload.type === "task_complete") {
      state = "complete";
      turnId = payload.turn_id || turnId;
      startedAt = asTimestamp(payload.started_at) || startedAt;
      completedAt = asTimestamp(payload.completed_at) || timestamp || completedAt;
      durationMs = typeof payload.duration_ms === "number" ? payload.duration_ms : durationMs;
      timeToFirstTokenMs =
        typeof payload.time_to_first_token_ms === "number" ? payload.time_to_first_token_ms : timeToFirstTokenMs;
      reason = null;
      activeCalls.clear();
      continue;
    }
    if (payload.type === "turn_aborted") {
      state = "aborted";
      turnId = payload.turn_id || turnId;
      startedAt = asTimestamp(payload.started_at) || startedAt;
      completedAt = asTimestamp(payload.completed_at) || timestamp || completedAt;
      durationMs = typeof payload.duration_ms === "number" ? payload.duration_ms : durationMs;
      reason = typeof payload.reason === "string" ? payload.reason : "Turn aborted";
      activeCalls.clear();
      continue;
    }

    if (payload.type === "custom_tool_call" && payload.call_id) {
      if (payload.status === "completed" || payload.status === "failed") {
        activeCalls.delete(payload.call_id);
      } else {
        activeCalls.set(payload.call_id, toolAction(payload.name, payload.input));
      }
      continue;
    }
    if (payload.type === "custom_tool_call_output" && payload.call_id) {
      activeCalls.delete(payload.call_id);
    }
  }

  const cwd = context.cwd || session.cwd || null;
  const git = session.git && typeof session.git === "object" ? session.git : {};
  const activeAction = Array.from(activeCalls.values()).at(-1) || null;

  return {
    fetchedAt: opts.fetchedAt || Date.now(),
    sourceFile: opts.sourceFile || null,
    sourceMtime: opts.sourceMtime || null,
    status: {
      state,
      action: state === "working" ? activeAction || "THINKING" : state.toUpperCase(),
      turnId,
      startedAt,
      completedAt,
      durationMs,
      timeToFirstTokenMs,
      reason,
      lastEventAt
    },
    session: {
      id: session.session_id || session.id || null,
      cwd,
      project: projectName(cwd),
      model: context.model || null,
      effort: context.effort || null,
      sandbox: sandboxName(context),
      approvalPolicy: context.approval_policy || null,
      collaborationMode:
        context.collaboration_mode_kind || context.collaboration_mode?.mode || context.collaboration_mode || null,
      realtimeActive: typeof context.realtime_active === "boolean" ? context.realtime_active : null,
      branch: git.branch || null,
      commitHash: git.commit_hash || null,
      cliVersion: session.cli_version || null,
      source: normaliseSource(session.source ?? session.thread_source)
    }
  };
}

async function getSnapshot(opts = {}) {
  const now = Date.now();
  if (!opts.force && cache.data && now - cache.at < MIN_REFRESH_MS) return cache.data;

  const rollouts = await collectRollouts(SESSIONS_DIR);
  if (!rollouts.length) throw new Error(`No Codex sessions found under ${SESSIONS_DIR}.`);
  rollouts.sort((a, b) => b.mtimeMs - a.mtimeMs);

  // Follow the most recently modified rollout regardless of which local Codex
  // surface created it (CLI, VS Code, desktop, and so on).
  const latest = rollouts[0];
  const lines = await readHeadAndTailLines(latest.file);
  const data = parseActivityLines(lines, {
    fetchedAt: now,
    sourceFile: latest.file,
    sourceMtime: latest.mtimeMs
  });
  cache = { at: now, data };
  return data;
}

module.exports = {
  getSnapshot,
  parseActivityLines,
  extractSessionSource,
  toolAction,
  MIN_REFRESH_MS
};
