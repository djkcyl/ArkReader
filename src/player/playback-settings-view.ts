import '../app/playback-settings.css';

/** Mount semantics and page layout; the client settings prefab supplies the widgets after loading. */
export function mountPlaybackSettings(dialog: HTMLDialogElement): HTMLElement {
  const tabs = document.createElement('div');
  tabs.className = 'settings-pages';
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', '设置分类');
  tabs.innerHTML =
    '<button id="native-story-settings-tab" role="tab" aria-label="剧情设置" aria-selected="false" aria-controls="reading-settings">剧情设置</button><button id="native-playback-settings-tab" role="tab" aria-label="播放控制" aria-selected="true" aria-controls="playback-settings-panel">播放控制</button>';
  const panel = document.createElement('section');
  panel.id = 'playback-settings-panel';
  panel.className = 'playback-settings';
  panel.setAttribute('role', 'tabpanel');
  panel.setAttribute('aria-labelledby', 'native-playback-settings-tab');
  const switchControl = (id: string, title: string, caption = title) =>
    `<label class="playback-switch"><span>${caption}</span><span class="setting-switch"><input type="checkbox" id="${id}" aria-label="${title}"></span></label>`;
  panel.innerHTML = /* HTML */ `<div class="playback-setting-row">
      <span>播放</span>
      <div class="playback-pause-slot"></div>
    </div>
    <div class="playback-setting-row">
      <span>显示</span>
      <div class="browser-controls" role="group" aria-label="显示模式"></div>
    </div>
    <div class="playback-setting-row">
      <span>分享</span
      ><button id="share-story" type="button" aria-live="polite">复制剧情链接</button>
    </div>
    <label class="playback-volume" for="volume"
      ><span>音量</span><output id="volume-value" for="volume">100%</output
      ><input id="volume" type="range" min="0" max="100" value="100" aria-label="音量"
    /></label>
    <div id="desktop-blur">${switchControl('high-res-rt', '高清模糊效果')}</div>
    ${switchControl('quick-skip-decisions', '快进时自动选择第一个选项', '快进自动选首项')}`;
  dialog.append(tabs, panel);
  const setPage = (playback: boolean) => {
    dialog.classList.toggle('playback-settings-open', playback);
    panel.hidden = !playback;
    for (const [index, tab] of [...tabs.querySelectorAll('button')].entries()) {
      const active = (index === 1) === playback;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    }
  };
  tabs.querySelectorAll('button').forEach((tab, index) => {
    tab.onclick = () => setPage(index === 1);
    tab.onkeydown = (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index;
      setPage(next === 1);
      tabs.querySelectorAll('button')[next].focus();
    };
  });
  setPage(true);
  return panel;
}
