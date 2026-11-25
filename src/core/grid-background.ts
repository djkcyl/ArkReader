import { resourceKey } from './resource-key.ts';

export interface GridTile {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function gridGroup(params: Record<string, unknown>) {
  const backgrounds = String(params.imagegroup ?? '');
  const value = backgrounds || String(params.cggroup ?? '');
  return { names: value ? value.split('/') : [], source: backgrounds ? 'background' : 'image' };
}

/** Local coordinates of the four upper-left pivots under the centered offset rect. */
export function gridLayout(params: Record<string, unknown>) {
  const { names } = gridGroup(params);
  const dimensions = (value: unknown) =>
    String(value ?? '')
      .split('/')
      .map((part) => (part.trim() ? Math.fround(Number(part)) : NaN));
  const widths = dimensions(params.solidwidth);
  const heights = dimensions(params.solidheight);
  if (
    names.length !== 4 ||
    names.some((name) => !name) ||
    [widths, heights].some((v) => v.length < 4 || !v.slice(0, 4).every(Number.isFinite))
  )
    return null;

  const width = widths[0] + widths[1];
  const height = heights[0] + heights[2];
  const { originX, originY } = panelOrigin(
    String(params.initposmode ?? 'default'),
    width,
    height,
    widths[1],
    heights[2],
  );
  const tiles: GridTile[] = names.map((name, i) => ({
    key: resourceKey(name),
    width: widths[i],
    height: heights[i],
    x: -width / 2 + (i % 2 ? widths[0] : 0),
    y: height / 2 - (i >= 2 ? heights[0] : 0),
  }));
  return { originX, originY, tiles };
}

function panelOrigin(
  mode: string,
  width: number,
  height: number,
  rightWidth: number,
  lowerHeight: number,
) {
  let originX = 0,
    originY = 0;
  if (mode === 'default') {
    originX = rightWidth / 2;
    originY = -lowerHeight / 2;
  } else if (mode === 'upperleft') {
    originX = (width - 1280) / 2;
    originY = (720 - height) / 2;
  } else if (mode === 'lowercenter') {
    originY = (height - 720) / 2;
  }
  return { originX, originY };
}

/** The strip executors use the same four Image objects and init-offset parent
 * as GridBG. Even for three/four vertical images, the original offset rect
 * is sized from the first two heights, then each additional tile is placed
 * below the preceding tiles. */
export function stripLayout(params: Record<string, unknown>, vertical: boolean) {
  const { names } = gridGroup(params);
  if (names.some((n) => !n) || names.length < 2 || names.length > (vertical ? 4 : 2)) return null;
  // Single.TryParse accepts thousands separators in authored strip lengths.
  const lengths = String((vertical ? params.solidheight : params.solidwidth) ?? '')
    .split('/')
    .map((part) => {
      const v = part.trim();
      return /^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(v)
        ? Math.fround(Number(v.replaceAll(',', '')))
        : NaN;
    });
  const cross = Math.fround(Number(vertical ? params.solidwidth : params.solidheight));
  if (
    lengths.length < names.length ||
    !Number.isFinite(cross) ||
    lengths.slice(0, names.length).some((v) => !Number.isFinite(v))
  )
    return null;
  const pair = lengths[0] + lengths[1];
  const width = vertical ? cross : pair,
    height = vertical ? pair : cross;
  const origin = panelOrigin(
    String(params.initposmode ?? 'default'),
    width,
    height,
    vertical ? 0 : lengths[1],
    vertical ? lengths[1] : 0,
  );
  let x = -width / 2,
    y = height / 2;
  const tiles: GridTile[] = names.map((name, i) => {
    const tile = {
      key: resourceKey(name),
      x,
      y,
      width: vertical ? cross : lengths[i],
      height: vertical ? lengths[i] : cross,
    };
    if (vertical) y -= tile.height;
    else x += tile.width;
    return tile;
  });
  return { ...origin, tiles };
}
