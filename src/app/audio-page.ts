import { audioLevels, type AudioChannel } from './audio-levels';
import './audio-page.css';

export class AudioPage {
  readonly root = document.createElement('section');
  private back = document.createElement('button');
  private controls = new Map<
    AudioChannel,
    { input: HTMLInputElement; output: HTMLOutputElement }
  >();
  constructor(returnToLibrary: () => void, previewUi: () => void) {
    this.root.id = 'desktop-audio';
    this.root.className = 'desktop-page';
    this.root.hidden = true;
    const header = document.createElement('div');
    header.className = 'desktop-page-heading';
    const title = document.createElement('h1');
    title.textContent = '声音';
    this.back.className = 'audio-return';
    this.back.onclick = returnToLibrary;
    header.append(title, this.back);
    const mixer = document.createElement('div');
    mixer.className = 'audio-mixer';
    for (const [channel, text] of [
      ['ui', '界面音效'],
      ['theme', '主题音乐'],
      ['player', '剧情播放器'],
    ] as const) {
      const row = document.createElement('label'),
        name = document.createElement('span'),
        input = document.createElement('input'),
        output = document.createElement('output');
      row.className = 'audio-level-row';
      name.textContent = text;
      input.type = 'range';
      input.min = '0';
      input.max = '100';
      input.step = '1';
      input.id = `audio-${channel}-volume`;
      input.setAttribute('aria-label', text + '音量');
      row.htmlFor = input.id;
      output.htmlFor.add(input.id);
      output.id = input.id + '-value';
      input.oninput = () => audioLevels.set(channel, Number(input.value));
      if (channel === 'ui') input.onchange = previewUi;
      row.append(name, input, output);
      mixer.append(row);
      this.controls.set(channel, { input, output });
    }
    this.root.append(header, mixer);
    this.root.addEventListener('keydown', (event) => {
      if (
        event.key === 'Escape' &&
        !document.querySelector('dialog[open],[popover]:popover-open:not(#prts-cursor)')
      ) {
        event.preventDefault();
        returnToLibrary();
      }
    });
    audioLevels.subscribe(() => this.sync());
    this.sync();
    this.setPlaying(false);
  }
  setPlaying(playing: boolean): void {
    this.back.textContent = playing ? '返回播放' : '返回剧情库';
  }
  focus(): void {
    this.back.focus({ preventScroll: true });
  }
  private sync(): void {
    for (const [channel, { input, output }] of this.controls) {
      const value = audioLevels.get(channel);
      input.value = String(value);
      output.value = `${value}%`;
      input.setAttribute('aria-valuetext', value === 0 ? '静音' : `${value}%`);
    }
  }
}
