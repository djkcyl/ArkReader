import type { PlaybackPosition } from '../core/playback-position';
import type { StoryPlayer } from './runtime';
import type { VideoPort } from './video';

export interface PlaybackTarget {
  position?: PlaybackPosition;
  percent?: number;
  commandIndex?: number;
  review?: boolean;
}
export class RestoringVideo implements VideoPort {
  restoring = false;
  constructor(
    private video: VideoPort,
    private skipDuringRestore: () => boolean = () => true,
  ) {}
  get frame() {
    return this.video.frame;
  }
  play(url: string, started: () => void, ended: (error?: string) => void) {
    if (this.restoring && this.skipDuringRestore()) {
      started();
      ended();
    } else this.video.play(url, started, ended);
  }
  pause(paused: boolean) {
    this.video.pause(paused);
  }
  close() {
    this.video.close();
  }
}

/** Re-execute the scene and the recorded route. Never assign a scheduler index:
 * backgrounds, holders, filters, history and audio all need their consumers. */
export async function restorePosition(
  player: StoryPlayer,
  target: PlaybackTarget,
  signal: AbortSignal,
  onProgress: (fraction: number) => void,
  draw: () => void,
): Promise<string> {
  const saved = target.position,
    exact = target.percent === undefined && target.commandIndex === undefined;
  const commandIndex = target.commandIndex;
  if (
    commandIndex !== undefined &&
    (!Number.isInteger(commandIndex) ||
      commandIndex < 0 ||
      commandIndex >= player.scheduler.commands.length)
  )
    throw Error('所选脚本行不存在。');
  if (saved && saved.script !== player.scriptIdentity) {
    player.tick(0);
    return '剧情内容已更新，上次位置不再适用，已从头播放。';
  }
  if (exact && !saved) {
    player.tick(0);
    return '';
  }
  const percent = Math.max(0, Math.min(100, target.percent ?? saved?.percent ?? 0));
  const targetIndex = commandIndex ?? Math.ceil((player.scheduler.commands.length * percent) / 100);
  const actions = saved?.actions ?? [];
  let actionIndex = 0,
    iterations = 0,
    shown = 0;
  const deadline = performance.now() + 60000;
  const finish = (notice = '') => {
    player.setAuto(false);
    player.restoreViewed(saved?.seen ?? []);
    onProgress(1);
    draw();
    return notice;
  };
  const previousYield = player.scheduler.yieldAfterCommand;
  if (target.review && saved)
    player.scheduler.yieldAfterCommand = () => player.playbackStep >= saved.step;
  else if (commandIndex !== undefined)
    player.scheduler.yieldAfterCommand = () => player.scheduler.index === commandIndex;
  try {
    while (!player.finished) {
      signal.throwIfAborted();
      if (performance.now() > deadline || iterations > 120000)
        throw Error('恢复进度耗时过长，可返回剧情库后从头播放。');
      const batchEnd = performance.now() + 10;
      do {
        signal.throwIfAborted();
        iterations++;
        player.tick(0.1);
        if (player.error) throw Error(player.error);
        if (
          commandIndex !== undefined &&
          player.scheduler.current &&
          player.scheduler.index === commandIndex
        )
          return finish();
        if (
          exact &&
          player.playbackStep === saved!.step &&
          player.scheduler.index === saved!.index &&
          (player.canBookmark || target.review)
        )
          return finish();
        if (commandIndex !== undefined && player.atEnd)
          return finish('所选行未在当前分支执行，已停在剧情结尾。');
        if (
          commandIndex === undefined &&
          !exact &&
          player.canBookmark &&
          (player.scheduler.index >= targetIndex || player.atEnd)
        )
          return finish();
        if (exact && player.playbackStep > saved!.step)
          throw Error('无法匹配已保存的剧情位置，请从头播放。');
        const action = actions[actionIndex];
        if (action && action.step < player.playbackStep)
          throw Error('已保存的分支记录与剧情不匹配，请从头播放。');
        if (action?.step === player.playbackStep) {
          if (action.kind === 'choice') {
            if (!player.choices[action.index] || player.choices[action.index].disabled)
              throw Error('已保存的剧情选项已不可用，请从头播放。');
            player.choose(action.index);
          } else if (action.kind === 'skip') {
            if (!player.skip()) throw Error('无法恢复已保存的跳过位置。');
          } else if (!player.receiveHostSignal(action.command, action.signal))
            throw Error('无法恢复已保存的剧情衔接。');
          actionIndex++;
          continue;
        }
        if (player.choices.length || player.hostCommands.waiting) {
          if (exact) throw Error('此位置缺少分支记录，请从头播放。');
          return finish(
            player.choices.length
              ? '已停在未记录的剧情选项，请选择后继续阅读。'
              : '已停在剧情衔接处，请确认后继续阅读。',
          );
        }
        if (player.canBookmark) player.advance();
      } while (performance.now() < batchEnd && !player.finished);
      shown = Math.max(
        shown,
        Math.min(
          0.99,
          exact
            ? player.playbackStep / Math.max(1, saved!.step)
            : player.scheduler.index / Math.max(1, targetIndex),
        ),
      );
      onProgress(shown);
      draw();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    if (exact) throw Error('剧情已结束，无法匹配保存的位置，请从头播放。');
    return finish(commandIndex !== undefined ? '当前分支没有执行所选行，剧情已结束。' : '');
  } finally {
    player.scheduler.yieldAfterCommand = previousYield;
  }
}
