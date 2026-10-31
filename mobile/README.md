# Docket for Android

Docket as an Android app. It is Docket's web files (`apps/prioritizer/` and `shared/`) inside a [Capacitor](https://capacitorjs.com) shell, with one difference: the board is saved as files in the app's own private storage on the phone, through the SDK's device store ([docs/run-modes.md](../docs/run-modes.md), Device store). Nothing is sent to a server.

## Where the data lives

- **On the phone, in the app's private folder** (`workshop/prioritizer/*.json`, the same files the agent writes to `~/Workshop/prioritizer/`). Other apps can't read it. Writes are atomic, so a write is never half done.
- **It is not cleared like browser storage.** Android removes it only when the app is uninstalled or you clear its data in Settings.
- **It is left out of Google's cloud backup** (`android:allowBackup="false"` and `res/xml/data_extraction_rules.xml`). A direct phone-to-phone transfer to a new phone still brings it along.
- **Backups and Excel copies** (the folder icon in Docket) open Android's share sheet, so you choose where the file goes: Files, Drive, email.
- **Moving a board from the website:** on the website, download a backup (folder icon, then "Download a backup"), then in the app choose "Import a file". The app and the website keep separate boards.

## Installing

Android visitors to Docket's page see a "Get the app" banner. It links to `docket.apk` on the repo's [`docket-android` release](https://github.com/adavidson21/workshop/releases/tag/docket-android), which every build of `main` replaces. The first time, Android asks you to allow installs from your browser. Updates install over the old app and keep your board, as long as they are signed with the same key (below).

## Signing

Release builds are signed with one key, kept only in repository secrets. Android installs an update only if it is signed with the same key as the installed app, so **keep a copy of the key somewhere safe** (a password manager). If it is lost, the next build can't update the app: you'd have to uninstall it (erasing its board unless you saved a backup) and install again.

Repository secrets (Settings, Secrets and variables, Actions):

| Secret | What |
| --- | --- |
| `DOCKET_KEYSTORE_BASE64` | The keystore file (PKCS12), base64-encoded |
| `DOCKET_KEYSTORE_PASSWORD` | The keystore password |
| `DOCKET_KEY_ALIAS` | The key's alias (`docket`) |
| `DOCKET_KEY_PASSWORD` | The key password |

To make a new key (only for a new app; it replaces nothing):

```
keytool -genkeypair -keystore docket-release.jks -storetype PKCS12 -alias docket -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=Docket"
base64 -w0 docket-release.jks   # the value of DOCKET_KEYSTORE_BASE64 (macOS: base64 -i docket-release.jks)
```

## How it is built

[`.github/workflows/android.yml`](../.github/workflows/android.yml) runs when Docket, `shared/` or `mobile/` change:

1. `npm ci` and `npm test` in `mobile/`.
2. `node scripts/build-web.mjs` copies Docket's files into `www/` with the site's layout, leaving out the service worker and web manifest, and fails if any page or module refers to a file the app doesn't have.
3. `npx cap sync android` puts them in the Android project.
4. `test/e2e_app.py` runs Docket from `www/` in headless Chrome with a stand-in for the phone's file storage: it must pick the device store, save the board as files, keep it across a restart, and send backups to the share sheet.
5. On pull requests, a debug APK, to show it still builds. On `main`, a release APK signed from the secrets (versionCode is the run number, so each build is an update), published to the `docket-android` release.

To build on your own computer you need Node 22, JDK 21 and the Android SDK (Android Studio installs it):

```
cd mobile
npm install
npm run sync                     # build-web, then cap sync android
cd android && ./gradlew assembleDebug   # app/build/outputs/apk/debug/app-debug.apk
```

Or open `mobile/android` in Android Studio and press Run with your phone plugged in.

## What is where

| Path | What |
| --- | --- |
| `capacitor.config.json` | App id `org.alexisdavidson.docket`, name, web folder |
| `scripts/build-web.mjs` | Copies Docket's files into `www/` (not committed) and checks every reference |
| `android/` | The Android project. `app/build.gradle` reads signing and version from the environment. Icons come from `icon/*.svg`. |
| `icon/` | Sources for the launcher icons and splash screen |
| `test/` | `build-web.test.mjs` (node) and `e2e_app.py` (Playwright) |
| `../shared/device-fs.js` | The device store's file access, through Capacitor's Filesystem plugin |
| `../shared/save-file.js` | Downloads in a browser, the share sheet in the app |

## iPhone

Not yet. The same `www/` would work in a Capacitor iOS project (`npx cap add ios`), and the device store already works there, but building needs a Mac with Xcode and the app goes through TestFlight or the App Store.
