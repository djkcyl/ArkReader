import { copyGlitch, interpolateGlitch, type GlitchPreset } from './character-glitch';
import { ViewingProgressTracker } from '../core/viewing-progress';
import {
  scriptIdentity,
  type PlaybackAction,
  type PlaybackPosition,
} from '../core/playback-position';
import { QuickClickRecord } from '../core/quick-notice';
import { bindImageEffect, type ImageEffectTexture } from './image-effects.ts';
import type { VideoPort } from './video';
import { TimerSticker } from './timer-sticker';
import { SpellStickers } from './spell-stickers';
import { readingMarkup, type ReadingMarkup } from '../core/sticker-color';
import { CharacterCutins } from './character-cutins';
import { stampParagraphs } from '../core/stamp-text';
import type { Stamp, StampProfile } from './stamps';
import type { AnimatedKV, AnimatedKVProfile } from './animated-kv';
import { updateAnimatedKV, disposeAnimatedKV } from './animated-kv';
import { NativeParticles } from './native-particles';
import { defaultEffectMotion, foregroundRotation } from './effect-motion';
import { Stickers } from './stickers';
import { Interludes, type InterludeProfile } from './interludes';
import { BackgroundEffects, type BgEffectProfile } from './bg-effects';
import { parseScript } from '../core/parser';
import { Scheduler, type Command } from '../core/scheduler';
import { decisionButtons } from '../core/decision';
import { defaultDialogPreset, dialogPresets } from '../core/dialog-presets';
import { parseCharacterKey } from '../core/character';
import { capabilityGaps, SUPPORTED, unsupportedCommands } from '../core/capabilities';
import { nativeBoolean, nativeInt } from '../core/values';
import { resourceKey } from '../core/resource-key';
import { easeAt, shakePath, sampleShake, jumpAt, type Ease } from '../core/motion';
import { nativeVector } from '../core/vector';
import type { FilterState } from './filters';
import { CurtainPlayer } from './curtains';
import { FocusState } from './focus-state';
import { parseStoryHeader, type StoryHeader } from '../core/story-header';
import { nativeEase } from '../core/easing';
import { blockerStyle, type BlockerState } from './blocker';
import { translateText } from '../core/text-variables';
import { imageRotationDelta } from './image-rotation';
import { gridGroup, gridLayout, stripLayout, type GridTile } from '../core/grid-background';
import { StoryHostCommands, type StoryHostPort } from './story-host';
import { storyHostRequirements } from '../core/story-host-requirements';
import { quickSpeeds } from '../core/quick-play';
import { ReaderModel } from '../core/reader-model';
import { ReaderPlayback } from '../core/reader-playback';
import { requirePackResources } from '../core/pack-resources';
export interface Asset {
  url: string;
  kind: 'image' | 'audio' | 'effect' | 'video';
  audio?: { url: string; sha256: string; size: number };
  profile?: BgEffectProfile;
  width?: number;
  height?: number;
  rect?: {
    width: number;
    height: number;
  };
  textureRect?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  textureRectOffset?: {
    x: number;
    y: number;
  };
  alphaSources?: {
    colorMain?: {
      url: string;
      width: number;
      height: number;
    };
    colorFace?: {
      url: string;
      width: number;
      height: number;
    };
    split?: boolean;
    main: {
      url: string;
      width: number;
      height: number;
    };
    face?: {
      url: string;
      width: number;
      height: number;
    };
    faceRect?: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  };
  pixelsPerUnit?: number;
  border?: number[];
  tileRepeatUV?: boolean;
  layout?: {
    position: {
      x: number;
      y: number;
    };
    size: {
      x: number;
      y: number;
    };
    pivot: {
      x: number;
      y: number;
    };
    scale: {
      x: number;
      y: number;
    };
  };
  composition?: {
    kind: string;
    bodyIndex: number;
    expressionIndex: number;
    faceRect: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  };
}
export interface Asset {
  imageEffectTexture?: ImageEffectTexture;
  interlude?: InterludeProfile;
  stamp?: StampProfile;
  animatedKV?: AnimatedKVProfile;
}
export interface Pack {
  glitchPresets?: Record<string, GlitchPreset>;
}
export interface Pack {
  skipBrief?: {
    chapterName: string;
    title: string;
    tag: string;
    infoId: string | null;
  } | null;
}
export interface Pack {
  review?: {
    label: string;
    groupName: string;
    storyCode: string | null;
    storyName: string | null;
    avgTag: string | null;
  };
}
export interface Visual {
  glitch?: GlitchPreset;
}
export interface Pack {
  unresolvedSoundKeys?: string[];
  unresolvedMusicKeys?: string[];
  summary?: string;
  id: string;
  version?: string;
  clientVersion?: string;
  script: string;
  variables: Record<string, unknown>;
  assets: Record<string, Asset>;
  missing: string[];
  errors: unknown[];
}
export interface SlotTransform {
  x: number;
  y: number;
  sx: number;
  sy: number;
  shakeX?: number;
  shakeY?: number;
}
interface CgItem extends Visual {
  rotationZ: number;
  slotKey: string;
  order: number;
  groupAlpha: number;
}
export interface Visual {
  rotationZ?: number;
  tiled?: boolean;
  key: string;
  x: number;
  y: number;
  sx: number;
  sy: number;
  alpha: number;
  brightness: number;
  slot?: string;
  width?: number;
  height?: number;
  parent?: SlotTransform;
  pivotX?: number;
  pivotY?: number;
  blackStart?: number;
  blackEnd?: number;
  blackInverse?: boolean;
}
export interface AudioPort {
  music(intro: string, loop: string, volume: number, delay: number, fade: number): void;
  stopMusic(fade: number): void;
  sound(key: string, channel: string, volume: number, delay: number, loop: boolean): void;
  stopSound(channel: string, fade: number): void;
  musicVolume(volume: number, fade: number): void;
  soundVolume(channel: string, volume: number, fade: number): void;
  stop(): void;
  pause(paused: boolean): void;
}
export type Trace = {
  t: number;
  line: number;
  event: string;
  detail: Record<string, unknown>;
};
type Tween = {
  owner: object;
  key: string;
  begin: number;
  duration: number;
  from: number;
  to: number;
  ease: Ease;
  done?: () => void;
  sequence?: SlotSequence;
  update?: (t: number) => void;
  motionTarget?: SlotTransform;
  shake?: boolean;
  loop?: boolean;
};
type Timer = {
  at: number;
  done: () => void;
};
type SlotSequence = {
  begin: number;
  end: number;
  locked: boolean;
  complete: boolean;
  done?: () => void;
};
export const NATIVE = {
  width: 1280,
  height: 720,
  characterY: 202.999267578125,
  characterFade: 0.15,
  blockerFade: 0.4,
  typeDelay: 0.04,
  autoBase: 1.5,
  autoPerChar: 0.03,
  focus: 1,
  unfocus: 0.5,
};
// AVGController._btnAutoSpeed in sharedassets1. Each timing is in seconds.
const buttonAutoSpeeds = [
  { typeDelay: 0.04, base: 1.5, perChar: 0.03 },
  { typeDelay: 0.01, base: 0.5, perChar: 0.015 },
  { typeDelay: 0.01, base: 0.25, perChar: 0.01 },
];
export { SUPPORTED } from '../core/capabilities';
export function num(p: Record<string, unknown>, key: string, fallback: number): number {
  if (!Object.hasOwn(p, key)) return fallback;
  const value = p[key] === null ? 0 : Number(p[key]);
  if (!Number.isFinite(value)) throw new Error(`无效数值 ${key}`);
  return Math.fround(value);
}
function bool(p: Record<string, unknown>, key: string, fallback = false): boolean {
  return Object.hasOwn(p, key) ? nativeBoolean(p[key]) : fallback;
}
export const assetKey = resourceKey;
/** Story command execution; current functional scope is in docs/modern-coverage.md. */
export class StoryPlayer {
  private readonly quickClickRecord = new QuickClickRecord();
  onQuickClickNotice?: () => void;
  readonly stamps: Stamp[] = [];
  readonly spells = new SpellStickers(
    (kv) => this.host.prepareSpell?.(kv),
    (kv) => this.host.releaseSpell?.(kv),
  );
  readonly displayHolders = new Map<
    string,
    {
      slot: string;
      layer: number;
      order: number;
    } & (
      | {
          particles: NativeParticles;
          born: number;
        }
      | {
          key: string;
          alpha: number;
        }
      | {
          kv: AnimatedKV;
        }
    )
  >();
  private holderOrder = 0;
  private clearDisplayables() {
    this.spells.clear();
    this.stamps.length = 0;
    for (const holder of this.displayHolders.values()) {
      if ('particles' in holder) holder.particles.dispose();
      else {
        this.kill('kv' in holder ? holder.kv : holder);
        if ('kv' in holder) disposeAnimatedKV(holder.kv);
      }
    }
    this.displayHolders.clear();
  }
  readonly cutins = new CharacterCutins();
  readonly interludes = new Interludes();
  readonly story: StoryHeader;
  readonly reader: ReaderModel;
  readonly readerPlayback = new ReaderPlayback();
  private readerDone: (() => void) | null = null;
  private readerDecisionDone: (() => void) | null = null;
  private readerQuickCache: number | null = null;
  get readerMode(): boolean {
    return this.readerPlayback.active;
  }
  // Execution mode persists through theater; AVGUIStateEngineController only
  // removes the Reader main state until ShouldEnableReaderMode becomes true.
  get readerVisible(): boolean {
    return this.readerMode && !this.theaterMode && !this.finished;
  }
  get readerShouldScrollToEnd(): boolean {
    return this.readerDone !== null || this.readerDecisionDone !== null;
  }
  // Standalone host enables the Reader feature by default. Native obtains this
  // independent feature switch from RemoteConfig, not from the story header.
  get readerEnabled(): boolean {
    return this.host.enableReader !== false;
  }
  get tutorialRestricted(): boolean {
    return this.story.isTutorial && !this.host.archiveReplay;
  }
  get readerAvailable(): boolean {
    return this.readerEnabled && !this.tutorialRestricted && !this.story.isVideoOnly;
  }
  get canRead(): boolean {
    return (
      this.readerAvailable && !this.theaterMode && !this.quickPlay && !this.finished && !this.error
    );
  }
  private autoWait: {
    deadline: number | null;
    duration: number;
  } | null = null;
  scheduler: Scheduler;
  readonly viewingProgress: ViewingProgressTracker;
  readonly scriptIdentity: string;
  playbackStep = 0;
  readonly executedCommands = new Map<number, number>();
  private playbackActions: PlaybackAction[] = [];
  private savedPosition?: PlaybackPosition;
  private reviewPoints = new WeakMap<object, { step: number; index: number }>();
  reviewPosition(cell: { text: string }): PlaybackPosition | undefined {
    const point = this.reviewPoints.get(cell);
    if (!point) return;
    return {
      schema: 1,
      script: this.scriptIdentity,
      ...point,
      percent: Math.min(99, Math.floor((point.index / this.scheduler.commands.length) * 100)),
      actions: this.playbackActions
        .filter((action) => action.step < point.step)
        .map((a) => ({ ...a })),
      seen: this.viewingProgress.snapshot,
    };
  }
  get canBookmark(): boolean {
    return (
      !!this.scheduler.current &&
      !this.finished &&
      !this.error &&
      !!(
        this.waiting ||
        this.subtitleDone ||
        this.stickerDone ||
        this.decisionDone ||
        this.spellClearDone ||
        this.endDone
      )
    );
  }
  get playbackPercent(): number {
    return this.finished || this.atFinalEndTip
      ? 100
      : Math.min(
          99,
          Math.floor((this.scheduler.index / Math.max(1, this.scheduler.commands.length)) * 100),
        );
  }
  get position(): PlaybackPosition | undefined {
    if (
      this.canBookmark &&
      (this.savedPosition?.step !== this.playbackStep ||
        this.savedPosition.actions.length !== this.playbackActions.length)
    ) {
      this.savedPosition = this.replayPosition;
    }
    return this.savedPosition;
  }
  get replayPosition(): PlaybackPosition {
    return {
      schema: 1,
      script: this.scriptIdentity,
      index: this.scheduler.index,
      step: this.playbackStep,
      percent: this.playbackPercent,
      actions: this.playbackActions.map((action) => ({ ...action })),
      seen: this.viewingProgress.snapshot,
    };
  }
  restoreViewed(ranges: [number, number][]): void {
    this.viewingProgress.restore(ranges, this.scheduler.index);
    if (this.atFinalEndTip) this.viewingProgress.finish();
    this.savedPosition = undefined;
  }
  time = 0;
  paused = false;
  auto = false;
  quickPlay = false;
  skipQuickDecisions = false;
  private quickSpeed = 0;
  get quickSpeedIndex(): number {
    return this.quickSpeed;
  }
  get canQuickPlay(): boolean {
    return (
      !this.readerMode &&
      !this.tutorialRestricted &&
      this.story.isAutoable &&
      !this.theaterMode &&
      !this.finished &&
      !this.error &&
      !this.paused
    );
  }
  private animationDuration(duration: number): number {
    return this.quickPlay || this.readerMode ? duration * 0 : duration;
  }
  private buttonSpeed = 0;
  get autoSpeedIndex(): number {
    return this.buttonSpeed;
  }
  private get readingSpeed() {
    return this.readerMode || (this.quickPlay && !this.theaterMode)
      ? quickSpeeds[this.quickSpeed]
      : buttonAutoSpeeds[this.auto && !this.theaterMode ? this.buttonSpeed : 0];
  }
  private subtitleDelay = NATIVE.typeDelay;
  theaterMode = false;
  private savedTheaterAuto: boolean | null = null;
  private savedTheaterQuick = false;
  private pausedQuick = false;
  private cancelledQuickResume = false;
  finished = false;
  error = '';
  nickname = '博士';
  background: Visual[] = [];
  readonly grid = { tiles: [] as GridTile[], originX: 0, originY: 0, alpha: 0 };
  readonly gridOffset = { x: 0, y: 0, sx: 1, sy: 1 };
  image: Visual[] = [];
  photoItem: {
    key: string;
    x: number;
    y: number;
    black: number;
    alpha: number;
  } | null = null;
  readonly cgItems: CgItem[] = [];
  private cgSlots = new Map<string, CgItem>();
  readonly imageRotation = { z: 0 };
  private imageRotationDone: (() => void) | null = null;
  characters: Visual[] = [];
  readonly curtains = new CurtainPlayer();
  readonly focus = new FocusState();
  readonly bgEffects = new BackgroundEffects();
  readonly timerSticker = new TimerSticker();
  readonly stickers = new Stickers((length) => this.raiseAutoClick(length));
  private stickerDone: (() => void) | null = null;
  blocker: BlockerState = {
    r: 0,
    g: 0,
    b: 0,
    a: 0,
    style: 0,
    flipX: false,
    flipY: false,
    image: '',
  };
  dialog = {
    markup: undefined as ReadingMarkup | undefined,
    visible: false,
    alpha: 0,
    name: '',
    text: '',
    revealed: 0,
    start: 0,
    doneAt: null as number | null,
    segment: '',
    segmentMarkup: undefined as ReadingMarkup | undefined,
    messageWidth: 735,
    preset: defaultDialogPreset as (typeof dialogPresets)[number],
    canExpand: true,
  };
  subtitle = {
    markup: undefined as ReadingMarkup | undefined,
    visible: false,
    alpha: 0,
    text: '',
    revealed: 0,
    start: 0,
    doneAt: null as number | null,
    x: 0,
    y: 0,
    width: 1280,
    size: 24,
    alignment: 'left',
  };
  camera = { x: 0, y: 0 };
  filters: FilterState = { grayscale: 0, inverse: 0, chaos: 0, chaosFrom: '', chaosTo: '' };
  private cameraShake: {
    begin: number;
    loop: boolean;
    path: ReturnType<typeof shakePath>;
    done?: () => void;
  } | null = null;
  private subtitleDone: (() => void) | null = null;
  private slotTransforms = new Map<string, SlotTransform>();
  private slotSequences = new Map<string, SlotSequence>();
  private slotClears = new Map<string, object>();
  choices: {
    text: string;
    value: number;
    disabled?: boolean;
  }[] = [];
  history: {
    name: string;
    text: string;
    line: number;
    decisionIndex?: number;
  }[] = [];
  private playbackOption = -1;
  trace: Trace[] = [];
  private tweens: Tween[] = [];
  private timers: Timer[] = [];
  private waiting: (() => void) | null = null;
  private decisionDone: (() => void) | null = null;
  private endDone: (() => void) | null = null;
  private line = 0;
  private slotFocus = new Set<string>();
  private multiline = false;
  private multilineEnd = false;
  private historyMultiline: {
    name: string;
    text: string;
    line: number;
  } | null = null;
  video: {
    key: string;
    alpha: number;
    phase: 'preparing' | 'playing' | 'finished';
  } | null = null;
  private readonly skipNodes: {
    index: number;
    firstReadLocked: boolean;
  }[];
  private readonly skipToIndex: number;
  private readonly hasSkipNodes: boolean;
  readonly hostCommands: StoryHostCommands;
  skipLandingReached = false;
  private firstReadLocked = false;
  private commandEpoch = 0;
  private whiteOnFinish = false;
  finishMask: 'loading_white' | null = null;
  private spellClearDone: (() => void) | null = null;
  private textDelay = NATIVE.typeDelay;
  get skipBrief() {
    const info = this.pack.skipBrief;
    if ((this.host.firstRead && this.hasSkipNodes) || !info?.infoId || !this.pack.summary)
      return null;
    return {
      ...info,
      chapterName: `《${info.chapterName}》`,
      content: this.translate(this.pack.summary),
    };
  }
  private translate(value: unknown): string {
    return translateText(value, this.pack.variables, this.nickname);
  }
  constructor(
    readonly pack: Pack,
    readonly audio: AudioPort,
    savedSpeed = 0,
    readonly host: {
      enableReader?: boolean;
      /** The archive replays tutorial narration without running a first-play tutorial. */
      archiveReplay?: boolean;
      commands?: StoryHostPort;
      video?: VideoPort;
      firstRead?: boolean;
      layoutDialog?: (dialog: StoryPlayer['dialog']) => void;
      prepareSpell?: (kv: AnimatedKV) => void;
      releaseSpell?: (kv: AnimatedKV) => void;
    } = {},
  ) {
    if (Number.isInteger(savedSpeed) && savedSpeed >= 0 && savedSpeed < buttonAutoSpeeds.length)
      this.buttonSpeed = savedSpeed;
    const commands = parseScript(pack.script, pack.variables);
    this.scriptIdentity = scriptIdentity(pack.script, pack.variables);
    this.viewingProgress = new ViewingProgressTracker(commands.length);
    this.story = parseStoryHeader(commands);
    this.reader = new ReaderModel(commands, (value) => this.translate(value));
    this.skipNodes = commands.flatMap((c, index) =>
      c.name === 'skipnode' ? [{ index, firstReadLocked: c.params.mode === 'nofirstskip' }] : [],
    );
    this.hasSkipNodes = this.skipNodes.length > 0;
    this.skipToIndex = commands.findIndex((c) => c.name === 'skiptothis');
    const gaps = capabilityGaps(commands);
    if (gaps.length)
      throw new Error(
        `当前版本不支持的剧情功能：${gaps
          .slice(0, 8)
          .map((g) => `${g.feature}（第 ${g.line} 行）`)
          .join('、')}`,
      );
    const unsupported = unsupportedCommands(commands);
    if (unsupported.length)
      throw new Error(
        `此版本尚不支持：${[...new Set(unsupported.map((c) => c.name))].join('、')}。不会跳过演出指令。`,
      );
    requirePackResources(pack);
    if (!host.commands && storyHostRequirements(commands).length)
      throw Error(
        '此剧情包含宿主场景衔接或信号等待，需要提供剧情宿主接口；不会伪造战斗或页面完成信号。',
      );
    this.scheduler = new Scheduler(commands, true, (c) => {
      this.trace.push({
        t: this.time,
        line: c.line,
        event: 'native-unhandled',
        detail: { name: c.name },
      });
    });
    this.hostCommands = new StoryHostCommands(host.commands, () => {
      this.scheduler.resumeAfter(commands.length - 1);
      this.emit('host-abort-remaining');
    });
    for (const name of [
      'dialog',
      'subtitle',
      'aside',
      'decision',
      'predicate',
      'endtip',
      'sticker',
      'spellsticker',
      'multiline',
      'animtext',
    ])
      this.scheduler.register(name, {
        uiInput: true,
        execute: (command, done) => {
          const count = this.reader.cells.length;
          const event = this.reader.process(command, this.scheduler.predicator.selectedIndexes);
          for (const cell of this.reader.cells.slice(count))
            this.reviewPoints.set(cell, {
              step: this.playbackStep + 1,
              index: this.scheduler.index,
            });
          if (command.name === 'decision') {
            if (this.quickPlay && this.skipQuickDecisions) {
              done();
              return;
            }
            this.readerDecisionDone = done;
            return;
          }
          if (!this.readerMode || !event) {
            done();
            return;
          }
          this.readerDone = done;
          if (event.endtip) {
            this.readerPlayback.stopAuto();
            this.readerPlayback.waitingForInput = false;
          } else if (this.theaterMode) {
            /* Native Reader auto controller is unbound. */
          } else if (this.readerPlayback.shouldAutoPlay) this.readerPlayback.raise(event.length);
          else this.readerPlayback.waitingForInput = true;
        },
        forceEnd: () => {
          this.readerDone = null;
          this.readerDecisionDone = null;
          this.readerPlayback.waitingForInput = false;
          this.readerPlayback.stopClick();
        },
      });
    for (const name of SUPPORTED)
      this.scheduler.register(name, {
        uiInput: [
          'stickertween',
          'spellsticker',
          'spellstickerclear',
          'sticker',
          'stickerclear',
          'dialog',
          'aside',
          'multiline',
          'subtitle',
          'decision',
          'endtip',
        ].includes(name),
        execute: (command, done) => {
          this.line = command.line;
          this.playbackStep++;
          const commandIndex = this.scheduler.index;
          this.executedCommands.set(
            commandIndex,
            (this.executedCommands.get(commandIndex) ?? 0) + 1,
          );
          const historyCount = this.history.length;
          this.emit('command', { name: command.name, params: command.params });
          const line = command.line,
            epoch = this.commandEpoch;
          this.execute(command, () => {
            if (this.commandEpoch !== epoch) return;
            this.trace.push({
              t: this.time,
              line,
              event: 'complete',
              detail: { name: command.name },
            });
            done();
          });
          for (const cell of this.history.slice(historyCount))
            this.reviewPoints.set(cell, { step: this.playbackStep, index: this.scheduler.index });
        },
      });
  }
  emit(event: string, detail: Record<string, unknown> = {}): void {
    this.trace.push({ t: this.time, line: this.line, event, detail });
  }
  private later(duration: number, done: () => void): void {
    this.timers.push({ at: this.time + Math.max(0, duration), done });
  }
  private tween(
    owner: object,
    key: string,
    to: number,
    duration: number,
    done?: () => void,
    ease: Ease = 'linear',
  ): void {
    this.tweens = this.tweens.filter((t) => t.owner !== owner || t.key !== key);
    const target = owner as Record<string, number>;
    if (duration <= 0) {
      target[key] = to;
      done?.();
      return;
    }
    this.tweens.push({ owner, key, begin: this.time, duration, from: target[key], to, done, ease });
  }
  private kill(owner: object): void {
    this.tweens = this.tweens.filter((t) => t.owner !== owner && t.motionTarget !== owner);
  }
  private setDialogVisible(visible: boolean): void {
    if (this.dialog.visible === visible) return;
    // DialogPanel._SetHiddenInternal replaces the CanvasGroup tween from its current alpha.
    this.dialog.visible = visible;
    this.tween(this.dialog, 'alpha', visible ? 1 : 0, 0.15);
  }
  private parentFor(slot: string): SlotTransform {
    let parent = this.slotTransforms.get(slot);
    if (!parent) {
      parent = { x: 0, y: 0, sx: 1, sy: 1 };
      this.slotTransforms.set(slot, parent);
    }
    for (const v of this.characters.filter((v) => v.slot === slot)) v.parent = parent;
    return parent;
  }
  private outsidePosition(slot: string, direction: string): [number, number] {
    const center = slot === 'left' ? 200 : slot === 'right' ? -200 : 0;
    return direction === 'left'
      ? [center - 1152, 0]
      : direction === 'right'
        ? [center + 1152, 0]
        : direction === 'up'
          ? [0, 1072]
          : direction === 'down'
            ? [0, -1072]
            : [0, 0];
  }
  private executeCharacterAction(c: Command, done: () => void): void {
    const p = c.params,
      type = String(p.type ?? ''),
      name = String(p.name ?? 'left');
    const slot =
      type === 'exit'
        ? name === 'left'
          ? 'left'
          : name === 'right'
            ? 'right'
            : 'middle'
        : name === 'right'
          ? 'right'
          : name === 'middle'
            ? 'middle'
            : 'left';
    const parent = this.parentFor(slot),
      duration = Math.max(
        0,
        this.animationDuration(num(p, 'fadetime', ['exit', 'zoom'].includes(type) ? 1 : 0.5)),
      );
    const sequence: SlotSequence = {
      begin: this.time,
      end: this.time,
      locked: true,
      complete: false,
    };
    let valid = true;
    if (type === 'move' || (duration === 0 && ['jump', 'shake'].includes(type))) {
      this.slotTween(sequence, parent, 'x', parent.x + num(p, 'xpos', 0), duration, 0, 'outCubic');
      this.slotTween(sequence, parent, 'y', parent.y + num(p, 'ypos', 0), duration, 0, 'outCubic');
    } else if (type === 'exit') {
      const pos =
        p.xpos !== undefined && p.ypos !== undefined
          ? [Math.trunc(num(p, 'xpos', 0)), Math.trunc(num(p, 'ypos', 0))]
          : this.outsidePosition(slot, String(p.direction ?? 'left'));
      this.slotTween(sequence, parent, 'x', pos[0], duration, 0, 'outCubic');
      this.slotTween(sequence, parent, 'y', pos[1], duration, 0, 'outCubic');
    } else if (type === 'jump') {
      const target = { x: parent.x + num(p, 'xpos', 0), y: parent.y + num(p, 'ypos', 0) };
      let from:
        | {
            x: number;
            y: number;
          }
        | undefined;
      this.slotMotion(
        sequence,
        duration,
        0,
        (t) => {
          from ??= { x: parent.x, y: parent.y };
          const pos = jumpAt(
            t,
            num(p, 'times', 3),
            num(p, 'power', 10),
            target.x - from.x,
            target.y - from.y,
          );
          parent.x = from.x + pos.x;
          parent.y = from.y + pos.y;
        },
        parent,
      );
    } else if (type === 'shake') {
      const path = shakePath(
        duration,
        num(p, 'power', 10),
        0,
        Math.trunc(num(p, 'times', 3)),
        Math.trunc(num(p, 'random', 10)),
        true,
        Math.random,
        true,
      );
      let from:
        | {
            x: number;
            y: number;
          }
        | undefined;
      this.slotMotion(
        sequence,
        duration,
        0,
        (t) => {
          from ??= { x: parent.shakeX ?? 0, y: parent.shakeY ?? 0 };
          const pos = sampleShake(path, t * duration);
          parent.shakeX = from.x + pos.x;
          parent.shakeY = from.y + pos.y;
        },
        parent,
        true,
      );
    } else if (type === 'zoom') {
      const x = num(p, 'xpos', 0.5),
        y = num(p, 'ypos', 0.5),
        scale = num(p, 'scale', 1),
        v = this.characters.findLast((v) => v.slot === slot);
      valid = x >= 0 && x <= 1 && y >= 0 && y <= 1;
      if (valid && v) {
        const layout = this.pack.assets[v.key].layout;
        v.pivotX ??= layout?.pivot.x ?? 0.5;
        v.pivotY ??= layout?.pivot.y ?? 0.5;
        for (const [key, to] of [
          ['pivotX', x],
          ['pivotY', y],
          ['sx', scale / (layout?.scale.x ?? 1)],
          ['sy', scale / (layout?.scale.y ?? 1)],
        ] as const) {
          const from = v[key]!;
          this.slotTween(sequence, v, key, to, duration, 0);
          if (duration > 0) this.tweens.at(-1)!.from = from;
        }
      }
    } else valid = false;
    this.emit('character-action', { type, slot, duration, valid });
    if (valid && bool(p, 'isblock') && (duration > 0 || type === 'zoom'))
      this.later(duration, done);
    else done();
  }
  private slotTween(
    sequence: SlotSequence,
    owner: object,
    key: string,
    to: number,
    duration: number,
    delay: number,
    ease: Ease = 'linear',
  ): void {
    if (duration <= 0) {
      (owner as Record<string, number>)[key] = to;
      return;
    }
    // A started native Sequence cannot accept new children. Such tweens remain
    // independent autoplay tweens; Insert's delay is not applied to them.
    const begin = sequence.locked ? this.time : sequence.begin + Math.max(0, delay);
    this.tweens.push({
      owner,
      key,
      to,
      duration,
      begin,
      from: NaN,
      ease,
      sequence: sequence.locked ? undefined : sequence,
    });
    if (!sequence.locked) sequence.end = Math.max(sequence.end, begin + duration);
  }
  private slotMotion(
    sequence: SlotSequence,
    duration: number,
    delay: number,
    update: (t: number) => void,
    target?: SlotTransform,
    shake = false,
  ): void {
    if (duration <= 0) {
      update(1);
      return;
    }
    this.slotTween(sequence, { progress: 0 }, 'progress', 1, duration, delay);
    Object.assign(this.tweens.at(-1)!, { update, motionTarget: target, shake });
  }
  private applySlotFocus(apply: (actor: Visual, brightness: number) => void): void {
    for (const name of ['middle', 'left', 'right']) {
      const v = this.characters.findLast((v) => v.slot === name);
      if (!v) continue;
      apply(v, this.slotFocus.has(name) ? 1 : 0.5);
      if (this.slotFocus.has(name))
        this.characters = [
          ...this.characters.filter((v) => v.slot !== name),
          ...this.characters.filter((v) => v.slot === name),
        ];
    }
  }
  private executeSlot(c: Command, done: () => void): void {
    const p = c.params,
      aliases: Record<string, string> = {
        m: 'middle',
        middle: 'middle',
        l: 'left',
        left: 'left',
        r: 'right',
        right: 'right',
      };
    const rawSlot = String(p.slot ?? '').toLowerCase(),
      slot = aliases[rawSlot],
      duration = Math.max(0, this.animationDuration(num(p, 'duration', 0))),
      focusDuration = Math.max(0, this.animationDuration(num(p, 'focusduration', 0))),
      delay = num(p, 'delay', 0);
    if (!rawSlot) {
      this.tweens = this.tweens.filter((t) => !t.sequence && !t.shake);
      this.slotSequences.clear();
      for (const [name, parent] of this.slotTransforms) {
        parent.shakeX = parent.shakeY = 0;
        parent.sx = parent.sy = 1;
        const token = {};
        this.slotClears.set(name, token);
        const reset = () => {
          // Loading another image kills the old image's native completion
          // tween. Do not let that superseded clear reset the new image.
          if (this.slotClears.get(name) !== token) return;
          this.kill(parent);
          parent.x = parent.y = 0;
          parent.sx = parent.sy = 1;
          parent.shakeX = parent.shakeY = 0;
          this.slotClears.delete(name);
        };
        if (duration > 0) this.later(duration, reset);
        else reset();
      }
      for (const v of [...this.characters]) {
        this.kill(v);
        this.tween(v, 'alpha', 0, duration, () => {
          this.characters = this.characters.filter((x) => x !== v);
        });
      }
      this.emit('charslot-clear', { duration });
      if (bool(p, 'isblock') && duration > 0) this.later(duration, done);
      else done();
      return;
    }
    const focus = String(p.focus ?? '')
      .toLowerCase()
      .split(';')
      .filter(Boolean);
    // An empty string becomes ["all"] in _ExecuteCharslot before _ProcessFocusArray.
    this.slotFocus = new Set(
      !focus.length || focus.includes('all')
        ? ['middle', 'left', 'right']
        : focus.map((s) => aliases[s]).filter(Boolean),
    );
    if (!slot) {
      // _ProcessCharFocus runs before _GetSlotWithName. Nonempty "n"/"all"
      // have no image target and must not enter the empty-slot clear path.
      this.applySlotFocus((actor, brightness) => {
        actor.brightness = brightness;
      });
      this.emit('charslot-focus', { slot: rawSlot, focus: [...this.slotFocus] });
      done();
      return;
    }
    let sequence = this.slotSequences.get(slot);
    if (!sequence || sequence.complete) {
      sequence = { begin: this.time, end: this.time, locked: false, complete: false };
      this.slotSequences.set(slot, sequence);
    }
    const tw = (owner: object, key: string, to: number, d: number, ease: Ease = 'linear') =>
      this.slotTween(sequence, owner, key, to, d, delay, ease);
    let parent = this.slotTransforms.get(slot);
    if (!parent) {
      parent = { x: 0, y: 0, sx: 1, sy: 1 };
      this.slotTransforms.set(slot, parent);
    }
    // Adopt an existing legacy slot; both panels target the same native objects.
    for (const v of this.characters.filter((v) => v.slot === slot)) v.parent = parent;
    const key = assetKey(p.name);
    if (key) {
      this.slotClears.delete(slot);
      if (key !== 'char_empty') this.checkAsset(key);
      const previous = this.characters.findLast((v) => v.slot === slot);
      for (const stale of this.characters.filter((v) => v.slot === slot && v !== previous)) {
        this.kill(stale);
        this.characters = this.characters.filter((v) => v !== stale);
      }
      if (previous) {
        this.kill(previous);
        this.tween(previous, 'alpha', 0, duration, () => {
          this.characters = this.characters.filter((v) => v !== previous);
        });
      }
      if (key !== 'char_empty') {
        parent.sx = parent.sy = 1;
        let from = num(p, 'afrom', -1),
          to = num(p, 'ato', -1);
        if (from < 0 || to < 0) {
          from = 0;
          to = 1;
        }
        const next: Visual = {
          key,
          slot,
          x: slot === 'left' ? -200 : slot === 'right' ? 200 : 0,
          y: NATIVE.characterY,
          sx: 1,
          sy: 1,
          alpha: from,
          brightness: 1,
          parent,
          blackStart: num(p, 'bstart', 0),
          blackEnd: num(p, 'bend', 0),
          blackInverse: bool(p, 'inverse'),
        };
        if (bool(p, 'glitch')) {
          const name = String(p.matname ?? 'greenscreen_middle'),
            preset = this.pack.glitchPresets?.[name];
          if (!preset) throw Error('缺少原版立绘故障预设：' + name);
          next.glitch = copyGlitch(preset);
        }
        this.characters.push(next);
        tw(next, 'alpha', to, duration);
      }
    } else if (num(p, 'ato', -1) >= 0) {
      const v = this.characters.findLast((v) => v.slot === slot);
      if (v) {
        if (duration > 0) v.alpha = num(p, 'afrom', -1);
        tw(v, 'alpha', num(p, 'ato', -1), duration);
      }
    }
    this.applySlotFocus((actor, brightness) =>
      tw(actor, 'brightness', brightness, focusDuration, 'outQuad'),
    );
    const from = nativeVector(p.posfrom, 'posfrom'),
      to = nativeVector(p.posto, 'posto');
    const action = String(p.action ?? '');
    if (
      (!action && (from[0] - 1) ** 2 + (from[1] - 1) ** 2 >= 1e-10) ||
      action === 'shakemove' ||
      (action === 'jump' && duration <= 0)
    ) {
      parent.x = from[0];
      parent.y = from[1];
      tw(parent, 'x', to[0], duration, 'outCubic');
      tw(parent, 'y', to[1], duration, 'outCubic');
    }
    if (action === 'jump' && duration > 0) {
      const target = { x: parent.x + to[0], y: parent.y + to[1] };
      let start:
        | {
            x: number;
            y: number;
          }
        | undefined;
      this.slotMotion(
        sequence,
        duration,
        delay,
        (t) => {
          start ??= { x: parent.x, y: parent.y };
          const delta = jumpAt(
            t,
            num(p, 'times', 0),
            num(p, 'power', 0),
            target.x - start.x,
            target.y - start.y,
          );
          parent.x = start.x + delta.x;
          parent.y = start.y + delta.y;
        },
        parent,
      );
    }
    if ((action === 'shake' || action === 'shakemove') && duration > 0) {
      const path = shakePath(
        duration,
        num(p, 'power', 0),
        0,
        Math.trunc(num(p, 'times', 0)),
        Math.trunc(num(p, 'random', 10)),
        true,
        Math.random,
        true,
      );
      let start:
        | {
            x: number;
            y: number;
          }
        | undefined;
      const shakeSequence =
        action === 'shakemove'
          ? { begin: this.time, end: this.time, locked: true, complete: false }
          : sequence;
      this.slotMotion(
        shakeSequence,
        duration,
        delay,
        (t) => {
          start ??= { x: parent.shakeX ?? 0, y: parent.shakeY ?? 0 };
          const value = sampleShake(path, t * duration);
          parent.shakeX = start.x + value.x;
          parent.shakeY = start.y + value.y;
        },
        parent,
        true,
      );
    }
    if (action === 'zoom') {
      const pivot = nativeVector(p.poszoom, 'poszoom'),
        v = this.characters.findLast((v) => v.slot === slot);
      if (pivot.every((n) => n >= 0 && n <= 1)) {
        if (v) {
          const layout = this.pack.assets[v.key].layout;
          v.pivotX ??= layout?.pivot.x ?? 0.5;
          v.pivotY ??= layout?.pivot.y ?? 0.5;
          const zoomTween = (field: 'pivotX' | 'pivotY' | 'sx' | 'sy', to: number) => {
            // CharZoom's closure captures pivotStart/scaleStart at creation,
            // unlike a transform tween's deferred getter at first update.
            const from = v[field]!;
            tw(v, field, to, duration);
            if (duration > 0) this.tweens.at(-1)!.from = from;
          };
          zoomTween('pivotX', pivot[0]);
          zoomTween('pivotY', pivot[1]);
          zoomTween('sx', num(p, 'scale', 1) / (layout?.scale.x ?? 1));
          zoomTween('sy', num(p, 'scale', 1) / (layout?.scale.y ?? 1));
        } else this.slotMotion(sequence, duration, delay, () => {});
      }
    }
    if (p.x !== undefined) parent.x = num(p, 'x', parent.x);
    if (p.y !== undefined) parent.y = num(p, 'y', parent.y);
    if (p.xscale !== undefined) parent.sx = num(p, 'xscale', parent.sx);
    if (p.yscale !== undefined) parent.sy = num(p, 'yscale', parent.sy);
    const end = bool(p, 'end', true),
      blocking = end && bool(p, 'isblock');
    if (end)
      sequence.done = () => {
        sequence.complete = true;
        if (blocking) done();
      };
    this.emit('charslot', {
      slot,
      key,
      focus: [...this.slotFocus],
      duration,
      focusDuration,
      delay,
      blocking,
    });
    if (!blocking) done();
  }
  private hidePhotoItem(duration: number, done: () => void): void {
    const item = this.photoItem;
    if (!item) {
      done();
      return;
    }
    item.alpha = 1;
    this.tween(
      item,
      'alpha',
      0,
      duration,
      () => {
        this.photoItem = null;
        done();
      },
      'outQuad',
    );
  }
  private checkAsset(key: string): void {
    if (key && !this.pack.assets[key]) throw new Error(`缺少资源 ${key}`);
  }
  private visual(key: string, p: Record<string, unknown>): Visual {
    this.checkAsset(key);
    const asset = this.pack.assets[key],
      ppu = asset.pixelsPerUnit ?? 100;
    let width = (((asset.rect?.width ?? asset.width ?? 1280) * 100) / ppu) * num(p, 'width', 1),
      height = (((asset.rect?.height ?? asset.height ?? 720) * 100) / ppu) * num(p, 'height', 1);
    const adapt = String(p.screenadapt ?? '');
    if (adapt === 'fill') {
      width = 1280;
      height = 720;
    } else if (['width', 'height', 'showall', 'coverall'].includes(adapt)) {
      const ratio =
        adapt === 'width'
          ? 1280 / width
          : adapt === 'height'
            ? 720 / height
            : adapt === 'showall'
              ? Math.min(1280 / width, 720 / height)
              : Math.max(1280 / width, 720 / height);
      width *= ratio;
      height *= ratio;
    }
    const tiled = bool(p, 'tiled');
    if (tiled && (!asset.border || asset.border.some((v) => v !== 0)))
      throw Error('不支持此平铺图片边框：' + key);
    return {
      key,
      tiled,
      x: num(p, 'x', 0),
      y: num(p, 'y', 0),
      sx: num(p, 'xScale', 1),
      sy: num(p, 'yScale', 1),
      alpha: 0,
      brightness: 1,
      width,
      height,
    };
  }
  private changeImage(layer: 'background' | 'image', c: Command, done: () => void): void {
    const p = c.params,
      rawDuration = num(p, 'fadetime', 0),
      duration = this.animationDuration(rawDuration),
      key = assetKey(p.image);
    const previous = this[layer].at(-1);
    // Two-buffer native panel: old foreground stays behind the incoming image.
    for (const stale of this[layer].slice(0, -1)) this.kill(stale);
    this[layer] = previous ? [previous] : [];
    const blocking = bool(p, 'block') && rawDuration > 0;
    // Image's native block flag is decided before applying the ratio. Its zero
    // tween still completes on the following update when quick play removes the fade.
    const complete = () => {
      if (blocking) {
        if (duration === 0) this.later(0, done);
        else done();
      }
    };
    if (key) {
      const next = this.visual(key, p);
      this[layer].push(next);
      this.tween(next, 'alpha', 1, duration, () => {
        this[layer] = this[layer].filter((v) => v !== previous);
        complete();
      });
    } else if (previous)
      this.tween(previous, 'alpha', 0, duration, () => {
        this[layer] = this[layer].filter((v) => v !== previous);
        complete();
      });
    else if (blocking) this.later(duration, done);
    if (!blocking) done();
    this.emit('image', { layer, key, duration, blocking, x: num(p, 'x', 0), y: num(p, 'y', 0) });
  }
  private cgKey(p: Record<string, unknown>): string {
    const id = String(p.id ?? '');
    return id ? `${p.image ?? ''}_${id}` : String(p.image ?? '');
  }
  private removeCgItem(item: CgItem): void {
    this.kill(item);
    const index = this.cgItems.indexOf(item);
    if (index >= 0) this.cgItems.splice(index, 1);
    if (this.cgSlots.get(item.slotKey) === item) this.cgSlots.delete(item.slotKey);
    if (!this.cgSlots.has(item.slotKey)) this.focus.forget('cgitem:' + item.slotKey);
  }
  private showCgItem(p: Record<string, unknown>, done: () => void): void {
    const key = assetKey(p.image),
      slotKey = this.cgKey(p);
    this.checkAsset(key);
    const previous = this.cgSlots.get(slotKey);
    if (previous) this.removeCgItem(previous);
    const item: CgItem = {
      key,
      slotKey,
      rotationZ: 0,
      x: 0,
      y: 0,
      sx: 1,
      sy: 1,
      alpha: 1,
      groupAlpha: 1,
      brightness: 1,
      order: 170 + 10 * nativeInt(p.layer ?? 0),
    };
    const width = nativeInt(p.width ?? 0),
      height = nativeInt(p.height ?? 0);
    if (width > 0 && height > 0) {
      item.width = width;
      item.height = height;
    }
    this.cgItems.push(item);
    this.cgSlots.set(slotKey, item);
    const ease = nativeEase(p.ease) ?? 1;
    const motions: Tween[] = [];
    const animate = (
      field: 'x' | 'y' | 'sx' | 'sy' | 'alpha' | 'rotationZ',
      from: number,
      to: number,
      duration: number,
      delay: number,
    ) => {
      if (duration <= 1e-5) {
        item[field] = to;
        return;
      }
      item[field] = from;
      motions.push({
        owner: item,
        key: field,
        from,
        to,
        duration,
        ease,
        begin: this.time + Math.max(0, delay),
      });
    };
    if (p.pfrom && p.pto) {
      const point = (v: unknown) => {
        const a = String(v).split(',');
        return a.length === 2 ? a.map((n) => Number(n) || 0) : [0, 0];
      };
      const from = point(p.pfrom),
        to = point(p.pto);
      const duration = num(p, 'pduration', 0),
        delay = num(p, 'pdelay', 0);
      animate('x', from[0], to[0], duration, delay);
      animate('y', from[1], to[1], duration, delay);
    }
    const sf = num(p, 'sfrom', 1),
      st = num(p, 'sto', 1),
      af = num(p, 'afrom', 1),
      at = num(p, 'ato', 1);
    if (Math.abs(sf - st) > 1e-5)
      for (const field of ['sx', 'sy'] as const)
        animate(field, sf, st, num(p, 'sduration', 0), num(p, 'sdelay', 0));
    if (Math.abs(af - at) > 1e-5)
      animate('alpha', af, at, num(p, 'aduration', 0), num(p, 'adelay', 0));
    // AVGShowItemCgSlot.Show skips rotation when MathUtil.GT(rfrom, 0).
    const startAngle = num(p, 'rfrom', -1),
      endAngle = num(p, 'rto', 0),
      rotationTime = num(p, 'rduration', 0);
    if (startAngle <= 1e-5) {
      if (rotationTime <= 1e-5) item.rotationZ = endAngle;
      else {
        // DORotate uses RotateMode.Fast and takes the shortest turn to the target.
        let delta = (endAngle - startAngle) % 360;
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;
        animate('rotationZ', startAngle, startAngle + delta, rotationTime, 0);
      }
    }
    if (bool(p, 'block')) {
      if (motions.length) {
        const last = motions.reduce((a, b) =>
          a.begin + a.duration > b.begin + b.duration ? a : b,
        );
        last.done = done;
      } else this.later(0, done);
    } else done();
    this.tweens.push(...motions);
  }
  private hideCgItem(p: Record<string, unknown>, done: () => void): void {
    if (!this.cgSlots.size) {
      this.emit('hidecgitem', { empty: true });
      done();
      return;
    }
    const key = this.cgKey(p),
      item = this.cgSlots.get(key);
    const selected = key ? (item ? [item] : []) : [...this.cgSlots.values()];
    const block = bool(p, 'block');
    if (!selected.length) {
      done();
      return;
    }
    const duration = num(p, 'duration', num(p, 'fadetime', 0.13)),
      ease = nativeEase(p.ease) ?? 1;
    if (!key) this.cgSlots.clear();
    for (const slot of selected) {
      this.tweens.push({
        owner: slot,
        key: 'groupAlpha',
        from: slot.groupAlpha,
        to: 0,
        begin: this.time,
        duration,
        ease,
        done: () => {
          this.removeCgItem(slot);
          if (key && block) done();
        },
      });
    }
    if (!key || !block) done();
  }
  private execute(c: Command, done: () => void): void {
    const p = c.params;
    switch (c.name) {
      case 'theater': {
        this.theaterMode = bool(p, 'mode', true);
        if (this.theaterMode) {
          if (this.readerMode) this.readerPlayback.suspendForTheater();
          this.savedTheaterAuto = this.auto;
          this.savedTheaterQuick = this.quickPlay;
          this.quickPlay = false;
          this.auto = true;
        } else {
          this.autoWait = null;
          this.auto = this.savedTheaterAuto ?? false;
          this.quickPlay = this.savedTheaterQuick;
          this.savedTheaterQuick = false;
          this.savedTheaterAuto = null;
          if (this.readerMode) this.readerPlayback.restoreFromTheater();
        }
        this.refreshTypingSpeed();
        this.emit('theater', { mode: this.theaterMode });
        done();
        break;
      }
      case 'avgdisplay': {
        const id = String(p.id),
          name = assetKey(p.name),
          slot = String(p.slot).toLowerCase();
        const previous = this.displayHolders.get(id);
        if (String(p.style).toLowerCase() === 'animekv' && name) {
          const profile = this.pack.assets[name]?.animatedKV;
          if (!profile) throw new Error('动画 CG 资源未加载：' + name);
          const reuse =
            previous && 'kv' in previous && previous.slot === slot && previous.kv.key === name;
          if (previous && 'kv' in previous && !reuse) disposeAnimatedKV(previous.kv);
          if (previous) {
            if ('particles' in previous) previous.particles.dispose();
            else this.kill('kv' in previous ? previous.kv : previous);
          }
          const kv: AnimatedKV = reuse
            ? previous.kv
            : {
                profile,
                key: name,
                born: this.time,
                x: 0,
                y: 0,
                sx: 1,
                sy: 1,
                entry: 0,
                entryIndex: null,
              };
          this.displayHolders.set(
            id,
            reuse
              ? previous
              : { kv, slot, layer: nativeInt(p.layer ?? 1), order: this.holderOrder++ },
          );
          const duration = this.animationDuration(num(p, 'duration', 0)),
            ease = nativeEase(p.ease) ?? 1,
            blocking = bool(p, 'block');
          let pending = 0;
          const complete = () => {
            if (--pending === 0 && blocking) done();
          };
          const apply = (field: 'x' | 'y' | 'sx' | 'sy' | 'entry', from: number, to: number) => {
            if (duration <= 1e-5 || Math.abs(from - to) <= 1e-5) {
              kv[field] = to;
              return;
            }
            kv[field] = from;
            pending++;
            this.tween(kv, field, to, duration, complete, ease);
          };
          for (const [field, base] of [
            ['x', 'x'],
            ['y', 'y'],
            ['sx', 'scalex'],
            ['sy', 'scaley'],
          ] as const) {
            const from = num(p, base + 'from', num(p, base, kv[field]));
            apply(field, from, num(p, base + 'to', from));
          }
          if (p.entryfrom !== undefined || p.entryto !== undefined) {
            kv.entryIndex = nativeInt(p.entryindex ?? 0);
            if (!profile.entries[kv.entryIndex]) throw new Error('动画 CG 入场索引无效');
            apply('entry', num(p, 'entryfrom', 0), num(p, 'entryto', 0));
          }
          if (!blocking || !pending) done();
          break;
        }
        const image = String(p.style).toLowerCase() === 'bg' && !!name;
        const reuse = image && previous && 'key' in previous && previous.slot === slot;
        if (previous) {
          if ('kv' in previous) disposeAnimatedKV(previous.kv);
          if ('particles' in previous) previous.particles.dispose();
          else this.kill('kv' in previous ? previous.kv : previous);
          if (!reuse) this.displayHolders.delete(id);
        }
        if (image) {
          this.checkAsset(name);
          const holder = reuse
            ? previous
            : {
                key: name,
                alpha: 1,
                slot,
                layer: nativeInt(p.layer ?? 1),
                order: this.holderOrder++,
              };
          this.displayHolders.set(id, holder);
          const duration = this.animationDuration(num(p, 'duration', 0.1)),
            from = num(p, 'afrom', 1),
            to = num(p, 'ato', 0);
          if (duration > 1e-5) {
            if (Math.abs(from - to) <= 1e-5) holder.alpha = to;
            else {
              holder.alpha = from;
              const blocking = bool(p, 'block');
              this.tween(holder, 'alpha', to, duration, blocking ? done : undefined, 'outQuad');
              if (blocking) break;
            }
          }
        } else if (name) {
          const profile = this.pack.assets[name]?.profile;
          if (profile?.kind !== 'native-particles-v2')
            throw new Error('显示对象缺少粒子资源：' + name);
          const pose = { ...defaultEffectMotion, x: num(p, 'x', 0), y: num(p, 'y', 0) };
          const particles = new NativeParticles(profile, undefined, false, undefined, pose);
          this.displayHolders.set(id, {
            slot,
            particles,
            layer: nativeInt(p.layer ?? 1),
            born: this.time,
            order: this.holderOrder++,
          });
        }
        done();
        break;
      }
      case 'animtext': {
        this.historyMultiline = null;
        const profile = this.pack.assets[assetKey(p.name)]?.stamp;
        const text = stampParagraphs(this.translate(c.text));
        if (!profile || !text) throw new Error('动画字幕资源或分段无效');
        const pos = String(p.pos ?? '0,0')
          .split(',')
          .map(Number);
        this.stamps.push({
          profile,
          text,
          pos,
          born: this.time,
          id: String(p.id ?? ''),
          style: String(p.style ?? ''),
        });
        for (const paragraph of text)
          if (paragraph !== undefined)
            this.history.push({ name: '', text: paragraph, line: c.line });
        if (bool(p, 'block', false)) {
          const length = Math.max(
            ...profile.clips[profile.animation].map((track) => track.keys.at(-1)!.time),
          );
          this.later(length, done);
        } else done();
        break;
      }
      case 'animtextclean': {
        const id = String(p.id ?? '');
        if (!id) this.stamps.length = 0;
        else {
          const index = this.stamps.findIndex((stamp) => stamp.id === id);
          if (index >= 0) this.stamps.splice(index, 1);
        }
        done();
        break;
      }
      case 'charactercutin':
        this.cutins.execute(
          { ...p, fadetime: this.animationDuration(num(p, 'fadetime', 0.4)) },
          this.time,
          (key) => this.checkAsset(key),
          done,
        );
        break;
      case 'interlude': {
        const scaled = { ...p };
        // AVGCharacterCutinPanel._GenCutinParamWithCommand scales these four
        // authored fields. Template-owned intervals and fades remain unchanged.
        for (const key of ['duration', 'sduration', 'tsduration', 'aduration'])
          scaled[key] = this.animationDuration(num(p, key, 0));
        this.interludes.execute(
          scaled,
          this.time,
          this.pack.assets[assetKey(p.maskid)]?.interlude,
          (key) => this.checkAsset(key),
          done,
        );
        this.emit('interlude', { ...scaled });
        break;
      }
      case 'showitem': {
        const key = assetKey(p.image),
          duration = num(p, 'fadetime', 0.5);
        this.checkAsset(key);
        const show = () => {
          const item = {
            key,
            x: num(p, 'offsetx', 0),
            y: num(p, 'offsety', 0),
            black: num(p, 'black', 0.4),
            alpha: 0,
          };
          this.photoItem = item;
          this.tween(item, 'alpha', 1, duration, done, 'outQuad');
        };
        if (this.photoItem) this.hidePhotoItem(duration, show);
        else show();
        break;
      }
      case 'hideitem':
        this.hidePhotoItem(num(p, 'fadetime', 0.5), done);
        break;
      case 'cgitem':
        this.showCgItem(p, done);
        break;
      case 'hidecgitem':
        this.hideCgItem(p, done);
        break;
      case 'curtain': {
        const direction = Math.trunc(num(p, 'direction', -1));
        const command = {
          direction,
          from: num(p, 'fillfrom', 1),
          to: num(p, 'fillto', 0),
          duration: this.animationDuration(num(p, 'fadetime', 0.4)),
          delay: num(p, 'delay', 0),
          gradient: bool(p, 'grad'),
          block: bool(p, 'block'),
          alphaTo: -1,
          alphaFrom: undefined as number | undefined,
        };
        if (direction >= 0 && direction < 8) {
          command.alphaTo = num(p, 'a', -1);
          command.alphaFrom = num(p, 'afrom', this.curtains.states[direction].alpha);
          // The native executor converts these values but never applies RGB.
          for (const key of ['r', 'g', 'b', 'rfrom', 'gfrom', 'bfrom']) num(p, key, 0);
        }
        this.curtains.execute(command, this.time, done);
        this.emit('curtain', { ...command });
        break;
      }
      case 'imgeffect': {
        const name = assetKey(p.name),
          image = assetKey(p.image),
          layer = nativeInt(p.layer ?? 1);
        let profile;
        if (name) {
          this.checkAsset(name);
          this.checkAsset('imgfx:' + image);
          const original = this.pack.assets[name]?.profile,
            texture = this.pack.assets['imgfx:' + image]?.imageEffectTexture;
          if (original?.kind !== 'native-particles-v2' || !texture)
            throw Error('图像特效绑定资源未准备');
          profile = bindImageEffect(original, texture);
        }
        this.bgEffects.executeImage(
          name,
          layer,
          profile,
          this.time,
          num(p, 'x', 0),
          num(p, 'y', 0),
        );
        this.emit('imgeffect', { name, image, layer });
        done();
        break;
      }
      case 'effect': {
        const name = assetKey(p.name),
          flip = nativeInt(p.flip ?? 0),
          motion = {
            rotation: foregroundRotation(
              num(p, 'rox', 0),
              num(p, 'roy', 0),
              num(p, 'roz', 0),
              flip,
            ),
            x: num(p, 'x', 0),
            y: num(p, 'y', 0),
            flip,
            xto: nativeInt(p.xto ?? -1),
            yto: nativeInt(p.yto ?? -1),
            movedelay: num(p, 'movedelay', 0),
            movetime: num(p, 'movetime', 0),
          };
        this.bgEffects.executeTransient(
          name,
          nativeInt(p.layer ?? 0),
          num(p, 'delay', 0),
          num(p, 'duration', 0),
          this.pack.assets[name]?.profile,
          this.time,
          motion,
        );
        this.emit('effect', { name, ...p });
        done();
        break;
      }
      case 'bgeffect': {
        const name = assetKey(p.name),
          layer = Object.hasOwn(p, 'layer') ? nativeInt(p.layer) : -1,
          delay = name ? num(p, 'delay', 0) : 0,
          fade = num(p, 'fadetime', 0);
        if (name) this.checkAsset(name);
        const motion = name
          ? {
              x: num(p, 'x', 0),
              y: num(p, 'y', 0),
              flip: nativeInt(p.flip ?? 0),
              xto: nativeInt(p.xto ?? -1),
              yto: nativeInt(p.yto ?? -1),
              movedelay: num(p, 'movedelay', 0),
              movetime: num(p, 'movetime', 0),
            }
          : undefined;
        this.bgEffects.execute(
          name,
          layer,
          delay,
          fade,
          this.pack.assets[name]?.profile,
          this.time,
          bool(p, 'fade', false),
          motion,
        );
        this.emit('bgeffect', { name, layer, delay, fade, motion });
        done();
        break;
      }
      case 'focusparam': {
        const blur = bool(p, 'blur', true),
          effect = String(p.effect ?? '');
        this.focus.configure(blur, effect);
        this.emit('focusparam', { blur, effect });
        done();
        break;
      }
      case 'focusout': {
        const command = {
          type: String(p.type ?? ''),
          id: String(p.id ?? ''),
          from: num(p, 'from', -1),
          to: num(p, 'to', 0),
          duration: num(p, 'duration', 0),
          block: bool(p, 'block'),
        };
        this.focus.execute(command, this.time, done);
        this.emit('focusout', { ...command });
        break;
      }
      case 'timersticker': {
        this.timerSticker.show(
          num(p, 'x', 0),
          num(p, 'y', 0),
          num(p, 'width', 1280),
          nativeInt(p.size ?? 24),
          nativeInt(p.time ?? -1),
          num(p, 'afrom', 0),
          num(p, 'ato', 1),
          num(p, 'duration', 1),
          this.time,
          this.stickers.views.length,
        );
        done();
        break;
      }
      case 'timerclear':
        this.timerSticker.clear(num(p, 'duration', 0.13), this.time);
        done();
        break;
      case 'sticker': {
        this.historyMultiline = null;
        const text = this.translate(p.text),
          result = this.stickers.execute(p, text, this.time, this.readingSpeed.typeDelay);
        if (p.text && !bool(p, 'hidelog'))
          this.history.push({ name: '', text: readingMarkup(text)?.plain ?? text, line: c.line });
        this.emit('sticker', { ...p, text, ...result });
        if (result.block) this.stickerDone = done;
        else {
          this.stickers.finishCurrent();
          done();
        }
        break;
      }
      case 'stickerclear': {
        const block = this.stickers.clear(p, this.time);
        this.emit('sticker-clear', { block });
        if (block) this.stickerDone = done;
        else done();
        break;
      }
      case 'stickertween': {
        const block = this.stickers.tween(p, this.time, this.quickPlay || this.readerMode ? 0 : 1);
        this.emit('sticker-tween', { ...p, block });
        if (block) this.stickerDone = done;
        else done();
        break;
      }
      case 'header':
        done();
        break;
      case 'characteraction':
        this.executeCharacterAction(c, done);
        break;
      case 'cameraeffect': {
        const effect = String(p.effect ?? ''),
          duration = Math.max(0, this.animationDuration(num(p, 'fadetime', 0.4))),
          keep = bool(p, 'keep'),
          block = bool(p, 'block');
        if (effect === 'Grayscale') {
          const initial = num(p, 'initamount', -1);
          // Virtual DOTween.To captures its start value at creation and does
          // not kill other virtual grayscale tweens. Zero duration still ticks.
          this.tweens.push({
            owner: this.filters,
            key: 'grayscale',
            begin: this.time,
            duration,
            from: initial < 0 ? this.filters.grayscale : initial,
            to: num(p, 'amount', 1),
            ease: 'outQuad',
            done: () => {
              if (block) done();
              if (!keep) this.filters.grayscale = 0;
            },
          });
          if (!block) done();
        } else if (effect === 'Colorinverse') {
          this.filters.inverse = keep ? 1 : 0;
          done();
        } else if (effect === 'Chaos') {
          // The native implementation initializes its material presets on its
          // first active render. Disabling the channel preserves those presets.
          if (keep && !this.filters.chaosFrom) {
            this.filters.chaosFrom = String(p.from ?? '');
            this.filters.chaosTo = String(p.to ?? '');
          }
          this.tween(this.filters, 'chaos', keep ? 1 : 0, duration, undefined, 'smoothStep');
          done();
        } else done();
        this.emit('camera-effect', {
          effect,
          duration,
          keep,
          blocking: effect === 'Grayscale' && block,
        });
        break;
      }
      case 'camerashake': {
        // Native DOKill(complete:true) completes the previous shake before reset.
        this.cameraShake?.done?.();
        this.cameraShake = null;
        this.camera.x = this.camera.y = 0;
        const duration = this.animationDuration(num(p, 'duration', -1)),
          stop = bool(p, 'stop'),
          blocking = bool(p, 'block');
        if (!stop && duration !== 0) {
          this.cameraShake = {
            begin: this.time,
            loop: duration < 0,
            path: shakePath(
              Math.abs(duration),
              num(p, 'xstrength', 1),
              num(p, 'ystrength', 0),
              Math.trunc(num(p, 'vibrato', 10)),
              num(p, 'randomness', 90),
              bool(p, 'fadeout'),
            ),
            done: blocking ? done : undefined,
          };
        }
        this.emit('camera-shake', { duration, stop, blocking });
        if (stop || duration === 0 || !blocking) done();
        break;
      }
      case 'subtitle': {
        this.historyMultiline = null;
        const raw = this.translate(p.text),
          markup = readingMarkup(raw),
          text = markup?.plain ?? raw;
        const original = String(p.text ?? ''),
          logText = readingMarkup(original)?.plain ?? original;
        if (logText && !bool(p, 'hidelog'))
          this.history.push({ name: '', text: this.translate(logText), line: c.line });
        if (!raw) {
          this.subtitle.visible = false;
          this.tween(this.subtitle, 'alpha', 0, 0.15);
          this.emit('subtitle-hide');
          done();
          break;
        }
        const x = num(p, 'x', 0),
          y = num(p, 'y', 0);
        if (x < 0 || x > 1280 || y < 0 || y > 720) {
          this.emit('subtitle-rejected', { x, y });
          done();
          break;
        }
        const wasVisible = this.subtitle.visible;
        Object.assign(this.subtitle, {
          visible: true,
          text,
          markup,
          x,
          y,
          width: Math.min(num(p, 'width', 1280), 1280 - x),
          size: Math.trunc(num(p, 'size', 24)),
          alignment:
            p.alignment === 'center' ? 'center' : p.alignment === 'right' ? 'right' : 'left',
          revealed: 0,
          start: this.time,
          doneAt: null,
        });
        if (!wasVisible) this.tween(this.subtitle, 'alpha', 1, 0.15);
        this.subtitleDelay = this.readingSpeed.typeDelay;
        this.subtitleDone = done;
        this.emit('subtitle', { text, x, y });
        break;
      }
      case 'delay': {
        const seconds = this.animationDuration(num(p, 'time', 0));
        this.emit('wait', { seconds });
        this.later(seconds, done);
        break;
      }
      case 'background':
      case 'image':
        this.changeImage(c.name, c, done);
        break;
      case 'largebg':
      case 'verticalbg':
      case 'gridbg': {
        const duration = num(p, 'fadetime', 0);
        const blocking = duration > 1e-5 && bool(p, 'block');
        const show = gridGroup(p).names.length > 0;
        if (show) {
          this.kill(this.gridOffset);
          const layout =
            c.name === 'gridbg' ? gridLayout(p) : stripLayout(p, c.name === 'verticalbg');
          if (!layout) {
            this.grid.tiles = [];
            this.grid.alpha = 0;
            done();
            break;
          }
          for (const tile of layout.tiles) this.checkAsset(tile.key);
          Object.assign(this.grid, layout, { alpha: 0 });
          Object.assign(this.gridOffset, {
            x: num(p, 'x', 0),
            y: num(p, 'y', 0),
            sx: num(p, 'xScale', 1),
            sy: num(p, 'yScale', 1),
          });
        }
        this.tweens.push({
          owner: this.grid,
          key: 'alpha',
          from: this.grid.alpha,
          to: show ? 1 : 0,
          begin: this.time,
          duration,
          ease: 'linear',
          done: () => {
            if (!show) {
              this.grid.tiles = [];
              this.kill(this.gridOffset);
            }
            if (blocking) done();
          },
        });
        if (!blocking) done();
        break;
      }
      case 'largebgtween': {
        const duration = num(p, 'duration', 0),
          loop = bool(p, 'loop');
        const blocking = duration > 1e-5 && bool(p, 'block');
        const ease = nativeEase(p.ease);
        if (ease === null) throw new Error('未识别的大背景缓动');
        for (const [key, prefix] of [
          ['x', 'x'],
          ['y', 'y'],
          ['sx', 'xScale'],
          ['sy', 'yScale'],
        ] as const) {
          const current = this.gridOffset[key];
          const from = num(p, prefix + 'From', current),
            to = num(p, prefix + 'To', current);
          this.gridOffset[key] = duration <= 1e-5 ? to : from;
          if (duration > 1e-5)
            this.tweens.push({
              owner: this.gridOffset,
              key,
              from,
              to,
              ease,
              begin: this.time,
              duration,
              loop,
              done: key === 'y' && blocking ? done : undefined,
            });
        }
        if (!blocking) done();
        break;
      }
      case 'imagerotate': {
        // DOKill(false) invokes the previous OnKill callback; the replacement
        // also completes through OnKill after SetAutoKill(true), not OnComplete.
        this.kill(this.imageRotation);
        this.imageRotationDone?.();
        this.imageRotationDone = null;
        const duration = Math.max(0, this.animationDuration(num(p, 'fadetime', 0))),
          blocking = bool(p, 'block'),
          from = this.imageRotation.z;
        const delta = imageRotationDelta(
          from,
          num(p, 'angle', 0),
          bool(p, 'inverse'),
          nativeInt(p.circles ?? 0),
        );
        const finish = () => {
          if (this.imageRotationDone === finish) this.imageRotationDone = null;
          if (blocking) done();
        };
        this.imageRotationDone = finish;
        this.tweens.push({
          owner: this.imageRotation,
          key: 'z',
          begin: this.time,
          duration,
          from,
          to: from + delta,
          ease: 'linear',
          done: finish,
        });
        this.emit('image-rotation', { from, delta, duration, blocking });
        if (!blocking) done();
        break;
      }
      case 'imagetween':
      case 'backgroundtween': {
        const v = (c.name === 'imagetween' ? this.image : this.background).at(-1);
        const duration = num(p, 'duration', 0),
          blocking = bool(p, 'block') && duration > 0;
        const ease = nativeEase(p.ease),
          loop = bool(p, 'loop');
        if (ease === null) throw new Error('未识别的缓动');
        if (v) {
          for (const [field, prefix] of [
            ['x', 'x'],
            ['y', 'y'],
            ['sx', 'xScale'],
            ['sy', 'yScale'],
          ] as const) {
            v[field] = num(p, prefix + 'From', v[field]);
            const sequence: SlotSequence = {
              begin: this.time,
              end: this.time,
              locked: true,
              complete: false,
            };
            this.slotTween(sequence, v, field, num(p, prefix + 'To', v[field]), duration, 0, ease);
            if (duration > 0) this.tweens.at(-1)!.loop = loop;
          }
        }
        this.emit('camera-tween', { duration, blocking, fromTo: p });
        if (blocking) this.later(duration, done);
        else done();
        break;
      }
      case 'blocker': {
        const rawDuration = this.animationDuration(num(p, 'fadetime', NATIVE.blockerFade)),
          duration = Math.abs(rawDuration) <= 1e-5 ? 0 : rawDuration,
          blocking = bool(p, 'block') && duration > 0;
        const style = blockerStyle(p.style),
          inverse = bool(p, 'inverse');
        if (style) this.blocker.image = '';
        else if (assetKey(p.image)) {
          this.checkAsset(assetKey(p.image));
          this.blocker.image = assetKey(p.image);
        }
        // _GenTweenerWithParam is not called for zero duration. Material and
        // inverse axis state therefore persist in that branch, as in the client.
        if (Math.abs(duration) > 1e-5) {
          this.blocker.style = style;
          if (inverse && style === 1) this.blocker.flipX = true;
          if (inverse && style === 2) this.blocker.flipY = true;
        }
        for (const key of ['r', 'g', 'b', 'a'] as const) {
          this.blocker[key] = num(p, key + 'from', this.blocker[key]);
          // DOColor has no SetEase override here; serialized DOTweenSettings.defaultEaseType=6.
          this.tween(
            this.blocker,
            key,
            num(p, key, key === 'a' ? 1 : 0),
            duration,
            key === 'a' && duration > 0
              ? () => {
                  if (Math.abs(this.blocker.a) <= 1e-5) this.blocker.image = '';
                }
              : undefined,
            'outQuad',
          );
        }
        this.emit('blocker', {
          duration,
          blocking,
          target: { r: num(p, 'r', 0), g: num(p, 'g', 0), b: num(p, 'b', 0), a: num(p, 'a', 1) },
        });
        if (blocking) this.later(duration, done);
        else done();
        break;
      }
      case 'character': {
        const duration = this.animationDuration(num(p, 'fadetime', NATIVE.characterFade)),
          focus = num(p, 'focus', 0);
        const names = [assetKey(p.name), assetKey(p.name2)];
        const specs =
          names[0] && !names[1]
            ? [{ key: names[0], slot: 'middle', x: 0, focus: focus <= 1 }]
            : [
                { key: names[0], slot: 'left', x: -200, focus: focus <= 1 },
                { key: names[1], slot: 'right', x: 200, focus: focus === 0 || focus === 2 },
              ];
        const old = [...this.characters];
        for (const visual of old) this.kill(visual);
        this.characters = [];
        for (const spec of specs.filter((s) => s.key)) {
          this.checkAsset(spec.key);
          const slotPrevious = old.findLast((v) => v.slot === spec.slot);
          const sameCharacter =
            !!slotPrevious &&
            parseCharacterKey(slotPrevious.key).key === parseCharacterKey(spec.key).key;
          const slotDuration = sameCharacter ? 0 : duration;
          const previous = old.find((v) => v.slot === spec.slot && v.key === spec.key);
          const v: Visual = previous ?? {
            key: spec.key,
            slot: spec.slot,
            x: spec.x,
            y: NATIVE.characterY,
            sx: 1,
            sy: 1,
            alpha: 0,
            brightness: spec.focus ? 1 : 0.5,
          };
          if (!previous) {
            const suffix = spec.slot === 'right' ? '2' : '';
            v.blackStart = num(p, 'blackstart' + suffix, 0);
            v.blackEnd = num(p, 'blackend' + suffix, 0);
          }
          const parent = this.parentFor(spec.slot);
          this.slotClears.delete(spec.slot);
          if (!previous) {
            parent.x = parent.y = 0;
            parent.sx = parent.sy = 1;
          }
          v.parent = parent;
          const suffix = spec.slot === 'right' ? '2' : '',
            enter = String(p['enter' + suffix] ?? '');
          parent.sx = num(p, 'xscale' + suffix, 1);
          parent.sy = num(p, 'yscale' + suffix, 1);
          if (['left', 'right', 'up', 'down'].includes(enter)) {
            const px = spec.slot === 'right' ? 'xpos2' : 'xpos1',
              py = spec.slot === 'right' ? 'ypos2' : 'ypos1';
            const from =
              p[px] !== undefined && p[py] !== undefined
                ? [Math.trunc(num(p, px, 0)), Math.trunc(num(p, py, 0))]
                : this.outsidePosition(spec.slot, enter);
            parent.x = from[0];
            parent.y = from[1];
            this.tween(parent, 'x', 0, duration, undefined, 'outCubic');
            this.tween(parent, 'y', 0, duration, undefined, 'outCubic');
          }
          this.characters.push(v);
          this.tween(v, 'alpha', 1, slotDuration);
          this.tween(v, 'brightness', spec.focus ? NATIVE.focus : NATIVE.unfocus, slotDuration);
        }
        for (const v of old.filter((v) => !this.characters.includes(v))) {
          const replacement = this.characters.find((x) => x.slot === v.slot);
          const sameCharacter =
            !!replacement &&
            parseCharacterKey(replacement.key).key === parseCharacterKey(v.key).key;
          const stale = old.findLast((x) => x.slot === v.slot) !== v;
          if (stale || sameCharacter) continue;
          this.characters.unshift(v);
          this.tween(v, 'alpha', 0, duration, () => {
            this.characters = this.characters.filter((x) => x !== v);
          });
        }
        this.emit('character', { names, focus, duration, blocking: bool(p, 'isblock') });
        if (bool(p, 'isblock') && duration > 0) this.later(duration, done);
        else done();
        break;
      }
      case 'charslot':
        this.executeSlot(c, done);
        break;
      case 'glitchtween': {
        const aliases: Record<string, string> = {
          m: 'middle',
          middle: 'middle',
          l: 'left',
          left: 'left',
          r: 'right',
          right: 'right',
        };
        const slot = aliases[String(p.slot ?? '').toLowerCase()],
          v = slot ? this.characters.findLast((v) => v.slot === slot) : undefined;
        const name = String(p.glitchto ?? 'greenscreen_middle');
        if (!v || !name) {
          done();
          break;
        }
        const target = this.pack.glitchPresets?.[name];
        if (!target) throw Error('缺少原版立绘故障预设：' + name);
        // The command changes material fields, not the _Glich enable flag.
        // A non-glitch image still blocks until the material batch completes.
        const from = v.glitch ? copyGlitch(v.glitch) : undefined,
          duration = Math.max(0, this.animationDuration(num(p, 'duration', 0)));
        const clock = { progress: 0 };
        if (duration <= 0) {
          if (from) v.glitch = copyGlitch(target);
          this.later(0, done);
        } else
          this.tweens.push({
            owner: clock,
            key: 'progress',
            from: 0,
            to: 1,
            begin: this.time,
            duration,
            ease: 'linear',
            update: (t) => {
              if (from) v.glitch = interpolateGlitch(from, target, t);
            },
            done,
          });
        this.emit('glitchtween', { slot, name, duration });
        break;
      }
      case 'aside':
      case 'dialog': {
        this.historyMultiline = null;
        this.setDialogVisible(!!c.text);
        if (!c.text) {
          done();
          break;
        }
        this.multiline = false;
        this.multilineEnd = false;
        this.textDelay = this.readingSpeed.typeDelay;
        const raw = this.translate(c.text),
          markup = readingMarkup(raw),
          text = markup?.plain ?? raw;
        Object.assign(this.dialog, {
          name: c.name === 'aside' ? '' : this.translate(p.name),
          text,
          markup,
          segment: text,
          segmentMarkup: markup,
          canExpand: true,
          revealed: 0,
          start: this.time,
          doneAt: null,
        });
        this.host.layoutDialog?.(this.dialog);
        this.history.push({ name: this.dialog.name, text, line: c.line });
        this.waiting = done;
        this.emit('dialog', { name: this.dialog.name, text });
        break;
      }
      case 'multiline': {
        this.setDialogVisible(!!c.text);
        if (!c.text) {
          done();
          break;
        }
        const prefix = this.multiline ? this.dialog.text : '';
        const raw = this.translate(c.text);
        const markup = readingMarkup(
          (this.multiline ? (this.dialog.markup?.raw ?? prefix) : '') + raw,
        );
        const segment = readingMarkup(raw),
          text = segment?.plain ?? raw;
        this.multiline = true;
        this.multilineEnd = bool(p, 'end');
        this.textDelay = Math.max(
          0,
          (num(p, 'delay', this.readingSpeed.typeDelay) / NATIVE.typeDelay) *
            this.readingSpeed.typeDelay,
        );
        Object.assign(this.dialog, {
          name: this.translate(p.name),
          text: markup?.plain ?? prefix + text,
          markup,
          segment: text,
          segmentMarkup: segment,
          canExpand: true,
          revealed: prefix.length,
          start: this.time - prefix.length * this.textDelay,
          doneAt: null,
        });
        this.host.layoutDialog?.(this.dialog);
        if (this.historyMultiline) this.historyMultiline.text += text;
        else {
          this.historyMultiline = { name: this.dialog.name, text, line: c.line };
          this.history.push(this.historyMultiline);
        }
        if (this.multilineEnd) this.historyMultiline = null;
        this.waiting = done;
        this.emit('multiline', {
          append: text,
          prefixLength: prefix.length,
          end: this.multilineEnd,
        });
        break;
      }
      case 'decision':
        this.historyMultiline = null;
        this.scheduler.predicator.beginDecision();
        // PlaybackPanel._ExecuteDecision adds the options as one cell. The
        // first predicate after selection formats that existing cell in place.
        if (p.options) {
          const options = this.translate(p.options);
          this.history.push({
            name: '',
            text: readingMarkup(options)?.plain ?? options,
            line: c.line,
          });
        }
        this.choices = decisionButtons(p.options, p.values).map((button) => ({
          ...button,
          text: this.translate(button.text),
        }));
        this.decisionDone = done;
        this.emit('choices', { options: this.choices });
        if (this.quickPlay && this.skipQuickDecisions && this.choices.length) this.choose(0);
        break;
      case 'usewhiteloadingmaskonfinish':
        this.whiteOnFinish = true;
        done();
        break;
      case 'spellsticker': {
        const id = String(p.id ?? '');
        if (!id) {
          done();
          break;
        }
        const hide = String(p.action ?? 'show').toLowerCase() === 'hide',
          style = String(p.style ?? 'sami').toLowerCase();
        let duration = 0;
        if (hide) this.spells.hide(id);
        else {
          const profile = this.pack.assets['sticker_' + style + '_fx_spell']?.animatedKV;
          if (!profile) throw Error('缺少原版咒文贴字 ' + style);
          duration = this.spells.show(id, style, profile, this.translate(c.text), p, this.time);
        }
        this.emit('spell-sticker', { id, style, hide, duration });
        if (bool(p, 'block')) {
          this.spells.current = hide ? null : id;
          this.spellClearDone = done;
          this.autoWait = {
            deadline: null,
            duration: duration > 0 ? duration : this.readingSpeed.base,
          };
        } else done();
        break;
      }
      case 'spellstickerclear':
        this.emit('spell-clear', { count: this.spells.views.size });
        this.spells.clear();
        if (bool(p, 'block')) {
          this.spellClearDone = done;
          this.raiseAutoClick(0);
        } else done();
        break;
      case 'skipnode':
        this.firstReadLocked = this.skipNodes.shift()?.firstReadLocked ?? false;
        done();
        break;
      case 'skiptothis':
        done();
        break; // A preprocessing marker, no native executor.
      case 'startbattle':
      case 'gotopage':
      case 'tutorial':
        this.hostCommands.execute(c, done);
        this.emit('host-command', { name: c.name, waiting: this.hostCommands.waiting });
        break;
      case 'video': {
        const key = String(p.res ?? '').toLowerCase(),
          asset = this.pack.assets[key],
          port = this.host.video;
        if (!port || asset?.kind !== 'video') throw Error('未准备剧情影片：' + key);
        if (this.video) this.kill(this.video);
        const view: {
          key: string;
          alpha: number;
          phase: 'preparing' | 'playing' | 'finished';
        } = { key, alpha: 0, phase: 'preparing' };
        this.video = view;
        const hold = num(p, 'fadeoutdelay', 0);
        port.play(
          asset.url,
          () => {
            if (this.video !== view || view.phase !== 'preparing') return;
            view.phase = 'playing';
            this.tween(view, 'alpha', 1, 0.23);
            this.emit('video-playing', { key });
          },
          (error) => {
            if (this.video !== view || view.phase === 'finished') return;
            view.phase = 'finished';
            this.emit(error ? 'video-error' : 'video-ended', { key, error });
            if (error) {
              this.error = `影片播放失败：${error}`;
              this.setPaused(true);
              port.close();
              this.video = null;
              return;
            }
            this.later(0, () => {
              if (this.video !== view) return;
              done();
              this.later(hold, () => {
                if (this.video !== view) return;
                this.tween(view, 'alpha', 0, 0.23, () => {
                  if (this.video === view) {
                    port.close();
                    this.video = null;
                  }
                });
              });
            });
          },
        );
        break;
      }
      case 'label':
        done();
        break;
      case 'warp': {
        const target = this.scheduler.warp(p.name);
        this.emit('warp', { name: p.name, targetIndex: target });
        done();
        break;
      }
      case 'predicate': {
        this.historyMultiline = null;
        const cell = this.history.at(-1);
        if (cell && this.playbackOption >= 0) {
          cell.decisionIndex = this.playbackOption;
          this.playbackOption = -1;
        }
        this.scheduler.predicator.setPredicate(
          p.references === undefined ? undefined : String(p.references),
        );
        done();
        break;
      }
      case 'playmusic': {
        const intro = assetKey(p.intro),
          loop = assetKey(p.key),
          volume = num(p, 'volume', 1),
          delay = num(p, 'delay', 0),
          fade = num(p, 'crossfade', 0.4);
        // Native LoadMusic rejects the whole intro/loop pair when a requested
        // clip is absent. Undefined script aliases are empty native lookups,
        // not download failures; do not replace them or stop the current BGM.
        const unresolved = [intro, loop].filter(
          (key) => key && this.pack.unresolvedMusicKeys?.includes(key) && !this.pack.assets[key],
        );
        if (unresolved.length) {
          this.emit('music-unresolved', { intro, loop, keys: unresolved });
          done();
          break;
        }
        this.checkAsset(intro);
        this.checkAsset(loop);
        this.audio.music(intro, loop, volume, delay, fade);
        this.emit('music', { intro, loop, volume, delay, fade });
        done();
        break;
      }
      case 'stopmusic': {
        const fade = num(p, 'fadetime', 0);
        this.audio.stopMusic(fade);
        this.emit('music-stop', { fade });
        done();
        break;
      }
      case 'stopsound': {
        const channel = String(p.channel ?? p.key ?? ''),
          fade = num(p, 'fadetime', 0);
        this.audio.stopSound(channel, fade);
        this.emit('sound-stop', { channel, fade });
        done();
        break;
      }
      case 'musicvolume': {
        const volume = num(p, 'volume', 1),
          fade = num(p, 'fadetime', 0);
        this.audio.musicVolume(volume, fade);
        this.emit('music-volume', { volume, fade });
        done();
        break;
      }
      case 'soundvolume': {
        const channel = String(p.channel ?? ''),
          volume = num(p, 'volume', 1),
          fade = num(p, 'fadetime', 0);
        this.audio.soundVolume(channel, volume, fade);
        this.emit('sound-volume', { channel, volume, fade });
        done();
        break;
      }
      case 'playsound': {
        const key = assetKey(p.key),
          channel = String(p.channel ?? p.key ?? ''),
          volume = num(p, 'volume', 1),
          delay = num(p, 'delay', 0),
          loop = bool(p, 'loop');
        // CommonExecutors._ExecutePlaySoundCommand: Reader and Pure omit
        // non-looping sounds before loading/playing them; music is unaffected.
        if (this.readerMode && !loop) {
          this.emit('reader-sound-omitted', { key, channel });
          done();
          break;
        }
        if (this.pack.unresolvedSoundKeys?.includes(key) && !this.pack.assets[key]) {
          this.emit('sound-unresolved', { key, channel });
          done();
          break;
        }
        this.checkAsset(key);
        this.audio.sound(key, channel, volume, delay, loop);
        this.emit('sound', { key, channel, volume, delay, loop });
        done();
        break;
      }
      case 'endtip':
        this.auto = false;
        this.quickPlay = false;
        this.dialog.visible = false;
        this.choices = [];
        this.endDone = done;
        this.emit('endtip');
        break;
      default:
        throw new Error(`未实现 ${c.name}`);
    }
  }
  tick(delta: number): void {
    if (this.paused || this.finished || this.error) return;
    this.time += Math.max(0, delta);
    try {
      this.curtains.update(this.time);
      for (const holder of this.displayHolders.values())
        if ('particles' in holder) holder.particles.update(this.time - holder.born);
      this.focus.update(this.time);
      this.bgEffects.update(this.time);
      this.stickers.update(this.time);
      this.timerSticker.update(this.time);
      this.interludes.update(this.time);
      this.cutins.update(this.time);
      for (const t of [...this.tweens]) {
        if (!this.tweens.includes(t)) continue;
        if (this.time < t.begin) continue;
        if (Number.isNaN(t.from)) t.from = (t.owner as Record<string, number>)[t.key];
        const elapsed = this.time - t.begin;
        const ratio =
          t.duration <= 0
            ? 1
            : t.loop
              ? elapsed === 0
                ? 0
                : (elapsed % t.duration || t.duration) / t.duration
              : Math.min(1, Math.max(0, elapsed / t.duration));
        const eased = easeAt(t.ease, ratio);
        (t.owner as Record<string, number>)[t.key] = t.from + (t.to - t.from) * eased;
        t.update?.(eased);
        if (ratio >= 1 && !t.loop) {
          this.tweens = this.tweens.filter((x) => x !== t);
          t.done?.();
        }
      }
      for (const seq of this.slotSequences.values()) {
        seq.locked = true;
        if (!seq.complete && this.time >= seq.end && seq.done) {
          const done = seq.done;
          seq.done = undefined;
          done();
        }
      }
      for (const holder of this.displayHolders.values())
        if ('kv' in holder) updateAnimatedKV(holder.kv, this.time);
      this.spells.update(this.time);
      if (this.cameraShake) {
        const shake = this.cameraShake,
          elapsed = this.time - shake.begin;
        Object.assign(
          this.camera,
          sampleShake(shake.path, shake.loop ? elapsed % shake.path.duration : elapsed),
        );
        if (!shake.loop && elapsed >= shake.path.duration) {
          this.cameraShake = null;
          shake.done?.();
        }
      }
      const due = this.timers.filter((t) => t.at <= this.time);
      this.timers = this.timers.filter((t) => t.at > this.time);
      for (const timer of due) timer.done();
      if (this.waiting) {
        this.dialog.revealed =
          this.textDelay <= 0
            ? this.dialog.text.length
            : Math.max(
                this.dialog.revealed,
                Math.min(
                  this.dialog.text.length,
                  Math.floor((this.time - this.dialog.start) / this.textDelay),
                ),
              );
        if (this.dialog.revealed >= this.dialog.text.length && this.dialog.doneAt === null) {
          this.dialog.doneAt = this.time;
          this.raiseAutoClick(this.dialog.markup?.raw.length ?? this.dialog.text.length);
        }
      }
      if (this.subtitleDone) {
        this.subtitle.revealed = Math.max(
          this.subtitle.revealed,
          Math.min(
            this.subtitle.text.length,
            Math.floor((this.time - this.subtitle.start) / this.subtitleDelay),
          ),
        );
        if (this.subtitle.revealed >= this.subtitle.text.length && this.subtitle.doneAt === null) {
          this.subtitle.doneAt = this.time;
          this.raiseAutoClick(this.subtitle.markup?.raw.length ?? this.subtitle.text.length);
        }
      }
      if (this.autoWait && this.auto) {
        if (this.autoWait.deadline === null)
          this.autoWait.deadline = this.time + this.autoWait.duration;
        else if (this.time >= this.autoWait.deadline) {
          this.autoWait = null;
          this.advance();
        }
      }
      if (this.readerPlayback.tick(delta)) this.advance();
      this.scheduler.tick();
      // The final EndTip waits for a dismissal after all story content has played.
      if (this.atFinalEndTip) this.viewingProgress.finish();
      else this.viewingProgress.observe(this.scheduler.index);
      if (this.scheduler.ended && !this.finished) {
        if (this.scheduler.index >= this.scheduler.commands.length) this.viewingProgress.finish();
        this.readerPlayback.reset();
        this.finished = true;
        this.host.video?.close();
        this.video = null;
        this.photoItem = null;
        for (const item of [...this.cgItems]) this.removeCgItem(item);
        this.grid.tiles = [];
        this.kill(this.gridOffset);
        this.kill(this.grid);
        this.audio.stop();
        this.clearDisplayables();
        this.bgEffects.dispose();
        this.stickers.dispose();
        this.timerSticker.dispose();
        this.interludes.dispose();
        this.cutins.dispose();
        this.finishMask = this.whiteOnFinish ? 'loading_white' : null;
        this.emit('finished', { mask: this.finishMask });
      }
    } catch (error) {
      this.error = String(error);
      this.audio.stop();
      this.emit('error', { message: this.error });
    }
  }
  /** AVGController.OnClickPress: cancel auto before broadcasting ON_CLICK.
   * Theater suppresses this user event; automatic clicks still use advance(). */
  pressAdvance(): void {
    if (this.paused || this.finished || this.theaterMode) return;
    this.readerPlayback.stopAuto();
    this.setAuto(false);
    this.emit('manual-press');
    this.advance();
    if (
      this.quickClickRecord.press(Date.now()) &&
      !this.tutorialRestricted &&
      this.story.isAutoable &&
      !this.readerMode
    )
      this.onQuickClickNotice?.();
  }
  advance(): void {
    if (this.paused || this.choices.length || this.finished) return;
    // Both components receive ON_CLICK; neither may consume it exclusively.
    if (this.readerDone) {
      const done = this.readerDone;
      this.readerDone = null;
      this.readerPlayback.waitingForInput = false;
      this.readerPlayback.stopClick();
      this.later(0, done);
    }
    if (this.spellClearDone) {
      this.spells.advance();
      const done = this.spellClearDone;
      this.spellClearDone = null;
      this.autoWait = null;
      this.later(0, done);
      return;
    }
    if (this.endDone) {
      const done = this.endDone;
      this.endDone = null;
      done();
      this.tick(0);
      return;
    }
    if (this.stickerDone) {
      if (this.stickers.current?.typing) {
        this.stickers.finishCurrent();
        this.emit('reveal-sticker');
      } else {
        const done = this.stickerDone;
        this.stickerDone = null;
        this.stickers.finishCurrent();
        this.autoWait = null;
        this.emit('advance-sticker');
        this.later(0, done);
      }
      return;
    }
    if (this.subtitleDone) {
      if (this.subtitle.revealed < this.subtitle.text.length) {
        this.subtitle.revealed = this.subtitle.text.length;
        this.subtitle.start = this.time - this.subtitle.text.length * this.subtitleDelay;
        this.subtitle.doneAt = this.time;
        this.raiseAutoClick(this.subtitle.markup?.raw.length ?? this.subtitle.text.length);
        this.emit('reveal');
      } else {
        this.autoWait = null;
        const done = this.subtitleDone;
        this.subtitleDone = null;
        this.emit('advance');
        this.later(0, done);
      }
      return;
    }
    if (!this.waiting) return;
    if (this.dialog.revealed < this.dialog.text.length) {
      this.dialog.revealed = this.dialog.text.length;
      this.dialog.start = this.time - this.dialog.text.length * this.textDelay;
      this.dialog.doneAt = this.time;
      this.raiseAutoClick(this.dialog.markup?.raw.length ?? this.dialog.text.length);
      this.emit('reveal');
    } else {
      this.autoWait = null;
      const done = this.waiting;
      this.waiting = null;
      this.emit('advance');
      this.later(0, done);
    }
    if (this.multilineEnd) this.multiline = false;
  }
  choose(index: number): void {
    const choice = this.choices[index];
    if (!choice || !this.decisionDone || this.paused) return;
    const line = this.scheduler.currentDecision?.line ?? 0;
    this.playbackActions.push({ step: this.playbackStep, kind: 'choice', index });
    this.scheduler.predicator.select(choice.value, index, line);
    this.emit('choice', { index, value: choice.value });
    this.playbackOption = index;
    this.choices = [];
    if (this.readerMode) this.reader.updateDecision(line, index);
    if (this.readerDecisionDone) {
      const done = this.readerDecisionDone;
      this.readerDecisionDone = null;
      this.later(0, done);
    }
    const done = this.decisionDone;
    this.decisionDone = null;
    done();
  }
  private raiseAutoClick(length: number): void {
    const { base, perChar } = this.readingSpeed;
    this.autoWait = { deadline: null, duration: base + length * perChar };
  }
  private refreshTypingSpeed() {
    const delay = this.readingSpeed.typeDelay;
    // The original setter leaves accumulated seconds in the typewriter buffer.
    // Moving the time origin preserves both the visible prefix and that remainder.
    if (this.waiting && this.dialog.doneAt === null)
      this.dialog.start += this.dialog.revealed * (this.textDelay - delay);
    if (this.subtitleDone && this.subtitle.doneAt === null)
      this.subtitle.start += this.subtitle.revealed * (this.subtitleDelay - delay);
    this.textDelay = this.subtitleDelay = delay;
    const sticker = this.stickers.current;
    if (sticker && !sticker.hidden) sticker.delay = delay;
  }
  setReaderMode(enabled: boolean): boolean {
    if (enabled === this.readerMode) return true;
    if (enabled && !this.canRead) return false;
    if (enabled) {
      this.readerQuickCache ??= this.quickSpeed;
      this.readerPlayback.active = true;
      this.quickSpeed = 3;
      this.pauseAuto();
      this.reader.opened(this.scheduler.predicator.selectedIndexes);
    } else {
      this.readerPlayback.active = false;
      this.readerPlayback.reset();
      if (this.readerQuickCache !== null) this.quickSpeed = this.readerQuickCache;
      this.readerQuickCache = null;
      this.quickPlay = false;
      this.auto = false;
    }
    this.refreshTypingSpeed();
    this.emit('reader-mode', { enabled, pure: this.readerPlayback.pure });
    return true;
  }
  setDialogPreset(id: number): void {
    const preset = dialogPresets.find((p) => p.id === id),
      d = this.dialog;
    if (!preset || preset === d.preset) return;
    d.preset = preset;
    d.messageWidth = 735;
    // RefreshCurrentLayout uses the populated Text and does not run the width
    // expansion command. StopTypingSilently finishes the reveal without a type-end event.
    d.segment = d.text;
    d.segmentMarkup = d.markup;
    d.canExpand = false;
    if (this.waiting && d.doneAt === null) {
      d.revealed = d.text.length;
      d.start = this.time - d.text.length * this.textDelay;
      d.doneAt = this.time;
    }
    this.emit('dialog-preset', { id });
  }
  cycleAutoSpeed(): void {
    if (!this.auto || this.quickPlay || this.theaterMode || this.finished) return;
    this.buttonSpeed = (this.buttonSpeed + 1) % buttonAutoSpeeds.length;
    this.refreshTypingSpeed();
    this.emit('auto-speed', { index: this.buttonSpeed });
  }
  setAuto(enabled: boolean): void {
    if (this.theaterMode) return;
    if (enabled) this.cancelledQuickResume = false;
    const next = enabled && this.story.isAutoable && !this.finished;
    if (this.auto === next && !this.quickPlay) return;
    this.quickPlay = false;
    this.auto = next;
    this.refreshTypingSpeed();
  }
  setQuickSpeed(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= quickSpeeds.length) return;
    this.quickSpeed = index;
    this.refreshTypingSpeed();
    this.emit('quick-speed', { index });
  }
  beginQuickPlay(): boolean {
    if (!this.canQuickPlay) return false;
    if (this.quickPlay) return true;
    this.quickPlay = true;
    this.cancelledQuickResume = false;
    this.auto = true;
    this.emit('quick-start', { index: this.quickSpeed });
    this.advance();
    this.refreshTypingSpeed();
    return true;
  }
  endQuickPlay(): void {
    if (this.savedTheaterQuick) {
      this.savedTheaterQuick = false;
      this.savedTheaterAuto = false;
    }
    if (this.pausedQuick) {
      this.pausedQuick = false;
      this.cancelledQuickResume = true;
    }
    if (!this.quickPlay) return;
    this.quickPlay = false;
    this.auto = false;
    this.refreshTypingSpeed();
    this.emit('quick-stop');
  }
  pauseAuto(): boolean {
    const was = this.auto;
    this.cancelledQuickResume = false;
    this.pausedQuick = this.quickPlay;
    if (was) {
      this.quickPlay = false;
      this.auto = false;
      this.autoWait = null;
      this.refreshTypingSpeed();
    }
    return was;
  }
  resumeAuto(): void {
    if (this.cancelledQuickResume) {
      this.cancelledQuickResume = false;
      return;
    }
    if (this.theaterMode) {
      this.auto = true;
      this.refreshTypingSpeed();
    } else if (this.pausedQuick) {
      this.quickPlay = true;
      this.auto = true;
      this.advance();
      this.refreshTypingSpeed();
    } else this.setAuto(true);
    this.pausedQuick = false;
    if (this.auto) this.advance();
  }
  receiveHostSignal(command: 'tutorial' | 'gotopage', signal: string): boolean {
    if (this.finished || this.error) return false;
    const accepted = this.hostCommands.signal(command, signal);
    if (accepted)
      this.playbackActions.push({ step: this.playbackStep, kind: 'signal', command, signal });
    this.emit('host-signal', { command, signal, accepted });
    return accepted;
  }
  private resetSkipPresentation(interrupt = true): void {
    // DialogPanel.ShouldResetOnSkip is false. Force-end only happens when the
    // controller jumps forward, not when a SkipToThis has already been passed.
    if (interrupt) {
      if (this.waiting) {
        this.dialog.revealed = this.dialog.text.length;
        this.dialog.doneAt = this.time;
      }
      this.waiting = null;
      this.decisionDone = null;
      this.choices = [];
      this.spellClearDone = null;
      this.endDone = null;
      this.subtitleDone = null;
      this.stickerDone = null;
    }
    this.autoWait = null;
    this.subtitle.visible = false;
    this.subtitle.alpha = 0;
    this.kill(this.subtitle);
    this.history.length = 0;
    this.historyMultiline = null;
    this.cutins.dispose();
    this.stickers.dispose();
    this.timerSticker.dispose();
    this.spells.clear();
    if (this.video) {
      this.kill(this.video);
      this.host.video?.close();
      this.video = null;
    }
  }
  get canSkip(): boolean {
    return (
      !this.skipLandingReached &&
      !(this.host.firstRead && this.firstReadLocked) &&
      this.story.isSkippable &&
      !this.finished &&
      !this.error
    );
  }
  skip(): boolean {
    if (!this.canSkip) return false;
    this.playbackActions.push({ step: this.playbackStep, kind: 'skip' });
    this.viewingProgress.observe(this.scheduler.index);
    if (this.skipToIndex >= 0) {
      // AVGController.SkipStory gives the first SkipToThis priority over skipnode.
      // Once already past it, do not interrupt a host wait or rewind the script.
      const interrupt = this.scheduler.index < this.skipToIndex;
      if (interrupt) {
        this.viewingProgress.jump(this.skipToIndex + 1);
        this.commandEpoch++;
        this.playbackOption = -1;
        this.hostCommands.cancel();
        this.scheduler.resumeAfter(this.skipToIndex);
      }
      this.auto = false;
      this.quickPlay = false;
      this.skipLandingReached = true;
      this.skipNodes.length = 0;
      this.firstReadLocked = false;
      this.resetSkipPresentation(interrupt);
      this.emit('skip-to-marker', { index: this.skipToIndex });
      return true;
    }
    const node = this.skipNodes.shift();
    this.firstReadLocked = node?.firstReadLocked ?? false;
    if (node && this.host.firstRead && node.firstReadLocked) {
      this.viewingProgress.jump(node.index + 1);
      this.commandEpoch++;
      this.playbackOption = -1;
      this.scheduler.resumeAfter(node.index);
      this.hostCommands.cancel();
      this.resetSkipPresentation();
      this.emit('skip-to-node', { index: node.index });
      return true;
    }
    this.viewingProgress.jump(this.scheduler.commands.length);
    this.dispose();
    this.auto = false;
    this.finished = true;
    this.choices = [];
    this.waiting = null;
    this.decisionDone = null;
    this.endDone = null;
    this.subtitleDone = null;
    this.stickerDone = null;
    this.dialog.visible = false;
    this.dialog.alpha = 0;
    this.subtitle.visible = false;
    this.subtitle.alpha = 0;
    this.finishMask = this.whiteOnFinish ? 'loading_white' : null;
    this.emit('skipped');
    this.emit('finished', { reason: 'Skipped', mask: this.finishMask });
    return true;
  }
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.audio.pause(paused);
    this.host.video?.pause(paused);
    this.emit(paused ? 'pause' : 'resume');
  }
  get atEnd(): boolean {
    return !!this.endDone;
  }
  private get atFinalEndTip(): boolean {
    return this.atEnd && this.scheduler.index === this.scheduler.commands.length - 1;
  }
  dispose(): void {
    this.readerPlayback.reset();
    this.quickPlay = false;
    this.hostCommands.cancel();
    this.commandEpoch++;
    this.spellClearDone = null;
    this.video = null;
    this.host.video?.close();
    this.photoItem = null;
    for (const item of [...this.cgItems]) this.removeCgItem(item);
    this.grid.tiles = [];
    this.autoWait = null;
    this.scheduler.stop();
    this.curtains.dispose();
    this.focus.dispose();
    this.clearDisplayables();
    this.bgEffects.dispose();
    this.stickers.dispose();
    this.timerSticker.dispose();
    this.interludes.dispose();
    this.cutins.dispose();
    this.stickerDone = null;
    this.imageRotationDone = null;
    this.tweens = [];
    this.timers = [];
    this.slotSequences.clear();
    this.slotClears.clear();
    this.cameraShake = null;
    this.audio.stop();
  }
}
