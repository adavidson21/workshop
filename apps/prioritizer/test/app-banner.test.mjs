// The "Get the Android app" banner (js/app-banner.js): only on Docket's own page, in a browser on Android,
// until dismissed; never in the app or in the Workshop shell.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APK_URL, wantsBanner } from '../js/app-banner.js';

const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';

test('app banner: Android browsers only, not dismissed, not in the app or the shell', () => {
  const base = { native: false, embedded: false, dismissed: false };
  assert.equal(wantsBanner({ ...base, ua: ANDROID }), true);
  assert.equal(wantsBanner({ ...base, ua: IPHONE }), false, 'no iPhone app yet');
  assert.equal(wantsBanner({ ...base, ua: MAC }), false);
  assert.equal(wantsBanner({ ...base, ua: ANDROID, native: true }), false, 'already in the app');
  assert.equal(wantsBanner({ ...base, ua: ANDROID, embedded: true }), false, 'inside the Workshop shell');
  assert.equal(wantsBanner({ ...base, ua: ANDROID, dismissed: true }), false);
});

test('app banner: links to the APK on the docket-android release', () => {
  assert.equal(APK_URL, 'https://github.com/adavidson21/workshop/releases/download/docket-android/docket.apk');
});
