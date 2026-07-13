# KLIVE / VLIVE Archive Integration Notes

This document records the publicly observable behavior of [KLIVE Archive](https://vlivearchive.com/) and its documented API. It is intended as a reference for building a third-party read-only site.

The observations below were made against the post:

```text
https://vlivearchive.com/post/0-18229254
```

and a cold-storage video:

```text
https://vlivearchive.com/post/1-24205874
```

Some implementation details are inferred from browser network traffic and may change without notice.

## Important usage notes

- Use the provided API rather than scraping the rendered HTML. The website is a JavaScript single-page application.
- Treat API response fields as the source of truth. Do not rely on the order of the `posts` array.
- Do not expose or persist temporary Dropbox redirect URLs. Request the archive download URL when playback is needed.
- Video availability can change. A video may be present in metadata but unavailable until it is retrieved from cold storage.
- Respect the archive's terms, bandwidth, copyright requirements, and request limits.

## Main concepts

There are three different identifiers commonly encountered:

| Identifier | Meaning |
|---|---|
| `postId` | Board-post identifier, for example `0-18229254` |
| `officialVideo.videoSeq` | Video identifier, for example `877` |
| `channelCode` | Channel identifier, for example `EDBF` for TWICE |

`postId` is not chronological. `videoSeq` is useful for addressing video media, but it should not be treated as the official date.

## Post data structure

A board response has this general structure:

```json
{
  "board": {
    "boardId": 3484,
    "boardType": "STAR",
    "channelCode": "EDBF",
    "title": "Star Board"
  },
  "posts": [
    {
      "postId": "0-18229254",
      "title": "[TWICE TV] Prologue",
      "contentType": "VIDEO",
      "createdAt": 1438090560000,
      "officialVideo": {
        "createdAt": 1438090569000,
        "videoSeq": 877,
        "title": "[TWICE TV] Prologue",
        "playTime": 84,
        "noticeYn": false
      },
      "captions": [],
      "subtitles": [],
      "mirrors": [],
      "alt_url": {}
    }
  ]
}
```

Common post fields include:

- `postId`, `boardId`, `channelCode`
- `title`, `contentType`, `postVersion`
- `createdAt`
- `officialVideo`
- `captions` and `subtitles`
- `mirrors` and `alt_url`
- `author`, `channel`, `board`
- `views`, `commentCount`, `totalCommentCount`

All timestamps are Unix timestamps in milliseconds.

## Recommended sorting

For an official video archive, sort by the official video timestamp, not the board-post timestamp:

```js
posts.sort((a, b) =>
  Number(a.officialVideo?.createdAt ?? 0) -
  Number(b.officialVideo?.createdAt ?? 0) ||
  Number(a.officialVideo?.videoSeq ?? 0) -
  Number(b.officialVideo?.videoSeq ?? 0)
);
```

Use descending order for newest first.

The distinction matters because:

- `posts[].createdAt` appears to describe the board/archive post time.
- `officialVideo.createdAt` represents the associated official video time.
- Several old posts share the same `createdAt`, while `officialVideo.createdAt` correctly orders them. For example, the order is Prologue, episode 1, episode 2.

If reproducing a historical board feed rather than an official video archive, use `posts[].createdAt` instead.

## API endpoints

The official documentation is at [docs.vlivearchive.com](https://docs.vlivearchive.com/).

### Channel metadata

```http
GET https://api.vlivearchive.com/channel/{channelCode}
```

Example:

```text
https://api.vlivearchive.com/channel/EDBF
```

This returns channel information and the channel's boards.

### Post page data

The website requests page-specific data from:

```http
GET https://api.vlivearchive.com/post/{postId}/page
```

Example:

```text
https://api.vlivearchive.com/post/0-18229254/page
```

This is the preferred endpoint for rendering an individual post page. It supplies the post/video metadata needed by the player, including subtitle information and video availability-related data.

### Video availability

```http
GET https://api.vlivearchive.com/video/{videoSeq}/status
```

Possible statuses documented by the archive include:

- `available`
- `available_to_request`
- `pending`
- `queued`
- `in_progress`
- `failed`
- video not found/error responses

Examples:

```json
{"status":"available"}
```

```json
{"status":"available_to_request"}
```

```json
{"status":"in_progress","percentDone":80}
```

### Request a cold-storage video

The public documentation describes a `POST` request, but browser inspection of the current website showed the website itself using:

```http
GET https://api.vlivearchive.com/video/{videoSeq}/request
```

Example observed response:

```json
{"status":"success"}
```

Use the documented method if integrating directly, and verify the current API behavior before relying on the undocumented browser method. The website displays an estimated wait time, requests retrieval, then polls the status endpoint.

### Video download/playback

Documented form:

```http
GET https://api.vlivearchive.com/download/{videoSeq}.mp4
```

The website player currently uses:

```http
GET https://vlivearchive.com/api/download/{videoSeq}
```

When available, the site endpoint returns a `302` redirect to the current storage provider. Do not hard-code the redirect target.

Example player source:

```html
<video
  crossorigin="anonymous"
  playsinline
  src="https://vlivearchive.com/api/download/877">
</video>
```

### Thumbnails

Full-size thumbnail:

```text
https://thumbs.vlivearchive.com/{videoSeq}.jpg
```

Small thumbnail:

```text
https://thumbs-sm.vlivearchive.com/{videoSeq}.jpg
```

The original extension is normalized to `.jpg` for full-size thumbnails. In practice, some videos may have missing thumbnails or alternate formats, so handle `404` responses.

### Profile pictures

```text
https://vlivearchive.com/pfp/{channelCode}.png
```

### Subtitles

Post metadata contains subtitle/caption records. The website loads external WebVTT files such as:

```text
https://vlivearchive.com/subtitles/877/877.fan.아토_l_Sarah.de_DE.vtt
```

Use the `file_name` from the response metadata rather than constructing filenames manually. A player can attach a subtitle using:

```html
<track
  kind="subtitles"
  srclang="en"
  label="English (official)"
  src="/subtitles/256489/256489.cp.en_US.vtt"
  default>
```

## Cold-storage workflow

A third-party client should implement this state machine:

```text
GET status
  ├─ available
  │    └─ play/download immediately
  ├─ available_to_request
  │    └─ request retrieval, then poll status
  ├─ pending / queued / in_progress
  │    └─ show progress/wait and continue polling
  ├─ failed
  │    └─ show retry/error state
  └─ not found
       └─ show unavailable state
```

Observed behavior for video `256489`:

1. `GET /video/256489/status` returned `available_to_request`.
2. The page showed an estimated loading time of approximately 40 seconds.
3. Clicking the play button called `GET /video/256489/request` and received `{"status":"success"}`.
4. The page polled `/video/256489/status` repeatedly.
5. A download attempt before retrieval returned `404`.
6. After roughly 30–40 seconds, `/api/download/256489` returned `302`.
7. The redirected media request returned `206 Partial Content` and the video became playable.

Recommended polling behavior:

- Start with a 2–5 second interval.
- Stop polling after a reasonable timeout, such as 10 minutes.
- Avoid sending duplicate retrieval requests while a request is pending.
- After status becomes `available`, request the download URL again.

## Storage and streaming observations

For tested videos, the archive API redirects to Dropbox-hosted URLs. The final response was:

```http
Content-Type: video/mp4
Content-Range: bytes 0-63053880/63053881
Accept-Ranges: bytes
```

This indicates normal MP4 progressive playback with HTTP byte ranges, not HLS or DASH. The application server does not appear to proxy the entire video; it redirects the browser to the storage provider.

The exact cold-storage backend is not public. The API hides it behind the status and download endpoints. Metadata may mention Google Drive mirrors while the current delivery URL resolves to Dropbox, so mirror metadata should not be treated as the current storage location.

## Player implementation

Browser inspection of the production JavaScript bundle found:

- A custom player implementation named `Tuby`.
- Custom CSS/DOM classes such as `tuby-container`, `tuby-controls`, and `tuby-seek-bar`.
- A native HTML5 `<video>` element underneath.
- No recognizable references to Video.js, Plyr, HLS.js, ReactPlayer, Vidstack, or MediaSource.
- External WebVTT subtitle tracks.

The player also loads Google's IMA SDK and requests VAST advertising through Google Ad Manager. A third-party site does not need to copy this player; a native `<video>` element with custom controls is sufficient for the MP4 delivery model.

## Minimal client example

```js
async function getVideoStatus(videoSeq) {
  const response = await fetch(
    `https://api.vlivearchive.com/video/${videoSeq}/status`
  );
  if (!response.ok) throw new Error(`Status request failed: ${response.status}`);
  return response.json();
}

function videoUrl(videoSeq) {
  // Let the archive handle redirects and storage-provider changes.
  return `https://vlivearchive.com/api/download/${videoSeq}`;
}

async function waitForVideo(videoSeq, { intervalMs = 5000, timeoutMs = 600000 } = {}) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const status = await getVideoStatus(videoSeq);

    if (status.status === "available") return videoUrl(videoSeq);
    if (status.status === "failed") throw new Error("Video retrieval failed");

    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  throw new Error("Timed out waiting for video retrieval");
}
```

For a video in `available_to_request`, call the current documented request endpoint/method, then use the same polling loop. Because the website currently uses a `GET` request while the documentation describes `POST`, keep this behavior configurable and verify it against the live API.

## Suggested low-cost third-party architecture

```text
Static React/Vite site
        ↓
API metadata fetches
        ↓
Local cache/database for channel and post metadata
        ↓
Native HTML5 video element
        ↓
Archive download endpoint
        ↓
Storage-provider redirect
```

To minimize cost:

- Cache metadata and thumbnails, but do not mirror all videos by default.
- Stream video directly from the archive redirect URL.
- Do not route video bytes through your own server.
- Use the official MP4 and VTT files instead of transcoding or repackaging them.
- Store only the fields needed for search and display locally.
- Cache cold-status results briefly and prevent duplicate requests.

## Sources

- [KLIVE Archive](https://vlivearchive.com/)
- [Official API documentation](https://docs.vlivearchive.com/)
- [Channels and boards](https://docs.vlivearchive.com/vlive-archive-documentation/channels-and-boards)
- [Videos and cold-storage requests](https://docs.vlivearchive.com/vlive-archive-documentation/multimedia/videos)
- [Images and thumbnails](https://docs.vlivearchive.com/vlive-archive-documentation/multimedia/images)
- [Archive service status](https://status.vlivearchive.com/)
