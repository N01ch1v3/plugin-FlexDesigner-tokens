const test = require("node:test");
const assert = require("node:assert/strict");
const { parseActivityLines, extractSessionSource, toolAction } = require("../../src/providers/codexActivity");

function line(type, payload, timestamp) {
  return JSON.stringify({ type, timestamp, payload });
}

test("parses working status and the current tool action", () => {
  const result = parseActivityLines([
    line("session_meta", { cwd: "/work/flex", git: { branch: "main" }, cli_version: "1.2.3" }),
    line("turn_context", { model: "gpt-test", effort: "high", sandbox_policy: "workspace-write" }),
    line("event_msg", { type: "task_started", turn_id: "turn-1", started_at: "2026-01-01T00:00:00Z" }),
    line("response_item", { type: "custom_tool_call", call_id: "call-1", name: "apply_patch", input: {} })
  ]);

  assert.equal(result.status.state, "working");
  assert.equal(result.status.action, "EDITING");
  assert.equal(result.session.project, "work");
  assert.equal(result.session.model, "gpt-test");
  assert.equal(result.session.effort, "high");
  assert.equal(result.session.sandbox, "workspace-write");
  assert.equal(result.session.branch, "main");
});

test("falls back to THINKING when a turn is active without a tool", () => {
  const result = parseActivityLines([
    line("event_msg", { type: "task_started", turn_id: "turn-1", started_at: 1_700_000_000 })
  ]);
  assert.equal(result.status.state, "working");
  assert.equal(result.status.action, "THINKING");
  assert.equal(result.status.startedAt, 1_700_000_000_000);
});

test("tool output clears the active action", () => {
  const result = parseActivityLines([
    line("event_msg", { type: "task_started", turn_id: "turn-1" }),
    line("response_item", { type: "custom_tool_call", call_id: "call-1", name: "exec_command", input: "npm test" }),
    line("response_item", { type: "custom_tool_call_output", call_id: "call-1", output: "ok" })
  ]);
  assert.equal(result.status.action, "THINKING");
});

test("parses completed and aborted turns", () => {
  const complete = parseActivityLines([
    line("event_msg", { type: "task_started", turn_id: "turn-1", started_at: "2026-01-01T00:00:00Z" }),
    line("event_msg", {
      type: "task_complete",
      turn_id: "turn-1",
      completed_at: "2026-01-01T00:00:05Z",
      duration_ms: 5000,
      time_to_first_token_ms: 700
    })
  ]);
  assert.equal(complete.status.state, "complete");
  assert.equal(complete.status.durationMs, 5000);
  assert.equal(complete.status.timeToFirstTokenMs, 700);

  const aborted = parseActivityLines([
    line("event_msg", { type: "task_started", turn_id: "turn-2" }),
    line("event_msg", { type: "turn_aborted", turn_id: "turn-2", reason: "interrupted" })
  ]);
  assert.equal(aborted.status.state, "aborted");
  assert.equal(aborted.status.reason, "interrupted");
});

test("toolAction maps safe display categories without exposing tool input", () => {
  assert.equal(toolAction("exec_command", { cmd: "npm test" }), "TESTING");
  assert.equal(toolAction("web_search", {}), "SEARCHING");
  assert.equal(toolAction("apply_patch", {}), "EDITING");
  assert.equal(toolAction("exec_command", { cmd: "git status" }), "GIT");
});

test("extractSessionSource distinguishes CLI sessions from other Codex surfaces", () => {
  assert.equal(extractSessionSource([line("session_meta", { source: "cli" })]), "cli");
  assert.equal(extractSessionSource([line("session_meta", { source: "vscode" })]), "vscode");
  assert.equal(extractSessionSource(["not json"]), null);
});

test("plugin subdirectories use their parent as the project name", () => {
  const result = parseActivityLines([
    line("session_meta", { cwd: "/Users/example/Code/FlexDesignerPlugin/plugin-FlexDesigner-tokens", source: "vscode" })
  ]);
  assert.equal(result.session.project, "FlexDesignerPlugin");
  assert.equal(result.session.cwd, "/Users/example/Code/FlexDesignerPlugin/plugin-FlexDesigner-tokens");
});

test("all sessions use the cwd parent as the project name", () => {
  const result = parseActivityLines([line("session_meta", { cwd: "/Users/example/Code/my-app" })]);
  assert.equal(result.session.project, "Code");
});
