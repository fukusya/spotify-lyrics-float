// Main logic for the persistent "host" tab: Spotify auth/setup UI, polling
// the currently-playing track, fetching lyrics, and hosting the
// Document Picture-in-Picture floating box.

const POLL_MS = 3000;
const TICK_MS = 200;
const BLANK_COVER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36"><rect width="36" height="36" fill="%23333"/></svg>'
  );

const els = {
  setup: document.getElementById("setup"),
  panel: document.getElementById("panel"),
  redirectUri: document.getElementById("redirectUri"),
  copyRedirect: document.getElementById("copyRedirect"),
  clientIdInput: document.getElementById("clientIdInput"),
  saveClientId: document.getElementById("saveClientId"),
  loginBtn: document.getElementById("loginBtn"),
  setupMsg: document.getElementById("setupMsg"),
  cover: document.getElementById("cover"),
  trackName: document.getElementById("trackName"),
  trackArtist: document.getElementById("trackArtist"),
  lyricsScroll: document.getElementById("lyricsScroll"),
  openSpotifyBtn: document.getElementById("openSpotifyBtn"),
  minimizeBtn: document.getElementById("minimizeBtn"),
  miniBubble: document.getElementById("miniBubble"),
  miniCover: document.getElementById("miniCover"),
  floatBtn: document.getElementById("floatBtn"),
  logoutBtn: document.getElementById("logoutBtn"),
  prevBtn: document.getElementById("prevBtn"),
  playPauseBtn: document.getElementById("playPauseBtn"),
  nextBtn: document.getElementById("nextBtn"),
  curTime: document.getElementById("curTime"),
  seekBar: document.getElementById("seekBar"),
  durTime: document.getElementById("durTime"),
};

let state = {
  trackId: null,
  trackUrl: null,
  syncedLines: null, // [{time, text}] or null
  plainText: null,
  baseProgressSec: 0,
  baseTimestamp: 0,
  durationSec: 0,
  isPlaying: false,
  activeIndex: -1,
  isSeeking: false,
  isMinimized: false,
  restoreSize: null,
};

let pipWindow = null;
let pollTimer = null;
let tickTimer = null;

function setStatusMessage(text) {
  els.lyricsScroll.innerHTML = `<div class="status-msg">${text}</div>`;
}

function renderLyricsSkeleton() {
  if (state.syncedLines && state.syncedLines.length) {
    els.lyricsScroll.innerHTML = state.syncedLines
      .map((l, i) => `<div class="lyrics-line" data-i="${i}">${escapeHtml(l.text) || "&nbsp;"}</div>`)
      .join("");
  } else if (state.plainText) {
    els.lyricsScroll.innerHTML = state.plainText
      .split("\n")
      .map((line) => `<div class="lyrics-line">${escapeHtml(line) || "&nbsp;"}</div>`)
      .join("");
  } else {
    setStatusMessage("Lirik tidak ditemukan untuk lagu ini.");
  }
}

function setCoverSrc(url) {
  els.cover.src = url;
  els.miniCover.src = url;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function getCurrentTimeSec() {
  if (!state.isPlaying) return state.baseProgressSec;
  return state.baseProgressSec + (Date.now() - state.baseTimestamp) / 1000;
}

function formatTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function tick() {
  const t = getCurrentTimeSec();

  if (!state.isSeeking) {
    els.seekBar.value = Math.round(t);
    els.curTime.textContent = formatTime(t);
  }

  if (!state.syncedLines || !state.syncedLines.length) return;
  const idx = findActiveLineIndex(state.syncedLines, t);
  if (idx === state.activeIndex) return;

  const doc = pipWindow ? pipWindow.document : document;
  const prev = doc.querySelector(".lyrics-line.active");
  if (prev) prev.classList.remove("active");

  if (idx >= 0) {
    const el = doc.querySelector(`.lyrics-line[data-i="${idx}"]`);
    if (el) {
      el.classList.add("active");
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }
  state.activeIndex = idx;
}

async function loadLyricsFor(item) {
  state.syncedLines = null;
  state.plainText = null;
  state.activeIndex = -1;
  try {
    const data = await fetchLyrics({
      track: item.name,
      artist: item.artists.map((a) => a.name).join(", "),
      album: item.album && item.album.name,
      durationSec: item.duration_ms / 1000,
    });
    if (data && data.syncedLyrics) {
      state.syncedLines = parseSyncedLyrics(data.syncedLyrics);
    } else if (data && data.plainLyrics) {
      state.plainText = data.plainLyrics;
    } else if (data && data.instrumental) {
      state.plainText = "(Instrumental — tanpa lirik)";
    }
  } catch (e) {
    console.warn("Gagal mengambil lirik:", e);
  }
  renderLyricsSkeleton();
}

async function pollCurrentTrack() {
  const token = await getValidAccessToken();
  if (!token) return;

  let res;
  try {
    res = await fetch("https://api.spotify.com/v1/me/player/currently-playing", {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (e) {
    console.warn("Network error polling Spotify:", e);
    return;
  }

  if (res.status === 204) {
    state.trackId = null;
    state.trackUrl = null;
    els.openSpotifyBtn.disabled = true;
    els.trackName.textContent = "Tidak ada yang diputar";
    els.trackArtist.textContent = "—";
    setCoverSrc(BLANK_COVER);
    setStatusMessage("Spotify sedang tidak memutar apa pun.");
    return;
  }

  if (res.status === 401) {
    return; // will refresh + retry on next poll via getValidAccessToken
  }

  if (!res.ok) {
    console.warn("Spotify API error", res.status);
    return;
  }

  const data = await res.json();
  if (!data || !data.item) return;

  state.isPlaying = data.is_playing;
  state.baseProgressSec = (data.progress_ms || 0) / 1000;
  state.baseTimestamp = Date.now();
  state.durationSec = (data.item.duration_ms || 0) / 1000;

  els.playPauseBtn.textContent = state.isPlaying ? "⏸" : "▶";
  els.durTime.textContent = formatTime(state.durationSec);
  els.seekBar.max = Math.round(state.durationSec);
  if (!state.isSeeking) els.seekBar.value = Math.round(state.baseProgressSec);

  const item = data.item;
  els.trackName.textContent = item.name;
  els.trackArtist.textContent = item.artists.map((a) => a.name).join(", ");
  const art = item.album && item.album.images && item.album.images[0];
  setCoverSrc(art ? art.url : BLANK_COVER);

  state.trackUrl = (item.external_urls && item.external_urls.spotify) || null;
  els.openSpotifyBtn.disabled = !state.trackUrl;

  if (item.id !== state.trackId) {
    state.trackId = item.id;
    setStatusMessage("Memuat lirik…");
    await loadLyricsFor(item);
  }
}

function startLoops() {
  stopLoops();
  pollCurrentTrack();
  pollTimer = setInterval(pollCurrentTrack, POLL_MS);
  tickTimer = setInterval(tick, TICK_MS);
}

function stopLoops() {
  if (pollTimer) clearInterval(pollTimer);
  if (tickTimer) clearInterval(tickTimer);
  pollTimer = null;
  tickTimer = null;
}

// --- Playback controls (needs the user-modify-playback-state scope) ---

async function spotifyPlayerRequest(method, path) {
  const token = await getValidAccessToken();
  if (!token) return null;
  const res = await fetch(`https://api.spotify.com/v1/me/player${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) {
    alert("Tidak ada perangkat Spotify yang sedang aktif memutar lagu.");
  } else if (res.status === 403) {
    alert(
      "Izin belum mencukupi untuk mengontrol playback.\nKlik ⏻ untuk disconnect, lalu Connect ulang untuk memberi izin baru."
    );
  }
  return res;
}

async function togglePlayPause() {
  const action = state.isPlaying ? "pause" : "play";
  await spotifyPlayerRequest("PUT", `/${action}`);
  setTimeout(pollCurrentTrack, 300);
}

async function skipNext() {
  await spotifyPlayerRequest("POST", "/next");
  setTimeout(pollCurrentTrack, 300);
}

async function skipPrevious() {
  await spotifyPlayerRequest("POST", "/previous");
  setTimeout(pollCurrentTrack, 300);
}

async function seekTo(sec) {
  await spotifyPlayerRequest("PUT", `/seek?position_ms=${Math.round(sec * 1000)}`);
  state.baseProgressSec = sec;
  state.baseTimestamp = Date.now();
  setTimeout(pollCurrentTrack, 300);
}

function copyStylesToPip(win) {
  [...document.styleSheets].forEach((styleSheet) => {
    try {
      const cssRules = [...styleSheet.cssRules].map((r) => r.cssText).join("");
      const style = document.createElement("style");
      style.textContent = cssRules;
      win.document.head.appendChild(style);
    } catch (e) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = styleSheet.href;
      win.document.head.appendChild(link);
    }
  });
}

function toggleMinimize() {
  if (!pipWindow) return;

  state.isMinimized = !state.isMinimized;
  els.panel.classList.toggle("minimized", state.isMinimized);

  if (state.isMinimized) {
    state.restoreSize = { w: pipWindow.innerWidth, h: pipWindow.innerHeight };
    try {
      pipWindow.resizeTo(88, 88);
    } catch (e) {
      console.warn("Resize ke bubble kecil tidak didukung:", e);
    }
  } else {
    const size = state.restoreSize || { w: 360, h: 260 };
    try {
      pipWindow.resizeTo(size.w, size.h);
    } catch (e) {
      console.warn("Resize kembali ke ukuran normal tidak didukung:", e);
    }
  }
}

async function toggleFloat() {
  if (!("documentPictureInPicture" in window)) {
    alert(
      "Browser ini belum mendukung Document Picture-in-Picture.\nButuh Chrome/Edge versi 116 ke atas."
    );
    return;
  }

  if (pipWindow) {
    pipWindow.close();
    return;
  }

  pipWindow = await documentPictureInPicture.requestWindow({
    width: 360,
    height: 220,
  });

  copyStylesToPip(pipWindow);
  pipWindow.document.body.style.margin = "0";
  pipWindow.document.body.style.background = "#121212";
  pipWindow.document.body.appendChild(els.panel);
  state.activeIndex = -1; // force re-highlight against the moved DOM
  els.minimizeBtn.classList.remove("hidden");

  pipWindow.addEventListener(
    "pagehide",
    () => {
      document.body.appendChild(els.panel);
      pipWindow = null;
      state.activeIndex = -1;
      state.isMinimized = false;
      els.panel.classList.remove("minimized");
      els.minimizeBtn.classList.add("hidden");
    },
    { once: true }
  );
}

async function refreshUiForAuthState() {
  els.redirectUri.value = getRedirectUri();
  const clientId = await getClientId();
  if (clientId) els.clientIdInput.value = clientId;

  const token = await getValidAccessToken().catch(() => null);
  if (token) {
    els.setup.classList.add("hidden");
    els.panel.classList.remove("hidden");
    startLoops();
  } else {
    els.setup.classList.remove("hidden");
    els.panel.classList.add("hidden");
    stopLoops();
  }
}

els.copyRedirect.addEventListener("click", async () => {
  await navigator.clipboard.writeText(els.redirectUri.value);
  els.copyRedirect.textContent = "Copied!";
  setTimeout(() => (els.copyRedirect.textContent = "Copy"), 1500);
});

els.saveClientId.addEventListener("click", async () => {
  await saveClientId(els.clientIdInput.value);
  els.setupMsg.textContent = "Client ID tersimpan. Klik 'Connect ke Spotify'.";
});

els.loginBtn.addEventListener("click", async () => {
  els.setupMsg.textContent = "Membuka jendela login Spotify…";
  try {
    await loginWithSpotify();
    els.setupMsg.textContent = "";
    await refreshUiForAuthState();
  } catch (e) {
    els.setupMsg.textContent = `Gagal login: ${e.message}`;
  }
});

els.logoutBtn.addEventListener("click", async () => {
  await logout();
  await refreshUiForAuthState();
});

els.openSpotifyBtn.addEventListener("click", () => {
  if (state.trackUrl) chrome.tabs.create({ url: state.trackUrl });
});

els.minimizeBtn.addEventListener("click", toggleMinimize);
els.miniBubble.addEventListener("click", toggleMinimize);

els.floatBtn.addEventListener("click", toggleFloat);

els.prevBtn.addEventListener("click", skipPrevious);
els.nextBtn.addEventListener("click", skipNext);
els.playPauseBtn.addEventListener("click", togglePlayPause);

els.seekBar.addEventListener("input", (e) => {
  state.isSeeking = true;
  els.curTime.textContent = formatTime(Number(e.target.value));
});

els.seekBar.addEventListener("change", async (e) => {
  await seekTo(Number(e.target.value));
  state.isSeeking = false;
});

refreshUiForAuthState();
