// Executed by the release checker inside the packaged system WebView.
void (async () => {
  if (window.__arkreaderReleaseCheck) return;
  window.__arkreaderReleaseCheck = true;
  const invoke = window.__TAURI__.core.invoke;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const check = (value, message) => {
    if (!value) throw Error(message);
  };
  const until = async (condition, message, timeout = 30000) => {
    const end = Date.now() + timeout;
    while (!condition()) {
      if (Date.now() > end) throw Error(message);
      await sleep(50);
    }
  };
  const click = (selector) => {
    const button = document.querySelector(selector);
    check(button, 'Missing control: ' + selector);
    button.click();
  };
  const results = [];
  let phase = 'catalog';
  try {
    const catalog = await (await fetch('/api/catalog')).json();
    for (const id of [
      'activities/act44side/level_act44side_entry',
      'activities/act20side/level_act20side_entry',
    ]) {
      phase = id + ': prepare';
      click('#library-tab-catalog');
      const back = document.querySelector('#catalog-back');
      if (back?.getClientRects().length) back.click();
      const group = catalog.groups.find((group) => group.stories.some((story) => story.id === id));
      check(group, 'Movie story missing: ' + id);
      click(`#catalog-nav [data-category="${group.category}"]`);
      click(`.archive-card[data-group="${group.id}"]`);
      click(`.story-track[data-story="${id}"]`);
      click('#start');
      await until(
        () => {
          if (document.querySelector('#resume-prompt')?.open) click('#resume-restart');
          if (!document.querySelector('#load-error-details').hidden)
            throw Error(document.querySelector('#load-error').textContent);
          const player = window.arkreader?.player;
          if (player?.error) throw Error(player.error);
          return player?.pack.id === id && player.host.video?.frame?.videoWidth > 0;
        },
        'Movie did not load',
        240000,
      );
      const { player, audio } = window.arkreader;
      const video = player.host.video.frame;
      const asset = Object.values(player.pack.assets).find((item) => item.kind === 'video');
      const analyser = audio.context.createAnalyser();
      const silent = audio.context.createGain();
      silent.gain.value = 0;
      player.host.video.video.node.connect(analyser);
      analyser.connect(silent).connect(audio.context.destination);
      audio.master.gain.value = 0;
      let error = '';
      const failed = () => {
        error = video.error?.message || 'Movie decode failed';
      };
      video.addEventListener('error', failed);
      try {
        phase = id + ': play';
        await until(() => error || video.currentTime > 1, 'Movie did not play');
        check(!error, error);
        player.setPaused(true);
        const pausedAt = video.currentTime;
        await sleep(250);
        check(Math.abs(video.currentTime - pausedAt) < 0.2, 'Movie pause failed');
        phase = id + ': seek';
        const position = Math.min(8, video.duration / 2);
        video.currentTime = position;
        await until(
          () => error || (!video.seeking && Math.abs(video.currentTime - position) < 0.2),
          'Movie seek failed',
        );
        check(!error, error);
        player.setPaused(false);
        phase = id + ': audio';
        let peak = 0;
        const samples = new Float32Array(analyser.fftSize);
        await until(() => {
          analyser.getFloatTimeDomainData(samples);
          peak = Math.max(
            peak,
            Math.sqrt(samples.reduce((sum, n) => sum + n * n, 0) / samples.length),
          );
          return error || (video.currentTime > position + 1 && peak > 0.0001);
        }, 'Movie audio or resumed playback missing');
        check(!error, error);
        phase = id + ': picture';
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 72;
        const pixels = canvas.getContext('2d');
        let visible = 0;
        await until(
          () => {
            pixels.drawImage(video, 0, 0, 128, 72);
            const rgba = pixels.getImageData(0, 0, 128, 72).data;
            visible = 0;
            for (let i = 0; i < rgba.length; i += 4)
              if (Math.max(rgba[i], rgba[i + 1], rgba[i + 2]) > 20) visible++;
            return error || visible > 50;
          },
          'Decoded movie picture is empty',
          10000,
        );
        check(!error, error);
        results.push({
          id,
          codecs: asset.codecs,
          source: video.src.startsWith('blob:') ? 'blob' : 'protocol',
          width: video.videoWidth,
          height: video.videoHeight,
          duration: video.duration,
          seek: position,
          audioRms: peak,
          pixels: visible,
        });
      } finally {
        video.removeEventListener('error', failed);
        player.host.video.video.node?.disconnect(analyser);
        analyser.disconnect();
        silent.disconnect();
        click('#leave-story');
        await until(() => !window.arkreader?.player, 'Player did not close');
      }
    }
    await invoke('app_frontend_log', {
      message: 'ARKREADER_MEDIA_VERIFIED ' + JSON.stringify(results),
    });
  } catch (error) {
    await invoke('app_frontend_log', {
      message:
        'ARKREADER_MEDIA_FAILED ' + phase + ': ' + String(error) + '\n' + (error?.stack || ''),
    });
  } finally {
    await invoke('app_quit');
  }
})();
