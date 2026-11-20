# Getting sleep & health metrics out of an Amazfit / Zepp (T-Rex 3 Pro) into a self-hosted app

Research note for `fit-analyzer`. Scope: **sleep and other health/wellness metrics only** — resting HR, HRV, SpO₂, stress, body battery/BioCharge, readiness, temperature, respiratory rate. Workouts/FIT are out of scope and covered separately in [`amazfit-zepp-data-access.md`](./amazfit-zepp-data-access.md); read that first, this file does not repeat it.

> Research date: 2026-10-16. Anything marked **[RE]** is reverse-engineered from the official apps (or from a community tool that did so), not documented by Zepp. Anything marked **⚠️** is explicitly uncertain and should be verified on the actual phone/watch before you build on it. Zepp's health sync surface is volatile: behaviour differs by **phone OS (iOS vs Android)**, by **Zepp app / watch firmware version**, and by **watch model**, and several "does it sync X?" answers on the web are from years ago and no longer true.

---

## TL;DR

- **The Zepp app writes health data *into* the phone health hub, one-way.** On iOS it writes to Apple Health; on Android it writes to Health Connect. Zepp does **not** read back (confirmed for Health Connect; sleep in particular is write-only). [Notebookcheck](https://www.notebookcheck.net/Amazfit-smartwatches-get-new-Health-Connect-data-sync-feature.951489.0.html), [r/amazfit "now sync more data"](https://www.reddit.com/r/amazfit/comments/1i7rks0/now_sync_more_data_to_health_connect/), [r/amazfit "reading sleep data from HC"](https://www.reddit.com/r/amazfit/comments/1qb793h/zepp_app_reading_sleep_data_from_health_connect/).
- **Sleep *stages* are the crux.** Both Apple Health (`HKCategoryValueSleepAnalysis`) and Health Connect (`SleepSessionRecord.stages`) natively carry Core/light, Deep, REM and Awake. So any stage-preserving bridge can carry them; the question is whether *Zepp* writes them. Evidence says **yes on current iOS** (users see the same stages in Apple Health and Zepp), but this is **not first-party documented** and is version-dependent — verify before relying on it. **⚠️**
- **For `fit-analyzer` specifically (it already ingests Health Auto Export → REST): the iOS path is the shortest and most stage-friendly.** Health Auto Export's unaggregated `sleep_analysis` preserves one `value` per segment (`Core` / `Deep` / `REM` / `Awake` / `In Bed` / `Asleep` / `Unspecified`) — see §3.
- **On Android you must build a *reader*.** Zepp writes to Health Connect but never reads it, and Health Connect has no push/webhook, so you poll `SleepSessionRecord` from your own app. Gadgetbridge can also write sleep sessions (with stages for Zepp OS ≥ 3.5) to Health Connect, which is a self-hosted-friendly alternative to the Zepp app.
- **The reverse-engineered cloud API (`/v1/data/band_data.json`) demonstrably contains full sleep stages** — a base64 `summary` blob whose `slp` object has `lt`/`dp`/`st`/`ed` and an optional `stage[]` array with `mode` 4=light, 5=deep, 7=awake, 8=REM. **[RE]**, from working code (§4).
- **The on-watch Zepp OS `Sleep` API exposes stages too**, but only for *today's* sleep (the night that just ended), refreshed every 30 min — there is **no historical sleep API** on the watch. It also has no HRV, no BodyBattery/BioCharge, no readiness. (§5)

---

## 1. Zepp → Apple Health (iOS)

### 1.1 What Apple HealthKit's sleep model actually supports (primary)

HealthKit represents sleep as `HKCategorySample`s of type `HKCategoryTypeIdentifier.sleepAnalysis`, one value per sample. The valid categories (`HKCategoryValueSleepAnalysis`) are ([Apple docs](https://developer.apple.com/documentation/healthkit/hkcategoryvaluesleepanalysis)):

| Value | Meaning |
| --- | --- |
| `inBed` | The user is in bed. |
| `awake` | The user is awake. |
| `asleepCore` | Light / intermediate sleep. |
| `asleepDeep` | Deep sleep. |
| `asleepREM` | REM sleep. |
| `asleepUnspecified` | Asleep, stage unknown. |
| `asleep` | **Deprecated** (legacy "asleep" flag). |

Apple's own guidance: a session is typically written as an `inBed` sample plus a **set of non-overlapping detailed stage samples** (awake/core/deep/REM) that overlap the in-bed sample. Apps reading the data reconstruct durations by comparing start/end times. ([Apple docs, same page](https://developer.apple.com/documentation/healthkit/hkcategoryvaluesleepanalysis).) Apple Watch's *own* writer only emits `awake` samples that fall between two sleep samples, but **third-party apps are free to write the full stage set** (Apple's HealthKit API accepts any of the values above). Apple's write-up of its own algorithm, for reference, writes full Awake/REM/Core/Deep classifications when a detected session exceeds three hours ([Apple, "Estimating Sleep Stages from Apple Watch", Oct 2025](https://www.apple.com/health/pdf/Estimating_Sleep_Stages_from_Apple_Watch_Oct_2025.pdf)).

**Consequence:** if the Zepp app writes stages, they land as ordinary HealthKit samples with no lossy translation — which is exactly what Health Auto Export reads back out (§3).

### 1.2 What the Zepp app writes to Apple Health

The Zepp↔Apple Health sync is a first-party feature, but it is documented only lightly. First-party evidence:

- Amazfit's own support article for a related model ("How can I sync to Strava / Apple Health / Google Fit / Relive?") says: *"In Zepp app, the watch data can be synced to Strava / Apple Health / Google Fit / Relive … Tap Add accounts in Profile page and choose the account."* ([support.amazfit.com](https://support.amazfit.com/en/amazfit_gts_2_mini/docs/N6cUdJxDRo6rbfxiLs1cJDBrnRd).) I found **no dedicated, current `support.amazfit.com` page that enumerates exactly which HealthKit types Zepp writes** — that absence is itself a finding. **⚠️**
- Amazfit's health-technology marketing page states the watch analyses *"light, deep, and REM sleep using a combination of heart rate monitoring and motion sensors"* and syncs that to the Zepp app; it does **not** claim what is forwarded to Apple Health ([us.amazfit.com](https://us.amazfit.com/pages/amazfit-technology-page-health-technology)). The same page confirms HRV is measured with **RMSSD** and baselined from ~7 days of sleep HRV. ([same page](https://us.amazfit.com/pages/amazfit-technology-page-health-technology).)
- Amazfit's sleep troubleshooting page confirms the watch records *"sleep duration, sleep stages, sleep score, naps"* and that "Assisted Sleep Monitoring" improves REM detection ([us.amazfit.com](https://us.amazfit.com/pages/why-are-my-sleep-results-are-not-tracking-properly)).

Reputable secondary sources (use with caution — they are not Zepp docs):

- **Constant (updated Jul 2026)** publishes a Zepp→Apple Health table: Steps yes, **Sleep yes ("Maps to Sleep Analysis")**, Heart rate yes, Blood oxygen (SpO₂) **yes** (spot + overnight), Weight yes, **HRV partial (Helio Strap only, Oct 2025 onward)**, **Stress no, Readiness/PAI no** — "Zepp-proprietary, not a HealthKit type". It also notes each metric has its own permission toggle and that Zepp is a *one-way writer*. ([trainconstant.com](https://trainconstant.com/blog/amazfit-zepp-apple-health).)
- On **HRV specifically**: an Amazfit firmware report says the **Active 3 Premium** added *"HRV data now writes directly to Apple Health"* in the April 2026 update; a commenter reports the **Helio Strap** also exports HRV but lands only 1–2 points per night instead of a full series. So HRV-in-Apple-Health exists but is **device-limited and sparse** ([the5krunner.com](https://the5krunner.com/2026/04/22/amazfit-april-update/)). The T-Rex 3 Pro is **not** on the confirmed list.
- On **SpO₂**: an older post says Zepp could *not* be made a data source for blood oxygen in Apple Health ([r/amazfit, 2021](https://www.reddit.com/r/amazfit/comments/l4uz1n/ios_can_zepp_sync_with_spo2_with_apple_health_in/)), while the 2026 Constant table says SpO₂ now syncs. **Behaviour changed over time** — another reason to verify on-device. **⚠️**

### 1.3 Do *stages* survive Zepp → Apple Health? (the key question)

**⚠️ Not first-party documented. Best current evidence leans "yes on modern iOS, but confirm it":**

- A user comparing the two apps asks: *"Am I seeing the sleep stages in Apple and Zepp to be completely identical? If that is the case then Apple health is using the Amazfit sleep [data]."* ([r/amazfit](https://www.reddit.com/r/amazfit/comments/1ndbl8r/apple_health_sleep_score_vs_zepp_sleep_score_from/).) This implies the stages *are present* in Apple Health and match Zepp's.
- HealthKit's API accepts stage values from any writer (§1.1), and the Zepp app's Zepp-OS sleep engine produces stages (light/deep/REM/awake) ([Zepp technology](https://www.zepp.com/technology)).
- The counterpoint: a different user notes *"Zepp does not share everything about my sleep to Apple Health"* — i.e. Zepp's sleep **score** and some derived fields don't cross, even if stage segments do. ([same r/amazfit thread](https://www.reddit.com/r/amazfit/comments/1ndbl8r/apple_health_sleep_score_vs_zepp_sleep_score_from/).)

**How to verify in 60 seconds on the phone:** Apple Health → **Browse → Sleep → "Show More Sleep Data" → Data Sources & Access → Zepp**; or open the **Sleep** category and inspect the individual samples. If you see `Core`/`Deep`/`REM`/`Awake` segments from source **Zepp**, stages survive; if you only see "In Bed"/"Asleep", they don't.

### 1.4 Which other metrics Zepp writes to Apple Health

Combining the Constant table ([link](https://trainconstant.com/blog/amazfit-zepp-apple-health)), the Amazfit tech page ([link](https://us.amazfit.com/pages/amazfit-technology-page-health-technology)) and the firmware report ([link](https://the5krunner.com/2026/04/22/amazfit-april-update/)):

| Requested metric | Likely in Apple Health from Zepp? | Notes |
| --- | --- | --- |
| Sleep (stages) | **Likely yes** ⚠️ | "Maps to Sleep Analysis"; verify stages on-device (§1.3). |
| Resting heart rate | Yes | Constant: "Resting and workout HR". |
| Heart rate | Yes | Also high/low/irregular HR notifications are Apple-HR-notification types, not Zepp's. |
| HRV | **Device-limited** ⚠️ | Helio Strap (Oct 2025) + Active 3 Premium (Apr 2026) only; sparse. T-Rex 3 Pro unconfirmed. |
| SpO₂ (blood oxygen) | Yes (now) ⚠️ | Older reports said no; Constant (2026) says yes. |
| Respiratory rate | **Unclear** ⚠️ | Apple has `respiratoryRate`; no source confirms Zepp writes it. |
| Body/skin temperature | **Unclear** ⚠️ | Apple has `appleSleepingWristTemperature` + `bodyTemperature`; no source confirms Zepp writes either. |
| Weight | Yes | "Via a paired smart scale or Zepp Life". |
| Stress | **No** | "Stays inside the Zepp app." |
| Readiness / PAI / BioCharge | **No** | Zepp-proprietary; no HealthKit type. |

The **general rule that emerges:** *raw sensor metrics* (sleep, HR, RHR, SpO₂, weight) cross into Apple Health; *Zepp-derived wellness scores* (sleep score, stress, readiness, PAI, BioCharge) do **not**.

---

## 2. Zepp → Health Connect (Android)

### 2.1 What Health Connect supports (primary)

Health Connect's `SleepSessionRecord` is an **Interval** record with **mandatory fields `endTime`, `metadata`, `stages`, `startTime`** — i.e. **every sleep session must carry a non-empty stage list**. Stage types are deep, light, REM and awake. Associated metrics are separate records (`HeartRateRecord`, `OxygenSaturationRecord`, `RespiratoryRateRecord`, `RestingHeartRateRecord`, `HeartRateVariabilityRmssdRecord`, etc.). ([Health Connect data types](https://developer.android.com/health-and-fitness/health-connect/data-types), [Develop Sleep experiences](https://developer.android.com/health-and-fitness/health-connect/experiences/sleep), [Track sleep sessions](https://developer.android.com/health-and-fitness/health-connect/features/sleep-sessions).)

Two things matter for a self-hosted app:

- **The `stages` field is mandatory** on `SleepSessionRecord` ([data-types table](https://developer.android.com/health-and-fitness/health-connect/data-types)). So a session written by Zepp *does* carry at least one stage entry — though it could be a single coarse stage rather than the full light/deep/REM breakdown.
- **Association between a session and its HR/SpO₂/respiratory records is by overlapping time window, not by a session ID.** Your collector must query the session's `[startTime, endTime)` for the related records. ([Develop Sleep experiences §Reading sleep data](https://developer.android.com/health-and-fitness/health-connect/experiences/sleep).)

### 2.2 What Zepp writes to Health Connect

- The Zepp app exposes a **Health Connect** sync at `Profile → 3rd-party account linking → Health Connect`, with **per-metric permission toggles** including Blood Pressure, **Heart rate**, **Sleep**, and Weight. ([Notebookcheck, quoting an Amazfit rep](https://www.notebookcheck.net/Amazfit-smartwatches-get-new-Health-Connect-data-sync-feature.951489.0.html).)
- An Amazfit representative clarifies it is **write-only**: *"this writes data to Health Connect, not the other way."* ([r/amazfit](https://www.reddit.com/r/amazfit/comments/1i7rks0/now_sync_more_data_to_health_connect/).)
- The integration is available broadly, including the T-Rex 3 family. ([Notebookcheck](https://www.notebookcheck.net/Amazfit-smartwatches-get-new-Health-Connect-data-sync-feature.951489.0.html).)

**Do stages survive Zepp → Health Connect?** **⚠️ Unverified.** Health Connect mandates a stage list, so *some* stages are written; whether Zepp populates the full light/deep/REM/awake breakdown (vs a single coarse stage) is **not documented by Zepp and I found no first-party confirmation**. Field reports of Zepp→Health Connect **sleep sync being unreliable/missing** are common ([r/amazfit "sleep data almost NEVER syncs"](https://www.reddit.com/r/amazfit/comments/1vwb5we/), [r/amazfit "Zepp stops syncing with Health Connect"](https://www.reddit.com/r/amazfit/comments/1ll1r93/)). Treat the Android health-hub path as "probably carries data, verify stages".

---

## 3. Health Auto Export (the iOS app `fit-analyzer` ingests from)

This is first-party, well-documented and the most relevant to an existing pipeline.

### 3.1 JSON shape of `sleep_analysis`

Health Auto Export (HAE) emits `sleep_analysis` in `metrics[]`, in **hours**, in one of two shapes depending on the **"Summarize Data"** toggle ([HAE Health Metrics docs](https://help.healthyapps.dev/en/health-auto-export/export-format/health-metrics)):

**Aggregated (Summarize ON):** one row per day with `totalSleep`, `asleep`, `core`, `deep`, `rem`, `sleepStart`, `sleepEnd`, `inBed`, `inBedStart`, `inBedEnd`.

**Unaggregated (Summarize OFF) — the one to use for stage analysis:** one object **per sleep segment**:

```json
{
  "name": "sleep_analysis",
  "units": "hr",
  "data": [
    {
      "startDate": "2024-02-05 23:00:00 -0800",
      "endDate":   "2024-02-05 23:30:00 -0800",
      "qty": 0.5,
      "value": "Core",
      "deep": 0.0,
      "rem": 0.0,
      "sleepStart": "…", "sleepEnd": "…",
      "inBed": 8.0, "inBedStart": "…", "inBedEnd": "…"
    }
  ]
}
```

`value` is one of `"Awake"`, `"Asleep"`, `"In Bed"`, `"Core"`, `"REM"`, `"Deep"`, `"Unspecified"`. The doc explicitly notes `"Asleep"` = *uncategorized* sleep (i.e. the source didn't provide stages) — so if you see only `"Asleep"`, Zepp didn't write stages. ([HAE Health Metrics docs](https://help.healthyapps.dev/en/health-auto-export/export-format/health-metrics).)

### 3.2 Metric names HAE emits (relevant subset)

All metric names are **snake_case** ([HAE Health Metrics docs](https://help.healthyapps.dev/en/health-auto-export/export-format/health-metrics)); the supported-data list is at [getting-started/supported-data](https://help.healthyapps.dev/en/health-auto-export/getting-started/supported-data) and the older [wiki](https://github.com/Lybron/health-auto-export/wiki/Supported-Data):

| Requested metric | HAE metric name |
| --- | --- |
| Sleep | `sleep_analysis` |
| Resting HR | `resting_heart_rate` |
| HRV | `heart_rate_variability` |
| SpO₂ | `blood_oxygen_saturation` |
| Respiratory rate | `respiratory_rate` |
| Body temperature | `body_temperature` (and `basal_body_temperature`) |
| Wrist/sleeping temperature | `apple_sleeping_wrist_temperature` (reported as a delta on Apple platforms) |
| Weight | `weight_&_body_mass` |

It also emits `breathing_disturbances` on iOS 18+ (Apple's sleep-apnea signal) and heart-rate notifications ([supported-data](https://help.healthyapps.dev/en/health-auto-export/getting-started/supported-data)).

### 3.3 Automatic background export to REST / webhook

Yes — **REST API automations** POST JSON (or `multipart/form-data` CSV) to any endpoint, with custom headers, configurable cadence, date range (Default = previous full day + today-to-now, "Since Last Sync", etc.), optional **batch requests** for large payloads, and per-request headers `automation-name`, `automation-id`, `automation-aggregation`, `automation-period`, `session-id` ([HAE REST API docs](https://help.healthyapps.dev/en/health-auto-export/automations/rest-api)). Background auto-export is a **Premium** feature ([HAE repo README](https://github.com/Lybron/health-auto-export)).

**Critical iOS limitations you must design around** (all first-party, [HAE REST API docs](https://help.healthyapps.dev/en/health-auto-export/automations/rest-api)):

- *"Apps are not allowed to access health data while iPhone is locked. Automations will only run during periods when your device is unlocked."* (Apple's [Protecting user privacy](https://developer.apple.com/documentation/healthkit/protecting-user-privacy) rule.)
- Background App Refresh / Low Power Mode / inactivity can delay or skip runs; Apple caps background tasks (~30 s), so **large exports can be killed** — export only the metrics you need.
- Workaround HAE itself suggests: charge the phone and use **iPhone Mirroring** so the device behaves as if unlocked.

**Net:** HAE is a solid, documented ingest path that **preserves stages when they exist**, and the stage `value` field makes "did Zepp give me stages?" trivially detectable in your `fit-analyzer` webhook.

---

## 4. Reverse-engineered sleep & health endpoints [RE]

All of §4 is reverse-engineered from the official Zepp app; it is unofficial and can break without notice. Auth/endpoint basics are in the companion doc; here is the **sleep/health** detail.

### 4.1 `/v1/data/band_data.json` — the actual sleep payload [RE]

Tools call this the "band data / sleep+steps sync payload" ([m4ary/zepp-health-cli](https://github.com/m4ary/zepp-health-cli)). Parameters: `userid`, `from_date`, `to_date`, `query_type=detail|summary`, `byteLength`, `device_type` ([m4ary `zepp_health.py`](https://raw.githubusercontent.com/m4ary/zepp-health-cli/main/zepp_health.py)).

The most concrete public evidence of its **sleep** contents is `bentasker/zepp_to_influxdb`, which parses it in production. Each day in `response["data"]` has `date_time`, `data_hr` (a base64 HR blob), and a base64 `summary` blob; `json.loads(base64.b64decode(summary))` yields a `slp` object ([bentasker `mifit_to_influxdb.py`](https://raw.githubusercontent.com/bentasker/zepp_to_influxdb/main/app/mifit_to_influxdb.py)):

| Field | Meaning (per the parser) |
| --- | --- |
| `slp['lt']` | **Light** sleep minutes |
| `slp['dp']` | **Deep** sleep minutes |
| `slp['st']` | Sleep start (minute-of-day) |
| `slp['ed']` | Sleep end (minute-of-day) |
| `slp['stage']` (optional) | Array of `{mode, start, stop}` per-segment stages |
| `slp['stage'][].mode` | **4 = light, 5 = deep, 7 = awake, 8 = REM** |

So the payload can contain **full staged segments including REM**, and `bentasker` maps them 1:1 into `light_sleep` / `deep_sleep` / `awake` / `REM` points ([same file](https://raw.githubusercontent.com/bentasker/zepp_to_influxdb/main/app/mifit_to_influxdb.py)). **Caveat:** this parser was written for an **Amazfit Bip 3 Pro**; the endpoint & shape are the same one the T-Rex 3 Pro's app uses, but the per-model `mode` set should be re-verified. **⚠️** The other `summary` keys are `stp` (steps, with its own `stage[]`) and `goal`, plus a `sync` timestamp ([same file](https://raw.githubusercontent.com/bentasker/zepp_to_influxdb/main/app/mifit_to_influxdb.py)).

Related `band_data`-adjacent commands in `m4ary`: `manual-data --type sleep` (`/v1/user/manualData.json`, app-logged sleep sessions) and `heart-rate` (`/users/{id}/heartRate`) ([m4ary README](https://github.com/m4ary/zepp-health-cli)).

### 4.2 Events endpoints for HRV / SpO₂ / stress / body-battery / readiness [RE]

`m4ary/zepp-health-cli` enumerates the presets (event `type`/`subType` triples) it has seen in proxy captures ([README](https://github.com/m4ary/zepp-health-cli), [source](https://raw.githubusercontent.com/m4ary/zepp-health-cli/main/zepp_health.py)):

| Preset | Endpoint + (eventType, subType) |
| --- | --- |
| `hrv` | `/v2/users/me/events` — (`hrv_sdnn`, `real_data`) |
| `hrv-rmssd` | `/v2/users/me/events` — (`HRVRMSSD`, `real_data`) |
| `stress` | `/v2/users/me/events` — (`Charge`, `stress_data`) |
| `body-battery` | `/v2/users/me/events` — (`Charge`, `real_data`) |
| `respiratory` | `/v2/users/me/events` — (`RespiratoryRate`, `real_data`) |
| `temperature` / `readiness` | `/v2/users/me/events` — (`readiness`, `watch_score`) |
| `daily-health` | `/v2/users/me/events` — (`DailyHealth`, `summary`) |
| `all-day-stress` | `/users/{id}/events` — (`all_day_stress`, …) |
| `spo2` | `/users/{id}/events` — (`blood_oxygen`, `click`) |
| `spo2-odi` / `spo2-osa` | `/users/{id}/events/dateString` — (`blood_oxygen`, `odi` / `osa_event`) |
| `pai` | `/users/{id}/events` — (`PaiHealthInfo`, …) |
| per-second HR index | `/users/me/fileInfo/events` — (`second_heart_rate`, `real_data`) |

`bentasker` shows the concrete field names the events API uses, e.g. for SpO₂ `click` events `extra.spo2`; ODI events `odi`, `score`; OSA events `spo2_decrease`; daily stress `minStress`/`maxStress`/`avgStress` + per-hour `data[].{time,value}`; PAI `restHr`/`maxHr`/zone minutes/total ([bentasker `mifit_to_influxdb.py`](https://raw.githubusercontent.com/bentasker/zepp_to_influxdb/main/app/mifit_to_influxdb.py)). Body temperature is a **calibrated delta from your baseline** in hundredths of °C (`skinTempCalibrated`, plus `skinTempScore`, `skinTempBaseLine`), *not* an absolute temperature ([m4ary README](https://github.com/m4ary/zepp-health-cli)).

### 4.3 What each community tool emits for sleep

| Tool | Sleep output |
| --- | --- |
| **`m4ary/zepp-health-cli`** | `band-data` = raw sleep/steps JSON (staged, per §4.1); `manual-data --type sleep` = app-logged sleep; plus `events` presets for `body-battery`, `hrv`, `hrv-rmssd`, `stress`, `respiratory`, `readiness`. `--json` for piping. ([README](https://github.com/m4ary/zepp-health-cli).) |
| **`bentasker/zepp_to_influxdb`** | Writes per-day `total_sleep_min`, `deep_sleep_min`, `rem_sleep_min`, `slept_from`, `slept_to`, plus per-segment `sleep_stage` points (`light_sleep`/`deep_sleep`/`awake`/`REM`/`unknown_N`) and a per-minute `sleep_stage_tracker`. Also SpO₂/ODI/OSA, stress (daily + per-hour), PAI. ([source](https://raw.githubusercontent.com/bentasker/zepp_to_influxdb/main/app/mifit_to_influxdb.py), [README](https://github.com/bentasker/zepp_to_influxdb).) |
| **`rolandsz/Mi-Fit-and-Zepp-workout-exporter`** | **Workouts only** (GPX/GeoJSON/tabular). I found **no sleep handling**. ([repo](https://github.com/rolandsz/Mi-Fit-and-Zepp-workout-exporter); see §4.3 of the companion doc.) |

Underlying protocol credits go to `micw/hacking-mifit-api` ([repo](https://github.com/micw/hacking-mifit-api)).

### 4.4 GDPR / account CSV export — `SLEEP.csv` columns [RE]

The account/GDPR export (`Zepp App → Profile → Settings → Exercising user rights → Export data`, or `user.huami.com/privacy2/...`; [zepp.com/privacy-support](https://www.zepp.com/privacy-support)) yields **CSV files, not FIT**. Gadgetbridge publishes an importer that consumes them and names the sleep file **`SLEEP.csv`** ([Gadgetbridge "Import data from Mi Fit"](https://gadgetbridge.org/internals/development/data-management/)).

The importer's header-skip + parsing logic reveals the columns of the sample it was written against:

```
# example rows (header skipped):
# 2017-07-05,45,348,0,2017-07-05 08:23:00+0000,2017-07-05 08:23:00+0000
deep_sleep  = int(line[1])   # minutes
light_sleep = int(line[2])   # minutes
datetime.strptime(line[4], "%Y-%m-%d %H:%M:%S%z")   # sleep start (with tz)
datetime.strptime(line[5], "%Y-%m-%d %H:%M:%S%z")   # sleep end   (with tz)
# line[0] = date (YYYY-MM-DD); line[3] = unused (0)
```

So the observed schema is: **date, deep_sleep_minutes, light_sleep_minutes, <unused/flag>, sleep_start(tz), sleep_end(tz)** ([Gadgetbridge data-management script](https://gadgetbridge.org/internals/development/data-management/)). **⚠️ Important caveats:** (1) this is a **single date + totals + a start/end pair**, i.e. **no REM**, no per-segment stages — it is *coarser* than the API payload in §4.1; (2) it comes from an **old Mi Fit-era** file and the modern Zepp `SLEEP.csv` may differ; (3) I could not find a public, current sample of a Zepp `SLEEP.csv` to confirm. Verify by exporting and opening the file. Other CSVs named by the same importer: `ACTIVITY_MINUTE.csv`, `HEARTRATE.csv`, `HEARTRATE_AUTO.csv`.

---

## 5. Zepp OS Mini Program / watch-side sleep & health APIs (primary: docs.zepp.com)

These are **official, supported** APIs for a Mini Program running on the watch — but they are for *building apps*, not for reading history, and mostly expose **today only**.

### 5.1 `Sleep` (`@zos/sensor`) — v3+ ([docs](https://docs.zepp.com/docs/reference/device-app-api/newAPI/sensor/Sleep/))

Permission `data:user.hd.sleep`; API_LEVEL 2.0+.

- `getInfo(): SleepInfo` → `score`, `deepTime` (min), `startTime`/`endTime` (**minutes from 0:00 of the day**), `totalTime` (min).
- `getStageConstantObj(): StageConstants` → `WAKE_STAGE`, `REM_STAGE`, `LIGHT_STAGE`, `DEEP_STAGE`.
- **`getStage(): Array<StageInfo>`** → `{ model, start, stop }` per segment, where `model` is one of the stage constants above. **This is the per-segment staged sleep data.**
- `getSleepingStatus(): number` (0 awake / 1 sleeping), API_LEVEL 3.0.
- `getNap(): Array<NapInfo>` → `{ length, start, stop }`, API_LEVEL 3.0.
- `updateInfo()` lets the app force a refresh; **the system otherwise updates sleep data every 30 minutes**.

**Live vs historical:** this is **today's sleep** (the night that ended today, expressed as minute-of-day). There is **no date parameter and no history** — you can only read the most recent sleep. So a Mini Program *can* retrieve **the previous night's stages** (`getStage()`) the morning after, but cannot backfill older nights, and if it doesn't run before the day rolls over the session is lost to you.

**On `Sleep.getSleepStageTime()`:** this method name does **not** appear in the current v3 reference. The documented accessors are `getStage()` + `getStageConstantObj()` (v2/v3). The v1.0 API used `getSleepStageData()` / `getSleepStageModel()` / `getSleepHrData()` ([v1.0 SLEEP docs](https://docs.zepp.com/docs/1.0/reference/device-app-api/hmSensor/sensorId/SLEEP/)). **⚠️** If a `getSleepStageTime()` exists it is not in the public docs; don't build on it.

### 5.2 Other health sensors ([Device App API → Sensor index](https://docs.zepp.com/docs/reference/device-app-api/newAPI/sensor/Accelerometer/))

| Module | Key methods | Historical? |
| --- | --- | --- |
| `HeartRate` | `getLast()`, `getToday()` (per-minute, up to 1440), `getDailySummary()` (max HR + time), `getResting()`, `getAFibRecord()`, `onRestingChange()` — [docs](https://docs.zepp.com/docs/reference/device-app-api/newAPI/sensor/HeartRate/) | Today (+ AFib records) |
| `Stress` | `getCurrent()`, **`getToday()`** (per-minute), `getTodayByHour()` (24), **`getLastWeek()`** (7 days), `getLastWeekByHour()` (7×24) — [docs](https://docs.zepp.com/docs/reference/device-app-api/newAPI/sensor/Stress/) | **Up to 7 days** |
| `BloodOxygen` (SpO₂) | `getCurrent()`, `getLastDay()` (24 h averages), `getLastFewHour(hour)` (timestamps) — [docs](https://docs.zepp.com/docs/reference/device-app-api/newAPI/sensor/BloodOxygen/) | ≤ 24 h / few hours |
| `BodyTemperature` | `getCurrent()`, **`getToday()`** = 288 values (one per 5 min, °C, `-1000` = missing) — [docs](https://docs.zepp.com/docs/reference/device-app-api/newAPI/sensor/BodyTemperature/) | Today |
| `Pai` | PAI score methods — [docs](https://docs.zepp.com/docs/reference/device-app-api/newAPI/sensor/Pai/) | Today-ish |

**What does NOT exist on-watch (checked against the full sensor index):** there is **no HRV sensor, no BodyBattery/BioCharge sensor, and no "readiness" sensor** exposed to Mini Programs. There is also **no generic "HistoricalData"/daily-summary API** — the only multi-day sensor is `Stress.getLastWeek()`. The one "user" health API, `addHealthData`, is **write-only** (weight/BMI) ([docs](https://docs.zepp.com/docs/reference/device-app-api/newAPI/user/addHealthData/)). So HRV/BioCharge/readiness are reachable **only** through the reverse-engineered cloud events endpoints (§4.2), not the watch.

### 5.3 T-Rex 3 Pro on this API surface

Per Zepp's official device list, **T-Rex 3 Pro (44 mm and 48 mm) run Zepp OS 5.0 at API_LEVEL 4.2** ([docs.zepp.com device list](https://docs.zepp.com/docs/reference/related-resources/device-list/)) — so every v3/API_LEVEL 3.x method above (Sleep stages, `Stress.getLastWeek()`, `BloodOxygen.getLastFewHour()`, `BodyTemperature.getToday()`, `HeartRate.getDailySummary()`) is available.

---

## 6. Home Assistant Mini Program bridges

All three are **watch Mini Programs** that push sensor data to HA; none is a history exporter.

- **`davidepalleschi/zepp2hass`** (HA custom integration, HACS). Sensors created for sleep: **Sleep Score, Total Duration, Deep Sleep, Sleep Start/End Time** — note **only Deep**, no light/REM. Also HR (last/resting/max), body temperature, stress, blood oxygen, steps/calories/etc., PAI, and binary sensors (wearing/moving/sleeping). Rate-limited 30 req / 60 s / device. It expects a companion watch app from the Zepp Store. ([README](https://github.com/davidepalleschi/zepp2hass).)
- **`MaximeBranger/zepp-hass-sync` (now "Hass Sync")** — an **open-source replacement** for zepp2hass's watch app (which "currently crashes on launch, its source isn't public"). It **claims T-Rex 3 / T-Rex 3 Pro support**, but the compatibility table shows them **implemented and tested only on ≤ 1.2**, and the current **1.3.x is only confirmed unstable on GTR 4** (alarm-driven background send capped at 600 ms vs a multi-second BLE round-trip). ([README](https://github.com/MaximeBranger/zepp-hass-sync).)
- **`ga2mer/ha-zepp`** — watch Mini Program to control HA and push wearable sensor data to HA's REST API via an alarm-triggered background page; needs the Zeus CLI to build/install. It documents that its updater "will break" if any watch notification blocks the alarm page. ([README](https://github.com/ga2mer/ha-zepp).)

**Reliability on a T-Rex 3 Pro:** the watch-side path is inherently **model- and firmware-dependent**, depends on background execution actually firing, and (for the sleep use case) only `zepp2hass` produces sleep sensors at all — and **only Deep**, not light/REM. So this route is **poor for full sleep staging** and should be considered a "near-real-time subset metrics" convenience, not a sleep-data source.

---

## 7. T-Rex 3 Pro specifics

- **OS/API:** **Zepp OS 5.0, API_LEVEL 4.2** (both 44 mm and 48 mm) ([docs.zepp.com device list](https://docs.zepp.com/docs/reference/related-resources/device-list/)). Launched Sept 2025 ([Zepp press release](https://www.zepp.com/press-release/amazfit-t-rex-3-pro-smartwatch-launches-featuring-a-rugged-titanium-design-and-integrated-flashlight)).
- **BioCharge / readiness:** the T-Rex 3 Pro **has BioCharge** (Amazfit's Body-Battery-style metric, which **replaced the earlier "Readiness" score from Sept 2025**). It also gained **BioCharge-related tools** in a Dec 2025 firmware ([Notebookcheck](https://www.notebookcheck.org/Amazfit-smartwatches-get-new-BioCharge-related-tools-in-update.1176599.0.html)) and **lactate-threshold tracking** in Mar 2026 ([the5krunner](https://the5krunner.com/2026/04/22/amazfit-april-update/)). **BioCharge is not a HealthKit/Health Connect type and does not sync to either** (§1.4, and it's absent from Gadgetbridge's syncable list below).
- **Sleep-export in the Zepp app:** the watch records stages/score/naps and Zepp shows sleep reports ([Amazfit](https://us.amazfit.com/pages/why-are-my-sleep-results-are-not-tracking-properly)); the *only* Zepp-side exports are (a) the Apple Health / Health Connect hub sync, and (b) the GDPR CSV archive (§4.4). There is **no per-night sleep file export** in the app.
- **Gadgetbridge support level:** **"Highly supported"**, added from [issue #5533](https://codeberg.org/Freeyourgadget/Gadgetbridge/issues/5533), **both 44 mm and 48 mm**. Requires the Huami/Zepp auth key to pair. ([Gadgetbridge Amazfit page](https://gadgetbridge.org/gadgets/wearables/amazfit/).) Watch for the **BT-Classic-needed-on-newer-firmware** pattern documented for other devices (the T-Rex 3 Pro page doesn't list it, but Balance/Balance 2 do — test if pairing fails). ([Gadgetbridge Zepp OS page](https://gadgetbridge.org/basics/topics/zeppos/).)
- **What sleep data Gadgetbridge actually gets for Zepp OS:** Gadgetbridge's sleep chart shows a **light/deep breakdown**, and it documents that **"Zepp OS 3.5 devices and above"** are known to **sync sleep stages including deep sleep** (on older Zepp OS, "sleep stage and sleep times are not accurate"). ([Gadgetbridge "Activity and sleep"](https://gadgetbridge.org/basics/features/activities/).) So for the T-Rex 3 Pro, Gadgetbridge **does** receive staged sleep (at least light/deep).
- **What Gadgetbridge is missing for Zepp OS (sleep-relevant):** **Sleep SpO₂ (breath-quality monitoring), Max HR, manual HR measurements, and BioCharge.** Also missing built-in-app data: **Readiness**, **Sleep schedule**. ([Gadgetbridge Zepp OS page](https://gadgetbridge.org/basics/topics/zeppos/).) So Gadgetbridge will **not** give you the T-Rex 3 Pro's overnight SpO₂ or BioCharge, even though it gives sleep stages + HR.
- **Gadgetbridge → Health Connect:** since PR #5346, Gadgetbridge can **write to Health Connect**, including **Sleep Sessions**, Steps, Distance, Heart Rate, SpO₂, HRV, body/skin temperature, respiratory rate, resting HR, weight, VO₂ max and exercise sessions. Data stays on-device. **⚠️** The docs list "Sleep Sessions" but do **not** state whether the individual **stage segments** are populated (it may write the session with a single stage). ([Gadgetbridge Health Connect](https://gadgetbridge.org/basics/integrations/health-connect/), [PR #5346](https://codeberg.org/Freeyourgadget/Gadgetbridge/pulls/5346).)

---

## 8. Ranked recommendation — getting **sleep** data into a self-hosted app

Ranked for the goal "sleep segments/stages into my own database", assuming the T-Rex 3 Pro + Zepp app.

| Rank | Path | What you get | Stages? | Reliability | Effort | Fragility |
| --- | --- | --- | --- | --- | --- | --- |
| **1 (iOS)** | **Zepp → Apple Health → Health Auto Export (REST, unaggregated) → your app** | Per-segment sleep with `value` = Core/Deep/REM/Awake + in-bed, plus RHR/HRV/SpO₂/respiratory/temp/weight *if they cross* | **Yes, if Zepp wrote them** — HAE preserves them; `"Asleep"` means it didn't ⚠️ | High (official both hops) | **Lowest for you** — HAE webhook already exists | Background/unlock limits; HRV device-limited |
| **2 (Android)** | **Zepp → Health Connect → your own reader app → your app** | `SleepSessionRecord` (+ associated HR/SpO₂/respiratory via time overlap) | Mandatory `stages` field ⇒ at least one stage; **full breakdown unverified** ⚠️ | Medium (reports of unreliable sleep sync) | High — you must build the HC reader | Write-only + no push; poll HC |
| **3 (Android)** | **Gadgetbridge → Health Connect** (or its SQLite) | Sleep sessions with light/deep (≥ Zepp OS 3.5), HR, SpO₂, HRV, temp, resp, resting HR | Likely light/deep; **stage segments in HC unconfirmed** ⚠️ | High once paired | High (Android phone, auth key, pair) | Needs vendor auth key; no BioCharge/Sleep-SpO₂ |
| **4 (either)** | **`[RE]` `/v1/data/band_data.json`** via `zepp-health-cli` / `zepp_to_influxdb` | **Full staged segments incl. REM + awake** + HR blob; `events` endpoints for HRV/SpO₂/stress/body-battery/readiness/respiratory | **Yes (demonstrated in code)** | Medium | Medium (proxy token capture) | `apptoken` ~30-day TTL; encrypted login/SSL pinning; ToS risk |
| **5 (either)** | **Watch Mini Program → HA** (`zepp2hass`/Hass Sync) | Sleep score, total duration, **Deep only**, start/end (+ HR/stress/SpO₂) | **No — Deep only** | Medium; model/firmware-dependent | Medium–High | Background-exec timing; crashes on some models |
| **6 (either)** | **GDPR `SLEEP.csv`** | Daily Deep+Light totals + start/end | **No REM, no segments** ⚠️ | High (official, but slow) | Low per export, high for automation | Schema may have changed since the importer was written |

### Apple Health (iOS) vs Health Connect (Android) — the direct answer

- **iOS / Apple Health is the better bridge for this use case**, *if* the user is on an iPhone. Reasons: (a) it plugs straight into the **existing Health Auto Export webhook** in `fit-analyzer`; (b) HAE's **unaggregated `sleep_analysis` carries exactly the per-segment `Core`/`Deep`/`REM`/`Awake` values**, so stages survive end-to-end *provided Zepp wrote them*; (c) no custom client app to build on the phone. The cost is Apple's **locked-device / background** limits and the need to confirm Zepp stage-writing once (§1.3).
- **Android / Health Connect works but is more work and less certain.** Zepp writes sleep (and HR/SpO₂/etc.) to Health Connect, **write-only and with no webhook**, so you must build and run a **reader** that polls `SleepSessionRecord`; Health Connect mandates a `stages` list so *something* staged is written, but whether Zepp fills the full light/deep/REM/awake breakdown is **undocumented**. If you're on Android and willing to run Gadgetbridge, **Gadgetbridge → Health Connect** is the more self-hosted-friendly variant (stages documented for Zepp OS ≥ 3.5), at the cost of pairing/auth-key setup and losing overnight SpO₂/BioCharge.
- **Stages survival, summarised:** iOS path — *likely yes* (verify once); Android Zepp→Health Connect — *probably partial/unverified*; Gadgetbridge→Health Connect — *likely light/deep*; reverse-engineered `band_data` — *yes, including REM* (but fragile); HA Mini Program — *no* (Deep only); GDPR CSV — *no* (no REM).

### Depends on the user's phone OS

Yes, and this decision is **made for you by the phone**:

- **iPhone →** enable Zepp → Apple Health, then point Health Auto Export at the `fit-analyzer` webhook (metrics: `sleep_analysis`, `resting_heart_rate`, `heart_rate_variability`, `blood_oxygen_saturation`, `respiratory_rate`, `body_temperature`, `apple_sleeping_wrist_temperature`, `weight_&_body_mass`). Use **Summarize OFF** to keep per-segment stages.
- **Android →** either (a) enable Zepp → Health Connect and write a small reader for `SleepSessionRecord` (+ associated records by time overlap), or (b) run **Gadgetbridge** and let it write to Health Connect, or read its SQLite directly.
- **Either OS, if you accept fragility →** use the reverse-engineered `band_data.json` / events tools to get the *fullest* stage set (incl. REM) plus HRV/BioCharge/readiness, at the price of ~monthly token re-capture.

---

## 9. Uncertainty / open questions (what to verify first)

1. **Does Zepp write sleep *stages* to Apple Health on this watch/phone/version?** The single most important unknown. Verify by inspecting Sleep samples by source in Apple Health (§1.3). If you only see "In Bed"/"Asleep", the whole iOS stage pipeline degrades to `value: "Asleep"` in HAE.
2. **Does Zepp populate full stages in Health Connect** (`SleepSessionRecord.stages`), or a single coarse stage? Undocumented. Dump records (e.g. with the Health Connect Toolbox) to see.
3. **Does Gadgetbridge write individual stage segments to Health Connect**, or just the session? Docs list "Sleep Sessions" only.
4. **Is `SLEEP.csv` still the same schema?** The only public parser is an old Mi Fit-era script; export your own and diff.
5. **Does the Zepp app on *this* firmware export HRV / SpO₂ / respiratory / skin temperature to Apple Health / Health Connect?** Per-device and per-version; the T-Rex 3 Pro is not on the confirmed HRV-export list.
6. **`band_data` `mode` codes for the T-Rex 3 Pro** — the 4/5/7/8 mapping came from a Bip 3 Pro parser and should be re-confirmed against a fresh capture.
7. **`Sleep.getSleepStageTime()`** — not in current docs; only `getStage()` exists. Don't assume it.

---

## Sources

**Apple / HealthKit (primary)**
- `HKCategoryValueSleepAnalysis` (inBed / awake / asleepCore / asleepDeep / asleepREM / asleepUnspecified / asleep-deprecated) — https://developer.apple.com/documentation/healthkit/hkcategoryvaluesleepanalysis
- HealthKit identifier `sleepAnalysis` used by the above — https://developer.apple.com/documentation/HealthKit/HKCategoryTypeIdentifier/sleepAnalysis
- Protecting user privacy (no health-data access while locked) — https://developer.apple.com/documentation/healthkit/protecting-user-privacy
- "Estimating Sleep Stages from Apple Watch" (Oct 2025) — https://www.apple.com/health/pdf/Estimating_Sleep_Stages_from_Apple_Watch_Oct_2025.pdf

**Google / Health Connect (primary)**
- Data types (`SleepSessionRecord`, mandatory `stages`; `HeartRateRecord`, `OxygenSaturationRecord`, `RespiratoryRateRecord`, `HeartRateVariabilityRmssdRecord`, `RestingHeartRateRecord`, `SkinTemperatureRecord`, `BodyTemperatureRecord`) — https://developer.android.com/health-and-fitness/health-connect/data-types
- Develop Sleep experiences — https://developer.android.com/health-and-fitness/health-connect/experiences/sleep
- Track sleep sessions — https://developer.android.com/health-and-fitness/health-connect/features/sleep-sessions

**Health Auto Export (primary)**
- JSON export format overview — https://help.healthyapps.dev/en/health-auto-export/export-format
- Health metrics incl. sleep_analysis shapes — https://help.healthyapps.dev/en/health-auto-export/export-format/health-metrics
- Supported data & metrics — https://help.healthyapps.dev/en/health-auto-export/getting-started/supported-data
- REST API automation (headers, batching, background/unlock limits) — https://help.healthyapps.dev/en/health-auto-export/automations/rest-api
- Repo README (pricing, integrations) — https://github.com/Lybron/health-auto-export ; wiki supported data — https://github.com/Lybron/health-auto-export/wiki/Supported-Data

**Zepp OS (primary)**
- `Sleep` v3 — https://docs.zepp.com/docs/reference/device-app-api/newAPI/sensor/Sleep/
- `HeartRate` v3 — https://docs.zepp.com/docs/reference/device-app-api/newAPI/sensor/HeartRate/
- `Stress` v3 — https://docs.zepp.com/docs/reference/device-app-api/newAPI/sensor/Stress/
- `BloodOxygen` v3 — https://docs.zepp.com/docs/reference/device-app-api/newAPI/sensor/BloodOxygen/
- `BodyTemperature` v3 — https://docs.zepp.com/docs/reference/device-app-api/newAPI/sensor/BodyTemperature/
- Sensor index (proves no HRV/BodyBattery sensor) — https://docs.zepp.com/docs/reference/device-app-api/newAPI/sensor/Accelerometer/
- `addHealthData` (write-only) — https://docs.zepp.com/docs/reference/device-app-api/newAPI/user/addHealthData/
- Device list (T-Rex 3 Pro = Zepp OS 5.0 / API_LEVEL 4.2) — https://docs.zepp.com/docs/reference/related-resources/device-list/
- v1.0 `SLEEP` sensor (`getSleepStageData`/`getSleepStageModel`/`getSleepHrData`) — https://docs.zepp.com/docs/1.0/reference/device-app-api/hmSensor/sensorId/SLEEP/

**Amazfit / Zepp (first-party, marketing/support)**
- How to sync to Strava / Apple Health / Google Fit / Relive — https://support.amazfit.com/en/amazfit_gts_2_mini/docs/N6cUdJxDRo6rbfxiLs1cJDBrnRd
- Health technology (sleep stages, HRV-RMSSD, BioCharge, PAI) — https://us.amazfit.com/pages/amazfit-technology-page-health-technology
- Sleep troubleshooting (stages/naps/REM assisted monitoring) — https://us.amazfit.com/pages/why-are-my-sleep-results-are-not-tracking-properly
- Zepp technology (SomnusCare sleep stages) — https://www.zepp.com/technology
- Data-subject rights / export — https://www.zepp.com/privacy-support
- T-Rex 3 Pro press release — https://www.zepp.com/press-release/amazfit-t-rex-3-pro-smartwatch-launches-featuring-a-rugged-titanium-design-and-integrated-flashlight

**Community tooling**
- `m4ary/zepp-health-cli` — https://github.com/m4ary/zepp-health-cli ; source — https://raw.githubusercontent.com/m4ary/zepp-health-cli/main/zepp_health.py
- `bentasker/zepp_to_influxdb` — https://github.com/bentasker/zepp_to_influxdb ; source — https://raw.githubusercontent.com/bentasker/zepp_to_influxdb/main/app/mifit_to_influxdb.py
- `rolandsz/Mi-Fit-and-Zepp-workout-exporter` (workouts only) — https://github.com/rolandsz/Mi-Fit-and-Zepp-workout-exporter
- `micw/hacking-mifit-api` (protocol) — https://github.com/micw/hacking-mifit-api
- `davidepalleschi/zepp2hass` — https://github.com/davidepalleschi/zepp2hass
- `MaximeBranger/zepp-hass-sync` ("Hass Sync") — https://github.com/MaximeBranger/zepp-hass-sync
- `ga2mer/ha-zepp` — https://github.com/ga2mer/ha-zepp

**Gadgetbridge (community, high-trust docs)**
- Zepp OS gadgets (missing Sleep SpO₂ / Max HR / manual HR / BioCharge; sleep accuracy < 3.5) — https://gadgetbridge.org/basics/topics/zeppos/
- Amazfit device list (T-Rex 3 Pro "Highly supported", issue #5533) — https://gadgetbridge.org/gadgets/wearables/amazfit/
- Activity and sleep (Zepp OS 3.5+ sync sleep stages incl. deep) — https://gadgetbridge.org/basics/features/activities/
- Health Connect (sleep sessions + other types) — https://gadgetbridge.org/basics/integrations/health-connect/ ; PR #5346 — https://codeberg.org/Freeyourgadget/Gadgetbridge/pulls/5346
- Data management (`SLEEP.csv` schema + importer) — https://gadgetbridge.org/internals/development/data-management/

**Reputable secondary / community reports (flagged where load-bearing)**
- Notebookcheck, Zepp→Health Connect (permissions incl. Sleep; one-way) — https://www.notebookcheck.net/Amazfit-smartwatches-get-new-Health-Connect-data-sync-feature.951489.0.html
- Notebookcheck, T-Rex 3 Pro BioCharge tools — https://www.notebookcheck.org/Amazfit-smartwatches-get-new-BioCharge-related-tools-in-update.1176599.0.html
- Constant, Zepp↔Apple Health sync table (HRV device-limited; stress/readiness don't sync) — https://trainconstant.com/blog/amazfit-zepp-apple-health
- the5krunner, Apr 2026 HRV→Apple Health (Active 3 Premium; Helio Strap sparse) + BioCharge lineup — https://the5krunner.com/2026/04/22/amazfit-april-update/
- r/amazfit: stages appear identical in Apple Health and Zepp — https://www.reddit.com/r/amazfit/comments/1ndbl8r/apple_health_sleep_score_vs_zepp_sleep_score_from/
- r/amazfit: Zepp SpO₂→Apple Health reportedly not possible (2021) — https://www.reddit.com/r/amazfit/comments/l4uz1n/ios_can_zepp_sync_with_spo2_with_apple_health_in/
- r/amazfit: "now sync more data to Health Connect" (write-only) — https://www.reddit.com/r/amazfit/comments/1i7rks0/now_sync_more_data_to_health_connect/
- r/amazfit: Zepp sleep data syncs unreliably to Health Connect — https://www.reddit.com/r/amazfit/comments/1vwb5we/ ; and HC sync stops without Google Fit — https://www.reddit.com/r/amazfit/comments/1ll1r93/ ; Zepp doesn't *read* sleep from HC — https://www.reddit.com/r/amazfit/comments/1qb793h/
