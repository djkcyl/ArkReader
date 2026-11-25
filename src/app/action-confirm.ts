import { loadWidgetProfile, NativePrompt } from '../player/native-widgets';
import './resume-prompt.css';

class ActionConfirm {
  private dialog = document.createElement('dialog');
  private heading = document.createElement('h2');
  private detail = document.createElement('p');
  private confirm = document.createElement('button');
  private cancel = document.createElement('button');
  private resolve?: (accepted: boolean) => void;
  private ready = false;
  private busy = false;

  constructor() {
    this.dialog.id = 'action-confirm';
    this.heading.id = 'action-confirm-heading';
    this.detail.id = 'action-confirm-detail';
    this.confirm.id = 'action-confirm-accept';
    this.cancel.id = 'action-confirm-cancel';
    this.cancel.textContent = '取消';
    this.dialog.setAttribute('aria-labelledby', this.heading.id);
    this.dialog.setAttribute('aria-describedby', this.detail.id);
    this.confirm.onclick = () => this.finish(true);
    this.cancel.onclick = () => this.finish(false);
    this.dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      this.finish(false);
    });
    this.dialog.addEventListener('close', () => {
      if (!this.dialog.open) this.finish(false);
    });
    this.dialog.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      (document.activeElement === this.confirm ? this.cancel : this.confirm).focus();
    });
    document.getElementById('app')!.append(this.dialog);
  }

  async ask(title: string, detail: string, action: string): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    try {
      if (!this.ready) {
        const profile = await loadWidgetProfile(AbortSignal.timeout(15000));
        const content = document.createElement('div');
        content.append(this.heading, this.detail);
        new NativePrompt(this.dialog, profile.dialogs.judge, content, this.confirm, this.cancel);
        const p = profile.dialogs.judge;
        const top = p.background.rect[1];
        const bottom = Math.max(
          p.controls.confirm.rect[1] + p.controls.confirm.rect[3],
          p.controls.cancel!.rect[1] + p.controls.cancel!.rect[3],
        );
        this.dialog.addEventListener('click', (event) => {
          if (event.target !== this.dialog) return;
          const rect = this.dialog.getBoundingClientRect();
          const y = ((event.clientY - rect.top) * 1280) / rect.width;
          if (event.clientX < rect.left || event.clientX > rect.right || y < top || y > bottom)
            this.finish(false);
        });
        this.ready = true;
      }
      this.heading.textContent = title;
      this.detail.textContent = detail;
      this.confirm.querySelector('.native-prompt-button-label')!.textContent = action;
      return await new Promise<boolean>((resolve) => {
        this.resolve = resolve;
        this.dialog.showModal();
        this.cancel.focus();
      });
    } finally {
      this.busy = false;
    }
  }

  private finish(accepted: boolean): void {
    const resolve = this.resolve;
    this.resolve = undefined;
    if (this.dialog.open) this.dialog.close();
    resolve?.(accepted);
  }
}

let prompt: ActionConfirm | undefined;
export function confirmAction(title: string, detail: string, action = '确认'): Promise<boolean> {
  return (prompt ??= new ActionConfirm()).ask(title, detail, action).catch((error) => {
    const notice = document.getElementById('resource-message');
    if (notice) {
      notice.textContent = '确认窗口加载失败，请稍后重试。';
      notice.classList.add('is-error');
      notice.hidden = false;
    }
    console.warn(error);
    return false;
  });
}
