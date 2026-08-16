English | [日本語](README.ja.md)

# AI Tokens — FlexDesigner Plugin

A FlexDesigner plugin that keeps your **remaining Claude Code and Codex CLI quota** visible on a Flexbar key at all times.

![Claude key](docs/images/key-claude.png)
![Codex key](docs/images/key-codex.png)

- **Claude key** — shows remaining 5-hour session quota prominently, with weekly quota and extra usage credits as secondary meters
- **Codex key** — shows remaining primary rate-limit quota, with context window usage as a secondary meter
- **Codex Status key** — shows explicit CLI turn lifecycle (`WORKING`, `COMPLETE`, `ABORTED`), safe activity categories such as `TESTING`, `EDITING`, and `SEARCHING`, plus compact model/effort/sandbox metadata
- Color shifts with remaining quota (green → yellow → orange → red). **Numbers are always shown, never color alone**
- **Click a key to refresh it immediately**
- Time until reset is shown in the top-right corner

---

## ⚠️ Important: Claude support uses an unofficial API

This plugin reads remaining Claude quota from `https://api.anthropic.com/api/oauth/usage`.

- This endpoint is **not documented in Anthropic's public API reference**. It's the same one Claude Code itself uses to render `/usage`, discovered by the community
- Authentication normally **reuses the OAuth token your local Claude Code login already saved**. If that token has expired, it is silently refreshed using `refreshToken` and written back to Claude Code's own credentials (Plan A)
  - The refresh request itself, to `https://console.anthropic.com/v1/oauth/token`, is likewise an **undocumented endpoint**
  - Only if `refreshToken` itself has expired can you re-authenticate through Anthropic's browser authorization flow from the settings page (Plan B, a fallback). Tokens from this flow are **stored separately for the plugin only** and never written to Claude Code's own credentials (equivalent to logging in from a separate device)
- Requests carry a Claude-Code-compatible `User-Agent` (`claude-code/<version>`), since the endpoint expects to be called by the Claude Code client; the version is read from the local `claude --version`
- The plugin only **reads your own account's usage information**. It never consumes tokens, incurs charges, or changes account settings
- **This may break without notice due to Anthropic changes to the endpoint**
- The endpoint rate-limits aggressively; a refresh interval of **60 seconds or more** is strongly recommended (default: 120 seconds)
- Because this relies on an unofficial mechanism, there is no guarantee it stays compliant with Anthropic's Terms of Service. **Use at your own risk.** If you're concerned, you can use the Codex key only and skip the Claude key entirely
- **If Anthropic requests it, the Claude key's functionality may be disabled or changed without notice**

**Why there's no other way:** `~/.claude/projects/**/*.jsonl` only records tokens **consumed**, with no information about rate-limit windows or reset times. There is no other way to learn the actual **remaining** quota.

**The Codex side, by contrast, only reads local files** — no authentication or network access required. Status and session metadata come from Codex's internal rollout JSONL format, so these two keys may need updates when Codex changes that format. A quiet log is never reported as "waiting for input" because local logs cannot establish that state reliably.

The Status key follows the most recently modified local rollout across Codex surfaces. It never shows the full directory path and always uses the parent of `cwd` as the project name. The project name is rendered in white so it remains distinct from the muted `CODEX` label.

### How tokens are handled

- Claude's OAuth token is read from the macOS **Keychain** (`Claude Code-credentials`), or from `~/.claude/.credentials.json` on Linux/Windows
- Tokens issued via Plan B (re-login from the settings page) are stored separately from Claude Code's own credentials: in a **separate Keychain item** (`FlexDesigner AI Tokens-credentials`) on macOS, or a dedicated file (`~/.claude/flexdesigner-ai-tokens.credentials.json`, mode 600) on Linux/Windows
- Tokens are **used only to authenticate to Anthropic** and are never written to logs, config files, or key rendering output
- **Nothing is ever sent to any third party**

---

## Requirements

This plugin assumes [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview) / [Codex CLI](https://github.com/openai/codex) are **already installed in the CLI environment of the same machine**. The plugin itself never logs in to either service — it only reads the credentials and session logs each CLI leaves behind.

| Requirement | Condition |
|---|---|
| FlexDesigner | 2.0.1 or later |
| Node.js | 20 or later |
| Claude Code | Installed and logged in via `claude` (if using the Claude key) |
| Codex CLI | Installed with at least one session run (if using the Codex key) |

Supports macOS / Windows / Linux.

---

## Installation

### Install from a release (recommended)

1. Download the `.flexplugin` matching your OS/architecture from [Releases](https://github.com/ari-show/plugin-FlexDesigner-tokens/releases)
2. Import it from FlexDesigner's **Key Library**

### Build from source

```bash
git clone https://github.com/ari-show/plugin-FlexDesigner-tokens.git
cd plugin-FlexDesigner-tokens
npm install
npm run build
npm run plugin:pack       # produces com.arishow.aitokens.flexplugin
```

---

## Development

### Using Nix (recommended)

This repo pins its dev environment with a flake.

```bash
nix develop          # or just `direnv allow` if you use direnv
npm install
npm run dev          # run this while FlexDesigner is already running
```

If you don't have Nix, the Determinate Systems installer is the easiest way to get it:

```bash
curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | sh -s -- install
```

`flake.nix` provides Node.js 20 / git / jq, and confines npm's global prefix inside the repo (`.npm-global`) so `flexcli` doesn't pollute your whole system.

### Without Nix

Node.js 20+ is enough: `npm install && npm run dev`.

### Main commands

| Command | What it does |
|---|---|
| `npm run build` | Bundles the backend into `backend/plugin.cjs` |
| `npm test` | Runs the unit test suite |
| `npm run dev` | Link + watch + debug (run while FlexDesigner is running) |
| `npm run plugin:validate` | Validates the manifest and plugin structure |
| `npm run plugin:pack` | Produces the `.flexplugin` file |

### Layout

```
src/
  plugin.js              SDK event wiring, polling, backoff
  render.js              Key rendering (240×60) via @napi-rs/canvas
  providers/
    claude.js             OAuth usage endpoint (needs auth + network)
    claudeAuth.js          OAuth token refresh / re-login (Plan A/B), credential read/write
    codex.js                Reads rollout JSONL under ~/.codex/sessions
    codexActivity.js        Derives local turn status and session metadata from rollout JSONL
com.arishow.aitokens.plugin/
  manifest.json          Key definitions, i18n resources (en / ja)
  ui/*.vue               Settings page (Vue 3 + Vuetify 3)
test/
  providers/*.test.js    Unit tests for pure logic (normaliseWindow, etc.)
```

---

## Releasing

Pushing a tag that matches the `version` in `manifest.json` triggers GitHub Actions to
build a `.flexplugin` for all 3 OSes and attach them to a Release.

```bash
git tag v1.0.1
git push origin v1.0.1
```

---

## Troubleshooting

| Message | Cause and fix |
|---|---|
| `Claude credentials not found` | Run `claude` and log in, or log in from the plugin's settings page |
| `Claude auth rejected (401)` / other login-expiry errors | This is usually retried and refreshed automatically. If it persists, run `claude` again or re-login from the plugin settings page (can take a few minutes to take effect) |
| `Rate limited by usage API (429)` | Increase the refresh interval (60 seconds or more recommended) |
| `No Codex sessions found` | Run the Codex CLI at least once |
| `No rate limit data in recent Codex sessions` | Have at least one turn of conversation with Codex |
| `·stale` shown in the top-right of a key | The last refresh failed; showing the most recently fetched value |

---

## Security

See [SECURITY.md](SECURITY.md) for how to report vulnerabilities.

---

## License

[MIT](LICENSE) © ari-show

This project is unofficial and not affiliated with Anthropic, OpenAI, or EniacTech.
