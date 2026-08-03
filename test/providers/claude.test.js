const test = require("node:test");
const assert = require("node:assert/strict");
const { normaliseWindow } = require("../../src/providers/claude");

test("normaliseWindow computes remaining percent from utilization", () => {
  const result = normaliseWindow({ utilization: 30, resets_at: "2026-01-01T00:00:00Z" });
  assert.equal(result.usedPercent, 30);
  assert.equal(result.remainingPercent, 70);
  assert.equal(result.resetsAt, new Date("2026-01-01T00:00:00Z").getTime());
});

test("normaliseWindow clamps remaining percent at 0 when over 100% used", () => {
  const result = normaliseWindow({ utilization: 120 });
  assert.equal(result.remainingPercent, 0);
});

test("normaliseWindow returns null resetsAt when resets_at is absent", () => {
  const result = normaliseWindow({ utilization: 10 });
  assert.equal(result.resetsAt, null);
});

test("normaliseWindow returns null for missing or malformed windows", () => {
  assert.equal(normaliseWindow(null), null);
  assert.equal(normaliseWindow(undefined), null);
  assert.equal(normaliseWindow({}), null);
  assert.equal(normaliseWindow({ utilization: "a lot" }), null);
});
