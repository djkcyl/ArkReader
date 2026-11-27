import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const root = path.resolve('web-dist');
const build = JSON.parse(await fs.readFile(path.join(root, 'build.json'), 'utf8'));
assert.match(build.engine ?? '', /^engine\/[a-f0-9]{64}\/$/);
const output = path.resolve('artifacts/web-verification');
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'arkreader-web-check-'));
await fs.mkdir(output, { recursive: true });
const dynamicRequests = [],
  failures = [],
  diagnostics = [];
const prefix = '/web/';
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/'))
    dynamicRequests.push(url.pathname);
  try {
    if (!url.pathname.startsWith(prefix)) throw Error('Outside static deployment');
    const file = path.resolve(
      root,
      url.pathname === prefix
        ? 'index.html'
        : decodeURIComponent(url.pathname.slice(prefix.length)),
    );
    assert(file.startsWith(root + path.sep));
    const bytes = await fs.readFile(file);
    response.setHeader(
      'Content-Type',
      {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.wasm': 'application/wasm',
        '.json': 'application/json',
        '.png': 'image/png',
      }[path.extname(file)] || 'application/octet-stream',
    );
    response.end(bytes);
  } catch {
    response.writeHead(404);
    response.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let context, page;
const report = { source: 'PRTS', staticOnly: true, stories: [], movies: [] };
async function ready() {
  await page.waitForFunction(
    () =>
      document.documentElement.dataset.arkreaderUi === 'ready' ||
      ['error', 'failed'].includes(document.body.dataset.state),
    null,
    { timeout: 480000 },
  );
  assert(
    await page.evaluate(() => document.documentElement.dataset.arkreaderUi === 'ready'),
    await page
      .locator('#startup-error')
      .textContent()
      .catch(() => 'Startup failed'),
  );
  await page.waitForFunction(() => document.querySelector('.archive-card,.story-track'));
}
async function api(url, body) {
  return page.evaluate(
    async ({ url, body }) => {
      const response = await fetch(
        url,
        body === undefined
          ? {}
          : {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            },
      );
      const value = await response.json();
      if (!response.ok) throw Error(value.detail);
      return value;
    },
    { url, body },
  );
}
async function openStory(id) {
  await page.locator('.desktop-rail [data-page="library"]').click();
  await page.locator('#library-tab-catalog').click();
  if (await page.locator('#catalog-back').isVisible()) await page.locator('#catalog-back').click();
  const group = (await api('/api/catalog')).groups.find((group) =>
    group.stories.some((story) => story.id === id),
  );
  assert(group, id);
  await page.locator(`#catalog-nav [data-category="${group.category}"]`).click();
  await page.locator(`.archive-card[data-group="${group.id}"]`).click();
  await page.locator(`.story-track[data-story="${id}"]`).click();
  await page.locator('#start').click();
  await page.waitForFunction(
    (id) =>
      window.arkreader?.player?.pack.id === id ||
      document.querySelector('#resume-prompt')?.open ||
      document.querySelector('#load-error-details')?.hidden === false,
    id,
    { timeout: 480000 },
  );
  if (await page.locator('#resume-restart').isVisible())
    await page.locator('#resume-restart').click();
  await page.waitForFunction(
    (id) => {
      if (document.querySelector('#load-error-details')?.hidden === false)
        throw Error(
          document.querySelector('#load-error')?.textContent || 'Story preparation failed',
        );
      return window.arkreader?.player?.pack.id === id;
    },
    id,
    { timeout: 480000 },
  );
}
async function verifyStory(id, movie = false) {
  console.log('Prepare', id);
  await openStory(id);
  let state;
  for (let turn = 0; turn < 3000; turn++) {
    state = await page.evaluate((movie) => {
      const { player, renderer } = window.arkreader;
      player.paused = false;
      for (let step = 0; step < 60 && !player.finished && !player.error; step++) {
        player.tick(1 / 30);
        renderer.draw(player);
        if (movie && player.video) {
          player.paused = true;
          return { movie: true };
        }
        if (player.choices.length) player.choose(0);
        else if (
          player.atEnd ||
          ['dialog', 'multiline', 'subtitle', 'sticker', 'stickerclear', 'stickertween'].includes(
            player.scheduler.current?.name,
          )
        )
          player.advance();
      }
      player.paused = true;
      return {
        finished: player.finished,
        error: player.error,
        missing: player.pack.missing,
        unknown: player.scheduler.unknownCommands,
      };
    }, movie);
    assert(!state.error, state.error);
    if (state.movie) {
      await page.evaluate(() => window.arkreader.player.setPaused(false));
      await page.waitForFunction(
        () => window.arkreader.player.host.video?.frame?.currentTime > 0.5,
        null,
        { timeout: 120000 },
      );
      await page.evaluate(() => {
        const { player, audio } = window.arkreader,
          video = player.host.video.frame;
        const analyser = audio.context.createAnalyser();
        audio.master.connect(analyser);
        window.webMovieProof = { video, analyser, source: audio.master, rms: 0, ended: false };
        video.addEventListener(
          'ended',
          () => {
            window.webMovieProof.ended = true;
          },
          { once: true },
        );
        window.webMovieProof.timer = setInterval(() => {
          const p = window.webMovieProof,
            samples = new Float32Array(p.analyser.fftSize);
          p.analyser.getFloatTimeDomainData(samples);
          p.rms = Math.max(
            p.rms,
            Math.sqrt(samples.reduce((sum, n) => sum + n * n, 0) / samples.length),
          );
        }, 50);
      });
      await page.waitForTimeout(800);
      await page.evaluate(() => window.arkreader.player.setPaused(true));
      const paused = await page.evaluate(() => window.webMovieProof.video.currentTime);
      await page.waitForTimeout(300);
      assert(
        Math.abs((await page.evaluate(() => window.webMovieProof.video.currentTime)) - paused) <
          0.1,
      );
      await page.evaluate(async () => {
        const video = window.webMovieProof.video;
        const seeked = new Promise((resolve) =>
          video.addEventListener('seeked', resolve, { once: true }),
        );
        video.currentTime = 8;
        await seeked;
        window.arkreader.player.setPaused(false);
        video.playbackRate = 4;
      });
      await page.waitForTimeout(500);
      const picture = await page.evaluate(() => {
        const video = window.webMovieProof.video,
          canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 72;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, 128, 72);
        const pixels = ctx.getImageData(0, 0, 128, 72).data;
        return {
          width: video.videoWidth,
          height: video.videoHeight,
          duration: video.duration,
          visible: pixels.some((value, index) => index % 4 !== 3 && value > 20),
        };
      });
      assert(picture.visible);
      await page.screenshot({ path: path.join(output, 'movie.png') });
      await page.evaluate(() => {
        const video = window.webMovieProof.video;
        video.currentTime = Math.max(0, video.duration - 0.5);
      });
      await page.waitForFunction(() => window.webMovieProof.ended, null, { timeout: 180000 });
      const sound = await page.evaluate(() => {
        const p = window.webMovieProof;
        clearInterval(p.timer);
        p.source.disconnect(p.analyser);
        p.analyser.disconnect();
        return p.rms;
      });
      assert(sound > 0.0001);
      report.movies.push({ id, ...picture, rms: sound, endEvent: true, pause: true, seek: true });
      movie = false;
    }
    if (state.finished) break;
  }
  assert(state.finished, id);
  assert.deepEqual(state.missing, []);
  assert.deepEqual(state.unknown, []);
  report.stories.push(id);
  console.log('Verified', id);
  await page.locator('#leave-story').click();
}
try {
  context = await chromium.launchPersistentContext(profile, {
    headless: true,
    ...(process.env.WEB_TEST_CHANNEL ? { channel: process.env.WEB_TEST_CHANNEL } : {}),
    viewport: { width: 1440, height: 1000 },
  });
  page = context.pages()[0] || (await context.newPage());
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') {
      diagnostics.push(message.type() + ': ' + message.text().slice(0, 1000));
      if (diagnostics.length > 200) diagnostics.shift();
    }
  });
  page.on('requestfailed', (request) =>
    diagnostics.push(`${request.failure()?.errorText}: ${request.url()}`),
  );
  await context.route(/https:\/\/(?!torappu\.prts\.wiki\/)/, (route) => route.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}${prefix}`, { waitUntil: 'commit' });
  await ready();
  console.log('Browser initialization completed.');
  assert.equal((await api('/api/status')).resourceSource, 'prts');
  await page.screenshot({ path: path.join(output, 'library.png') });
  const story = 'activities/a001/level_a001_01_beg';
  const movie = 'activities/act38side/level_act38side_entry';
  await verifyStory(story);
  await verifyStory(movie, true);
  const cached = await api('/api/story-cache', {
    stories: [story, movie],
  });
  let operation;
  for (let n = 0; n < 1200; n++) {
    operation = await api(`/api/operations/${cached.id}`);
    if (!operation.running) break;
    await page.waitForTimeout(100);
  }
  assert.equal(operation.state, 'completed');
  // Firefox's request interception bypasses service-worker navigation while offline.
  await context.unrouteAll();
  await context.setOffline(true);
  await page.reload({ waitUntil: 'commit' });
  await ready();
  const offline = await api('/api/status');
  assert.equal(offline.resourceUpdate.state, 'offline');
  assert.equal(offline.job.transfers.downloadedBytes, 0);
  for (const id of [story, movie]) {
    await openStory(id);
    await page.waitForFunction(
      (movie) => {
        const player = window.arkreader.player;
        if (player.error) throw Error(player.error);
        return movie ? player.host.video?.frame?.currentTime > 0.2 : player.history.length > 0;
      },
      id === movie,
      { timeout: 120000 },
    );
    await page.locator('#leave-story').click();
  }
  assert.equal((await api('/api/status')).job.transfers.downloadedBytes, 0);
  assert.deepEqual(dynamicRequests, []);
  assert.deepEqual(failures, []);
  report.offline = true;
  report.wasmSha256 = createHash('sha256')
    .update(await fs.readFile(path.join(root, build.engine, 'arkreader_web.wasm')))
    .digest('hex');
  await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify(report, null, 2));
  console.log('Static web initialization, story, movie and offline checks passed.');
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'error.png') }).catch(() => {});
  const details = await page
    ?.evaluate(async () => ({
      error: document.querySelector('#load-error')?.textContent,
      startup: document.querySelector('#startup-error')?.textContent,
      status: await fetch('/api/status', { signal: AbortSignal.timeout(5000) })
        .then((r) => r.json())
        .catch(String),
    }))
    .catch(String);
  await fs.writeFile(
    path.join(output, 'error.json'),
    JSON.stringify({ message: String(error), details, failures, diagnostics }, null, 2),
  );
  throw error;
} finally {
  await context?.close();
  await new Promise((resolve) => server.close(resolve));
  const resolved = await fs.realpath(profile);
  assert.equal(path.dirname(resolved), await fs.realpath(os.tmpdir()));
  assert(path.basename(resolved).startsWith('arkreader-web-check-'));
  await fs.rm(resolved, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
