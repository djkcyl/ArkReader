import { loadWidgetProfile, NativePrompt } from '../player/native-widgets';
import type { PlaybackTarget } from '../player/restore-position';
import type { ResumeChoice } from './resume-choice';
import './resume-prompt.css';
import { previewText } from './reading-preview';

export class ResumePrompt {
  readonly dialog = document.createElement('dialog');
  private ready = false;
  private resolve?: (target: PlaybackTarget | null) => void;
  private choice?: ResumeChoice;
  private title = document.createElement('p');
  private progress = document.createElement('p');
  private excerpt = document.createElement('p');
  private continueButton = document.createElement('button');
  private restartButton = document.createElement('button');
  private bounds?: { top: number; bottom: number };
  constructor() {
    this.dialog.id = 'resume-prompt';
    this.dialog.setAttribute('aria-labelledby', 'resume-heading');
    this.dialog.setAttribute('aria-describedby', 'resume-story resume-progress');
    this.title.id = 'resume-story';
    this.progress.id = 'resume-progress';
    this.excerpt.id = 'resume-excerpt';
    this.continueButton.id = 'resume-continue';
    this.continueButton.textContent = '继续阅读';
    this.restartButton.id = 'resume-restart';
    this.restartButton.textContent = '从头播放';
    this.continueButton.onclick = () => this.finish(this.choice!.target);
    this.restartButton.onclick = () => this.finish({});
    this.dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      this.finish(null);
    });
    this.dialog.addEventListener('close', () => {
      if (!this.dialog.open) this.finish(null);
    });
    this.dialog.addEventListener('click', (event) => {
      if (event.target !== this.dialog || !this.bounds) return;
      const rect = this.dialog.getBoundingClientRect(),
        y = ((event.clientY - rect.top) * 1280) / rect.width;
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        y < this.bounds.top ||
        y > this.bounds.bottom
      )
        this.dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    });
    this.dialog.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      (document.activeElement === this.continueButton
        ? this.restartButton
        : this.continueButton
      ).focus();
    });
    document.getElementById('app')!.append(this.dialog);
  }
  async ask(
    story: string,
    choice: ResumeChoice,
    signal: AbortSignal,
  ): Promise<PlaybackTarget | null> {
    if (!this.ready) {
      const profile = await loadWidgetProfile(signal);
      signal.throwIfAborted();
      const heading = document.createElement('h2');
      heading.id = 'resume-heading';
      heading.textContent = '继续阅读？';
      const content = document.createElement('div');
      content.append(heading, this.title, this.progress, this.excerpt);
      new NativePrompt(
        this.dialog,
        profile.dialogs.judge,
        content,
        this.continueButton,
        this.restartButton,
      );
      const p = profile.dialogs.judge;
      this.bounds = {
        top: p.background.rect[1],
        bottom: Math.max(
          p.controls.confirm.rect[1] + p.controls.confirm.rect[3],
          p.controls.cancel!.rect[1] + p.controls.cancel!.rect[3],
        ),
      };
      this.ready = true;
    }
    signal.throwIfAborted();
    this.choice = choice;
    this.title.textContent = story;
    this.progress.textContent = `最高进度 ${choice.percent}%`;
    this.refreshPreview();
    const abort = () => this.finish(null);
    signal.addEventListener('abort', abort, { once: true });
    try {
      return await new Promise<PlaybackTarget | null>((resolve) => {
        this.resolve = resolve;
        this.dialog.showModal();
        this.continueButton.focus();
      });
    } finally {
      signal.removeEventListener('abort', abort);
    }
  }
  refreshPreview(): void {
    if (!this.choice) return;
    this.excerpt.textContent = this.choice.approximate
      ? '将快进至这一进度附近，遇到选项时暂停。'
      : previewText(this.choice.preview);
    this.excerpt.title = this.excerpt.textContent;
    this.excerpt.hidden = !this.excerpt.textContent;
  }
  private finish(target: PlaybackTarget | null) {
    const resolve = this.resolve;
    this.resolve = undefined;
    if (this.dialog.open) this.dialog.close();
    resolve?.(target);
  }
}
