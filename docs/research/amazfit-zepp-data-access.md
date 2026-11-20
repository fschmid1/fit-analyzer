# Getting Amazfit / Zepp data out and into self-hosted tooling

Research note for `fit-analyzer`. Scope: the **Amazfit smartwatch + Zepp app** (Zepp Health / Huami) ecosystem, and how to move data into a self-hosted analysis pipeline (ideally raw FIT/GPX/TCX, otherwise structured health metrics).

> Research date: 2026-10-16. The reverse-engineered API surface here is volatile: Zepp has repeatedly moved endpoints, added SSL pinning, and encrypted the login payload (see §2.3). Anything marked **[RE]** is reverse-engineered from the official apps, not documented by Zepp. Verify against the linked repo/issue before relying on it.

---

## TL;DR

- **There is no official, individual-facing Zepp/Huami "user data" API.** The only official user-data API is the legacy **Huami Web API**, which is partner-only ("corporate users, not individual users") and was last updated in 2020. [→ §2.2](#22-official-first-party-user-data-api-huami--zepp-web-api-partner-only)
- **Zepp OS developer APIs are for building apps/watchfaces, not for reading a user's history.** Zepp staff confirm there is no history-extraction API; you can only have a Mini Program read current sensor data and push it out yourself. [→ §2.1](#21-zepp-os-developer-apis-apps-sensors-not-user-history)
- **The Zepp app can export a single workout as GPX / TCX / FIT** (three-dot menu on a workout). This is the simplest official path, but it is per-workout, and FIT support appears on newer devices. [→ §1.1](#11-zepp-app-per-workout-export-gpx--tcx--fit)
- **The account/GDPR export is CSV only and does not include workout GPS tracks.** [→ §1.2](#12-zepp-account--gdpr-data-export-csv-archive)
- **The Zepp cloud mobile API is reverse-engineered and works today, but is fragile.** It returns JSON (not FIT) that tools reconstruct into GPX/FIT. [→ §2.3](#23-the-mobile-apps-private-cloud-api-reverse-engineered)
- **Gadgetbridge is the most reliable self-hosted path** for a modern Amazfit watch: it talks to the watch over BLE, produces a **device-agnostic FIT file** (synthesized from the parsed workout) plus GPX, and can auto-export to a directory or upload to self-hostable services. It requires an auth key retrieved once from the vendor cloud. [→ §3.1](#31-gadgetbridge)
- **Strava is a dead end for raw FIT**: Zepp can auto-sync workouts to Strava, but Strava's public API exposes streams/summaries, not the original FIT. [→ §1.4](#14-strava-and-other-service-auto-sync)
- **Model matters a lot.** "Zepp OS" watches (GTR 3/4, GTS 3/4, T-Rex 2/3, Balance, Active, Cheetah, Bip 5/6, Band 7, …) differ from older Huami/Amazfit-OS watches. How to tell which you have and what changes: [→ §4.3](#43-firmware--model-differences-that-change-whats-possible).

---

## 1. Official / supported export paths

### 1.1 Zepp app per-workout export (GPX / TCX / FIT)

In the Zepp app: **Workout History → tap a workout → three-dot (⋮) menu → "Export data"**. Multiple screen recordings of the current Zepp app show three formats offered — **GPX, TCX and FIT**:

- Amazfit Balance 2 walkthrough: "it gives you three formats that you can export this root data in. GPX format, TCX and FET [FIT] format" — [YouTube](https://www.youtube.com/watch?v=6t7dsMipeC8).
- Amazfit T-Rex 3 Pro walkthrough: same three-format menu — [YouTube](https://www.youtube.com/watch?v=m_Soi2_ygvA).

Amazfit's own Q&A page (first-party, though on Facebook) states: *"For workouts, you can export GPX or TCX files directly from the Zepp app using the three dots menu on a workout."* — [Amazfit Data Export Guide](https://www.facebook.com/fb-answers/amazfit-data-export-guide).

Amazfit's blog confirms device-side workout export arrived with the T-Rex 3 in 2024: *"In 2024, Amazfit T-Rex 3 introduced user-controlled options for GPS and workout data, including … activity-file export."* — [Amazfit blog](https://us.amazfit.com/blogs/blog/your-data-your-storage-your-choice-amazfit-expands-personal-health-data-controls).

Notes / uncertainty:

- I could **not** find this documented on `support.amazfit.com`; the searchable support articles cover *importing* routes (GPX/TCX/KML) and Strava/Apple Health sync, not exporting recorded workouts. Treat the FIT option as **device- and app-version-dependent** (newer Zepp OS watches have it; the older official answer only listed GPX/TCX).
- The exported FIT is not always complete. A user report on Balance 2 says the exported FIT **omits lap data** ([r/amazfit](https://www.reddit.com/r/amazfit/comments/1qkt2ka/amazfit_balance_2_problem_exporting_to_fit_lap)). Verify laps for interval analysis.
- Workouts only. Sleep/heart-rate/steps are **not** exported this way (see §1.2 / §1.5).

### 1.2 Zepp account / GDPR data export (CSV archive)

There are two entry points to the same account-data export:

- **In app:** Zepp `App → Profile → Settings → Exercising user rights → Export data` — [zepp.com/privacy-support](https://www.zepp.com/privacy-support).
- **Web portal:** `https://user.huami.com/privacy2/index.html?...platform_app=com.huami.watch.hmwatchmanager` (the Zepp app variant; the Zepp Life variant uses `com.xiaomi.hm.health`) — linked from [zepp.com/privacy-support](https://www.zepp.com/privacy-support) and documented in [Gadgetbridge data management](https://gadgetbridge.org/internals/development/data-management/).

What it contains:

- The archive is **CSV files**, not FIT. Gadgetbridge's importer names the relevant files: `ACTIVITY_MINUTE.csv`, `HEARTRATE.csv`, `HEARTRATE_AUTO.csv`, `SLEEP.csv`. Its script comment is explicit: *"what this tool does not: doesn't import activities"* — [Gadgetbridge data management](https://gadgetbridge.org/internals/development/data-management/).
- The `zepp-fit-extractor` README states plainly: *"Zepp bulk export only provides CSV files and unfortunately the fit export can only be done on single activities one by one with the application."* — [H3llK33p3r/zepp-fit-extractor](https://github.com/H3llK33p3r/zepp-fit-extractor).
- The reverse-engineering write-up from 2020 observed the same: *"the resulting archive does not contain workout specific data"* (no GPS track) — [Roland Szabó](https://rolandszabo.com/reverse-engineering/mi-fit/export-mi-fit-and-zepp-workout-data).

So the GDPR/account export is useful for **daily health metrics (steps, sleep, HR)** but is *not* a source of workout FIT/GPX.

### 1.3 What a recorded workout actually is in the Zepp app/cloud

The watch records a proprietary workout; the Zepp app syncs it to the Zepp cloud, where it is stored as **JSON**, not FIT. The reverse-engineered cloud endpoints return:

- Workout list: `GET https://api-mifit-<region>.<huami|zepp>.com/v1/sport/{sport}/history.json?source=run.mifit.huami.com` with header `apptoken`.
- Workout detail (the actual track): `GET .../v1/sport/{sport}/detail.json` with `trackid` + `source`.

The detail JSON carries `longitude_latitude`, `altitude`, `time`, `heart_rate`, `pace`, `speed`, `distance`, `cadence`, `lap`, `spo2`, etc. as semicolon/comma-encoded strings — **not** a FIT file. Reconstructing FIT/GPX from this is exactly what the third-party tools do. Source: [Roland Szabó, "Export Mi Fit and Zepp workout data"](https://rolandszabo.com/reverse-engineering/mi-fit/export-mi-fit-and-zepp-workout-data).

### 1.4 Strava and other service auto-sync

**Zepp → Strava is officially supported and automatic:**

- Link in app: `Profile → 3rd-party account linking → Strava → Authorize`, then enable *"Upload your activities from Zepp to Strava"*. New workouts push automatically. — [Strava Help Center: Amazfit and Strava](https://support.strava.com/en-us/articles/15402010-amazfit-and-strava).
- Same for **Apple Health, Google Fit, Relive** — [Amazfit Support](https://support.amazfit.com/en/amazfit_gts_2_mini/docs/N6cUdJxDRo6rbfxiLs1cJDBrnRd).
- The Zepp app also lists Strava, TrainingPeaks, Runna, komoot, adidas Running as connected platforms — [us.amazfit.com/pages/zepp-app](https://us.amazfit.com/pages/zepp-app).

**Can you get FIT back out of Strava's API? No.** Strava's public v3 API has no endpoint that returns the original activity FIT file:

- Activity endpoints return summary/detail JSON and `GET /activities/{id}/streams` returns per-sample streams (time, latlng, heartrate, watts, cadence, etc.) for activities you own — [Strava API reference, Streams](https://developers.strava.com/docs/reference/#api-Streams).
- The documented per-activity export is **TCX via the website** (`https://www.strava.com/activities/:id/export_tcx`), and only route export (GPX/TCX) is exposed in the API — [Strava API reference, Routes](https://developers.strava.com/docs/reference/#api-Routes).
- Strava *accepts* FIT/TCX/GPX/JSON for uploads — [Strava upload docs](https://developers.strava.com/docs/uploads/) — but that is ingest, not retrieval.

Practical consequence: **Strava is a backup/share sink, not a raw-data source** for a self-hosted FIT pipeline. (Undocumented `/export_original`-style endpoints may exist, but they are not part of the public API and I did not verify them against a first-party source.)

### 1.5 Apple Health / Google Health Connect / Google Fit relay

The Zepp app writes data into the phone health hubs; other apps then read from there. This is official and stable-ish, but **aggregated metrics, not FIT**:

- Zepp can sync to Apple Health / Google Fit / Relive — [Amazfit Support](https://support.amazfit.com/en/amazfit_gts_2_mini/docs/N6cUdJxDRo6rbfxiLs1cJDBrnRd).
- Health Connect: set up at `Zepp App → Profile → 3rd-party account linking → Health Connect`, choose permissions (Blood Pressure, Heart rate, Sleep, Weight, …) — [Notebookcheck](https://www.notebookcheck.net/Amazfit-smartwatches-get-new-Health-Connect-data-sync-feature.951489.0.html). Amazfit's own channel states: *"Zepp App currently supports writing data to Health Connect only; reading data is not yet available."* — [Amazfit Global (YouTube)](https://www.youtube.com/watch?v=DIJOGYHKw2U). So Health Connect is **one-way out of Zepp**.

Data available through the hubs is steps, sleep, heart rate (incl. resting), workouts, etc. — enough for health dashboards, not for session-level FIT analysis.

---

## 2. First-party APIs

### 2.1 Zepp OS developer APIs (apps/sensors, not user history)

`developer.zepp.com` and `docs.zepp.com` are for building **Zepp OS Mini Programs / watchfaces** that run on the watch and (optionally) a "Side Service" that runs inside the Zepp app on the phone. Open capability modules include UI, Sensor, Device, User, File System, Storage, **BLE Central**, Side Service `fetch`, etc. — [Zepp OS docs, Device App introduction](https://docs.zepp.com/docs/guides/framework/device/intro/).

This is **not** a user-data API. A Zepp Health maintainer (`silver-zepp`) answered a direct request for a BLE/history API:

> *"The functionality to extract history data isn't available, however, you can collect data for yourself and send it either to your BLE Slave device … or a web server…"* — [zepp-health discussion #366](https://github.com/orgs/zepp-health/discussions/366).

The sanctioned pattern is documented in Zepp's own workshop **"How To Extract Health Data from Amazfit Smartwatches to a Web Server"**: a Mini Program reads sensor data (e.g. `Sleep.getInfo()`) and POSTs to your server via the Side Service `fetch` API. Caveat from the same post: *"most health-related sensor data supports obtaining data for the same day"* — i.e. it is **not** historical backfill. — [zepp-health discussion #276](https://github.com/orgs/zepp-health/discussions/276).

Takeaway: Zepp OS can be used as a *live push* mechanism (see HA tools in §3.6), not as a bulk data-export API.

### 2.2 Official first-party user-data API: Huami / Zepp Web API (partner-only)

There *is* an official Web API — but it is gated to approved partners. It lives at **`github.com/zepp-health/rest-api`** (formerly `huamitech/rest-api`), wiki "Huami Web API Documents for Developers":

- **OAuth 2.0** at `auth.huami.com`; data at `api-open.huami.com` (`Authorization: Bearer <token>`).
- Scopes: `profile`, `activity`, `sleep`, `heartrate`, `motion`, `notifyme`, `sport`, `sportDetail` ([wiki](https://github.com/zepp-health/rest-api/wiki)).
- Registration via `dev.huami.com`; **"Data cooperation currently only supports corporate users, not individual users"** ([wiki, §2](https://github.com/zepp-health/rest-api/wiki)).
- Real-time **subscription webhooks** exist but "available to invited partners only", and are signature-verified with RSA-SHA1 ([wiki, §5](https://github.com/zepp-health/rest-api/wiki)).
- The wiki was last edited **Nov 27, 2020** and there is no `zepp.com` successor documented; treat it as **legacy, partner-only, and possibly stale**.

Independent confirmation that it is not open to individuals: the `ha-zepp` README says *"it is not possible for the general public to access Huami's WEB API"* — [ga2mer/ha-zepp](https://github.com/ga2mer/ha-zepp).

**Conclusion:** no first-party API you can self-register against to pull your own Zen data. Anything that pulls your own workout/health data programmatically is reverse-engineered (§2.3).

### 2.3 The mobile app's private cloud API [RE] {#23-the-mobile-apps-private-cloud-api-reverse-engineered}

This is the API the Zepp/Zepp Life apps call; it is not public. It is the backbone of nearly every "export from Zepp" tool.

**Auth flow (as of the Sept 2025 overhaul):**

1. `POST https://api-user.zepp.com/v2/registrations/tokens` — body is now an **encrypted payload** (app uses SSL pinning; analysing it required patching the APK with `apk-mitm`). Returns a temporary `code`. — [huami-token issue #118](https://codeberg.org/argrento/huami-token/issues/118).
2. `POST https://api-mifit.zepp.com/v2/client/login` with the `code` → returns `token_info.app_token`, `token_info.login_token`, `token_info.user_id`, `app_ttl = 2592000` (**30 days**). Same source.
3. All later data requests are `GET`s to your **regional host** with header `apptoken: <token>`.

**Older/alternative token paths (still useful):**

- **Browser console trick (no MITM, no root):** sign in at `https://watchface.zepp.com`, then read the `hm-user-login-info` cookie (contains `user_id` + `app_token`) and call `GET https://api-mifit-us3.zepp.com/users/{user_id}/devices` with the `apptoken` header. The response's `additionalInfo.auth_key` is the **Bluetooth pairing key**. — [Gadgetbridge Huami/Xiaomi pairing docs](https://gadgetbridge.org/basics/pairing/huami-xiaomi-server/).
- **Rooted phone:** the token lives in `shared_prefs/hm_id_sdk_android.xml` for Zepp (`com.huami.watch.hmwatchmanager`) — [Roland Szabó](https://rolandszabo.com/reverse-engineering/mi-fit/export-mi-fit-and-zepp-workout-data). (Android 11+ restricts direct access.)
- **MITM:** capture `apptoken` and `userid` from `api-mifit.huami.com` / `api-mifit.zepp.com` traffic with mitmproxy — [bentasker/zepp_to_influxdb README](https://github.com/bentasker/zepp_to_influxdb).

**Known endpoints (from `m4ary/zepp-health-cli`, all `GET`, header `apptoken`):**

| Data | Endpoint |
| --- | --- |
| Training load | `/v2/watch/users/{id}/WatchSportStatistics/SPORT_LOAD` |
| VO2 max | `/v2/watch/users/{id}/WatchSportStatistics/VO2_MAX` |
| Heart rate | `/users/{id}/heartRate` |
| Weight | `/users/{id}/members/-1/weightRecords` |
| Workout history | `/v1/sport/{sport}/history.json` |
| Sleep/steps sync payload | `/v1/data/band_data.json` |
| User info | `/huami.health.getUserInfo.json` |
| Events (stress, PAI, SpO2, HRV, body battery, …) | `/users/{id}/events`, `/v2/users/me/events?eventType=…&subType=…` |
| Per-second HR file index | `/users/me/fileInfo/events` |

Source: [m4ary/zepp-health-cli README](https://github.com/m4ary/zepp-health-cli).

**Fragility markers:**

- Regional host matters (`api-mifit-us3.zepp.com`, `-de2`, `-cn`, …); wrong region → 403/empty.
- Token TTL ≈ **30 days** → re-capture. Tokens should be treated like passwords.
- Zepp has shipped an **encrypted login body + SSL pinning**; the fully automated email/password flow can break at any time. `zepp-health-cli` deliberately dropped password login and uses a proxy capture instead. — [README](https://github.com/m4ary/zepp-health-cli).
- `huami-token` was updated to handle the new flow (its README shows a successful login dated 2025-11-14 and it now depends on `pycryptodome`) — [huami-token README](https://codeberg.org/argrento/huami-token). Even so, this repo's issue tracker is an active record of breakage ([issue #118](https://codeberg.org/argrento/huami-token/issues/118), and Gadgetbridge referenced it: `huafetcher no longer working`).

---

## 3. Third-party / community tooling

### 3.1 Gadgetbridge

**What it is:** an Android app (AGPLv3) that talks directly to many wearables without the vendor app or an account — [gadgetbridge.org](https://gadgetbridge.org/). It is the closest thing to a *supported-by-community*, watch-level alternative to the Zepp app.

**Amazfit support:** broad. The device list includes Bip/Bip S/Bip U, GTR/GTR 2, GTS/GTS 2, T-Rex/T-Rex Pro, Band 5/7, GTR 3/4, GTR Mini, GTS 3/4, T-Rex 2/3/Ultra, Balance/Balance 2/Balance 3/Ultra, Active/Active 2/Active Max/Active Edge/Active 3 Premium, Cheetah/Cheetah Pro/Cheetah 2 Pro/2 Ultra, Falcon, Bip 3/3 Pro/5/5 Unity/6/Max, Neo, Pop, Cor, Verge Lite, X — see [gadgetbridge.org/gadgets/wearables/amazfit](https://gadgetbridge.org/gadgets/wearables/amazfit).

**What it records / produces:**

- **Activities/workouts** synced from the watch, with HR, and GPX for GPS activities (GPX includes HR if recorded) — [Sports and GPS](https://gadgetbridge.org/basics/features/sports/).
- **Device-agnostic FIT export** (since 0.92.0). For Huami/Amazfit/Xiaomi (which do *not* hand over a raw `.fit`), Gadgetbridge **synthesizes** the FIT from the parsed workout data. Only Garmin/iGPSPORT hand over their original file unchanged. — [Gadgetbridge release 0.92.0 blog](https://gadgetbridge.org/blog/release-0_92_00), [Auto export](https://gadgetbridge.org/internals/automations/auto-export/).
- **Auto exports**: FIT per activity, GPX tracks, SQLite DB, full ZIP; configurable directories — [Auto export](https://gadgetbridge.org/internals/automations/auto-export/).
- **Direct upload** to self-hostable services: FIT → **Endurain**, GPX → **Wanderer** — [Online fitness trackers](https://gadgetbridge.org/basics/integrations/online-fitness-trackers/).
- Health/steps/sleep data lives in an SQLite DB (`Gadgetbridge`, no extension) with tables like `MI_BAND_ACTIVITY_SAMPLE`, `BASE_ACTIVITY_SUMMARY`, plus documented SQL for steps/sleep/HR — [Data management](https://gadgetbridge.org/internals/development/data-management/).

**Pairing / auth key:** most modern Amazfit watches require a one-time **Huami/Zepp auth key** captured from the vendor cloud (see §2.3); the original **Amazfit Bip** is an exception and can pair with no vendor app — [Huami/Xiaomi pairing](https://gadgetbridge.org/basics/pairing/huami-xiaomi-server/), [Amazfit page](https://gadgetbridge.org/gadgets/wearables/amazfit). Rules: **do not unpair** from the vendor app (invalidates the key); a hard reset changes the MAC and requires a new key.

**Limitations (Zepp OS page):**

- Workout sync is **manual and one-at-a-time** ("only one workout will be fetched at a time") — [Sports and GPS](https://gadgetbridge.org/basics/features/sports/).
- Missing data sync on Zepp OS: Sleep SpO2, Max HR, manual HR measurements, BioCharge.
- Missing built-in-app integrations: Alexa, Female Health, Maps (on device), Readiness, Sleep schedule, To-Do, Zepp Coach, Zepp Flow, voice replies.
- **3rd-party realtime HR access doesn't work** (e.g. other apps can't use the watch as an HR strap).
- Some newer watches need **BT Classic ("Force connection type")** for reliable/large transfers (e.g. Balance 2 from FW 3.30.2.1).

Sources: [Zepp OS gadgets](https://gadgetbridge.org/basics/topics/zeppos/), [Sports and GPS](https://gadgetbridge.org/basics/features/sports/).

**Verdict:** best self-hosted raw-ish FIT source, but "raw" means a *synthesized* FIT from the parsed workout — verify that fields you need survive the mapping.

### 3.2 huami-token / huafetcher (pairing key + AGPS, also gives app_token)

- **`argrento/huami-token`** — logs into Zepp (Amazfit) or Xiaomi accounts and prints each device's Bluetooth pairing key; can also download AGPS packs. Command: `huami-token --method amazfit --email you@example.com --password '…' --bt_keys`. With `-n/--no_logout` it keeps the session and shows the `app token` too. — [README](https://codeberg.org/argrento/huami-token).
- **`vanous/huafetcher`** — a Kivy/Android GUI wrapping huami-token, for AGPS on-phone. — linked from [Gadgetbridge Huami GPS](https://gadgetbridge.org/internals/topics/huami-gps/).
- **Status:** the plaintext-password login broke in Sept 2025 (encrypted payload, moved endpoints, SSL pinning) — [issue #118](https://codeberg.org/argrento/huami-token/issues/118) — and has since been reworked (README shows a successful 2025-11-14 login). Treat as fragile; the fallback is the vendor-cloud token capture in §2.3.

This is mainly a **pairing enabler for Gadgetbridge**, not a data-export tool.

### 3.3 rolandsz / Mi-Fit-and-Zepp-workout-exporter [RE]

Python script that authenticates to the reverse-engineered Zepp/Mi Fit cloud API and exports all workouts. Usage:

```
uv run python3 main.py [-t TOKEN] [-f {gpx,geojson,gpkg,parquet,shp,csv,json,xlsx,sql,sqlite3,xml,html}] [--start-date …] [--end-date …]
```

- Auth: email/password (may fail) or a manually supplied `apptoken` captured from the GDPR page's network traffic.
- Output formats include **GPX** and **GeoJSON**, plus tabular formats; **not FIT** directly.
- Repo: [rolandsz/Mi-Fit-and-Zepp-workout-exporter](https://github.com/rolandsz/Mi-Fit-and-Zepp-workout-exporter); methodology write-up: [Roland Szabó](https://rolandszabo.com/reverse-engineering/mi-fit/export-mi-fit-and-zepp-workout-data).

### 3.4 H3llK33p3r/zepp-fit-extractor [RE]

Kotlin CLI that downloads all Zepp activities and converts them to **`.fit`** files (for import into Garmin, etc.). Built on the rolandsz exporter's API work.

```
shell:> download-all
shell:> generate-all
```

- Supported sports (v0.1.x): Running, Walking, Cycling, Indoor swimming, Treadmill. **Laps are not included** in the output.
- Auth: same manual `apptoken` capture from the GDPR page.
- Repo: [H3llK33p3r/zepp-fit-extractor](https://github.com/H3llK33p3r/zepp-fit-extractor).

### 3.5 m4ary/zepp-health-cli [RE]

Single-file Python CLI wrapping the Zepp mobile API for **health records** (not workouts primarily): skin temperature, heart rate, HRV, body battery, training load, VO2 max, weight, sleep/steps (`band-data`), SpO2 (ODI/OSA), stress, PAI, per-second HR file index, raw event streams.

- Auth: **proxy capture required** (HAR or JSON session export via mitmproxy/Proxyman); writes `config.json` with `app_token`, `user_id`, regional `host`. Explicitly does **not** support password login.
- Output: JSON (`--json` for piping to `jq`).
- Repo: [m4ary/zepp-health-cli](https://github.com/m4ary/zepp-health-cli). Endpoint table quoted in §2.3.

### 3.6 bentasker/zepp_to_influxdb [RE]

Pulls **step count and sleep** from the Zepp/MiFit/Huami API and writes to InfluxDB (Docker/K8s CronJob). Supports email/password or the recommended pre-extracted `app_token` + `user_id` (avoids the login 429 rate limit). Underlying protocol from `micw/hacking-mifit-api`. — [bentasker/zepp_to_influxdb](https://github.com/bentasker/zepp_to_influxdb).

Good reference for a metrics-ingest pattern; not a FIT source.

### 3.7 Home Assistant options

None of these produce FIT; they pipe **metrics** into HA.

- **`davidepalleschi/zepp2hass`** — HA custom integration (HACS) that receives data via a **local webhook** from a companion watch Mini Program from the Zepp Store. Sensors: HR (last/resting/max), body temperature, stress, SpO2, steps/calories/distance with goals, sleep score/duration/stages, training load, last workout/workout history, VO2 max, battery, PAI, plus binary sensors (wearing/moving/sleeping). Rate-limited (30 req / 60 s / device). — [zepp2hass README](https://github.com/davidepalleschi/zepp2hass).
- **Hass Sync (`MaximeBranger/zepp-hass-sync`, renamed because Zepp Store rejected the trademarked name)** — open-source replacement for the zepp2hass watch app, sending the same webhook shape. Its README documents that zepp2hass's own watch app "currently crashes on launch, its source isn't public, and the issue has never been fixed", and that automatic sending on GTR 4 is **unstable** because an alarm-woken background run is capped at ~600 ms while the BLE round-trip takes seconds. — [MaximeBranger/zepp-hass-sync README](https://github.com/MaximeBranger/zepp-hass-sync).
- **`ga2mer/ha-zepp`** — Mini Program to **control** HA from the watch and push wearable sensor data to HA's REST API using an alarm-triggered background page. Requires building/installing via the Zeus CLI and an HA long-lived token. — [ga2mer/ha-zepp README](https://github.com/ga2mer/ha-zepp).

All three depend on the watch Mini Program / Zepp OS path in §2.1 and are watch-model-dependent.

---

## 4. Direct device access

### 4.1 BLE / GATT

- Amazfit/Zepp watches expose a **vendor-proprietary GATT protocol** over BLE. Gadgetbridge implements it for a large device set; it requires the 16-byte **auth key** from the vendor cloud before it can connect — [Huami/Xiaomi pairing](https://gadgetbridge.org/basics/pairing/huami-xiaomi-server/).
- The protocol is reverse-engineered; Gadgetbridge documents a "BT Protocol Reverse Engineering" workflow and a packet-inspection guide — [Inspect Bluetooth packets](https://gadgetbridge.org/internals/development/bluetooth/).
- Academic prior art on the Xiaomi/Huami BLE ecosystem (GATT exploration with `Bleak`, `pyshark` dissectors, `mitmproxy` for the cloud side): [Reversing, Exploiting and Fixing Xiaomi Fitness Tracking Ecosystem (CHES 2022)](https://hexhive.epfl.ch/publications/files/22CHES.pdf).
- **From a Zepp OS app's perspective**, the device BLE API is oriented toward the Mini Program talking to the Zepp app / peripherals, not toward a general "read all my history" call (see §2.1). A community pattern is the watch acting as a **BLE peripheral/slave** (`silver-zepp/zeppos-easy-ble`) so your own collector can read pushed data — [discussion #366](https://github.com/orgs/zepp-health/discussions/366).

**Bottom line:** raw retrieval is possible **only** by implementing (or reusing) the reverse-engineered protocol and having the auth key. There is no generic, documented GATT profile for historical data.

### 4.2 USB / serial / filesystem

Consumer Amazfit watches do not present a user-accessible mass-storage/serial filesystem. The only local transports used by the ecosystem are:

- **BLE** (all devices) — Gadgetbridge, huami-token (AGPS), etc.
- **Wi-Fi** on some Zepp OS watches, used for large downloads (e.g. offline maps), not for user-file transfer — [Amazfit Support: How to use map](https://support.amazfit.com/en/amazfit_t-rex_3/docs/XHJPdSZdNor8whxzsb5ccT3tnsx).

There is no first-party "mount the watch and copy FIT files" path; USB is charging only. (If a specific model ever exposes MTP/serial, it is not documented by Zepp and I found no first-party source claiming it.)

### 4.3 Firmware / model differences that change what's possible

Two families; the answer to "what can I get out?" depends on which one you have.

| Category | Examples | Notes that matter |
| --- | --- | --- |
| **Older Huami / "Amazfit OS" (RTOS)** | Bip, Bip Lite, Bip S/S Lite, Bip U/U Pro, Bip 3/3 Pro, Cor/Cor 2, GTR, GTR 2/2e, GTR Lite, GTS, GTS 2/2e/2 Mini, T-Rex, T-Rex Pro, Verge Lite, Band 5, Neo, Pop | Mostly need the Huami auth key for Gadgetbridge; **original Amazfit Bip can pair with no vendor app** — [Amazfit page](https://gadgetbridge.org/gadgets/wearables/amazfit). Older watches may not offer in-app FIT export. |
| **Zepp OS (2.x / 3.x / 5 / 6)** | GTR 3/3 Pro/4/GTR Mini, GTS 3/4/4 Mini, T-Rex 2/3/3 Pro/Ultra/Ultra 2, Balance/Balance 2/2 XT/3/Ultra, Active/Active 2/Active Max/Active Edge/Active 3 Premium, Cheetah/Cheetah Pro/Cheetah 2 Pro/2 Ultra, Falcon, Bip 5/5 Unity/6/Max, Band 7 | Support Mini Programs (so §2.1 / HA / sensor-push paths apply), and newer ones offer the three-dot workout export incl. FIT. Some need BT Classic in Gadgetbridge; several missing features (SpO2 sleep, Max HR, BioCharge) — [Zepp OS page](https://gadgetbridge.org/basics/topics/zeppos/). |

**How to tell which one you have:**

1. On the watch: **Settings → About** (or System) shows a **Zepp OS version**. Presence of "Zepp OS" ⇒ modern family.
2. Zepp Health publishes an official list of Zepp OS devices — [docs.zepp.com device list](https://docs.zepp.com/docs/reference/related-resources/device-list).
3. Gadgetbridge marks each Amazfit entry with a "Zepp OS device" badge on its [Amazfit page](https://gadgetbridge.org/gadgets/wearables/amazfit).
4. In the Zepp app, modern devices have the Zepp Store / Mini Programs; older ones don't.

Also note the **app naming** trap (Gadgetbridge): **Zepp** (`com.huami.watch.hmwatchmanager`) is for Amazfit watches + Mi Band 7 Pro/8 Pro; **Zepp Life** (`com.xiaomi.hm.health`, formerly Mi Fit) is for older Mi Bands/scales; **Mi Fitness** (`com.xiaomi.wearable`) is Xiaomi's newer app — [App naming overview](https://gadgetbridge.org/basics/pairing/huami-xiaomi-server/). The user's "Amazfit + Zepp" combination is the Amazfit/`com.huami.watch.hmwatchmanager` case.

---

## 5. Practical recommendation (ranked for a self-hosted FIT pipeline)

| Rank | Option | Yields | Reliability | Effort | Fragility |
| --- | --- | --- | --- | --- | --- |
| 1 | **Gadgetbridge → Auto FIT export** (dir / Endurain / Wanderer) | **Synthesized FIT** + GPX + SQLite metrics, no cloud after pairing | High for supported models | Medium (Android phone, get auth key, pair, manual workout sync) | Low after setup; FIT is synthesized (verify fields) |
| 2 | **Zepp app per-workout export** (⋮ → Export data → FIT/GPX/TCX) | **FIT / GPX / TCX** per workout | High (official) | Low per workout, **high** for bulk | Officially supported but bulk is impractical; FIT may omit laps on some models |
| 3 | **Health Connect / Apple Health relay** | Aggregated metrics (steps, sleep, HR, workouts) | High | Low–Medium | Not FIT; Health Connect is write-only from Zepp |
| 4 | **Reverse-engineered cloud exporters** (`zepp-fit-extractor` for FIT; `rolandsz` for GPX/GeoJSON) | FIT / GPX / tabular for **bulk history** | Medium | Medium (token capture) | High: `apptoken` (~30-day TTL), encrypted-login/SSL-pinning changes, ToS concerns |
| 5 | **Reverse-engineered health API tools** (`zepp-health-cli`, `zepp_to_influxdb`) | JSON/metrics (HR, sleep, steps, SpO2, training load, VO2) | Medium | Medium (proxy capture) | High: same volatility; read-only |
| 6 | **HA Mini-Program bridges** (`zepp2hass`, Hass Sync, `ha-zepp`) | Near-real-time metrics into Home Assistant | Medium | Medium–High | Watch-model dependent; app-service timing issues; no FIT |
| 7 | **Official Huami/Zepp Web API** | OAuth JSON (activity/sleep/HR/sport) | High if approved | Blocked | **Not available to individuals** (corporate partners only) |

Rules of thumb:

- If you want **FIT files in a directory on your own box**, start with **Gadgetbridge auto-FIT export**. It is the only path that is both local-only and produces FIT across many models.
- If you only need to back-fill **past** history, accept a reverse-engineered exporter (rank 4) and expect to re-capture tokens periodically.
- **Strava/Health Connect** are fine for dashboards/share, but do not give you raw session data.

### Fragile vs stable

- **Stable / official:** in-app workout export (GPX/TCX/FIT), Zepp→Strava/Apple Health/Health Connect sync, Gadgetbridge *once paired* (community-maintained, not official).
- **Fragile [RE]:** anything touching `api-mifit*.zepp.com` / `api-user*.zepp.com` — token TTL ~30 days, regional hosts, rate limits (HTTP 429), encrypted login body, SSL pinning. Also note **ToS risk**: `zepp-health-cli`'s own disclaimer says calling private/unsupported endpoints "may violate the Zepp Terms of Service in some jurisdictions." Treat `app_token`/`auth_key` as passwords.

### Model-specific caveats

- The Zepp app's **FIT export option** appears on newer Zepp OS watches; older watches may only offer GPX/TCX (or nothing). Confirm on your specific model.
- **Gadgetbridge coverage varies per model** (many are "Highly supported", several are "Experimental"/unknown, some need BT Classic). Check your exact model on the [Amazfit page](https://gadgetbridge.org/gadgets/wearables/amazfit).
- Watch Mini-Program paths (zepp2hass etc.) exist only on **Zepp OS** devices.

---

## 6. What to try first for this user

Assuming an **Amazfit watch paired to the Zepp app** and a self-hosted analysis app that wants FIT/GPX:

1. **Identify the family.** On the watch: Settings → About → note the **Zepp OS version** (or its absence). Cross-check the model on [Gadgetbridge's Amazfit page](https://gadgetbridge.org/gadgets/wearables/amazfit) for a "Zepp OS device" badge and support level.
2. **Quick win for a few key sessions (5 minutes):** in the Zepp app, open a workout → **⋮ → Export data → FIT** (or GPX/TCX) and drop it into `fit-analyzer`. This validates your parser end-to-end immediately. Check that laps/intervals survived.
3. **Set up the durable local pipeline (recommended):**
   - Install **Gadgetbridge** (F-Droid). Get your **auth key**:
     - Easiest: sign in at `https://watchface.zepp.com`, run the browser-console snippet from the [Gadgetbridge pairing docs](https://gadgetbridge.org/basics/pairing/huami-xiaomi-server/) to fetch `/users/{id}/devices`, and copy `additionalInfo.auth_key`.
     - Or use **`huami-token`** / **`huafetcher`** (§3.2).
   - **Do not unpair** the watch from Zepp. Pair in Gadgetbridge with the key (prefix `0x`).
   - Enable **Settings → Automations → Auto FIT export** to a directory, and/or **External Integrations → Endurain** for direct upload. Point `fit-analyzer` at that directory.
   - Sync workouts from the watch (manual; one at a time).
4. **If you need past history in bulk:** run **`zepp-fit-extractor`** (FIT) or **`rolandsz/Mi-Fit-and-Zepp-workout-exporter`** (GPX/GeoJSON) using an `apptoken` captured from the Zepp web/GDPR page's network traffic. Expect to repeat token capture roughly monthly.
5. **For sleep/HR/steps dashboards:** either enable **Zepp → Health Connect / Apple Health** and ingest from there, or use **`zepp-health-cli`** / **`zepp_to_influxdb`** if you want automation and accept the fragility.
6. **Only if you live in Home Assistant:** add **`zepp2hass`** + a watch Mini Program (or **Hass Sync** as the more open alternative) for near-real-time metrics. Neither yields FIT.

Keep the Zepp app installed (just muted/backgrounded) so the auth key stays valid, and treat the FIT files from Gadgetbridge as "good but synthesized" — diff them against one Zepp-exported FIT for a known workout before trusting all fields.

---

## 7. Uncertainty / open questions

- **Exact Zepp app FIT availability per model/version** is not documented first-party; verified only via screen recordings and one official social answer. Test on the actual watch.
- **GDPR archive contents** are inferred from Gadgetbridge's importer (CSV filenames) and the 2020/2023 write-ups; the portal's own file listing is not published. It may have changed.
- **FIT from the Zepp app omitting laps** is a single user report; not universal.
- **`huami-token` current login viability** is inferred from its README sample output (Nov 2025); the issue tracker shows this area breaks often.
- **Strava original-file retrieval** is not in the public API; any `/export_original`-style endpoint is undocumented and unverified here.
- The **official Huami Web API** wiki is from 2020 and may be stale or superseded; `dev.huami.com` registration status was not verified.

---

## Sources

Official / first-party:

- Zepp OS developers docs — https://docs.zepp.com/docs/guides/framework/device/intro/ ; https://docs.zepp.com/docs/reference/related-resources/device-list
- Zepp Health / Huami official Web API wiki — https://github.com/zepp-health/rest-api/wiki
- Zepp privacy & data-subject rights — https://www.zepp.com/privacy-support
- Amazfit blog, "Your Data. Your Storage. Your Choice" — https://us.amazfit.com/blogs/blog/your-data-your-storage-your-choice-amazfit-expands-personal-health-data-controls
- Amazfit support, Strava/Apple Health/Google Fit/Relive sync — https://support.amazfit.com/en/amazfit_gts_2_mini/docs/N6cUdJxDRo6rbfxiLs1cJDBrnRd
- Amazfit (Facebook Q&A), Data Export Guide — https://www.facebook.com/fb-answers/amazfit-data-export-guide
- Amazfit Global, Health Connect (write-only) — https://www.youtube.com/watch?v=DIJOGYHKw2U
- Strava Help Center, Amazfit & Strava — https://support.strava.com/en-us/articles/15402010-amazfit-and-strava
- Strava API reference / uploads — https://developers.strava.com/docs/reference/ ; https://developers.strava.com/docs/uploads/

Community / tooling:

- Gadgetbridge docs — https://gadgetbridge.org/ (sports, auto-export, Zepp OS, pairing, data management, Huami GPS, Amazfit device list)
- Gadgetbridge release notes 0.92.0 (FIT export) — https://gadgetbridge.org/blog/release-0_92_00
- rolandsz/Mi-Fit-and-Zepp-workout-exporter — https://github.com/rolandsz/Mi-Fit-and-Zepp-workout-exporter ; write-up https://rolandszabo.com/reverse-engineering/mi-fit/export-mi-fit-and-zepp-workout-data
- H3llK33p3r/zepp-fit-extractor — https://github.com/H3llK33p3r/zepp-fit-extractor
- m4ary/zepp-health-cli — https://github.com/m4ary/zepp-health-cli
- bentasker/zepp_to_influxdb — https://github.com/bentasker/zepp_to_influxdb
- argrento/huami-token (+ issue #118) — https://codeberg.org/argrento/huami-token ; https://codeberg.org/argrento/huami-token/issues/118
- davidepalleschi/zepp2hass — https://github.com/davidepalleschi/zepp2hass
- MaximeBranger/zepp-hass-sync (Hass Sync) — https://github.com/MaximeBranger/zepp-hass-sync
- ga2mer/ha-zepp — https://github.com/ga2mer/ha-zepp
- zepp-health discussions #366 (no history API) and #276 (sensor push) — https://github.com/orgs/zepp-health/discussions/366 ; https://github.com/orgs/zepp-health/discussions/276
- Reverse-engineering paper — https://hexhive.epfl.ch/publications/files/22CHES.pdf
