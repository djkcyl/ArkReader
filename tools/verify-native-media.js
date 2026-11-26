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
  const results = [];
  try {
    for (const id of [
      'activities/act44side/level_act44side_entry',
      'activities/act20side/level_act20side_entry',
    ]) {
      const response = await fetch('/api/story/' + id);
      check(response.ok, await response.clone().text());
      const pack = await response.json();
      const asset = Object.values(pack.assets).find((item) => item.kind === 'video');
      check(asset, 'Story movie missing: ' + id);
      const context = new AudioContext();
      const video = document.createElement('video');
      video.playsInline = true;
      video.style.cssText = 'position:fixed;inset:0;width:320px;height:180px;z-index:2147483647';
      document.body.append(video);
      const source = context.createMediaElementSource(video);
      const analyser = context.createAnalyser();
      const silent = context.createGain();
      silent.gain.value = 0;
      source.connect(analyser).connect(silent).connect(context.destination);
      let error = '';
      video.onerror = () => {
        error = video.error?.message || 'Movie decode failed';
      };
      try {
        await context.resume();
        video.src = asset.url;
        await video.play();
        await until(
          () => error || (video.videoWidth > 0 && video.currentTime > 1),
          'Movie did not play',
        );
        check(!error, error);
        video.pause();
        const pausedAt = video.currentTime;
        await sleep(250);
        check(Math.abs(video.currentTime - pausedAt) < 0.2, 'Movie pause failed');
        const position = Math.min(8, video.duration / 2);
        video.currentTime = position;
        await until(
          () => error || (!video.seeking && Math.abs(video.currentTime - position) < 0.2),
          'Movie seek failed',
        );
        check(!error, error);
        await video.play();
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
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 72;
        const pixels = canvas.getContext('2d');
        pixels.drawImage(video, 0, 0, 128, 72);
        const rgba = pixels.getImageData(0, 0, 128, 72).data;
        let visible = 0;
        for (let i = 0; i < rgba.length; i += 4)
          if (Math.max(rgba[i], rgba[i + 1], rgba[i + 2]) > 20) visible++;
        check(visible > 50, 'Decoded movie picture is empty');
        results.push({
          id,
          codecs: asset.codecs,
          width: video.videoWidth,
          height: video.videoHeight,
          duration: video.duration,
          seek: position,
          audioRms: peak,
          pixels: visible,
        });
      } finally {
        video.pause();
        video.removeAttribute('src');
        video.load();
        video.remove();
        await context.close();
      }
    }
    await invoke('app_frontend_log', {
      message: 'ARKREADER_MEDIA_VERIFIED ' + JSON.stringify(results),
    });
  } catch (error) {
    await invoke('app_frontend_log', {
      message: 'ARKREADER_MEDIA_FAILED ' + String(error?.stack || error),
    });
  } finally {
    await invoke('app_quit');
  }
})();
