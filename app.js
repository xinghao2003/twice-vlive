(function () {
  "use strict";

  const VIEWED_KEY = "vlive-archive-viewed";
  const POSITION_KEY = "vlive-archive-positions";
  const viewed = new Set(JSON.parse(localStorage.getItem(VIEWED_KEY) || "[]").map(String));
  let positions = readPositions();
  let videos = [];

  const saveViewed = () => localStorage.setItem(VIEWED_KEY, JSON.stringify([...viewed]));
  const idOf = (video) => String(video.officialVideo.videoSeq);
  const dateOf = (video) => Number(video.officialVideo.createdAt || video.createdAt || 0);
  const titleOf = (video) => video.officialVideo.title || video.title || `Video ${idOf(video)}`;
  const formatDate = (timestamp) => timestamp ? new Date(timestamp).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "Unknown date";
  const videoUrl = (id) => `video.html?id=${encodeURIComponent(id)}`;
  function readPositions() {
    try { return JSON.parse(localStorage.getItem(POSITION_KEY) || "{}"); } catch { return {}; }
  }
  function formatTime(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const minutes = Math.floor(total / 60);
    return `${minutes}:${String(total % 60).padStart(2, "0")}`;
  }
  function savePosition(id, seconds, duration) {
    if (!Number.isFinite(seconds) || seconds < 1) return;
    if (Number.isFinite(duration) && duration > 0 && seconds >= duration - 5) delete positions[String(id)];
    else positions[String(id)] = Math.floor(seconds);
    localStorage.setItem(POSITION_KEY, JSON.stringify(positions));
  }
  function subtitleTracks(video) {
    const captions = Array.isArray(video.captions) ? video.captions : [];
    const subtitles = Array.isArray(video.subtitles) ? video.subtitles : [];
    return [...captions, ...subtitles].filter((track) => track.source || track.file_name).map((track) => {
      const locale = track.locale || track.name?.match(/[a-z]{2}(?:_[A-Z]{2})?/)?.[0] || "und";
      return {
        src: track.source || `https://vlivearchive.com/subtitles/${track.file_name}`,
        language: (track.language || locale.split("_")[0]).toLowerCase(),
        locale,
        label: track.label || track.name || locale,
        type: track.type || (track.name?.match(/\(([^)]+)\)/)?.[1] || "subtitle")
      };
    });
  }

  function addSubtitleTracks(player, video) {
    const tracks = subtitleTracks(video);
    if (!tracks.length) return;
    // Prefer Simplified Chinese, then Traditional Chinese. If neither exists,
    // prefer an official English track so a subtitle is still useful by default.
    const zhCn = tracks.findIndex((track) => track.locale.toLowerCase() === "zh_cn");
    const zhTw = tracks.findIndex((track) => track.locale.toLowerCase() === "zh_tw");
    const anyZh = tracks.findIndex((track) => track.language === "zh");
    const officialEnglish = tracks.findIndex((track) => track.language === "en" && track.type === "official");
    const preferred = zhCn >= 0 ? zhCn : zhTw >= 0 ? zhTw : anyZh >= 0 ? anyZh : officialEnglish;
    tracks.forEach((track, index) => {
      const element = document.createElement("track");
      element.kind = "subtitles";
      element.src = track.src;
      element.srclang = track.language;
      element.label = track.label + (track.type !== "subtitle" ? ` (${track.type})` : "");
      player.appendChild(element);
    });
    // Some browsers automatically enable the first <track>. Reset all modes
    // after insertion so exactly one subtitle is visible by default.
    const selectPreferred = () => {
      Array.from(player.textTracks).forEach((track) => { track.mode = "disabled"; });
      if (preferred >= 0 && player.textTracks[preferred]) player.textTracks[preferred].mode = "showing";
    };
    selectPreferred();
    // Chromium may auto-enable the first track on the next task after tracks
    // are inserted, so enforce the choice once more after that task.
    setTimeout(selectPreferred, 0);
    setTimeout(selectPreferred, 100);
  }

  function renderList() {
    const list = document.querySelector("#video-list");
    if (!list) return;
    const latest = document.querySelector("#sort-order").value === "latest";
    const sorted = [...videos].sort((a, b) => (latest ? -1 : 1) * (dateOf(a) - dateOf(b) || Number(idOf(a)) - Number(idOf(b))));
    list.innerHTML = sorted.map((video) => {
      const id = idOf(video);
      const isViewed = viewed.has(id);
      const position = positions[id];
      const progress = position ? ` · Resume ${formatTime(position)}` : "";
      return `<a class="video-row" href="${videoUrl(id)}">
        <span><h2>${escapeHtml(titleOf(video))}</h2><p class="muted">${formatDate(dateOf(video))} · Video ${escapeHtml(id)}${progress}</p></span>
        <span class="status ${isViewed ? "viewed" : ""}">${isViewed ? "Viewed" : "Not viewed"}</span>
      </a>`;
    }).join("");
    const remaining = videos.filter((video) => !viewed.has(idOf(video))).length;
    document.querySelector("#view-summary").textContent = `${videos.length - remaining} viewed · ${remaining} remaining`;
    const resumeCount = videos.filter((video) => Number(positions[idOf(video)]) > 0).length;
    const resumeSummary = document.querySelector("#resume-summary");
    if (resumeSummary) resumeSummary.textContent = resumeCount ? `${resumeCount} in progress` : "";
    const next = sorted.find((video) => !viewed.has(idOf(video)));
    const nextLink = document.querySelector("#next-unwatched");
    nextLink.href = next ? videoUrl(idOf(next)) : "#";
    nextLink.textContent = next ? "Play next unwatched" : "All videos viewed";
    nextLink.setAttribute("aria-disabled", next ? "false" : "true");
  }

  function renderPlayer() {
    const content = document.querySelector("#player-content");
    if (!content) return;
    const id = new URLSearchParams(location.search).get("id");
    const video = videos.find((item) => idOf(item) === String(id));
    if (!video) { showError("This video could not be found in board.json.", "#player-error"); return; }
    content.hidden = false;
    document.title = titleOf(video);
    document.querySelector("#video-title").textContent = titleOf(video);
    document.querySelector("#video-date").textContent = `${formatDate(dateOf(video))} · Video ${id}`;
    const player = document.querySelector("#video-player");
    const resumeMessage = document.querySelector("#resume-message");
    const savedPosition = Number(positions[String(id)] || 0);
    let positionRestored = false;
    let lastSavedPosition = -1;
    const persistPosition = () => {
      if (!positionRestored) return;
      const current = player.currentTime;
      if (Math.abs(current - lastSavedPosition) < 2 && !player.ended) return;
      lastSavedPosition = current;
      savePosition(id, current, player.duration);
    };
    const restorePosition = () => {
      if (positionRestored || !Number.isFinite(player.duration)) return;
      positionRestored = true;
      if (savedPosition > 0 && savedPosition < player.duration - 5) {
        try { player.currentTime = savedPosition; } catch {}
        if (resumeMessage) {
          resumeMessage.textContent = `Resuming from ${formatTime(savedPosition)}.`;
          resumeMessage.hidden = false;
        }
      } else {
        delete positions[String(id)];
      }
    };
    player.addEventListener("loadedmetadata", restorePosition, { once: true });
    player.addEventListener("timeupdate", persistPosition);
    player.addEventListener("pause", persistPosition);
    player.addEventListener("ended", () => { delete positions[String(id)]; localStorage.setItem(POSITION_KEY, JSON.stringify(positions)); });
    window.addEventListener("pagehide", persistPosition);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") persistPosition(); });
    setupMediaSession(player, video);
    addSubtitleTracks(player, video);
    const iframe = document.querySelector("#video-iframe");
    const iframeUrl = typeof video.alt_url?.iframe === "string" ? video.alt_url.iframe : "";
    let iframeStarted = false;
    const useIframeFallback = (reason) => {
      if (iframeStarted) return;
      if (!iframeUrl) { showError(reason, "#player-message"); return; }
      iframeStarted = true;
      player.pause();
      player.hidden = true;
      iframe.src = iframeUrl;
      iframe.hidden = false;
      const message = document.querySelector("#player-message");
      message.textContent = "The archive video is unavailable. Playing the backup player instead.";
      message.hidden = false;
      if (savedPosition > 0 && resumeMessage) {
        resumeMessage.textContent = `You previously stopped at ${formatTime(savedPosition)}. Please jump to that point manually in the backup player.`;
        resumeMessage.hidden = false;
      }
    };
    let recoveryStarted = false;
    player.addEventListener("error", () => {
      if (iframeStarted) return;
      if (!recoveryStarted) {
        recoveryStarted = true;
        prepareVideo(player, id, useIframeFallback);
      } else {
        useIframeFallback("The archive could not load this video after retrieval.");
      }
    });
    // Try the media endpoint first. Available videos begin loading without
    // waiting for a separate status API request.
    player.src = `https://vlivearchive.com/api/download/${encodeURIComponent(id)}`;
    player.load();
    const index = [...videos].sort((a, b) => dateOf(a) - dateOf(b) || Number(idOf(a)) - Number(idOf(b))).findIndex((item) => idOf(item) === String(id));
    const sorted = [...videos].sort((a, b) => dateOf(a) - dateOf(b) || Number(idOf(a)) - Number(idOf(b)));
    const setNav = (selector, item) => { const link = document.querySelector(selector); link.href = item ? videoUrl(idOf(item)) : "#"; link.setAttribute("aria-disabled", item ? "false" : "true"); };
    setNav("#previous-video", sorted[index - 1]); setNav("#next-video", sorted[index + 1]);
    const toggle = document.querySelector("#view-toggle");
    const updateToggle = () => { toggle.textContent = viewed.has(String(id)) ? "Mark as not viewed" : "Mark as viewed"; };
    updateToggle();
    toggle.addEventListener("click", () => { viewed.has(String(id)) ? viewed.delete(String(id)) : viewed.add(String(id)); saveViewed(); updateToggle(); });
  }

  function setupMediaSession(player, video) {
    if (!("mediaSession" in navigator) || !("MediaMetadata" in window)) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: titleOf(video), artist: "VLIVE archive", album: "Video archive" });
    const actions = {
      play: () => player.play(), pause: () => player.pause(),
      seekbackward: () => { player.currentTime = Math.max(0, player.currentTime - 10); },
      seekforward: () => { player.currentTime = Math.min(player.duration || Infinity, player.currentTime + 10); },
    };
    Object.entries(actions).forEach(([action, handler]) => {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch {}
    });
    ["play", "playing"].forEach((event) => player.addEventListener(event, () => { navigator.mediaSession.playbackState = "playing"; }));
    ["pause", "ended"].forEach((event) => player.addEventListener(event, () => { navigator.mediaSession.playbackState = "paused"; }));
  }

  function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char])); }
  function showError(message, selector) { const element = document.querySelector(selector); element.textContent = message; element.hidden = false; }
  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  async function prepareVideo(player, id, onFailure) {
    const message = document.querySelector("#player-message");
    const setMessage = (text) => { message.textContent = text; message.hidden = !text; };
    const source = `https://vlivearchive.com/api/download/${encodeURIComponent(id)}`;
    const statusUrl = `https://api.vlivearchive.com/video/${encodeURIComponent(id)}/status`;
    const getStatus = async () => {
      const response = await fetch(statusUrl);
      if (!response.ok) throw new Error(`Status request returned ${response.status}`);
      return response.json();
    };
    const setSource = () => { setMessage(""); player.src = source; player.load(); };

    setMessage("Checking video availability…");
    try {
      let status = await getStatus();
      if (status.status === "available") { setSource(); return; }
      if (status.status === "available_to_request") {
        setMessage("This video is in cold storage. Requesting it from the archive…");
        const request = await fetch(`https://api.vlivearchive.com/video/${encodeURIComponent(id)}/request`);
        if (!request.ok) throw new Error(`Retrieval request returned ${request.status}`);
      }
      const deadline = Date.now() + 10 * 60 * 1000;
      while (Date.now() < deadline) {
        const progress = status.percentDone ? ` (${status.percentDone}% complete)` : "";
        setMessage(`Waiting for the archive to retrieve this video${progress}…`);
        await wait(5000);
        status = await getStatus();
        if (status.status === "available") { setSource(); return; }
        if (status.status === "failed" || status.status === "not_found") throw new Error("The archive could not retrieve this video.");
      }
      throw new Error("The archive is taking longer than expected to retrieve this video. Please try again later.");
    } catch (error) {
      if (error.message.startsWith("Status request")) {
        onFailure("Availability could not be checked, and the archive video could not be loaded.");
      } else {
        onFailure(error.message);
      }
    }
  }
  fetch("board.json").then((response) => { if (!response.ok) throw new Error("Could not load board.json"); return response.json(); }).then((data) => {
    videos = (data.posts || []).filter((post) => post.officialVideo && post.officialVideo.videoSeq != null);
    const boardTitle = document.querySelector("#board-title"); if (boardTitle) boardTitle.textContent = data.board?.title || "Video archive";
    const summary = document.querySelector("#board-summary"); if (summary) summary.textContent = `${data.board?.channelCode || ""} · ${videos.length} videos`;
    renderList(); renderPlayer();
  }).catch((error) => showError(error.message, document.querySelector("#video-list") ? "#error" : "#player-error"));
  document.querySelector("#sort-order")?.addEventListener("change", renderList);
})();
