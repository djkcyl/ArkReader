import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { _android as android } from 'playwright';

const serial = process.env.ANDROID_SERIAL ?? 'emulator-5554';
const adbPort = Number(process.env.ARKREADER_ADB_PORT ?? '5037');
const app = 'io.arkreader.mobile';
const out = process.env.ARKREADER_VERIFY_OUT ?? 'artifacts/android-verification';
await fs.mkdir(out, { recursive: true });
const adb = (...args) =>
  execFileSync('adb', ['-P', String(adbPort), '-s', serial, ...args], {
    encoding: 'utf8',
    timeout: 120000,
  });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function find(directory, suffix) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const found = await find(file, suffix);
      if (found) return found;
    } else if (file.endsWith(suffix) && file.includes('debug')) return file;
  }
}
let device;
let page;
const errors = [];
try {
  const avd = adb('emu', 'avd', 'name')
    .trim()
    .split(/[\r\n]+/)[0];
  assert(
    ['ArkReaderLocalVerify', 'ArkReaderVerification'].includes(avd),
    'Only an isolated ArkReader test emulator may be used',
  );
  const apk = await find('src-tauri/gen/android/app/build/outputs/apk', '.apk');
  assert(apk, 'Debug APK missing');
  adb('shell', 'svc', 'power', 'stayon', 'true');
  adb('shell', 'settings', 'put', 'system', 'screen_off_timeout', '2147483647');
  adb('shell', 'settings', 'put', 'secure', 'immersive_mode_confirmations', 'confirmed');
  adb('shell', 'input', 'keyevent', '224');
  adb('shell', 'wm', 'dismiss-keyguard');
  adb('shell', 'am', 'force-stop', app);
  adb('install', '-r', apk);
  adb('shell', 'am', 'start', '-n', `${app}/.MainActivity`);
  let pid = '';
  for (let attempt = 0; attempt < 50 && !pid; attempt++) {
    try {
      pid = adb('shell', 'pidof', app).trim().split(' ')[0];
    } catch {}
    if (!pid) await sleep(200);
  }
  assert(pid, 'Application process missing');
  device = (await android.devices({ port: adbPort })).find((device) => device.serial() === serial);
  assert(device, 'Isolated Android device missing');
  const webview = await device.webView(
    { pkg: app, socketName: `webview_devtools_remote_${pid}` },
    { timeout: 180000 },
  );
  page = await Promise.race([
    webview.page(),
    sleep(60000).then(() => {
      throw new Error('WebView connection timed out');
    }),
  ]);
  assert(page, 'Application document missing');
  console.log('Attached Android WebView', pid);
  page.setDefaultTimeout(45000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(
    () =>
      document.documentElement.dataset.arkreaderUi === 'ready' ||
      document.body.dataset.state === 'failed',
    undefined,
    { timeout: 480000, polling: 1000 },
  );
  assert.equal(
    await page.evaluate(() => document.body.dataset.state === 'failed'),
    false,
    await page.evaluate(() => document.getElementById('startup-error')?.textContent ?? ''),
  );
  await page.waitForFunction(() => !!document.querySelector('.archive-card,.story-track'));
  console.log('Library ready');
  if (await page.locator('#catalog-back').isVisible()) await page.locator('#catalog-back').click();
  await page.locator('#catalog-nav [data-category="main"]').click();
  await page.screenshot({ path: `${out}/library.png` });
  const layout = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    body: document.body.scrollHeight,
    root: document.documentElement.scrollHeight,
    mobile: document.body.classList.contains('mobile-app'),
  }));
  assert(layout.mobile, 'Android layout was not selected');
  assert(
    layout.body <= layout.height + 2 && layout.root <= layout.height + 2,
    'Document has a global scrollbar',
  );
  await page.locator('.archive-card').first().click();
  await page.locator('.story-track').first().click();
  await page.locator('#start').click();
  await page.waitForFunction(
    () =>
      !!window.arkreader?.player ||
      document.querySelector('#resume-prompt')?.open ||
      document.querySelector('#app-loading')?.hidden === false,
  );
  if (await page.locator('#resume-prompt').isVisible())
    await page.locator('#resume-restart').click();
  await page.waitForFunction(
    () => !!window.arkreader?.player || !document.querySelector('#load-error-details').hidden,
    undefined,
    { timeout: 300000, polling: 250 },
  );
  assert(
    await page.evaluate(() => !!window.arkreader?.player),
    await page.evaluate(() => document.querySelector('#load-error')?.textContent),
  );
  await page.waitForFunction(
    () => innerWidth > innerHeight && document.body.classList.contains('window-filled'),
  );
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${out}/player.png` });
  console.log('Story ready');
  const canvas = await page.locator('#canvas').boundingBox();
  assert(canvas && canvas.width > 400 && canvas.height > 150);
  const cdp = await page.context().newCDPSession(page);
  await page.waitForFunction(() => window.arkreader.player.canQuickPlay);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: canvas.x + canvas.width * 0.65, y: canvas.y + canvas.height * 0.55 }],
  });
  await page.waitForFunction(() => window.arkreader.player.quickPlay, undefined, { timeout: 6000 });
  const quick = await page.evaluate(() => window.arkreader.player.quickPlay);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert(quick, 'Touch hold did not enable fast playback');
  adb('shell', 'input', 'keyevent', '3');
  await sleep(1200);
  adb('shell', 'am', 'start', '-n', `${app}/.MainActivity`);
  await page.waitForFunction(() => window.arkreader.player.paused);
  await page.locator('#resume').click();
  await page.waitForFunction(() => !window.arkreader.player.paused);
  await page.locator('#resume').waitFor({ state: 'hidden' });
  adb('shell', 'input', 'keyevent', '4');
  await page.waitForFunction(() => !document.body.classList.contains('playing'));
  const movieId = 'activities/act44side/level_act44side_entry';
  const group = await page.evaluate(async (id) => {
    const catalog = await (await fetch('/api/catalog')).json();
    return catalog.groups.find((group) => group.stories.some((story) => story.id === id));
  }, movieId);
  await page.locator('#catalog-back').click();
  await page.locator(`#catalog-nav [data-category="${group.category}"]`).click();
  await page.locator(`.archive-card[data-group="${group.id}"]`).click();
  await page.locator(`.story-track[data-story="${movieId}"]`).click();
  await page.locator('#start').click();
  await page.waitForFunction(
    () =>
      !!window.arkreader?.player ||
      document.querySelector('#resume-prompt')?.open ||
      !document.querySelector('#app-loading').hidden,
  );
  if (await page.locator('#resume-prompt').isVisible())
    await page.locator('#resume-restart').click();
  await page.waitForFunction(
    () =>
      !!window.arkreader?.player?.video ||
      !!window.arkreader?.player?.error ||
      !document.querySelector('#load-error-details').hidden,
    undefined,
    {
      timeout: 300000,
    },
  );
  assert(
    await page.evaluate(() => !!window.arkreader?.player?.video),
    await page.evaluate(
      () => window.arkreader?.player?.error || document.querySelector('#load-error').textContent,
    ),
  );
  await page.waitForFunction(
    () => {
      const video = window.arkreader.player.host.video?.frame;
      return video && video.videoWidth > 0 && video.currentTime > 1;
    },
    undefined,
    { timeout: 60000 },
  );
  const movie = await page.evaluate(async () => {
    const video = window.arkreader.player.host.video.frame;
    video.currentTime = Math.min(5, video.duration / 2);
    await new Promise((resolve, reject) => {
      video.addEventListener('seeked', resolve, { once: true });
      video.addEventListener('error', reject, { once: true });
      setTimeout(() => reject(new Error('Movie seek timed out')), 15000);
    });
    return {
      width: video.videoWidth,
      height: video.videoHeight,
      duration: video.duration,
      seek: video.currentTime,
    };
  });
  assert(movie.width > 0 && movie.height > 0 && movie.seek > 1);
  console.log('Movie decoded', movie);
  await page.screenshot({ path: `${out}/movie.png` });
  adb('shell', 'input', 'keyevent', '4');
  await page.waitForFunction(() => !document.body.classList.contains('playing'));
  const status = await page.evaluate(async () => (await fetch('/api/status')).json());
  assert(status.baseResources.ready && status.storyPlayerScripts > 1000);
  assert.deepEqual(errors, []);
  await fs.writeFile(
    `${out}/result.json`,
    JSON.stringify(
      {
        startup: true,
        buildRun: process.env.ARKREADER_BUILD_RUN,
        layout,
        playback: true,
        touchHold: true,
        backgroundPause: true,
        backNavigation: true,
        movie,
        status,
        errors,
      },
      null,
      2,
    ),
  );
} finally {
  if (page) {
    const state = await page
      .evaluate(async () => ({
        url: location.href,
        body: document.body.textContent,
        progress: await Promise.race([
          window.__TAURI__.core.invoke('app_startup_progress').catch(String),
          new Promise((resolve) => setTimeout(() => resolve('Native progress timed out'), 3000)),
        ]),
      }))
      .catch(String);
    await fs.writeFile(`${out}/state.json`, JSON.stringify(state, null, 2));
    if (state?.progress?.state === 'failed') {
      const url = 'https://ak-conf.hypergryph.com/config/prod/official/network_config';
      const cdp = await page.context().newCDPSession(page);
      const { frameTree } = await cdp.send('Page.getFrameTree');
      const browserRequest = await Promise.race([
        cdp
          .send('Network.loadNetworkResource', {
            frameId: frameTree.frame.id,
            url,
            options: { disableCache: true, includeCredentials: false },
          })
          .catch(String),
        sleep(20000).then(() => 'Browser request timed out'),
      ]);
      const hostRequest = await fetch(url, { signal: AbortSignal.timeout(20000) })
        .then(async (response) => ({
          status: response.status,
          body: (await response.text()).slice(0, 1000),
        }))
        .catch(String);
      await fs.writeFile(
        `${out}/network.json`,
        JSON.stringify(
          {
            hostRequest,
            browserRequest,
            deviceTime: adb('shell', 'date', '-u'),
          },
          null,
          2,
        ),
      );
      await cdp.detach();
    }
  }
  if (page) await page.screenshot({ path: `${out}/last-state.png` }).catch(() => {});
  try {
    await fs.writeFile(`${out}/logcat.txt`, adb('logcat', '-d', '-t', '3000'));
  } catch (error) {
    await fs.writeFile(`${out}/logcat-error.txt`, String(error));
  }
  await device?.close();
}
