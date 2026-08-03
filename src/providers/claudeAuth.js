/**
 * Claude Code OAuth internals shared by the usage poller (claude.js) and the
 * settings-page re-login flow (plugin.js).
 *
 * Every endpoint, client id and field name here is reverse-engineered from the
 * Claude Code CLI — none of it is documented by Anthropic. It can change or
 * disappear without notice. See README.md for the same caveat surfaced to users.
 */
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

// Claude Code's own OAuth client id. Shared by every install — there is no
// per-user or per-plugin client id to register.
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";
const AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
// Anthropic's own hosted callback page (not a localhost server). It renders
// `code#state` for the user to copy back into our settings page.
const REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback";
const SCOPES = "org:create_api_key user:profile user:inference";

const SHARED_KEYCHAIN_SERVICE = "Claude Code-credentials";
const OWN_KEYCHAIN_SERVICE = "FlexDesigner AI Tokens-credentials";
const OWN_CREDENTIALS_FILE = path.join(os.homedir(), ".claude", "flexdesigner-ai-tokens.credentials.json");
const SHARED_CREDENTIALS_FILE = path.join(os.homedir(), ".claude", ".credentials.json");

const PENDING_REAUTH_TTL_MS = 15 * 60_000;

class InvalidGrantError extends Error {}
class ReauthRequiredError extends Error {}

let pendingReauth = null;

function base64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function createVerifier() {
  return base64url(crypto.randomBytes(32));
}

function createChallenge(verifier) {
  return base64url(crypto.createHash("sha256").update(verifier).digest());
}

function createState() {
  return base64url(crypto.randomBytes(16));
}

/**
 * Starts a fresh browser re-auth flow (案B) and remembers the PKCE verifier +
 * state so a later pasted code can be exchanged. Overwrites any previous
 * pending flow — only one re-login can be in progress at a time.
 */
function buildAuthorizeUrl() {
  const verifier = createVerifier();
  const state = createState();
  pendingReauth = { verifier, state, createdAt: Date.now() };

  const params = new URLSearchParams({
    code: "true",
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge: createChallenge(verifier),
    code_challenge_method: "S256",
    state
  });

  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * Posts a token request as `application/x-www-form-urlencoded` — the token
 * endpoint has been observed to hang/timeout on `application/json` bodies.
 */
async function postToken(body) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(15_000)
  });

  let json = null;
  try {
    json = await res.json();
  } catch {
    // fall through with json = null
  }

  if (!res.ok) {
    const errCode = json?.error;
    const message = json?.error_description || errCode || `Token endpoint returned HTTP ${res.status}`;
    if (errCode === "invalid_grant") throw new InvalidGrantError(message);
    throw new Error(message);
  }

  if (!json?.access_token || !json?.refresh_token) {
    throw new Error("Token endpoint response is missing access_token/refresh_token.");
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + (json.expires_in || 0) * 1000
  };
}

async function refreshWithToken(refreshToken) {
  if (!refreshToken) throw new InvalidGrantError("No refresh token available.");
  return postToken({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: CLIENT_ID
  });
}

/**
 * Exchanges a pasted `code#state` (or bare `code`) value for tokens, validating
 * it against the verifier/state stashed by the most recent buildAuthorizeUrl().
 */
async function exchangeCode(pastedValue) {
  if (!pendingReauth || Date.now() - pendingReauth.createdAt > PENDING_REAUTH_TTL_MS) {
    throw new Error("No pending login — click \"Log in with browser\" again first.");
  }

  const raw = String(pastedValue || "").trim();
  if (!raw) throw new Error("Paste the code shown on the Anthropic page.");

  const [code, state] = raw.split("#");
  if (!code || !state) {
    throw new Error("That doesn't look like the full code — it should contain a '#'.");
  }
  if (state !== pendingReauth.state) {
    throw new Error("Code does not match the current login attempt. Click \"Log in with browser\" again.");
  }

  const { verifier } = pendingReauth;
  const tokens = await postToken({
    grant_type: "authorization_code",
    code,
    state,
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier
  });

  pendingReauth = null;
  return tokens;
}

async function readDarwinKeychainRaw(service) {
  const { stdout } = await execFileAsync("security", ["find-generic-password", "-s", service, "-w"]);
  return stdout;
}

/** Fetches the `acct` attribute of a Keychain item, needed to overwrite it in place. */
async function readDarwinKeychainAccount(service) {
  try {
    // Without `-w` this prints attributes (including "acct"<blob>="...") to stdout.
    const { stdout } = await execFileAsync("security", ["find-generic-password", "-s", service]);
    const m = stdout.match(/"acct"<blob>="([^"]*)"/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

async function writeDarwinKeychain(service, account, json) {
  await execFileAsync("security", [
    "add-generic-password",
    "-U",
    "-a", account,
    "-s", service,
    "-w", json
  ]);
}

function unwrapOauth(parsed) {
  const hasWrapper = !!parsed.claudeAiOauth;
  const oauth = hasWrapper ? parsed.claudeAiOauth : parsed;
  return { hasWrapper, oauth };
}

function mergeCredentials(parsed, tokens) {
  const { hasWrapper, oauth } = unwrapOauth(parsed);
  const mergedOauth = {
    ...oauth,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt
  };
  return hasWrapper ? { ...parsed, claudeAiOauth: mergedOauth } : mergedOauth;
}

/** Reads Claude Code's own shared credentials (same file/Keychain item Claude Code CLI uses). */
async function readSharedCredentials() {
  let raw;
  if (process.platform === "darwin") {
    try {
      raw = await readDarwinKeychainRaw(SHARED_KEYCHAIN_SERVICE);
    } catch {
      throw new Error("Claude credentials not found in Keychain. Run `claude` and log in, or log in from the settings page.");
    }
  } else {
    try {
      raw = await fs.readFile(SHARED_CREDENTIALS_FILE, "utf8");
    } catch {
      throw new Error(`Claude credentials not found at ${SHARED_CREDENTIALS_FILE}. Run \`claude\` and log in, or log in from the settings page.`);
    }
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Claude credentials are not valid JSON.");
  }

  const { oauth } = unwrapOauth(parsed);
  if (!oauth.accessToken) throw new Error("No accessToken in Claude credentials.");
  return { parsed, oauth };
}

/**
 * Writes refreshed tokens back to Claude Code's own credential store, preserving
 * every other field (scopes, subscriptionType, ...) and the claudeAiOauth wrapper.
 */
async function writeSharedCredentials(parsed, tokens) {
  const merged = mergeCredentials(parsed, tokens);
  const json = JSON.stringify(merged);

  if (process.platform === "darwin") {
    const account = await readDarwinKeychainAccount(SHARED_KEYCHAIN_SERVICE);
    if (!account) {
      throw new Error("Could not read the Keychain account for Claude Code-credentials; refusing to write back to avoid creating a duplicate item.");
    }
    await writeDarwinKeychain(SHARED_KEYCHAIN_SERVICE, account, json);
  } else {
    await fs.writeFile(SHARED_CREDENTIALS_FILE, json, "utf8");
  }
}

/** Reads the plugin's own fallback credentials (案B), separate from Claude Code's. */
async function readOwnCredentials() {
  let raw;
  if (process.platform === "darwin") {
    try {
      raw = await readDarwinKeychainRaw(OWN_KEYCHAIN_SERVICE);
    } catch {
      return null;
    }
  } else {
    try {
      raw = await fs.readFile(OWN_CREDENTIALS_FILE, "utf8");
    } catch {
      return null;
    }
  }

  try {
    const oauth = JSON.parse(raw);
    if (!oauth.accessToken) return null;
    return { parsed: oauth, oauth };
  } catch {
    return null;
  }
}

async function writeOwnCredentials(tokens) {
  const merged = { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: tokens.expiresAt };
  const json = JSON.stringify(merged);

  if (process.platform === "darwin") {
    const account = (await readDarwinKeychainAccount(OWN_KEYCHAIN_SERVICE)) || "flexdesigner-ai-tokens";
    await writeDarwinKeychain(OWN_KEYCHAIN_SERVICE, account, json);
  } else {
    await fs.writeFile(OWN_CREDENTIALS_FILE, json, { encoding: "utf8", mode: 0o600 });
    await fs.chmod(OWN_CREDENTIALS_FILE, 0o600);
  }
}

module.exports = {
  InvalidGrantError,
  ReauthRequiredError,
  buildAuthorizeUrl,
  exchangeCode,
  refreshWithToken,
  readSharedCredentials,
  writeSharedCredentials,
  readOwnCredentials,
  writeOwnCredentials
};
