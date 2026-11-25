import { interludeNodeScale, interludeNodeValue } from './interludes';
import { InterludeWave } from './interlude-wave';
import { loadFont, loadImage, releaseFont } from './asset-load';
import { nativeColorUnit } from '../core/color32';
import type { InterludeNode, InterludeChannel, InterludeProfile } from './interludes';
import type { Visual } from './runtime';
type Box = { w: number; h: number; px: number; py: number };
export function interludeRect(node: InterludeNode, parent: Box) {
  const t = node.transform,
    p = t.m_Pivot,
    min = t.m_AnchorMin,
    max = t.m_AnchorMax;
  return {
    x: parent.w * (min.x + (max.x - min.x) * p.x - parent.px) + t.m_AnchoredPosition.x,
    y: parent.h * (min.y + (max.y - min.y) * p.y - parent.py) + t.m_AnchoredPosition.y,
    w: parent.w * (max.x - min.x) + t.m_SizeDelta.x,
    h: parent.h * (max.y - min.y) + t.m_SizeDelta.y,
    px: p.x,
    py: p.y,
  };
}
export class InterludeRenderer {
  private labelFont?: FontFace;
  private images = new Map<string, HTMLImageElement>();
  private tinted = new Map<string, HTMLCanvasElement>();
  private wave = new InterludeWave();
  frames = 0;
  waveFrames = 0;
  async load(profile: InterludeProfile, signal?: AbortSignal) {
    if (profile.font && !this.labelFont) {
      const font = await loadFont('ArkInterludeHeavy', profile.font.url, signal);
      signal?.throwIfAborted();
      this.labelFont = font;
    }
    await this.wave.load(profile.textures, signal);
    for (const [id, t] of Object.entries(profile.textures)) {
      if (this.images.has(id)) continue;
      const image = await loadImage(t.url, signal);
      signal?.throwIfAborted();
      this.images.set(id, image);
    }
  }
  private image(profile: InterludeProfile, id: string, color: number[]) {
    const key = id + ':' + color.slice(0, 3).join(',');
    let image: CanvasImageSource = this.images.get(id)!;
    if (color.slice(0, 3).some((v) => v !== 1)) {
      let tinted = this.tinted.get(key);
      if (!tinted) {
        const t = profile.textures[id];
        tinted = document.createElement('canvas');
        tinted.width = t.width;
        tinted.height = t.height;
        const c = tinted.getContext('2d')!;
        c.drawImage(image, 0, 0);
        const data = c.getImageData(0, 0, t.width, t.height);
        for (let i = 0; i < data.data.length; i += 4)
          for (let j = 0; j < 3; j++)
            data.data[i + j] = Math.round(data.data[i + j] * nativeColorUnit(color[j]));
        c.putImageData(data, 0, 0);
        this.tinted.set(key, tinted);
      }
      image = tinted;
    }
    return image;
  }
  draw(
    c: CanvasRenderingContext2D,
    channels: InterludeChannel[],
    time: number,
    avatar: (v: Visual) => void,
    picture: (v: Visual) => void,
    dialogImage?: (key: string, rect: number[]) => void,
  ) {
    const sceneMatrix = c.getTransform();
    for (const ch of channels) {
      const profile = ch.profile;
      let mask:
        | { matrix: DOMMatrix; x: number; y: number; w: number; h: number; path?: Path2D }
        | undefined;
      const clipMask = () => {
        if (!mask) return;
        c.setTransform(mask.matrix);
        if (mask.path) c.clip(mask.path);
        else {
          c.beginPath();
          c.rect(mask.x, mask.y, mask.w, mask.h);
          c.clip();
        }
      };
      const visit = (
        node: InterludeNode,
        parent: Box,
        root = false,
        deco = false,
        flow?: { left: number; width: number },
      ) => {
        const selected = node.id === profile.selectedNode,
          unselected = node.id === profile.unselectedNode;
        if (
          (selected && !ch.selected) ||
          (unselected && ch.selected) ||
          (!node.active && !selected && !unselected) ||
          (node.id === profile.emptyNode && !ch.empty)
        )
          return;
        const b = interludeRect(node, parent);
        if (root) {
          b.x = (profile.dialog ? b.x : 0) + ch.offset[0];
          b.y = (profile.dialog ? b.y : 0) + ch.offset[1];
          if (!deco) {
            b.w = ch.size[0];
            b.h = ch.size[1];
          }
        }
        b.x = interludeNodeValue(ch, node, 'm_AnchoredPosition.x', b.x, time);
        if (node.id === profile.dialog?.portrait) {
          b.x += ch.position[0];
          b.y += ch.position[1];
        }
        const widths = new Map<string, number>();
        if (node.row) {
          let preferred = node.row.left + node.row.right;
          for (const child of node.children.filter((child) => !child.ignore && child.active)) {
            const label = child.components.find((comp) => comp.kind === 'label');
            if (label) c.font = `${label.size}px ArkInterludeHeavy`;
            const w = label
              ? Math.ceil(c.measureText(ch.label).width)
              : Math.max(0, child.preferredWidth ?? child.transform.m_SizeDelta.x);
            if (widths.size) preferred += node.row.spacing;
            widths.set(child.id, w);
            preferred += w;
          }
          b.w = Math.max(node.minWidth ?? 0, preferred);
        }
        if (flow) {
          b.w = flow.width;
          b.x = flow.left + b.w * b.px;
          b.y = b.h * (b.py - 0.5);
        }
        c.save();
        c.translate(b.x, -b.y);
        const rotation = node.transform.m_LocalRotation ?? { x: 0, y: 0, z: 0, w: 1 };
        const z = interludeNodeValue(ch, node, 'rotation.z', rotation.z, time),
          w = interludeNodeValue(ch, node, 'rotation.w', rotation.w, time);
        if (!(node.id === profile.dialog?.background && ch.pictures.bg?.key))
          c.rotate(-2 * Math.atan2(z, w));
        c.scale(...interludeNodeScale(ch, node, time));
        if (node.id === profile.dialog?.portrait) c.scale(...ch.avatarScale);
        c.globalAlpha *= interludeNodeValue(ch, node, 'm_Alpha', node.alpha ?? 1, time);
        if (root && profile.dialog) c.globalAlpha *= ch.maskAlpha;
        const left = -b.w * b.px,
          top = -b.h * (1 - b.py);
        const reads = node.components.some((component) => component.kind === 'read-mask');
        if (reads && !mask) {
          c.restore();
          return;
        }
        if (reads && mask) {
          const current = c.getTransform();
          clipMask();
          c.setTransform(current);
        }
        for (const component of node.components) {
          if (component.kind === 'read-mask') continue;
          if (component.kind === 'mesh-mask') {
            const path = new Path2D();
            for (const tri of component.triangles) {
              tri.forEach((index, i) => {
                const p = component.points[index];
                if (i) path.lineTo(p[0], p[1]);
                else path.moveTo(p[0], p[1]);
              });
              path.closePath();
            }
            mask = { matrix: c.getTransform(), x: left, y: top, w: b.w, h: b.h, path };
            continue;
          }
          if (component.kind === 'dialog-portrait') {
            const key = ch.avatars[0]?.key;
            if (key) dialogImage?.(key, [left, top, b.w, b.h]);
            continue;
          }
          if (component.kind === 'mask') {
            const matrix = c.getTransform();
            if (nativeColorUnit(ch.maskAlpha) === 0 || matrix.a * matrix.d === matrix.b * matrix.c)
              continue;
            mask = { matrix, x: left, y: top, w: b.w, h: b.h };
            continue;
          }
          if (component.kind === 'gradient') {
            const gradient = c.createLinearGradient(0, top + b.h, 0, top);
            for (const point of component.points) {
              const v = point.color;
              gradient.addColorStop(
                point.point,
                `rgba(${Math.round(nativeColorUnit(v.r) * 255)},${Math.round(nativeColorUnit(v.g) * 255)},${Math.round(nativeColorUnit(v.b) * 255)},${nativeColorUnit(v.a)})`,
              );
            }
            c.fillStyle = gradient;
            c.fillRect(left, top, b.w, b.h);
            continue;
          }
          if (component.kind === 'label' || component.kind === 'solid') {
            const [r, g, bcol, a] = component.color.map(nativeColorUnit);
            c.save();
            c.fillStyle = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(bcol * 255)})`;
            c.globalAlpha *= a;
            if (component.kind === 'solid') c.fillRect(left, top, b.w, b.h);
            else {
              c.font = `${component.size}px ArkInterludeHeavy`;
              c.textAlign = 'left';
              c.textBaseline = 'alphabetic';
              const m = c.measureText(ch.label);
              c.fillText(
                ch.label,
                left + m.actualBoundingBoxLeft,
                top + (b.h + m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2,
              );
            }
            c.restore();
            continue;
          }
          if (node.id === profile.dialog?.background && ch.pictures.bg?.key) {
            dialogImage?.(ch.pictures.bg.key, [left, top, b.w, b.h]);
            continue;
          }
          const s = profile.sprites[component.sprite],
            texture = profile.textures[s.texture],
            r = s.rect;
          let image: CanvasImageSource;
          if (component.material) {
            image = this.wave.render(
              profile.materials[component.material],
              s.texture,
              time,
              texture.width,
              texture.height,
              component.color.map(nativeColorUnit),
            );
            this.waveFrames++;
          } else image = this.image(profile, s.texture, component.color);
          c.save();
          if (!component.material) c.globalAlpha *= nativeColorUnit(component.color[3]);
          if (component.sliced && s.border.some((v) => v > 0)) {
            const [l, bt, rt, tp] = s.border,
              factorX = Math.min(1, b.w / (l + rt)),
              factorY = Math.min(1, b.h / (bt + tp));
            const sx = [r.x, r.x + l, r.x + r.width - rt, r.x + r.width],
              sy = [
                texture.height - r.y - r.height,
                texture.height - r.y - r.height + tp,
                texture.height - r.y - bt,
                texture.height - r.y,
              ];
            const dx = [left, left + l * factorX, left + b.w - rt * factorX, left + b.w],
              dy = [top, top + tp * factorY, top + b.h - bt * factorY, top + b.h];
            for (let y = 0; y < 3; y++)
              for (let x = 0; x < 3; x++)
                if (dx[x + 1] > dx[x] && dy[y + 1] > dy[y])
                  c.drawImage(
                    image,
                    sx[x],
                    sy[y],
                    sx[x + 1] - sx[x],
                    sy[y + 1] - sy[y],
                    dx[x],
                    dy[y],
                    dx[x + 1] - dx[x],
                    dy[y + 1] - dy[y],
                  );
          } else
            c.drawImage(
              image,
              r.x,
              texture.height - r.y - r.height,
              r.width,
              r.height,
              left + (b.w * s.offset[0]) / s.size[0],
              top + (b.h * (s.size[1] - s.offset[1] - r.height)) / s.size[1],
              (b.w * r.width) / s.size[0],
              (b.h * r.height) / s.size[1],
            );
          c.restore();
        }
        let next = (node.row?.left ?? 0) - b.w * b.px;
        for (const child of node.children) {
          const width = widths.get(child.id);
          visit(child, b, false, deco, width === undefined ? undefined : { left: next, width });
          if (width !== undefined) next += width + (node.row?.spacing ?? 0);
        }
        c.restore();
      };
      c.save();
      c.translate(640, 360);
      visit(profile.template, { w: 1280, h: 720, px: 0.5, py: 0.5 }, true);
      c.restore();
      if (mask && !profile.dialog) {
        c.save();
        clipMask();
        c.setTransform(sceneMatrix);
        const bg = ch.pictures.bg;
        if (bg?.key) picture(bg);
        for (const v of ch.avatars) avatar(v);
        for (const slot of ['middle', 'right', 'left'] as const) {
          const img = ch.pictures[slot];
          if (img?.key) picture(img);
        }
        c.restore();
      }
      if (profile.deco) {
        c.save();
        c.globalAlpha *= ch.decoAlpha;
        c.translate(640, 360);
        visit(profile.deco, { w: 1280, h: 720, px: 0.5, py: 0.5 }, true, true);
        c.restore();
      }
      this.frames++;
    }
  }
  dispose() {
    if (this.labelFont) releaseFont(this.labelFont);
    this.labelFont = undefined;
    this.wave.dispose();
    this.images.clear();
    this.tinted.clear();
  }
}
