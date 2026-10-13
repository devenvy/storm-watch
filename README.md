# Storm Watch

A severe-weather monitor that runs entirely in your browser. Pick a location and get, on one screen:

- **NWS alerts** for your point, with an EAS-style tone and desktop notification for danger-level warnings
- **Radar** with a scrubbable timeline: past radar flowing into a 6-hour model forecast, local-site
  reflectivity and velocity (rotation), a second independent composite, and warning polygons on top
- **Current conditions** from the nearest _reporting_ home weather station on the Ambient Weather Network
  (rain rate, rain today and storm total, gusts; pick a different nearby station if you like), plus the
  nearest reporting NWS station
- **Tropical storms** from the National Hurricane Center, with forecast cones
- **Live TV** from _your own_ IPTV service (Xtream Codes or M3U), with a pre-picked "storm lineup" that
  can switch to a default channel automatically when a Tornado Warning is issued
- **Your own dashboards**: drag, resize, add and remove widgets; several dashboards as tabs (e.g. two radars
  side by side, or a "No TV" board)
- **Share / TV links**: one URL that sets up a TV, signage player (Screenly etc.) or phone, optionally in a
  menu-free kiosk mode

There is no backend. Weather data comes straight from public, keyless government and open-data APIs, and
your settings stay in your browser's storage.

> **Storm Watch is not an official warning system.** Always have a primary way to receive warnings
> (NOAA Weather Radio, Wireless Emergency Alerts, local broadcast) and follow instructions from local officials.

## About this code: AI-generated

This project was written almost entirely by AI coding assistants, directed and reviewed by a human
maintainer:

- **Claude** (Anthropic, via Claude Code) generated the application code, tests, Docker/nginx setup and
  CI workflows.
- **Codex** (OpenAI) was used as an independent second reviewer for code review and security review.
- The human maintainer set the requirements, tested against real weather and IPTV services during an active
  hurricane, and decided what shipped.

Review the code with that in mind, and please open issues for anything that looks wrong.

## Data sources

Everything is public and needs no API key. Each source is called directly from the browser, which is why
CORS support decided what is included.

| Information                                                           | Source                                                                                                                                 | Endpoint(s) used                                    |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Location lookup (search)                                              | [Open-Meteo Geocoding](https://open-meteo.com/en/docs/geocoding-api)                                                                   | `geocoding-api.open-meteo.com/v1/search`            |
| NWS office, radar site, nearest stations                              | [National Weather Service API](https://www.weather.gov/documentation/services-web-api)                                                 | `api.weather.gov/points/{lat},{lon}`                |
| Active alerts for your point                                          | National Weather Service API                                                                                                           | `api.weather.gov/alerts/active?point=`              |
| Warning polygons (tornado, severe t-storm, flash flood, extreme wind) | National Weather Service API                                                                                                           | `api.weather.gov/alerts/active?event=`              |
| Current conditions (official)                                         | National Weather Service API                                                                                                           | `api.weather.gov/stations/{id}/observations/latest` |
| Current conditions (nearby home stations)                             | [Ambient Weather Network](https://ambientweather.net/) public stations¹                                                                | `lightning.ambientweather.net/devices?$publicBox…`  |
| Radar mosaic, last 50 min                                             | [Iowa Environmental Mesonet](https://mesonet.agron.iastate.edu/ogc/) (NEXRAD)                                                          | `cache/tile.py/1.0.0/nexrad-n0q-900913…`            |
| Forecast radar, next 6 h (HRRR model, simulated)                      | Iowa Environmental Mesonet                                                                                                             | `cache/tile.py/1.0.0/hrrr::REFD-F…`                 |
| Local radar reflectivity and velocity                                 | Iowa Environmental Mesonet (NEXRAD Level III)                                                                                          | `json/radar.py`, `cache/tile.py/1.0.0/ridge::…`     |
| Second radar composite, last 2 h                                      | [RainViewer](https://www.rainviewer.com/api.html)                                                                                      | `api.rainviewer.com/public/weather-maps.json`       |
| Local radar loop image                                                | [NWS RIDGE](https://radar.weather.gov/)                                                                                                | `radar.weather.gov/ridge/standard/{site}_loop.gif`  |
| Tropical storms (position, intensity, motion)                         | [NOAA / NHC tropical map service](https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer) | `…/MapServer/{layer}/query`                         |
| Forecast cone graphic, advisories                                     | [National Hurricane Center](https://www.nhc.noaa.gov/)                                                                                 | `nhc.noaa.gov/storm_graphics/…`                     |
| Base map                                                              | [OpenStreetMap](https://www.openstreetmap.org/copyright)                                                                               | `tile.openstreetmap.org`                            |
| Live TV                                                               | **Your own** IPTV provider                                                                                                             | Xtream Codes `player_api.php` or an M3U playlist    |

¹ Stations their owners have made public. This keyless endpoint is the one behind the Ambient Weather
Network map (and Home Assistant's `ambient_network` integration); it is undocumented and may change, so
Storm Watch treats it as optional, ignores stations that haven't reported in 30 minutes, and keeps only outdoor
readings.

Please respect these services: Storm Watch polls alerts and conditions once a minute and tropical data every
ten minutes. If you run a busy public instance, consider the services' usage policies.

## Using it

### Hosted

<https://devenvy.github.io/storm-watch/>

Open the site, go to **Setup**, set your location, and optionally add an IPTV source and pick your channels.
Click **Enable alert sounds** once per visit (browsers only play audio after a click).

### Self-hosted with Docker

```bash
docker build -t stormwatch .
docker run -d --name stormwatch -p 8080:8080 --read-only --tmpfs /tmp stormwatch
# or: docker compose up -d
```

Then open <http://localhost:8080>. The image is a static nginx server (non-root, port 8080) with a strict
Content-Security-Policy and a `/healthz` endpoint. Release builds are published to GitHub Container Registry:

```bash
docker run -d --name stormwatch -p 8080:8080 --read-only --tmpfs /tmp ghcr.io/devenvy/storm-watch:1.0.0-beta.1
```

Any static host works too: download the zip from a release and serve its contents. URLs use `#/…` routing,
so no rewrite rules are needed and the app works from a sub-path.

### Dashboards

Click **✎ Edit** above the dashboard to rename it, set how many rows fit on screen, add widgets, drag them
into order (⠿ handle), change width/height, pin a TV widget to a specific channel, or create, duplicate and
delete dashboards. Every dashboard has its own URL: `#/d/<name>`.

### Share / TV links

**Setup → Share / TV link** builds one URL containing your location and dashboards, plus a choice of which
dashboard to open and whether to use **kiosk mode** (no menus). Paste it into a TV browser, a signage player
such as Screenly, or a phone.

- The setup is stored **after the `#`** in the URL, so it is never sent to the web server. Anyone who has the
  link can still read it.
- Your **IPTV login and lineup are only included if you tick the box**, because Xtream stream URLs contain
  your username and password. Only send such links to devices you own.
- Opening a link on a device that already has a different setup asks before replacing it. A device that
  reloads the same link (e.g. signage on a schedule) applies it silently and re-fetches the channel list.

### Keyboard

Watch page: `↑`/`↓` change channel, `1`–`9` jump to a channel, `F` fullscreen.
Radar: `←`/`→` step frames, `Space` play/pause. `Esc` closes an expanded card.

## IPTV in the browser

Streams are played client-side: hls.js for `.m3u8` and mpegts.js for MPEG-TS (H.264/AAC). Streams that drop
are reconnected automatically, and a watchdog reloads a frozen picture. Two things decide whether a
provider works in the browser:

1. **CORS**: the provider must send `Access-Control-Allow-Origin` headers. Many do; the Setup page tells you
   if yours doesn't.
2. **Mixed content**: most IPTV servers are plain `http://`. Browsers block `http` streams on an `https`
   page, so on the hosted (https) site only `https` providers will play. For `http` providers, self-host
   Storm Watch over `http` on your LAN (the Docker image above).

Your provider's connection limit applies: each playing TV widget uses one connection.

## Privacy and security

- No backend, no accounts, no analytics. Settings live in IndexedDB in your browser.
- Weather services see the coordinates you set (that's how they answer); nothing else about you is sent.
- IPTV credentials are only sent to your IPTV provider, and only leave the device in a share link or lineup
  export if you explicitly choose that.
- Imported files and share links are validated (only `http(s)` URLs are accepted, sizes are capped), and
  alert text from feeds is always rendered as text, never HTML.

## Development

Requires Node.js 24.

```bash
pnpm install
pnpm start           # dev server on http://127.0.0.1:4317
pnpm run lint
pnpm run test:ci     # unit tests (Vitest)
pnpm run build       # production build in dist/stormwatch/browser
```

Built with Angular 22 (standalone components, signals, zoneless, OnPush), Leaflet, hls.js, mpegts.js and the
Angular CDK. Storage sits behind a small `StorageBackend` interface (`src/app/core/storage`) so it can be
swapped (e.g. for a server-backed store) without touching features.

### CI / releases

- **CI** (`ci.yml`), on every pull request and weekly: lint (including `code-guidelines check`,
  knip, actionlint and zizmor), unit tests with coverage, the production build, a runtime dependency
  audit, dependency review, and a container build with a smoke test of its security headers. `result`
  is the single required check. CodeQL and Code Quality also run on pull requests.
- **Dependabot**: one grouped pull request a week for npm, GitHub Actions and Docker updates; it
  merges itself once CI passes.
- **Every push to `main`** (`release.yml`): CI, then the site deploys to GitHub Pages and the image
  is pushed to `ghcr.io/devenvy/storm-watch` as `latest` and `sha-<commit>`.
- **Releases** are cut by hand: `gh release create vX.Y.Z --target main --generate-notes` (or the
  Releases page). Publishing one runs CI, pushes the image as `X.Y.Z` and `X.Y`, and attaches a zip of
  the static build and an SBOM to the release.

## License

[MIT](LICENSE)
