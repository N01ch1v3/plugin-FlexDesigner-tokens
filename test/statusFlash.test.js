const test = require("node:test");
const assert = require("node:assert/strict");
const {
  shouldFlashComplete,
  COMPLETE_FLASH_DURATION_MS,
  COMPLETE_FLASH_INTERVAL_MS,
  THINKING_RUN_INTERVAL_MS
} = require("../src/statusFlash");
const { renderCodexStatus } = require("../src/render");

test("flashes for ten seconds only after THINKING completes", () => {
  assert.equal(
    shouldFlashComplete(
      { state: "working", action: "THINKING" },
      { state: "complete", action: "COMPLETE" }
    ),
    true
  );
  assert.equal(COMPLETE_FLASH_DURATION_MS, 10_000);
  assert.equal(COMPLETE_FLASH_INTERVAL_MS, 500);
  assert.equal(THINKING_RUN_INTERVAL_MS, 160);
});

test("does not restart flashing for repeated complete snapshots or tool completion", () => {
  assert.equal(
    shouldFlashComplete(
      { state: "complete", action: "COMPLETE" },
      { state: "complete", action: "COMPLETE" }
    ),
    false
  );
  assert.equal(
    shouldFlashComplete(
      { state: "working", action: "EDITING" },
      { state: "complete", action: "COMPLETE" }
    ),
    false
  );
});

test("thinking runner produces distinct animation frames", () => {
  const data = {
    status: { state: "working", action: "THINKING", startedAt: Date.now() },
    session: { project: "demo", model: "codex" }
  };
  assert.notEqual(
    renderCodexStatus(data, { runnerFrame: 0 }),
    renderCodexStatus(data, { runnerFrame: 1 })
  );
});
