/**
 * Codex CLI usage provider.
 *
 * Codex writes a rollout JSONL per session under ~/.codex/sessions/YYYY/MM/DD/.
 * Each `token_count` event carries a `rate_limits` block with the percentage of
 * each window consumed, so we can read remaining quota straight off disk — no
 * auth and no network required.
 *
 * Only the newest session that actually contains rate limit data is consulted,
 * since the windows are account-wide rather than per-session.
 */
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");

const SESSIONS_DIR = path.join(os.homedir(), ".codex", "sessions");

// Rollouts are append-only; the newest rate_limits block is near the end.
const TAIL_BYTES = 512 * 1024;
// How many recent sessions to try before giving up.
const MAX_SESSIONS_SCANNED = 5;
const MIN_REFRESH_MS = 15_000;

let cache = { at: 0, data: null };

/** Recursively collects rollout files with their mtimes. */
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
        /* file vanished mid-scan */
      }
    }
  }
  return out;
}

/**
 * Reads the last TAIL_BYTES of a file and returns complete lines only.
 * Rollouts can be tens of MB, so never read the whole thing.
 */
async function readTailLines(file) {
  const handle = await fs.open(file, "r");
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - TAIL_BYTES);
    const length = size - start;
    const buf = Buffer.alloc(length);
    await handle.read(buf, 0, length, start);

    const lines = buf.toString("utf8").split("\n");
    // If we started mid-file the first line is probably truncated.
    if (start > 0) lines.shift();
    return lines;
  } finally {
    await handle.close();
  }
}

/** Pure parsing: finds the last token_count event carrying rate limits in a list of JSONL lines. */
function extractLastRateLimits(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line || !line.includes("token_count")) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const payload = event.payload && typeof event.payload === "object" ? event.payload : event;
    if (payload.type !== "token_count") continue;
    if (payload.rate_limits) return payload;
  }
  return null;
}

/** Pulls the last token_count event carrying rate limits out of a rollout. */
async function lastRateLimits(file) {
  const lines = await readTailLines(file);
  return extractLastRateLimits(lines);
}

/** Normalises one rate limit window. `used_percent` is percent USED. */
function normaliseWindow(win) {
  if (!win || typeof win.used_percent !== "number") return null;
  return {
    usedPercent: win.used_percent,
    remainingPercent: Math.max(0, 100 - win.used_percent),
    windowMinutes: win.window_minutes ?? null,
    // Codex reports resets_at as unix seconds.
    resetsAt: typeof win.resets_at === "number" ? win.resets_at * 1000 : null
  };
}

/**
 * Reads the most recent Codex usage snapshot.
 * @param {{force?: boolean}} [opts]
 */
async function getUsage(opts = {}) {
  const now = Date.now();
  if (!opts.force && cache.data && now - cache.at < MIN_REFRESH_MS) {
    return cache.data;
  }

  const rollouts = await collectRollouts(SESSIONS_DIR);
  if (rollouts.length === 0) {
    throw new Error(`No Codex sessions found under ${SESSIONS_DIR}.`);
  }
  rollouts.sort((a, b) => b.mtimeMs - a.mtimeMs);

  let payload = null;
  let sourceFile = null;
  for (const { file } of rollouts.slice(0, MAX_SESSIONS_SCANNED)) {
    try {
      payload = await lastRateLimits(file);
    } catch {
      continue;
    }
    if (payload) {
      sourceFile = file;
      break;
    }
  }

  if (!payload) {
    throw new Error("No rate limit data in recent Codex sessions. Run a Codex turn first.");
  }

  const limits = payload.rate_limits;
  const info = payload.info || {};
  const credits = limits.credits || null;

  const data = {
    provider: "codex",
    fetchedAt: now,
    sourceFile,
    planType: limits.plan_type || null,
    primary: normaliseWindow(limits.primary),
    secondary: normaliseWindow(limits.secondary),
    credits: credits
      ? {
          hasCredits: !!credits.has_credits,
          unlimited: !!credits.unlimited,
          balance: credits.balance ?? null
        }
      : null,
    context: info.model_context_window
      ? {
          window: info.model_context_window,
          used: info.total_token_usage?.total_tokens ?? null
        }
      : null,
    raw: payload
  };

  cache = { at: now, data };
  return data;
}

module.exports = { getUsage, MIN_REFRESH_MS, normaliseWindow, extractLastRateLimits };
