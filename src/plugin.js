/**
 * FlexDesigner AI Tokens plugin.
 *
 * Renders remaining Claude Code and Codex quota onto Flexbar keys.
 * See src/providers/* for where each number comes from — the two providers work
 * very differently (Claude is a network call, Codex is a local file read).
 */
const { plugin, logger } = require("@eniac/flexdesigner");
const claudeProvider = require("./providers/claude");
const codexProvider = require("./providers/codex");
const { renderClaude, renderCodex, renderError } = require("./render");

const CID = {
  claude: "com.arishow.aitokens.claude",
  codex: "com.arishow.aitokens.codex"
};

// Claude's usage endpoint rate-limits hard, so it gets a slower default poll
// than Codex, which is just reading a local file.
const DEFAULT_INTERVAL_MS = {
  [CID.claude]: 120_000,
  [CID.codex]: 30_000
};

const MAX_BACKOFF_MS = 15 * 60_000;

/** Live key state, keyed by key.uid. */
const keys = new Map();

function providerFor(cid) {
  if (cid === CID.claude) return claudeProvider;
  if (cid === CID.codex) return codexProvider;
  return null;
}

function renderFor(cid, data, opts) {
  return cid === CID.claude ? renderClaude(data, opts) : renderCodex(data, opts);
}

function labelFor(cid) {
  return cid === CID.claude ? "CLAUDE" : "CODEX";
}

/** Draws whatever the current state warrants, then schedules the next refresh. */
async function refresh(uid, { force = false } = {}) {
  const state = keys.get(uid);
  if (!state) return;

  const { serialNumber, key } = state;
  const cid = key.cid;
  const provider = providerFor(cid);
  if (!provider) return;

  const width = key.style?.width || undefined;

  try {
    const data = await provider.getUsage({ force });
    state.lastData = data;
    state.failures = 0;

    plugin.draw(serialNumber, key, "base64", renderFor(cid, data, { width }));
  } catch (err) {
    state.failures = (state.failures || 0) + 1;
    logger.warn(`[${cid}] refresh failed (${state.failures}): ${err.message}`);

    if (state.lastData) {
      // Prefer a stale-but-real number over an error card; mark it as stale so
      // the value is never silently trusted as current.
      plugin.draw(serialNumber, key, "base64", renderFor(cid, state.lastData, { width, stale: true }));
    } else {
      plugin.draw(serialNumber, key, "base64", renderError(labelFor(cid), err.message, { width }));
    }
  } finally {
    schedule(uid);
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
  const interval = payload?.config?.intervalMs;
  if (!interval) return;

  keys.forEach((state, uid) => {
    state.intervalMs = interval;
    schedule(uid);
  });
  logger.info(`Refresh interval updated to ${interval}ms`);
});

plugin.start();
logger.info("AI Tokens plugin started");
