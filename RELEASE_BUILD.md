# RELEASE_BUILD.md — John Stick: web build → Android APK runbook

**Ownership split.** This repository holds the *web* game only (React 19 + Vite 6 + TypeScript, custom 2D canvas engine). Signing and packaging happen in J.I.N's Capacitor wrapper project, which lives **outside** this repository. Nothing signing-related (keystore, `.jks`, key passwords, `signingConfigs`) may ever be committed here.

Commands are marked **repo** (run here) or **wrapper** (run in the wrapper project).

---

## 0. Prerequisites — once per machine

| Need | Check | Notes |
|------|-------|-------|
| Node 20+ / npm | `node -v` | Dev server, Vite, tsx. |
| JDK 21 | `java -version` → `21.x` | Gradle 8 + AGP require 17+; 21 is the version the wrapper is built with. |
| Android SDK | `adb version`, `apksigner --version`, `aapt version` | platform-tools + build-tools on `PATH`. |
| Wrapper project | present, with `android/` and a `keystore/` you control | Owned by J.I.N. |

**`JAVA_TOOL_OPTIONS` / trust-store note.** If `JAVA_TOOL_OPTIONS` is exported in the shell that launches Gradle, every JVM in that shell picks it up and prints `Picked up JAVA_TOOL_OPTIONS: …` to **stderr** (some tooling mis-parses that line as an error). Worse, if it sets `-Djavax.net.ssl.trustStore=…` to a store that does not hold the public CA set, Gradle's dependency resolution fails with `PKIX path building failed`. So:

- If you do not need it: build with it unset — `env -u JAVA_TOOL_OPTIONS ./gradlew assembleRelease`.
- If you do need it: point it at a full trust store, and expect the stderr banner (it is not a build failure).

---

## 1. Type gate + smoke test (repo)

```bash
npm install
npm run lint                      # tsc --noEmit
npx tsx smoke_combat.ts           # must end with ALL GREEN (35 PASS lines)
```

All three must be green before anything is packaged. `npm run lint` is exactly `tsc --noEmit`; there is no other linter.

## 2. Clean web build (repo)

```bash
rm -rf dist && npm run build
```

Expected:

```
dist/index.html                   1.03 kB │ gzip:   0.46 kB
dist/assets/index-*.css         100.05 kB │ gzip:  14.15 kB
dist/assets/web-*.js              0.84 kB │ gzip:   0.40 kB   # @capacitor/app bridge chunk
dist/assets/index-*.js          659.31 kB │ gzip: 184.07 kB
(!) Some chunks are larger than 500 kB after minification.
```

- The 500 kB warning is **advisory** (one code-split chunk, 184 kB gzipped). Record it; do not "fix" it by deleting systems on release day.
- Always `rm -rf dist` first: stale files from an older build would otherwise ship inside the APK.
- `dist/` is git-ignored; never hand-edit it.

Resulting tree that must be present:

| Path | Content |
|------|---------|
| `dist/index.html` | entry, references `/assets/index-*.js` + `/assets/index-*.css` (absolute — fine, Capacitor serves from origin root) |
| `dist/assets/index-*.js`, `index-*.css` | game bundle |
| `dist/assets/web-*.js` | Capacitor App-plugin bridge |
| `dist/assets/audio/` | **21 entries = 20 `.ogg` + `SOURCES.md`** (fetched at runtime from `/assets/audio/…`) |
| `dist/assets/ai/` | room backdrops + title art (and their `media-generation-*.json` metadata) |
| `dist/assets/aistudio/` | empty template dir — harmless, ships as-is |

## 3. Sync into the wrapper (wrapper)

- Point the wrapper's `capacitor.config` `webDir` at this repo's `dist` (or copy `dist/*` into the wrapper's web root).
- `npx cap sync android` — pulls `@capacitor/core` / `@capacitor/app` versions from this repo's `package.json` into the native project.
- Review `git status` in the wrapper: only intended changes (synced assets, version bump).

## 4. Wrapper summary

| Field | Value |
|-------|-------|
| Application ID | `com.reesedigital.johnstick` |
| App name | John Stick |
| Packaging | Capacitor 8 (WebView + local asset bundle) — **not** a native Android project |
| Web entry | `dist/index.html` |
| Orientation | landscape-locked + fullscreen best-effort (`src/hooks/useLandscapeLock.ts`); show a rotate overlay when portrait is forced |
| Back button | `@capacitor/app` back-button listener → in-game pause/back handling (`App.tsx`) |
| Haptics | Web `navigator.vibrate` (`src/engine/Haptics.ts`) |
| Audio | bundled `.ogg` under `/assets/audio/`, loaded with `fetch` — no network needed |
| Saves | `localStorage` (`johnstick-profile-v1`, `john-stick.progress.v1`, `john-stick.settings.v1`) — no storage permission required |
| Permissions | see §9 |

## 5. Debug APK (wrapper)

```bash
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Installable with "unknown apps" allowed. Debug and release APKs use **different signatures** — a debug build cannot be upgraded in place by a release build (uninstall first, saves are lost), so never hand a debug APK to a player you expect to upgrade.

## 6. Release APK + keystore custody (wrapper)

Create the keystore **once**, then never again:

```bash
keytool -genkeypair -v \
  -keystore <owner-held location outside any repo> \
  -alias johnstick \
  -keyalg RSA -keysize 2048 -validity 10000
```

Then wire `signingConfigs.release` + `buildTypes.release.signingConfig` in the wrapper's `app/build.gradle` and build:

```bash
./gradlew clean assembleRelease     # or bundleRelease for Play
```

**Custody rules (non-negotiable):**

1. The keystore and its passwords are **never** written into this repository, never into git, never into a chat log.
2. Keep the keystore in the owner's password vault **plus** one independent backup (the alias password is stored separately from the file).
3. If the keystore is lost, the app can never be updated in place: a differently-signed APK is treated as a different app → uninstall → progress loss.
4. Rotating the key is a product decision (new package name, or a Play "key reset" process), not a routine ops step.

## 7. Version scheme

| Field | Rule | Current train |
|-------|------|---------------|
| `versionCode` (wrapper `build.gradle`) | Monotonic integer, **+1 per shipped build, never reused** — Android rejects a lower code on upgrade | `10` → the "v10 APK" |
| `versionName` (wrapper `build.gradle`) | `MAJOR.MINOR.PATCH`; `MAJOR` mirrors the build counter so the store label reads like the build | `10.0.0` |
| `package.json` `version` | Not read by Android (left `0.0.0`); bump only if you want the repo to match | — |

Every bump gets an entry in `CHANGELOG.md` (this repo) before the APK is handed over.

## 8. Verification checklist — every release

Run in order; a failure at any row stops the release.

| # | Check | Command / action | Pass criterion |
|---|-------|------------------|----------------|
| 1 | Type gate | `npm run lint` | exit 0, no errors |
| 2 | Smoke test | `npx tsx smoke_combat.ts` | ends with `ALL GREEN`, **35** `PASS` lines, 0 failures |
| 3 | Clean build | `rm -rf dist && npm run build` | exit 0 (chunk warning allowed) |
| 4 | Audio assets | `ls dist/assets/audio/*.ogg \| wc -l` | `20` (plus `SOURCES.md` = 21 entries) |
| 5 | Bundle integrity | `sha256sum dist/assets/index-*.js` then locate the same file inside the APK: `unzip -l <apk> \| grep 'index-.*\.js'` → `unzip -p <apk> <path> \| sha256sum` | hashes **match** — proves the APK carries the bundle you just built |
| 6 | Signature | `apksigner verify --verbose --print-certs <apk>` | `Verifies`, v2 + v3 schemes, expected signer cert |
| 7 | Identity | `aapt dump badging <apk> \| head` | `package: name='com.reesedigital.johnstick'`, `versionCode='10'`, `versionName='10.0.0'`, landscape screen orientation |
| 8 | Permissions | `aapt dump permissions <apk>` | matches §9 (no camera/mic/contacts/location) |
| 9 | Install | `adb install -r <apk>` | installs on a physical device |
| 10 | Cold start offline | enable airplane mode, launch | game boots, audio plays, no blank screen (all assets are local) |
| 11 | Core loop | 1 wave: move, combo, finisher, special, dodge, block, jump, pause | inputs respond, HUD/score/save behave |
| 12 | Persistence | force-stop, relaunch | profile, unlocks, settings and bests survive |
| 13 | Controls | touch layout editor + save, connect a pad, press Android back | layout persists, pad works, back pauses instead of killing the app |
| 14 | Feel | 10-minute run on mid-range Android, FPS chip on | holds ~60 FPS, no thermal runaway, no stuck buttons |
| 15 | Record | write the `versionCode`/`versionName`/bundle hash into `CHANGELOG.md` | documented |

## 9. Permissions audit

**Allowed (expected):**

| Permission | Why it exists |
|------------|---------------|
| `android.permission.VIBRATE` | `navigator.vibrate` in `src/engine/Haptics.ts` — gameplay haptics. |

**Never permitted** (grep the wrapper manifest and fail the build if present):

`CAMERA` · `RECORD_AUDIO` · `READ_CONTACTS` / `WRITE_CONTACTS` · `ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION` · `READ/WRITE_EXTERNAL_STORAGE` · `READ_CALENDAR` · `CALL_PHONE` / `SEND_SMS` · `READ_PHONE_STATE`

Evidence the app needs nothing else: `metadata.json` ships `"requestFramePermissions": []` (no browser capabilities requested), all storage is `localStorage`, and every runtime asset is bundled under `dist/assets/`.

`INTERNET`: gameplay does **not** need it (audio and art are local). The only networked feature is the dev-only **AI Agents** panel, which calls `/api/agents/*` on the dev server (`server.ts`) and must degrade to its built-in *"Network issue - check connection."* message in the APK. If the wrapper's manifest carries `INTERNET` (some Capacitor templates add it), document the reason next to it; do not add it to make that dev panel work.

## 10. Known non-blockers

- **Chunk-size warning** (§2) — advisory, 184 kB gzipped.
- **Empty `dist/assets/aistudio/`** — leftover template folder, ships harmlessly.
- **`media-generation-*.json` under `dist/assets/ai/`** — art provenance metadata, ships with the backdrops.
- **Secrets** — `GEMINI_API_KEY` is a server-side secret for `server.ts` only (`.env` is git-ignored). Never bundle it into the APK; the shipped APK is static files and has no server to talk to.
- **`npm run dev` / `npm run start`** run `tsx server.ts` (Express + Gemini agent endpoints) — development only, never part of a release artifact.
