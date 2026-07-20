/**
 * Claude Code usage provider.
 *
 * Reads remaining quota from Anthropic's OAuth usage endpoint. This endpoint is
 * NOT part of Anthropic's public API reference — it is what Claude Code itself
 * uses to render `/usage`. It may change or disappear without notice.
 *
 * Auth token lives in the macOS Keychain (item "Claude Code-credentials"), or in
 * ~/.claude/.credentials.json on Linux/Windows.
 */
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const KEYCHAIN_SERVICE = "Claude Code-credentials";

// The endpoint rate-limits aggressively; never poll faster than this.
const MIN_REFRESH_MS = 60_000;

let cache = { at: 0, data: null };

/**
 * Reads the Claude Code OAuth credentials blob for the current platform.
 * @returns {Promise<{accessToken: string, expiresAt?: number}>}
 */
async function readCredentials() {
  let raw;

  if (process.platform === "darwin") {
    try {
      const { stdout } = await execFileAsync("security", [
        "find-generic-password",
        "-s",
        KEYCHAIN_SERVICE,
        "-w"
      ]);
      raw = stdout;
    } catch {
      throw new Error("Claude credentials not found in Keychain. Run `claude` and log in first.");
    }
  } else {
    const file = path.join(os.homedir(), ".claude", ".credentials.json");
    try {
      raw = await fs.readFile(file, "utf8");
    } catch {
      throw new Error(`Claude credentials not found at ${file}. Run \`claude\` and log in first.`);
    }
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Claude credentials are not valid JSON.");
  }

  const oauth = parsed.claudeAiOauth || parsed;
  if (!oauth.accessToken) throw new Error("No accessToken in Claude credentials.");
  return oauth;
}

/**
 * Best-effort Claude Code version, used for the User-Agent header. Without a
 * `claude-code/<version>` UA the endpoint drops you into a much harsher
 * rate-limit bucket and returns persistent 429s.
 */
let cachedVersion = null;
async function claudeCodeVersion() {
  if (cachedVersion) return cachedVersion;
  try {
    const { stdout } = await execFileAsync("claude", ["--version"], { timeout: 5000 });
    const m = stdout.match(/(\d+\.\d+\.\d+)/);
    cachedVersion = m ? m[1] : "2.0.0";
  } catch {
    cachedVersion = "2.0.0";
  }
  return cachedVersion;
}

/**
 * Normalises one window of the usage payload into a common shape.
 * `utilization` is percent USED, so remaining is 100 - utilization.
 */
function normaliseWindow(win) {
  if (!win || typeof win.utilization !== "number") return null;
  const usedPercent = win.utilization;
  return {
    usedPercent,
    remainingPercent: Math.max(0, 100 - usedPercent),
    resetsAt: win.resets_at ? new Date(win.resets_at).getTime() : null
  };
}

/**
 * Fetches Claude usage, honouring the minimum refresh interval.
 * @param {{force?: boolean}} [opts]
 */
async function getUsage(opts = {}) {
  const now = Date.now();
  if (!opts.force && cache.data && now - cache.at < MIN_REFRESH_MS) {
    return cache.data;
  }

  const creds = await readCredentials();
  if (creds.expiresAt && creds.expiresAt < now) {
    throw new Error("Claude OAuth token expired. Run `claude` to refresh it.");
  }

  const version = await claudeCodeVersion();
  const res = await fetch(USAGE_URL, {
    headers: {
      Authorization: `Bearer ${creds.accessToken}`,
      "User-Agent": `claude-code/${version}`,
      "anthropic-beta": "oauth-2025-04-20",
      Accept: "application/json"
    },
    signal: AbortSignal.timeout(10_000)
  });

  if (res.status === 401) throw new Error("Claude auth rejected (401). Re-login with `claude`.");
  if (res.status === 429) throw new Error("Rate limited by usage API (429). Backing off.");
  if (!res.ok) throw new Error(`Usage API returned HTTP ${res.status}.`);

  const body = await res.json();

  const data = {
    provider: "claude",
    fetchedAt: now,
    session: normaliseWindow(body.five_hour),
    weekly: normaliseWindow(body.seven_day),
    weeklyOpus: normaliseWindow(body.seven_day_opus),
    extraUsage: body.extra_usage
      ? {
          enabled: !!body.extra_usage.is_enabled,
          usedPercent: body.extra_usage.utilization ?? null,
          usedCredits: body.extra_usage.used_credits ?? null,
          monthlyLimit: body.extra_usage.monthly_limit ?? null,
          currency: body.extra_usage.currency || "USD"
        }
      : null,
    raw: body
  };

  cache = { at: now, data };
  return data;
}

module.exports = { getUsage, MIN_REFRESH_MS };
