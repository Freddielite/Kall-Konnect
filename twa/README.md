# Kall Konnect — Android APK (TWA)

This wraps your live PWA at `https://kallkonnect.vercel.app` in a Trusted Web
Activity, so Google Sign-In and push behave the same as they do in Chrome —
because it *is* Chrome under the hood, not a stripped WebView.

`twa-manifest.json` in this folder is a ready-made Bubblewrap config, built
from your actual `public/manifest.json`. You don't need to run the
interactive wizard — just build from it.

## Why this has to run on your machine (or CI), not here

Bubblewrap needs to download Android SDK build tools from `dl.google.com`
and Gradle dependencies from Google's Maven repo. Both are unreachable from
this sandbox. Locally or in GitHub Actions, they're a normal `npm install`
away.

## Steps

1. **Install Bubblewrap** (needs Node 18+):
   ```bash
   npm install -g @bubblewrap/cli
   ```

2. **Copy this folder** (`twa-manifest.json`) to your machine, `cd` into it.

3. **Run the build** — first run offers to install JDK 17 + Android SDK for
   you; say yes to both if you don't have them already:
   ```bash
   bubblewrap build
   ```
   This will:
   - Generate the full Android Studio project
   - Prompt to create `android.keystore` (your app's signing key) if it
     doesn't exist yet — **back this file up somewhere safe**. Losing it
     means you can never publish an update to the same app listing again.
   - Compile `app-release-signed.apk`

4. **Get the signing fingerprint** for Digital Asset Links (this is what
   proves to Android that you — not some copy of your site — control the
   app, so it opens without a Chrome address bar):
   ```bash
   keytool -list -v -keystore android.keystore -alias kallkonnect
   ```
   Copy the `SHA256` fingerprint from the output.

5. **Host `assetlinks.json`** — put this at
   `kall-konnect-mvp-main/public/.well-known/assetlinks.json` in your repo
   (Vercel serves anything under `public/` as static files, so this needs no
   server config) and redeploy:
   ```json
   [{
     "relation": ["delegate_permission/common.handle_all_urls"],
     "target": {
       "namespace": "android_app",
       "package_name": "tech.wyntek.kallkonnect",
       "sha256_cert_fingerprints": ["PASTE_YOUR_SHA256_HERE"]
     }
   }]
   ```
   Without this file being live at that exact URL, Android falls back to
   showing a browser address bar inside the app — it'll still work, just
   won't look fully "native."

6. **Install the APK**: `adb install app-release-signed.apk`, or upload it to
   Play Console as an internal test release.

## New logo (already in this zip)

`public/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, and
`apple-touch-icon.png` have been replaced with the new design (the split
circle with the two figures on a call). Nothing else needs to change —
`twa-manifest.json` already points at these filenames. Just:

1. Deploy this updated `public/` folder to Vercel so the new icons are live.
2. Rerun `bubblewrap build` to bake the new icon into a fresh APK (and bump
   `appVersionCode` in `twa-manifest.json` first, same as any other update).

`public/logo-source.svg` is the editable source if you want to tweak colors
or details later — regenerate the PNGs from it with:
```bash
rsvg-convert -w 512 -h 512 logo-source.svg -o icon-512.png
rsvg-convert -w 192 -h 192 logo-source.svg -o icon-192.png
```

`public/splash.svg` is the full animated version (blinking eyes, alternating
chat bubbles, talking mouths) — see the note in the main project README for
how to wire it in as an actual in-app splash/loading screen, since Android's
native TWA splash only supports a static image, not this animation.

## Things specific to this codebase, worth knowing before you build

- **Cross-site cookies**: your `DEPLOYING.md` already covers this — Vercel
  and Render are different eTLDs, so `SameSite=None` cookies get dropped by
  some browsers, and the code has a bearer-token fallback for it. That
  fallback also covers you inside the TWA, since it's the same cross-site
  situation. Moving to `app.wyntek.tech` / `api.wyntek.tech` later removes
  the need for it entirely — and also lets you swap `host` in
  `twa-manifest.json` to your own domain instead of `kallkonnect.vercel.app`,
  which is worth doing before a real Play Store listing (an app tied to a
  domain you don't own or control long-term is fragile).
- **Render free-tier cold start** (30–60s wake from idle): worth adding a
  splash-screen message for first load, since a native-feeling app going
  blank for a minute reads worse than a browser tab doing the same thing.
- **Package ID** (`tech.wyntek.kallkonnect`) is arbitrary but permanent once
  published — Play Store won't let you change it later. Rename it now in
  `twa-manifest.json` if you want something different.
