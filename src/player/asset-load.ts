/** Decoding may finish after its story is cancelled. Never publish such data. */
export function abortable<T>(
  task: Promise<T>,
  signal?: AbortSignal,
  onAbort?: () => void,
): Promise<T> {
  if (!signal) return task;
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      onAbort?.();
      reject(signal.reason);
    };
    if (signal.aborted) {
      abort();
      void task.catch(() => {});
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    task.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        if (signal.aborted) reject(signal.reason);
        else resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}

const imageSlots =
  typeof navigator !== 'undefined' && /Android|iPhone|iPad/i.test(navigator.userAgent) ? 2 : 4;
let decodingImages = 0;
const imageQueue: (() => void)[] = [];

function acquireImageSlot(signal?: AbortSignal): Promise<() => void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {
      const index = imageQueue.indexOf(start);
      if (index >= 0) imageQueue.splice(index, 1);
      reject(signal!.reason);
    };
    const start = () => {
      signal?.removeEventListener('abort', abort);
      decodingImages++;
      resolve(() => {
        decodingImages--;
        imageQueue.shift()?.();
      });
    };
    if (decodingImages < imageSlots) start();
    else {
      imageQueue.push(start);
      signal?.addEventListener('abort', abort, { once: true });
    }
  });
}

export async function loadImage(url: string, signal?: AbortSignal): Promise<HTMLImageElement> {
  signal?.throwIfAborted();
  const release = await acquireImageSlot(signal);
  try {
    signal?.throwIfAborted();
    const image = new Image();
    image.src = url;
    await abortable(image.decode(), signal, () => image.removeAttribute('src'));
    signal?.throwIfAborted();
    return image;
  } catch (error) {
    signal?.throwIfAborted();
    throw new Error(`图像加载失败：${url}`, { cause: error });
  } finally {
    release();
  }
}

const fontReleases = new WeakMap<FontFace, () => void>();
/** A registered font belongs to the loading story even before its await resumes. */
export function releaseFont(font: FontFace): void {
  const release = fontReleases.get(font);
  if (release) release();
  else document.fonts.delete(font);
}

export async function loadFont(
  family: string,
  url: string,
  signal?: AbortSignal,
): Promise<FontFace> {
  signal?.throwIfAborted();
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('字体加载失败：' + family);
  const bytes = await response.arrayBuffer();
  signal?.throwIfAborted();
  const font = new FontFace(family, bytes);
  await abortable(font.load(), signal);
  signal?.throwIfAborted();
  const release = () => {
    signal?.removeEventListener('abort', release);
    fontReleases.delete(font);
    document.fonts.delete(font);
  };
  fontReleases.set(font, release);
  signal?.addEventListener('abort', release, { once: true });
  try {
    document.fonts.add(font);
  } catch (error) {
    release();
    throw error;
  }
  return font;
}
