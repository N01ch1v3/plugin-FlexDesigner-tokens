/**
 * FlexDesigner AI Tokens plugin.
 *
 * Renders remaining Claude Code and Codex quota onto Flexbar keys.
 * See src/providers/* for where each number comes from — the two providers work
 * very differently (Claude is a network call, Codex is a local file read).
 */
const { execFile } = require("node:child_process");
const { plugin, logger } = require("@eniac/flexdesigner");
const claudeProvider = require("./providers/claude");
const codexProvider = require("./providers/codex");
const codexActivityProvider = require("./providers/codexActivity");
const claudeAuth = require("./providers/claudeAuth");
const { renderClaude, renderCodex, renderCodexStatus, renderCodexSession, renderError } = require("./render");

const CID = {
  claude: "com.arishow.aitokens.claude",
  codex: "com.arishow.aitokens.codex",
  codexStatus: "com.arishow.aitokens.codex-status",
  codexSession: "com.arishow.aitokens.codex-session"
};

// Claude's usage endpoint rate-limits hard, so it gets a slower default poll
// than Codex, which is just reading a local file.
const DEFAULT_INTERVAL_MS = {
  [CID.claude]: 120_000,
  [CID.codex]: 30_000,
  [CID.codexStatus]: 2_000,
  [CID.codexSession]: 10_000
};

const MAX_BACKOFF_MS = 15 * 60_000;

/** Live key state, keyed by key.uid. */
const keys = new Map();

// Tracks the last-seen values of the settings-page re-login fields, so we only
// react when the user actually changes them (plugin.config.updated fires on
// every config save, including unrelated ones like intervalMs).
let lastSeenReloginRequestedAt = null;
let lastSeenReloginCode = null;

/** Opens `url` in the OS default browser, best-effort. */
function openBrowser(url) {
  if (process.platform === "darwin") return execFile("open", [url]);
  if (process.platform === "win32") return execFile("cmd", ["/c", "start", "", url]);
  return execFile("xdg-open", [url]);
}

/** Forces an immediate refresh of every currently-live Claude key. */
function refreshAllClaudeKeys() {
  keys.forEach((state, uid) => {
    if (state.key.cid === CID.claude) refresh(uid, { force: true });
  });
}

/**
 * Handles the settings-page "log in with browser" / "paste code" fields (案B).
 * Both are plain config values — the frontend has no documented API to call the
 * backend directly, but writing to `modelValue.config` already round-trips
 * through `plugin.config.updated` (as intervalMs does today), so we piggyback
 * on that instead of relying on anything undocumented.
 */
async function handleReloginConfig(config) {
  if (!config) return;

  const requestedAt = config.claudeReloginRequestedAt || null;
  if (requestedAt && requestedAt !== lastSeenReloginRequestedAt) {
    lastSeenReloginRequestedAt = requestedAt;
    try {
      const url = claudeAuth.buildAuthorizeUrl();
      openBrowser(url);
      await plugin.setConfig({ ...config, claudeReloginStatus: "awaiting-code" });
    } catch (err) {
      logger.warn(`[claude] failed to start browser re-login: ${err.message}`);
      await plugin.setConfig({ ...config, claudeReloginStatus: "error", claudeReloginError: err.message });
    }
    return;
  }

  const code = config.claudeReloginCode || "";
  if (code && code !== lastSeenReloginCode) {
    lastSeenReloginCode = code;
    try {
      const tokens = await claudeAuth.exchangeCode(code);
      await claudeAuth.writeOwnCredentials(tokens);
      await plugin.setConfig({
        ...config,
        claudeReloginCode: "",
        claudeReloginStatus: "success",
        claudeReloginError: ""
      });
      refreshAllClaudeKeys();
      logger.info("[claude] fallback login (案B) succeeded");
    } catch (err) {
      logger.warn(`[claude] fallback login (案B) failed: ${err.message}`);
      await plugin.setConfig({
        ...config,
        claudeReloginCode: "",
        claudeReloginStatus: "error",
        claudeReloginError: err.message
      });
    }
  }
}

function providerFor(cid) {
  if (cid === CID.claude) return claudeProvider;
  if (cid === CID.codex) return codexProvider;
  if (cid === CID.codexStatus || cid === CID.codexSession) return codexActivityProvider;
  return null;
}

function renderFor(cid, data, opts) {
  if (cid === CID.claude) return renderClaude(data, opts);
  if (cid === CID.codex) return renderCodex(data, opts);
  if (cid === CID.codexStatus) return renderCodexStatus(data, opts);
  return renderCodexSession(data, opts);
}

function labelFor(cid) {
  if (cid === CID.claude) return "CLAUDE";
  if (cid === CID.codexStatus) return "CODEX STATUS";
  if (cid === CID.codexSession) return "CODEX SESSION";
  return "CODEX";
}

function getProviderData(provider, opts) {
  return provider === codexActivityProvider ? provider.getSnapshot(opts) : provider.getUsage(opts);
}

/**
 * plugin.draw() rejects if the physical device has disconnected (e.g. a USB
 * hiccup). Left unhandled, that rejection crashes the whole backend process,
 * killing every key until FlexDesigner restarts it. Swallow and log instead.
 */
function safeDraw(serialNumber, key, format, data) {
  Promise.resolve(plugin.draw(serialNumber, key, format, data)).catch((err) => {
    logger.warn(`[${key.cid}] draw failed: ${err.message}`);
  });
}

/** Draws whatever the current state warrants, then schedules the next refresh. */
async function refresh(uid, { force = false } = {}) {
  const state = keys.get(uid);
  if (!state) return;
  const refreshSeq = (state.refreshSeq || 0) + 1;
  state.refreshSeq = refreshSeq;

  const { serialNumber, key } = state;
  const cid = key.cid;
  const provider = providerFor(cid);
  if (!provider) return;

  const width = key.style?.width || undefined;

  try {
    const data = await getProviderData(provider, { force });
    if (keys.get(uid) !== state || state.refreshSeq !== refreshSeq) return;
    state.lastData = data;
    state.failures = 0;

    safeDraw(serialNumber, key, "base64", renderFor(cid, data, { width }));
  } catch (err) {
    if (keys.get(uid) !== state || state.refreshSeq !== refreshSeq) return;
    state.failures = (state.failures || 0) + 1;
    logger.warn(`[${cid}] refresh failed (${state.failures}): ${err.message}`);

    if (state.lastData) {
      // Prefer a stale-but-real number over an error card; mark it as stale so
      // the value is never silently trusted as current.
      safeDraw(serialNumber, key, "base64", renderFor(cid, state.lastData, { width, stale: true }));
    } else {
      safeDraw(serialNumber, key, "base64", renderError(labelFor(cid), err.message, { width }));
    }
  } finally {
    if (keys.get(uid) === state && state.refreshSeq === refreshSeq) schedule(uid);
  }
}

/** Reschedules a key's timer, backing off exponentially after failures. */
function schedule(uid) {
  const state = keys.get(uid);
  if (!state) return;

  clearTimeout(state.timer);

  const base = state.intervalMs || DEFAULT_INTERVAL_MS[state.key.cid] || 60_000;
  const delay = state.failures
    ? Math.min(base * 2 ** state.failures, MAX_BACKOFF_MS)
    : base;

  state.timer = setTimeout(() => refresh(uid), delay);
}

plugin.on("plugin.alive", (payload) => {
  const { serialNumber, keys: incoming } = payload;

  incoming.forEach((key) => {
    if (!providerFor(key.cid)) return;

    const existing = keys.get(key.uid);
    clearTimeout(existing?.timer);

    keys.set(key.uid, {
      serialNumber,
      key,
      failures: 0,
      lastData: existing?.lastData || null,
      refreshSeq: existing?.refreshSeq || 0,
      intervalMs: key.data?.intervalMs || null,
      timer: null
    });

    refresh(key.uid, { force: true });
  });
});

plugin.on("plugin.data", (payload) => {
  const { serialNumber, data } = payload;
  const key = data.key;
  if (!providerFor(key.cid)) return;

  // Keep the freshest key object so style/width edits take effect immediately.
  const state = keys.get(key.uid);
  if (state) {
    state.key = key;
    state.serialNumber = serialNumber;
    state.failures = 0;
    state.intervalMs = key.data?.intervalMs || null;
  }

  refresh(key.uid, { force: true });
  return { status: "success" };
});

plugin.on("plugin.dead", (payload) => {
  payload.keys.forEach((key) => {
    const state = keys.get(key.uid);
    if (!state) return;
    clearTimeout(state.timer);
    keys.delete(key.uid);
  });
});

plugin.on("plugin.config.updated", (payload) => {
  const config = payload?.config;
  if (!config) return;

  const interval = config.intervalMs;
  if (interval) {
    keys.forEach((state, uid) => {
      state.intervalMs = interval;
      schedule(uid);
    });
    logger.info(`Refresh interval updated to ${interval}ms`);
  }

  handleReloginConfig(config).catch((err) => {
    logger.warn(`[claude] re-login config handling failed: ${err.message}`);
  });
});

plugin.start();
logger.info("AI Tokens plugin started");
