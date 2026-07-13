(function () {
  "use strict";

  const VIEWED_KEY = "vlive-archive-viewed";
  const viewed = new Set(JSON.parse(localStorage.getItem(VIEWED_KEY) || "[]").map(String));
  let videos = [];

  const saveViewed = () => localStorage.setItem(VIEWED_KEY, JSON.stringify([...viewed]));
  const idOf = (video) => String(video.officialVideo.videoSeq);
  const dateOf = (video) => Number(video.officialVideo.createdAt || video.createdAt || 0);
  const titleOf = (video) => video.officialVideo.title || video.title || `Video ${idOf(video)}`;
  const formatDate = (timestamp) => timestamp ? new Date(timestamp).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "Unknown date";
  const videoUrl = (id) => `video.html?id=${encodeURIComponent(id)}`;
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
      return `<a class="video-row" href="${videoUrl(id)}">
        <span><h2>${escapeHtml(titleOf(video))}</h2><p class="muted">${formatDate(dateOf(video))} · Video ${escapeHtml(id)}</p></span>
        <span class="status ${isViewed ? "viewed" : ""}">${isViewed ? "Viewed" : "Not viewed"}</span>
      </a>`;
    }).join("");
    const remaining = videos.filter((video) => !viewed.has(idOf(video))).length;
    document.querySelector("#view-summary").textContent = `${videos.length - remaining} viewed · ${remaining} remaining`;
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
    addSubtitleTracks(player, video);
    player.addEventListener("error", () => showError("The archive could not load this video. It may be unavailable or still in cold storage.", "#player-message"));
    prepareVideo(player, id);
    const index = [...videos].sort((a, b) => dateOf(a) - dateOf(b) || Number(idOf(a)) - Number(idOf(b))).findIndex((item) => idOf(item) === String(id));
    const sorted = [...videos].sort((a, b) => dateOf(a) - dateOf(b) || Number(idOf(a)) - Number(idOf(b)));
    const setNav = (selector, item) => { const link = document.querySelector(selector); link.href = item ? videoUrl(idOf(item)) : "#"; link.setAttribute("aria-disabled", item ? "false" : "true"); };
    setNav("#previous-video", sorted[index - 1]); setNav("#next-video", sorted[index + 1]);
    const toggle = document.querySelector("#view-toggle");
    const updateToggle = () => { toggle.textContent = viewed.has(String(id)) ? "Mark as not viewed" : "Mark as viewed"; };
    updateToggle();
    toggle.addEventListener("click", () => { viewed.has(String(id)) ? viewed.delete(String(id)) : viewed.add(String(id)); saveViewed(); updateToggle(); });
  }

  function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char])); }
  function showError(message, selector) { const element = document.querySelector(selector); element.textContent = message; element.hidden = false; }
  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  async function prepareVideo(player, id) {
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
      // Keep a direct playback fallback if the status service is temporarily unavailable.
      if (error.message.startsWith("Status request")) {
        setMessage("Availability could not be checked. Trying the archive player directly…");
        player.src = source;
        player.load();
      } else {
        showError(error.message, "#player-message");
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
