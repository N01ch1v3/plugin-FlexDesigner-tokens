const test = require("node:test");
const assert = require("node:assert/strict");
const { normaliseWindow, extractLastRateLimits } = require("../../src/providers/codex");

test("normaliseWindow computes remaining percent and converts resets_at to ms", () => {
  const result = normaliseWindow({ used_percent: 25, window_minutes: 300, resets_at: 1700000000 });
  assert.equal(result.usedPercent, 25);
  assert.equal(result.remainingPercent, 75);
  assert.equal(result.windowMinutes, 300);
  assert.equal(result.resetsAt, 1700000000 * 1000);
});

test("normaliseWindow returns null windowMinutes/resetsAt when absent", () => {
  const result = normaliseWindow({ used_percent: 10 });
  assert.equal(result.windowMinutes, null);
  assert.equal(result.resetsAt, null);
});

test("normaliseWindow returns null for missing or malformed windows", () => {
  assert.equal(normaliseWindow(null), null);
  assert.equal(normaliseWindow({}), null);
  assert.equal(normaliseWindow({ used_percent: "lots" }), null);
});

test("extractLastRateLimits returns the last token_count event carrying rate_limits", () => {
  const lines = [
    JSON.stringify({ payload: { type: "token_count", rate_limits: { primary: { used_percent: 10 } } } }),
    "not json {{{",
    "",
    JSON.stringify({ payload: { type: "other_event" } }),
    JSON.stringify({ payload: { type: "token_count", rate_limits: { primary: { used_percent: 40 } } } })
  ];
  const result = extractLastRateLimits(lines);
  assert.equal(result.rate_limits.primary.used_percent, 40);
});

test("extractLastRateLimits ignores token_count events without rate_limits", () => {
  const lines = [JSON.stringify({ payload: { type: "token_count" } })];
  assert.equal(extractLastRateLimits(lines), null);
});

test("extractLastRateLimits handles events not wrapped in a payload field", () => {
  const lines = [JSON.stringify({ type: "token_count", rate_limits: { primary: { used_percent: 5 } } })];
  const result = extractLastRateLimits(lines);
  assert.equal(result.rate_limits.primary.used_percent, 5);
});

test("extractLastRateLimits returns null when no lines match", () => {
  assert.equal(extractLastRateLimits([]), null);
  assert.equal(extractLastRateLimits(["irrelevant line"]), null);
});
