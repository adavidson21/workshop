# Google Play connector

Your apps on Google Play in Workshop, for your own computer: tracks and releases, uploaded bundles, reviews, and the app signing key your PWA's `assetlinks.json` needs. Tandem can read all of it and **propose** release sets; nothing changes on Google Play until **you** approve a set in Workshop's Approvals (or an always-allow rule you made covers it). `workshop play build` makes the signed bundle on this computer. Off in work mode. Node standard library only. It calls only the API and token addresses in its settings (`https://androidpublisher.googleapis.com` and `https://oauth2.googleapis.com/token`), plus your app's own site to read `/.well-known/assetlinks.json`.

## How it keeps things safe

- **The service account key lives in this computer's secret store** (macOS Keychain, or the Secret Service on Linux). **Add key file** in Settings (or `workshop secret set play --from-file <key.json>`) keeps only what signing needs (the account's email and its private key) and tells you to delete the downloaded file. The key never goes in a file Workshop writes, an environment variable or a log.
- **Only this connector reads it** (`ctx.secret`), to sign a request for a one-hour access token at the token address. The key itself never leaves this computer; the access token stays in memory and goes only in the `Authorization` header to the API address.
- **Signing passwords never reach Tandem.** Only `workshop play build`, run by you in a terminal, reads them from the secret store and hands them to Bubblewrap or Gradle in their environment.
- **Every change is a release set you approve.** What Approvals shows is worked out each time from the set, the bundle file and Play as they are then, never from text Tandem wrote. Approve sends back a fingerprint of the set: if it was edited after you read it, nothing runs.
- **The bundle you approve is the bundle that goes out.** A proposed upload records the file's SHA-256. If the file is built again before you approve, the set is refused. Tandem cannot pick a file: an upload always takes the bundle in the app's project folder from Settings.
- **All or nothing.** A set's track changes go to Play in one edit, which Play takes whole or not at all.
- **A review in progress is never cancelled.** Workshop commits with `changesInReviewBehavior=ERROR_IF_IN_REVIEW`, so it stops and tells you instead.
- **Small on purpose.** No deleting apps, tracks or bundles, and no store listings, prices, countries, testers or users. Those stay in Play Console.
- What was done is in `play/log.md` in your data folder, in plain words.

What this does not protect against: a program running as you that sets out to read your Keychain. Give the service account only the apps and permissions it needs (below). You can disable or delete its key in Google Cloud at any time.

## Setup (once)

1. **Play Console.** Use your organization (business) developer account. Organization accounts skip the testing rule for new personal accounts (a closed test with 12 testers for 14 days before production). Create the app: **Home**, **Create app**.
2. **Google Cloud: a service account and its key.**
   1. In the Google Cloud console, pick or create a project, then turn on **Google Play Android Developer API** (APIs & Services, Library).
   2. IAM & Admin, **Service accounts**, **Create service account**. Name it something like `workshop-play`. It needs no Google Cloud roles.
   3. Open it, **Keys**, **Add key**, **Create new key**, **JSON**. A file downloads.
   4. If Google says **service account key creation is disabled**: organizations created on or after May 3, 2024 turn that off by default (`iam.disableServiceAccountKeyCreation`, or `iam.managed.disableServiceAccountKeyCreation`). As the organization's admin, open **Organization policies**, find **Disable service account key creation**, and override it for this one project only.
3. **Play Console: give the service account your app.** **Users and permissions**, **Invite new users**, paste the service account's email (it ends in `iam.gserviceaccount.com`). No account permissions. Under **App permissions**, **Add app**, pick your app, and give it:

   | Permission | For |
   | --- | --- |
   | View app information (read-only) | Every read |
   | Release apps to testing tracks | Internal, closed and open testing |
   | Release to production, exclude devices, and use Play App Signing | Production releases and the app signing key's fingerprint. Leave it off to keep production in Play Console. |
   | Reply to reviews | Optional: replies |

   Play can take a while to apply new permissions. If calls answer HTTP 403 right after, try again later. If `signing.info` keeps answering 403, Play Console shows the same app signing fingerprint (SHA-256) under **Test and release**, **App integrity**, and Tandem can use that instead.
4. **Save the key.** In Settings, Google Play, click **Add key file** and choose the JSON file (Settings, Manager, Tokens & sign-ins lists them all), then delete the file. (Or in a terminal: `workshop secret set play --from-file ~/Downloads/<the file>.json`.)
5. **Turn it on.** Settings, Google Play: switch it on and add your app under **Apps**: package name, a short name, the project folder, the kind of project, the PWA's site, and a name for its signing password (like `play-wishlist`). Leave **Let Tandem read and propose releases** on to use it from Tandem.
6. Use the Test field (a package name) to see the app's tracks.

## Your first release: a PWA with Bubblewrap

Bubblewrap wraps a PWA in a small Android app (a Trusted Web Activity) that opens your site full screen. Web deploys update the app without a new Play release.

1. **Make the Android project** in a new folder (its own repo is easiest): `npx @bubblewrap/cli@1.27.0 init --manifest=https://wishlist.example.org/manifest.webmanifest`. It asks for the package name and app details, offers to install the JDK and Android SDK it needs (say yes), and makes a signing key, `android.keystore`, with a password.
2. **Keep the keystore safe.** Keep `android.keystore` out of git, and put a copy and its password in your password manager. It is your upload key: with Play App Signing, Google holds the key that signs what people install, and a lost upload key can be reset through Play Console.
3. **Save its password** for Workshop: click **Add password** beside **Signing password** in Settings (or `workshop secret set play-wishlist --password`). If the key's password differs from the keystore's, save that too and name it under **Key password (secret name)**.
4. **Build:** `workshop play build wishlist`. It runs `bubblewrap build` with the passwords from the secret store and reads the bundle back: package, version code, size and SHA-256.
5. **Upload the first bundle by hand.** Play's API cannot take a new app's first bundle. Play Console, your app, **Test and release**, **Internal testing**, **Create new release**, upload `app-release-bundle.aab`, and let Google manage the app signing key. Add your testers there. Play also needs the app's store listing and **App content** (privacy policy, data safety, content rating, target audience) before anything goes past internal testing; Workshop does not touch those.
6. **Link the site to the app.** Ask Tandem to set up `assetlinks.json` for wishlist (it reads `signing.info`, which has Play's app signing key and your upload key, adds `.well-known/assetlinks.json` to the PWA's repo, and you deploy it), then `assetlinks.check`. Without it, the app opens with an address bar.

## After that: from idea to production

- **Web changes:** deploy the PWA as usual. The app on Play shows them at once.
- **App changes** (icon, name, Android settings): `workshop play build wishlist --bump --release internal`. `--bump` raises the version code (Play takes each one once). Approve the release in Workshop and your testers get it.
- **Production:** ask Tandem to release the newest version to production for 20% of users, approve it, watch, then ask it to raise the rollout to 100% (or halt it).
- **Reviews:** Tandem can read reviews and propose replies; you approve each one.
- **Always allow:** when you approve, "Always allow" covers that app and track (`org.example.wishlist:internal`, say), so internal releases go straight through while production still asks.

## Native apps (Gradle)

Set the app's kind to **Gradle**. `workshop play build` runs `./gradlew bundleRelease` in the project folder with `ANDROID_KEYSTORE_PASSWORD` and `ANDROID_KEY_PASSWORD` set, and the bundle is read from `app/build/outputs/bundle/release/app-release.aab` unless you set **Bundle file**. Sign the release build from those variables, for example in `app/build.gradle.kts`:

```kotlin
android {
    signingConfigs {
        create("release") {
            storeFile = file("../upload.keystore") // keep it out of git
            storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias = "upload"
            keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
        }
    }
    buildTypes { getByName("release") { signingConfig = signingConfigs.getByName("release") } }
}
```

Raise `versionCode` there for each release (`--bump` is for Bubblewrap only).

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `keySecret` | `play` | The name the service account key is kept under. Settings shows whether it is saved, with **Add key file**. |
| `apps` | `[]` | Your apps. Tandem can only touch these. Each has `packageName` (required), `name`, `folder` (the project, a full path; `~` is your home folder), `kind` (`bubblewrap` or `gradle`), `bundle` (inside the folder; the default depends on the kind), `site` (the PWA's address) and `signingSecret` and `keyPasswordSecret` (secret names only `workshop play build` reads). |
| `agents` | `true` | Tandem may read and propose through `/api/tools` and `/api/mcp`. Off: those calls are refused; you can still use everything from Workshop. |
| `apiUrl` | `https://androidpublisher.googleapis.com` | The API address (Advanced). |
| `tokenUrl` | `https://oauth2.googleapis.com/token` | Where the signed request is traded for an access token (Advanced). |

## Actions

Read actions marked **agent** can be run by Tandem through `/api/tools` and `/api/mcp`. `app` is a package name or the name you gave the app; with one app it can be left out. Apply is a write Tandem can only ask for: it runs when you approve it in Approvals.

| Action | Agent | Args | Result |
| --- | --- | --- | --- |
| `token.verify` | yes | none | `{ok, serviceAccount}` after getting a fresh access token |
| `apps.list` | yes | none | `[{packageName, name, kind, folder, bundle, bundleExists, site}]` (this computer only) |
| `bundle.inspect` | yes | `app` | The bundle on disk: `{file, exists, size, modified, sha256, packageName, versionCode, versionName, matches}` |
| `tracks.list` | yes | `app` | `{app, tracks: [{track, label, releases: [{name, versionCodes, status, userFraction, notes}]}]}` |
| `bundles.list` | yes | `app` | `[{versionCode, sha256}]`, newest first, at most 30 |
| `reviews.list` | yes | `app`, `max` (1 to 100) | `[{reviewId, author, stars, text, lastModified, versionCode, versionName, device, language, reply}]`. Play gives reviews with text from about the last week. |
| `signing.info` | yes | `app`, `versionCode` (default: the newest uploaded) | `{versionCode, appSigning, local, assetlinks, next}`: Play's app signing key fingerprint, the ones in Bubblewrap's `twa-manifest.json` (your upload key), and the `assetlinks.json` with both |
| `assetlinks.check` | yes | `app` | Reads `<site>/.well-known/assetlinks.json` (no token sent, no redirects followed): `{url, ok, listed, expected, missing, problem?}` |
| `releases.check` | yes | `app`, `changes` | `{app, ok, steps: [{summary, problem?}]}`: every problem at once; changes nothing |
| `releases.propose` | yes | `title`, `why`, `item`, `app`, `changes` | Saves a set and asks you to approve it in Approvals: `{id, status: "waiting", steps, approval}`. When an always-allow rule covers it, it runs at once: `{id, status: "applied", rule, results}`. Refused (with every problem) if any change fails its check. |
| `releases.list` | yes | `status` | `[{id, title, app, status, item, from, created, decided, steps}]`, newest first |
| `releases.get` | yes | `id` | The whole set, with `results` once done. While it waits, its steps are worked out again (never read from the file), plus `ok` and `digest`. |
| `releases.apply` | asks (write) | `id`, `digest` | What Approvals runs when you approve a set. Refuses if the set or the bundle changed since it was read. Track changes go in one edit; replies follow. `{status: applied\|failed, results}`. Always-allow rules cover `<package>:<track>` for each track a set changes and `<package>:reviews` for replies. |

## Release sets

A release set is up to 6 changes for one app, with at most one upload and one change per track:

| `op` | Fields | Does |
| --- | --- | --- |
| `release.upload` | `track`, `status`, `userFraction`, `notes`, `name` | Uploads the app's bundle (as it was when proposed) and releases it on the track |
| `release.promote` | `versionCode`, `track`, `status`, `userFraction`, `notes`, `name` | Releases a version already on Play to a track. Without `notes`, it keeps the notes it has elsewhere. |
| `rollout.update` | `track` (default `production`), `action` (`increase`, `halt`, `resume`, `complete`), `userFraction` (`increase`; optional for `resume`) | Changes a staged rollout. A rollout only goes up. |
| `review.reply` | `reviewId` (from `reviews.list`), `text` (at most 350 characters) | Replies publicly to a review, after the release changes |

`track` is `internal`, `alpha` (closed testing), `beta` (open testing), `production`, or a closed testing track's own name. `status` is `completed` (the default, except Production, which needs it said), `inProgress` (a staged rollout, with `userFraction` between 0 and 1, like `0.1` for 10%; not on internal testing) or `draft` (nothing goes out until you send it in Play Console). `notes` is text (English, US) or `{"en-US": "...", "es-ES": "..."}`, at most 500 characters each.

Play's own rules come back in plain words: an app that has never been published takes only `draft` releases; changes Play wants sent for review by hand are committed that way and the result says so; and a set is refused while the app has changes in review.

## Data

| Where | What |
| --- | --- |
| `<data folder>/play/releases/<id>.json` | One release set: what was asked and why, by whom, its steps (with the bundle's SHA-256 for an upload), and what happened. Never removed by Workshop. |
| `<data folder>/play/log.md` | Every set done or rejected, newest last, one line per change. |

## Known limits

- **Windows:** a service account key is too big for Windows Credential Manager, so on Windows Settings and `workshop secret set play --from-file` say so and save nothing. Use macOS or Linux.
- Bundles up to 500 MB, read into memory to upload.
- Not tested against Google's real servers yet (the tests use a fake Play and a fake sign-in). The first real run is on your Mac.

## Tests

```
node --test "connectors/play/test/*.test.mjs"
```

They run against a fake Google sign-in and Play API (`test/fake-play.mjs`), with small app bundles built in the test; nothing reaches Google, Bubblewrap or Gradle.
