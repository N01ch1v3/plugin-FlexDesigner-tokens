/**
 * Key rendering for the Flexbar display.
 *
 * The key is a 60px-tall strip, so this is a hero number plus a thin meter
 * rather than a chart. Status colour never carries meaning on its own — the
 * numeric percentage is always drawn alongside it.
 */
const { createCanvas } = require("@napi-rs/canvas");

const KEY_HEIGHT = 60;
const DEFAULT_WIDTH = 240;

// Fixed status palette — reserved for state, never reused as series colours.
const STATUS = {
  active: "#4da3ff",
  good: "#0ca30c",
  warning: "#fab219",
  serious: "#ec835a",
  critical: "#d03b3b"
};

const INK = {
  surface: "#1a1a19",
  primary: "#ffffff",
  secondary: "#c3c2b7",
  muted: "#898781",
  track: "#3a3a37"
};

/** Maps remaining percentage to a status role. */
function statusFor(remainingPercent) {
  if (remainingPercent > 50) return "good";
  if (remainingPercent > 20) return "warning";
  if (remainingPercent > 5) return "serious";
  return "critical";
}

/** Compact reset countdown, e.g. "2h13m", "45m", "now". */
function countdown(resetsAt) {
  if (!resetsAt) return "";
  const ms = resetsAt - Date.now();
  if (ms <= 0) return "now";
  const mins = Math.floor(ms / 60_000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days >= 1) return `${days}d${hours % 24}h`;
  if (hours >= 1) return `${hours}h${mins % 60}m`;
  return `${mins}m`;
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/**
 * Draws a thin meter with a rounded data end anchored to the track start.
 * @param {number} remainingPercent 0-100, the portion still available
 */
function meter(ctx, x, y, w, h, remainingPercent, color) {
  ctx.fillStyle = INK.track;
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();

  const filled = Math.max(0, Math.min(100, remainingPercent)) / 100;
  const fw = w * filled;
  if (fw > 0.5) {
    ctx.fillStyle = color;
    roundRect(ctx, x, y, fw, h, h / 2);
    ctx.fill();
  }
}

function newCanvas(width) {
  const canvas = createCanvas(width, KEY_HEIGHT);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = INK.surface;
  ctx.fillRect(0, 0, width, KEY_HEIGHT);
  return { canvas, ctx };
}

function fitText(ctx, text, maxWidth) {
  let value = String(text || "");
  if (ctx.measureText(value).width <= maxWidth) return value;
  while (value.length > 1 && ctx.measureText(`${value}…`).width > maxWidth) value = value.slice(0, -1);
  return `${value}…`;
}

function compactDuration(ms) {
  if (typeof ms !== "number" || ms < 0) return "";
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours) return `${hours}h${minutes % 60}m`;
  if (minutes) return `${minutes}m${seconds % 60}s`;
  return `${seconds}s`;
}

/**
 * Shared card layout.
 *
 * @param {object} opts
 * @param {string} opts.label      provider name, e.g. "CLAUDE"
 * @param {number} opts.remaining  hero percentage remaining
 * @param {string} opts.heroCaption caption under/next to the hero number
 * @param {string} opts.corner     top-right text (reset countdown)
 * @param {Array<{label:string, remaining:number}>} opts.meters
 * @param {number} [opts.width]
 * @param {boolean} [opts.stale]   true when showing a cached value after a failure
 */
function drawCard(opts) {
  const width = opts.width || DEFAULT_WIDTH;
  const { canvas, ctx } = newCanvas(width);
  const pad = 8;
  const role = statusFor(opts.remaining);
  const color = STATUS[role];

  // Header: provider label (left) and reset countdown (right).
  ctx.font = "600 10px sans-serif";
  ctx.fillStyle = INK.muted;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(opts.label, pad, pad);

  if (opts.corner) {
    ctx.textAlign = "right";
    ctx.fillStyle = opts.stale ? STATUS.warning : INK.muted;
    ctx.fillText(opts.stale ? `${opts.corner} ·stale` : opts.corner, width - pad, pad);
  }

  // Hero number — the status colour plus the digits, never colour alone.
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = "700 26px sans-serif";
  ctx.fillStyle = color;
  const hero = `${Math.round(opts.remaining)}%`;
  ctx.fillText(hero, pad, 43);
  const heroWidth = ctx.measureText(hero).width;

  if (opts.heroCaption) {
    ctx.font = "400 10px sans-serif";
    ctx.fillStyle = INK.secondary;
    ctx.fillText(opts.heroCaption, pad + heroWidth + 6, 43);
  }

  // Meters stacked on the right half.
  const meters = (opts.meters || []).slice(0, 2);
  if (meters.length) {
    const mx = Math.round(width * 0.52);
    const mw = width - mx - pad;
    const startY = meters.length === 1 ? 34 : 26;
    meters.forEach((m, i) => {
      const y = startY + i * 14;
      ctx.font = "400 9px sans-serif";
      ctx.fillStyle = INK.muted;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(m.label, mx, y);

      ctx.textAlign = "right";
      ctx.fillStyle = INK.secondary;
      ctx.fillText(`${Math.round(m.remaining)}%`, mx + mw, y);

      meter(ctx, mx, y + 3, mw, 3, m.remaining, STATUS[statusFor(m.remaining)]);
    });
  }

  return canvas.toDataURL("image/png");
}

/** Claude key: 5-hour session window as the hero, weekly + extra credits as meters. */
function renderClaude(data, opts = {}) {
  const session = data.session;
  const weekly = data.weekly;
  const meters = [];

  if (weekly) meters.push({ label: "week", remaining: weekly.remainingPercent });
  if (data.extraUsage?.enabled && typeof data.extraUsage.usedPercent === "number") {
    meters.push({
      label: "credit",
      remaining: Math.max(0, 100 - data.extraUsage.usedPercent)
    });
  }

  return drawCard({
    label: "CLAUDE",
    remaining: session ? session.remainingPercent : 0,
    heroCaption: "5h",
    corner: session ? countdown(session.resetsAt) : "",
    meters,
    width: opts.width,
    stale: opts.stale
  });
}

/** Codex key: primary rate limit window as the hero, secondary window as a meter. */
function renderCodex(data, opts = {}) {
  const primary = data.primary;
  const meters = [];

  if (data.secondary) {
    meters.push({ label: "2nd", remaining: data.secondary.remainingPercent });
  }
  if (data.context?.window && data.context.used != null) {
    const ctxRemaining = Math.max(0, 100 - (data.context.used / data.context.window) * 100);
    meters.push({ label: "ctx", remaining: ctxRemaining });
  }

  const windowLabel = primary?.windowMinutes
    ? primary.windowMinutes >= 1440
      ? `${Math.round(primary.windowMinutes / 1440)}d`
      : `${Math.round(primary.windowMinutes / 60)}h`
    : "";

  return drawCard({
    label: "CODEX",
    remaining: primary ? primary.remainingPercent : 0,
    heroCaption: windowLabel,
    corner: primary ? countdown(primary.resetsAt) : "",
    meters,
    width: opts.width,
    stale: opts.stale
  });
}

/** Codex activity key: explicit rollout lifecycle state plus a safe tool category. */
function renderCodexStatus(data, opts = {}) {
  const width = opts.width || DEFAULT_WIDTH;
  const { canvas, ctx } = newCanvas(width);
  const pad = 8;
  const status = data.status || {};
  const session = data.session || {};
  const state = status.state || "idle";
  const color = state === "working" ? STATUS.active : state === "complete" ? STATUS.good : state === "aborted" ? STATUS.critical : INK.secondary;
  const elapsed =
    state === "working" && status.startedAt
      ? compactDuration(Math.max(0, Date.now() - status.startedAt))
      : compactDuration(status.durationMs);

  ctx.textBaseline = "top";
  ctx.font = "600 10px sans-serif";
  ctx.fillStyle = INK.muted;
  ctx.textAlign = "left";
  const elapsedWidth = elapsed ? ctx.measureText(elapsed).width + 8 : 0;
  const headerWidth = width - pad * 2 - elapsedWidth;
  const prefix = session.project ? "CODEX · " : "CODEX";
  ctx.fillText(prefix, pad, pad);
  if (session.project) {
    const prefixWidth = ctx.measureText(prefix).width;
    ctx.fillStyle = INK.primary;
    ctx.fillText(fitText(ctx, session.project, Math.max(0, headerWidth - prefixWidth)), pad + prefixWidth, pad);
  }
  if (elapsed) {
    ctx.textAlign = "right";
    ctx.fillText(elapsed, width - pad, pad);
  }

  ctx.textAlign = "left";
  ctx.font = "700 20px sans-serif";
  ctx.fillStyle = color;
  ctx.fillText(fitText(ctx, status.action || state.toUpperCase(), width - pad * 2), pad, 22);

  const sandbox =
    session.sandbox === "workspace-write"
      ? "WS"
      : session.sandbox === "read-only"
        ? "RO"
        : session.sandbox === "danger-full-access" || session.sandbox === "full-access"
          ? "FULL"
          : session.sandbox;
  const detail =
    state === "aborted" && status.reason
      ? status.reason
      : [session.model, session.effort ? String(session.effort).toUpperCase() : null, sandbox]
          .filter(Boolean)
          .join(" · ");
  ctx.font = "400 9px sans-serif";
  ctx.fillStyle = INK.secondary;
  ctx.fillText(fitText(ctx, detail || "No active Codex turn", width - pad * 2), pad, 47);

  return canvas.toDataURL("image/png");
}

/** Codex session key: project/model plus the most useful execution settings. */
function renderCodexSession(data, opts = {}) {
  const width = opts.width || DEFAULT_WIDTH;
  const { canvas, ctx } = newCanvas(width);
  const pad = 8;
  const session = data.session || {};

  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.font = "600 10px sans-serif";
  ctx.fillStyle = INK.muted;
  ctx.fillText("CODEX SESSION", pad, 6);
  if (session.effort) {
    ctx.textAlign = "right";
    ctx.fillStyle = STATUS.active;
    ctx.fillText(String(session.effort).toUpperCase(), width - pad, 6);
  }

  ctx.textAlign = "left";
  ctx.font = "700 15px sans-serif";
  ctx.fillStyle = INK.primary;
  ctx.fillText(fitText(ctx, session.project || "No Codex session", width - pad * 2), pad, 20);

  ctx.font = "400 10px sans-serif";
  ctx.fillStyle = INK.secondary;
  ctx.fillText(fitText(ctx, session.model || "Unknown model", width - pad * 2), pad, 38);

  const detail = [session.branch, session.sandbox].filter(Boolean).join(" · ");
  ctx.font = "400 8px sans-serif";
  ctx.fillStyle = INK.muted;
  ctx.fillText(fitText(ctx, detail || session.cwd || "Session metadata unavailable", width - pad * 2), pad, 51);

  return canvas.toDataURL("image/png");
}

/**
 * Error state. Never leaves the key blank — a silent key is indistinguishable
 * from a healthy one at a glance.
 */
function renderError(label, message, opts = {}) {
  const width = opts.width || DEFAULT_WIDTH;
  const { canvas, ctx } = newCanvas(width);
  const pad = 8;

  ctx.font = "600 10px sans-serif";
  ctx.fillStyle = INK.muted;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(label, pad, pad);

  ctx.font = "700 13px sans-serif";
  ctx.fillStyle = STATUS.critical;
  ctx.fillText("— unavailable", pad, 22);

  // Wrap the reason onto one clipped line.
  ctx.font = "400 9px sans-serif";
  ctx.fillStyle = INK.secondary;
  let text = message || "unknown error";
  while (ctx.measureText(text).width > width - pad * 2 && text.length > 4) {
    text = text.slice(0, -2);
  }
  ctx.fillText(text, pad, 42);

  return canvas.toDataURL("image/png");
}

module.exports = {
  renderClaude,
  renderCodex,
  renderCodexStatus,
  renderCodexSession,
  renderError,
  countdown,
  compactDuration,
  statusFor,
  KEY_HEIGHT,
  DEFAULT_WIDTH,
  STATUS
};
