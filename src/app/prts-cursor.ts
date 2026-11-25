import { playerMediaUrl } from '../player/package-source';
import { sampleKeys, type CurveKey } from '../player/particle-math';
import { topNativeDialog } from '../player/native-dialogs';
import './prts-cursor.css';

interface CursorNode {
  path: string;
  parent: string | null;
  active: boolean;
  anchorMin: number[];
  anchorMax: number[];
  position: number[];
  size: number[];
  pivot: number[];
  scale: number[];
  rotation: number;
  sprite?: string;
  color?: number[];
}
interface Track {
  path: string;
  property: 'scale' | 'rotation' | 'position';
  axis: 'x' | 'y' | 'z';
  keys: CurveKey[];
}
interface Clip {
  name: string;
  duration: number;
  tracks: Track[];
}
export interface CursorProfile {
  source: unknown;
  handler: string;
  reference: number[];
  match: number;
  nodes: CursorNode[];
  sprites: Record<string, string>;
  down: Clip;
  up: Clip;
}
interface NodeView {
  node: CursorNode;
  element: HTMLElement;
  width: number;
  height: number;
  scale: number[];
  rotation: number;
}

/** The client's common PCMouseHandler, presented above both dialogs and
 * fullscreen. It observes input without becoming a pointer/capture target. */
export class PRTSCursor {
  private overlay = document.createElement('div');
  private position = document.createElement('div');
  private canvas = document.createElement('div');
  private nodes = new Map<string, NodeView>();
  private profile?: CursorProfile;
  private pending?: Promise<void>;
  private visible = false;
  private pressed = false;
  private pointer: number | null = null;
  private pointerType = 'mouse';
  private x = 0;
  private y = 0;
  private frame = 0;
  private started = 0;
  private clip?: Clip;
  private host?: Element;
  private popover = false;
  constructor() {
    this.overlay.id = 'prts-cursor';
    this.overlay.className = 'prts-cursor-layer';
    this.overlay.setAttribute('aria-hidden', 'true');
    this.overlay.hidden = true;
    this.position.className = 'prts-cursor-position';
    this.canvas.className = 'prts-cursor-canvas';
    this.position.append(this.canvas);
    this.overlay.append(this.position);
    this.popover = typeof this.overlay.showPopover === 'function';
    if (this.popover) this.overlay.setAttribute('popover', 'manual');
    document.body.append(this.overlay);
    document.addEventListener(
      'pointerover',
      (e) => {
        if (e.pointerType === 'mouse') {
          this.pointerType = 'mouse';
          this.move(e.clientX, e.clientY);
        }
      },
      { capture: true, passive: true },
    );
    document.addEventListener(
      'pointermove',
      (e) => {
        if (e.pointerType !== 'mouse' && e.pointerId !== this.pointer) return;
        this.pointerType = e.pointerType;
        this.move(e.clientX, e.clientY);
        if (e.pointerType === 'mouse' && this.pressed && !(e.buttons & 1)) this.release();
      },
      { capture: true, passive: true },
    );
    document.addEventListener(
      'pointerdown',
      (e) => {
        if (!e.isPrimary || e.button !== 0) return;
        this.pointerType = e.pointerType;
        this.pointer = e.pointerId;
        this.move(e.clientX, e.clientY);
        this.pressed = true;
        this.play(this.profile?.down);
      },
      { capture: true, passive: true },
    );
    window.addEventListener(
      'pointerup',
      (e) => {
        if (e.pointerId === this.pointer && e.button === 0) this.release();
      },
      { capture: true, passive: true },
    );
    window.addEventListener(
      'pointercancel',
      (e) => {
        if (e.pointerId === this.pointer) this.hide();
      },
      { capture: true, passive: true },
    );
    window.addEventListener(
      'lostpointercapture',
      (e) => {
        if (this.pressed && e.pointerId === this.pointer) this.release();
      },
      { capture: true, passive: true },
    );
    document.documentElement.addEventListener('pointerleave', () => this.hide());
    window.addEventListener('blur', () => this.hide());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.hide();
    });
    document.addEventListener('fullscreenchange', () => {
      this.host = undefined;
      this.lift();
      this.resize();
    });
    document.addEventListener(
      'toggle',
      (event) => {
        if (
          event.target instanceof HTMLElement &&
          event.target !== this.overlay &&
          event.target.hasAttribute('popover')
        ) {
          this.host = undefined;
          this.lift();
        }
      },
      true,
    );
    window.addEventListener('resize', () => this.resize());
    new MutationObserver((records) => {
      if (records.some((r) => r.target instanceof HTMLDialogElement)) {
        this.host = undefined;
        this.lift();
      }
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
  }
  async load(): Promise<void> {
    if (this.profile) return;
    if (this.pending) return this.pending;
    this.pending = (async () => {
      const response = await fetch(playerMediaUrl('native-cursor.json'));
      if (!response.ok) throw Error('PRTS 光标资源尚未准备好');
      const profile = (await response.json()) as CursorProfile;
      await Promise.all(
        Object.keys(profile.sprites).map(async (file) => {
          const image = new Image();
          image.src = playerMediaUrl(file);
          await image.decode();
        }),
      );
      this.build(profile);
      this.profile = profile;
      this.resize();
      if (this.visible) {
        this.lift();
        if (this.pressed) this.play(profile.down);
      }
    })();
    try {
      await this.pending;
    } finally {
      this.pending = undefined;
    }
  }
  private build(profile: CursorProfile) {
    this.canvas.replaceChildren();
    this.nodes.clear();
    for (const node of profile.nodes) {
      const parent = node.parent === null ? undefined : this.nodes.get(node.parent);
      const element = document.createElement('div');
      element.className = 'prts-cursor-node';
      element.dataset.prtsNode = node.path || '@root';
      element.hidden = !node.active;
      const pw = parent?.width ?? 0,
        ph = parent?.height ?? 0;
      const width = node.size[0] + pw * (node.anchorMax[0] - node.anchorMin[0]),
        height = node.size[1] + ph * (node.anchorMax[1] - node.anchorMin[1]);
      const left = parent
        ? pw * (node.anchorMin[0] + (node.anchorMax[0] - node.anchorMin[0]) * node.pivot[0]) +
          node.position[0] -
          width * node.pivot[0]
        : -width * node.pivot[0];
      const top = parent
        ? ph -
          ph * (node.anchorMin[1] + (node.anchorMax[1] - node.anchorMin[1]) * node.pivot[1]) -
          node.position[1] -
          height * (1 - node.pivot[1])
        : -height * (1 - node.pivot[1]);
      Object.assign(element.style, {
        left: left + 'px',
        top: top + 'px',
        width: width + 'px',
        height: height + 'px',
        transformOrigin: `${node.pivot[0] * 100}% ${(1 - node.pivot[1]) * 100}%`,
      });
      if (node.sprite) {
        const image = document.createElement('img');
        image.src = playerMediaUrl(node.sprite);
        image.alt = '';
        image.draggable = false;
        image.dataset.nativeSprite = profile.sprites[node.sprite];
        image.style.opacity = String(node.color?.[3] ?? 1);
        element.append(image);
      }
      const view = {
        node,
        element,
        width,
        height,
        scale: [...node.scale],
        rotation: node.rotation,
      };
      this.nodes.set(node.path, view);
      this.paint(view);
      (parent?.element ?? this.canvas).append(element);
    }
  }
  private paint(view: NodeView) {
    view.element.style.transform = `rotate(${-view.rotation}deg) scale(${view.scale[0]},${view.scale[1]})`;
  }
  private resize() {
    if (!this.profile) return;
    const p = this.profile,
      scale =
        (innerWidth / p.reference[0]) ** (1 - p.match) * (innerHeight / p.reference[1]) ** p.match;
    this.canvas.style.transform = `scale(${scale})`;
    this.place();
  }
  private place() {
    let x = this.x,
      y = this.y;
    if (!this.popover && this.host instanceof HTMLDialogElement) {
      const rect = this.host.getBoundingClientRect();
      x -= rect.left;
      y -= rect.top;
    }
    this.position.style.transform = `translate3d(${x}px,${y}px,0)`;
  }
  private lift() {
    if (!this.profile || !this.visible) return;
    const host = topNativeDialog() ?? document.fullscreenElement ?? document.body;
    try {
      if (this.host !== host) {
        if (this.popover && this.overlay.matches(':popover-open')) this.overlay.hidePopover();
        host.append(this.overlay);
        this.host = host;
      }
      this.overlay.hidden = false;
      if (this.popover && !this.overlay.matches(':popover-open')) this.overlay.showPopover();
      document.documentElement.classList.add('prts-cursor-active');
      this.place();
    } catch {
      this.hide();
    }
  }
  private move(x: number, y: number) {
    this.x = x;
    this.y = y;
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) {
      this.hide();
      return;
    }
    this.visible = true;
    this.place();
    this.lift();
  }
  private play(clip?: Clip) {
    if (!clip) return;
    cancelAnimationFrame(this.frame);
    this.clip = clip;
    this.started = performance.now();
    this.overlay.dataset.state = this.pressed ? 'pressed' : 'release';
    this.animate(this.started);
  }
  private animate(now: number) {
    if (!this.clip) return;
    const time = Math.min(this.clip.duration, (now - this.started) / 1000);
    for (const track of this.clip.tracks) {
      const view = this.nodes.get(track.path);
      if (!view) continue;
      const value = sampleKeys(track.keys, time);
      if (track.property === 'scale') view.scale['xyz'.indexOf(track.axis)] = value;
      else if (track.property === 'rotation' && track.axis === 'z') view.rotation = value;
      this.paint(view);
    }
    if (time < this.clip.duration) this.frame = requestAnimationFrame((t) => this.animate(t));
    else {
      this.frame = 0;
      this.clip = undefined;
      if (!this.pressed) {
        this.overlay.dataset.state = 'idle';
        if (this.pointerType !== 'mouse') this.hide();
      }
    }
  }
  private release() {
    if (!this.pressed) return;
    this.pressed = false;
    this.pointer = null;
    if (this.profile) this.play(this.profile.up);
    else if (this.pointerType !== 'mouse') this.hide();
  }
  private hide() {
    this.visible = false;
    this.pressed = false;
    this.pointer = null;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.clip = undefined;
    for (const view of this.nodes.values()) {
      view.scale = [...view.node.scale];
      view.rotation = view.node.rotation;
      this.paint(view);
    }
    if (this.popover && this.overlay.matches(':popover-open')) this.overlay.hidePopover();
    this.overlay.hidden = true;
    this.overlay.dataset.state = 'idle';
    document.documentElement.classList.remove('prts-cursor-active');
  }
}

let cursor: PRTSCursor | undefined;
export function prtsCursor() {
  return (cursor ??= new PRTSCursor());
}
