import { playerMediaUrl } from './package-source';
import { loadImage } from './asset-load';
/** The photo prefab anchors a 9-sliced frame 32 reference units beyond each
 * side of the sprite's native rect. Each Image inherits CanvasGroup.alpha. */
export class PhotoSlotRenderer {
  private readonly border = 32;
  private sizedFrame: HTMLCanvasElement | null = null;
  private constructor(
    private frame: HTMLImageElement,
    private dim: HTMLImageElement,
  ) {}

  static async load(signal?: AbortSignal): Promise<PhotoSlotRenderer> {
    async function read(name: string) {
      return loadImage(playerMediaUrl('native-photo-' + name + '.png'), signal);
    }
    const [frame, dim] = await Promise.all([read('frame'), read('dim')]);
    signal?.throwIfAborted();
    return new PhotoSlotRenderer(frame, dim);
  }

  private frameFor(width: number, height: number): HTMLCanvasElement {
    if (this.sizedFrame?.width === width && this.sizedFrame.height === height)
      return this.sizedFrame;
    const result = document.createElement('canvas');
    result.width = width;
    result.height = height;
    const ctx = result.getContext('2d')!,
      b = this.border;
    const sx = [0, b, this.frame.width - b, this.frame.width],
      sy = [0, b, this.frame.height - b, this.frame.height];
    const dx = [0, b, width - b, width],
      dy = [0, b, height - b, height];
    for (let y = 0; y < 3; y++)
      for (let x = 0; x < 3; x++) {
        ctx.drawImage(
          this.frame,
          sx[x],
          sy[y],
          sx[x + 1] - sx[x],
          sy[y + 1] - sy[y],
          dx[x],
          dy[y],
          dx[x + 1] - dx[x],
          dy[y + 1] - dy[y],
        );
      }
    this.sizedFrame = result;
    return result;
  }

  draw(
    ctx: CanvasRenderingContext2D,
    item: { x: number; y: number; black: number; alpha: number },
    image: HTMLImageElement,
    width: number,
    height: number,
  ) {
    const x = 640 + item.x - width / 2,
      y = 360 - item.y - height / 2,
      b = this.border;
    const fw = width + 2 * b,
      fh = height + 2 * b;
    ctx.save();
    ctx.globalAlpha = item.alpha * Math.max(0, Math.min(1, item.black));
    ctx.drawImage(this.dim, 0, 0, 1280, 720);
    ctx.globalAlpha = item.alpha;
    ctx.drawImage(this.frameFor(Math.round(fw), Math.round(fh)), x - b, y - b, fw, fh);
    ctx.drawImage(image, x, y, width, height);
    ctx.restore();
  }
}
