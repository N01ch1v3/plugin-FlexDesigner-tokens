/**
 * Claude Code usage provider.
 *
 * Reads remaining quota from Anthropic's OAuth usage endpoint. This endpoint is
 * NOT part of Anthropic's public API reference — it is what Claude Code itself
 * uses to render `/usage`. It may change or disappear without notice.
 *
 * Auth token lives in the macOS Keychain (item "Claude Code-credentials"), or in
 * ~/.claude/.credentials.json on Linux/Windows. If that token has expired, it is
 * silently refreshed via `refreshToken` and written back (案A); if the refresh
 * token itself is dead, we fall back to a plugin-only login done from the
 * settings page (案B) — see providers/claudeAuth.js.
 */
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const claudeAuth = require("./claudeAuth");

const execFileAsync = promisify(execFile);

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";

// The endpoint rate-limits aggressively; never poll faster than this.
const MIN_REFRESH_MS = 60_000;

// Refresh a little before actual expiry so a slow request doesn't race past it.
const SAFETY_MARGIN_MS = 30_000;

let cache = { at: 0, data: null };

function isFresh(oauth) {
  return !oauth.expiresAt || oauth.expiresAt > Date.now() + SAFETY_MARGIN_MS;
}

/** True for errors that mean "nothing usable in this credential store", as opposed to a transient network blip. */
function isReauthTrigger(err) {
  if (err instanceof claudeAuth.InvalidGrantError) return true;
  return /credentials not found|No accessToken|not valid JSON/.test(err.message || "");
}

let sharedRefreshInFlight = null;

/** Ensures Claude Code's own shared credentials have a live access token, refreshing (案A) if needed. */
async function ensureFreshSharedToken() {
  const { oauth } = await claudeAuth.readSharedCredentials();
  if (isFresh(oauth)) return oauth;

  if (!sharedRefreshInFlight) {
    sharedRefreshInFlight = refreshSharedToken().finally(() => {
      sharedRefreshInFlight = null;
    });
  }
  return sharedRefreshInFlight;
}

async function refreshSharedToken() {
  // Re-read right before hitting the network — Claude Code itself may have
  // already refreshed (and rotated the refresh token) since our first read.
  let { parsed, oauth } = await claudeAuth.readSharedCredentials();
  if (isFresh(oauth)) return oauth;

  try {
    const tokens = await claudeAuth.refreshWithToken(oauth.refreshToken);
    await claudeAuth.writeSharedCredentials(parsed, tokens);
    return { ...oauth, ...tokens };
  } catch (err) {
    if (err instanceof claudeAuth.InvalidGrantError) throw err;

    // Transient failure (network, rate limit, ...): retry exactly once.
    ({ parsed, oauth } = await claudeAuth.readSharedCredentials());
    if (isFresh(oauth)) return oauth;
    const tokens = await claudeAuth.refreshWithToken(oauth.refreshToken);
    await claudeAuth.writeSharedCredentials(parsed, tokens);
    return { ...oauth, ...tokens };
  }
}

let ownRefreshInFlight = null;

/** Ensures the plugin's own fallback credentials (案B) have a live access token. */
async function ensureFreshOwnToken() {
  const creds = await claudeAuth.readOwnCredentials();
  if (!creds) throw new claudeAuth.ReauthRequiredError("No fallback login found.");
  if (isFresh(creds.oauth)) return creds.oauth;

  if (!ownRefreshInFlight) {
    ownRefreshInFlight = refreshOwnToken(creds).finally(() => {
      ownRefreshInFlight = null;
    });
  }
  return ownRefreshInFlight;
}

async function refreshOwnToken(initial) {
  let creds = initial;
  if (isFresh(creds.oauth)) return creds.oauth;

  try {
    const tokens = await claudeAuth.refreshWithToken(creds.oauth.refreshToken);
    await claudeAuth.writeOwnCredentials(tokens);
    return { ...creds.oauth, ...tokens };
  } catch (err) {
    if (err instanceof claudeAuth.InvalidGrantError) throw err;

    creds = await claudeAuth.readOwnCredentials();
    if (!creds) throw err;
    if (isFresh(creds.oauth)) return creds.oauth;
    const tokens = await claudeAuth.refreshWithToken(creds.oauth.refreshToken);
    await claudeAuth.writeOwnCredentials(tokens);
    return { ...creds.oauth, ...tokens };
  }
}

/** Resolves a live access token, trying Claude Code's own credentials (案A) before the plugin's fallback login (案B). */
async function ensureAccessToken() {
  try {
    return await ensureFreshSharedToken();
  } catch (sharedErr) {
    if (!isReauthTrigger(sharedErr)) throw sharedErr;

    try {
      return await ensureFreshOwnToken();
    } catch {
      throw new claudeAuth.ReauthRequiredError(
        "Claude login has expired. Log in again from the plugin settings page."
      );
    }
  }
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

  const oauth = await ensureAccessToken();

  const version = await claudeCodeVersion();
  const res = await fetch(USAGE_URL, {
    headers: {
      Authorization: `Bearer ${oauth.accessToken}`,
      "User-Agent": `claude-code/${version}`,
      "anthropic-beta": "oauth-2025-04-20",
      Accept: "application/json"
    },
    signal: AbortSignal.timeout(10_000)
  });

  if (res.status === 401) {
    throw new claudeAuth.ReauthRequiredError("Claude auth rejected (401). Log in again from the plugin settings page.");
  }
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

module.exports = { getUsage, MIN_REFRESH_MS, ReauthRequiredError: claudeAuth.ReauthRequiredError };
