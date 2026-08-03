# Security Policy

## Supported Versions

This project is early-stage, so **only the latest release** is supported.
Security patches are not backported to older versions.

## Reporting a Vulnerability

If you find a vulnerability, **please do not open a public issue**.

Instead, report it via GitHub's [Private vulnerability reporting](https://github.com/ari-show/plugin-FlexDesigner-tokens/security/advisories/new)
(repository **Security** tab → **Report a vulnerability**).

Please include as much of the following as you can:

- Affected version(s) / OS
- Steps to reproduce
- Expected impact

There's no guaranteed response time, but reports will be reviewed as quickly as possible.

## Token handling

A summary of what this plugin does and does not do with Claude/Codex credentials. See
[README.md](README.md#how-tokens-are-handled) for details.

- The only thing read is an **already-saved local OAuth token** (macOS Keychain / `~/.claude/.credentials.json`).
  The plugin never prompts for or collects new credentials itself
- If the token has expired, it's refreshed either via silent `refreshToken`-based refresh (Plan A), or via a
  browser re-login from the settings page (Plan B, stored separately as plugin-only credentials)
- Tokens are **used only to authenticate to Anthropic** and are never written to logs, config files, or key
  rendering output
- **Nothing is ever sent to any third party.** Network requests only go to Anthropic's official domains
  (`api.anthropic.com` / `console.anthropic.com` / `claude.ai`)

## Dependence on an unofficial API

The Claude key's functionality depends on an internal API Anthropic has not publicly documented (see the
relevant section in [README.md](README.md) for details). If Anthropic requests it, this functionality may be
disabled or changed without notice.
