// Spotify Authorization Code + PKCE flow, using chrome.identity.launchWebAuthFlow
// as the redirect handler (works from any extension page).

const SPOTIFY_SCOPES =
  "user-read-currently-playing user-read-playback-state user-modify-playback-state";

function randomString(length) {
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values, (x) => possible[x % possible.length]).join("");
}

async function sha256(plain) {
  const data = new TextEncoder().encode(plain);
  return crypto.subtle.digest("SHA-256", data);
}

function base64UrlEncode(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function getClientId() {
  const { spotifyClientId } = await chrome.storage.local.get("spotifyClientId");
  return spotifyClientId || "";
}

async function saveClientId(clientId) {
  await chrome.storage.local.set({ spotifyClientId: clientId.trim() });
}

function getRedirectUri() {
  return chrome.identity.getRedirectURL();
}

async function getStoredTokens() {
  const { spotifyTokens } = await chrome.storage.local.get("spotifyTokens");
  return spotifyTokens || null;
}

async function saveTokens(tokens) {
  await chrome.storage.local.set({ spotifyTokens: tokens });
}

async function clearTokens() {
  await chrome.storage.local.remove(["spotifyTokens"]);
}

// Kicks off the login flow: opens Spotify's consent screen in a Chrome-managed
// popup and captures the redirect back to https://<ext-id>.chromiumapp.org/.
async function loginWithSpotify() {
  const clientId = await getClientId();
  if (!clientId) throw new Error("Client ID belum diisi.");

  const redirectUri = getRedirectUri();
  const codeVerifier = randomString(64);
  const codeChallenge = base64UrlEncode(await sha256(codeVerifier));
  const state = randomString(16);

  const authUrl = new URL("https://accounts.spotify.com/authorize");
  authUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    scope: SPOTIFY_SCOPES,
    redirect_uri: redirectUri,
    state,
    code_challenge_method: "S256",
    code_challenge: codeChallenge,
  }).toString();

  const resultUrl = await chrome.identity.launchWebAuthFlow({
    url: authUrl.toString(),
    interactive: true,
  });

  const params = new URL(resultUrl).searchParams;
  if (params.get("state") !== state) {
    throw new Error("State tidak cocok, coba login ulang.");
  }
  const error = params.get("error");
  if (error) throw new Error(`Spotify menolak otorisasi: ${error}`);

  const code = params.get("code");
  if (!code) throw new Error("Tidak menerima authorization code.");

  const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: codeVerifier,
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`Gagal menukar token: ${text}`);
  }

  const tokenData = await tokenRes.json();
  await saveTokens({
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresAt: Date.now() + tokenData.expires_in * 1000,
  });
}

async function refreshAccessToken(tokens) {
  const clientId = await getClientId();
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
      client_id: clientId,
    }),
  });

  if (!res.ok) {
    throw new Error("Refresh token gagal, silakan login ulang.");
  }

  const data = await res.json();
  const updated = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || tokens.refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  await saveTokens(updated);
  return updated;
}

// Returns a valid access token, refreshing it first if it's expired or about
// to expire. Returns null if the user has never logged in.
async function getValidAccessToken() {
  let tokens = await getStoredTokens();
  if (!tokens) return null;
  if (Date.now() > tokens.expiresAt - 30000) {
    tokens = await refreshAccessToken(tokens);
  }
  return tokens.accessToken;
}

async function logout() {
  await clearTokens();
}
