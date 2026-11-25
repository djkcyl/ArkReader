import { parseScript } from '../src/core/parser.ts';
import { resourceKey } from '../src/core/resource-key.ts';
import { DECISION_PRESS_CLIP, SKIP_CANCEL_CLIP, SKIP_CONFIRM_CLIP } from '../src/core/decision.ts';
import { parseStoryHeader } from '../src/core/story-header.ts';
const fields: Record<string, string[]> = {
  animtext: ['name'],
  effect: ['name'],
  bgeffect: ['name'],
  blocker: ['image'],
  background: ['image'],
  image: ['image'],
  character: ['name', 'name2', 'name3'],
  charslot: ['name'],
  playmusic: ['intro', 'key'],
  playsound: ['key'],
  playvoice: ['key'],
};
export function collectResourceRefs(script: string, variables: Record<string, unknown> = {}) {
  const refs = [];
  const commands = parseScript(script, variables);
  if (parseStoryHeader(commands).isSkippable)
    for (const key of [SKIP_CANCEL_CLIP, SKIP_CONFIRM_CLIP])
      refs.push({
        command: 'playsound',
        field: 'skipPress',
        line: commands[0].line,
        raw: key,
        key,
      });
  for (const c of commands)
    if (c.name === 'imgeffect' && c.params.name) {
      for (const [field, command] of [
        ['name', 'imgeffect'],
        ['image', 'imgeffect-image'],
      ]) {
        const raw = String(c.params[field] ?? '');
        refs.push({
          command,
          field,
          line: c.line,
          raw,
          key: (field === 'image' ? 'imgfx:' : '') + resourceKey(raw),
        });
      }
    }
  for (const c of commands)
    if (
      c.name === 'spellsticker' &&
      String(c.params.id ?? '') &&
      String(c.params.action ?? 'show').toLowerCase() !== 'hide'
    ) {
      const key = 'sticker_' + String(c.params.style ?? 'sami').toLowerCase() + '_fx_spell';
      refs.push({ command: 'spellsticker', field: 'style', line: c.line, raw: key, key });
    }
  const decision = commands.find((c) => c.name === 'decision');
  if (decision)
    refs.push({
      command: 'playsound',
      field: 'decisionPress',
      line: decision.line,
      raw: DECISION_PRESS_CLIP,
      key: DECISION_PRESS_CLIP,
    });
  for (const c of commands)
    if (c.name === 'video' && c.params.res) {
      const raw = String(c.params.res);
      refs.push({ command: 'video', field: 'res', line: c.line, raw, key: raw.toLowerCase() });
    }
  for (const c of commands)
    if (c.name === 'avgdisplay' && String(c.params.style).toLowerCase() === 'bg' && c.params.name) {
      refs.push({
        command: 'background',
        field: 'name',
        line: c.line,
        raw: String(c.params.name),
        key: resourceKey(c.params.name),
      });
    }
  for (const c of commands)
    if (
      c.name === 'avgdisplay' &&
      String(c.params.style).toLowerCase() === 'animekv' &&
      c.params.name
    ) {
      refs.push({
        command: 'animated-kv',
        field: 'name',
        line: c.line,
        raw: String(c.params.name),
        key: resourceKey(c.params.name),
      });
    }
  for (const c of commands)
    if (
      c.name === 'avgdisplay' &&
      ['bgeffect', 'effect'].includes(String(c.params.style).toLowerCase()) &&
      c.params.name
    ) {
      refs.push({
        command: String(c.params.style).toLowerCase(),
        field: 'name',
        line: c.line,
        raw: String(c.params.name),
        key: resourceKey(c.params.name),
      });
    }
  for (const c of commands)
    if (
      c.name === 'charactercutin' &&
      c.params.name &&
      resourceKey(c.params.name) !== 'char_empty'
    ) {
      refs.push({
        command: 'charslot',
        field: 'name',
        line: c.line,
        raw: String(c.params.name),
        key: resourceKey(c.params.name),
      });
    }
  for (const c of commands)
    if (['cgitem', 'showitem'].includes(c.name) && c.params.image) {
      refs.push({
        command: c.name,
        field: 'image',
        line: c.line,
        raw: String(c.params.image),
        key: resourceKey(c.params.image),
      });
    }
  for (const c of commands)
    if (['gridbg', 'largebg', 'verticalbg'].includes(c.name)) {
      // GatherResRefs collects both fields independently of the display choice.
      for (const [field, command] of [
        ['imagegroup', 'background'],
        ['cggroup', 'image'],
      ]) {
        for (const raw of String(c.params[field] ?? '').split('/')) {
          if (raw) refs.push({ command, field, line: c.line, raw, key: resourceKey(raw) });
        }
      }
    }
  for (const c of commands)
    if (c.name === 'interlude') {
      if (c.params.maskid)
        refs.push({
          command: 'interlude-mask',
          field: 'maskid',
          line: c.line,
          raw: String(c.params.maskid),
          key: resourceKey(c.params.maskid),
        });
      const type = String(c.params.type);
      if (c.params.name && ['1', 'uichar', '2', 'bg'].includes(type)) {
        refs.push({
          command: ['2', 'bg'].includes(type) ? 'background' : 'interlude-uichar',
          field: 'name',
          line: c.line,
          raw: String(c.params.name),
          key: resourceKey(c.params.name),
        });
      }
      if (
        ['3', 'char'].includes(String(c.params.type)) &&
        c.params.name &&
        resourceKey(c.params.name) !== 'char_empty'
      )
        refs.push({
          command: 'charslot',
          field: 'name',
          line: c.line,
          raw: String(c.params.name),
          key: resourceKey(c.params.name),
        });
    }
  for (const c of commands)
    for (const field of fields[c.name] ?? []) {
      if (c.name === 'blocker' && ['slider', 'verticalslider'].includes(String(c.params.style)))
        continue;
      const value = c.params[field];
      if (value === undefined || value === null || value === '') continue;
      // An empty slot takes _CleanSlotsWithTween before the image-loading branch.
      if (
        c.name === 'charslot' &&
        (['', 'n', 'all'].includes(String(c.params.slot ?? '').toLowerCase()) ||
          resourceKey(value) === 'char_empty')
      )
        continue;
      const tileMetadata =
        ['background', 'image'].includes(c.name) && Object.hasOwn(c.params, 'tiled');
      refs.push({
        command: c.name,
        field,
        line: c.line,
        raw: String(value),
        key: resourceKey(value),
        ...(tileMetadata ? { tileMetadata: true } : {}),
      });
    }
  return refs;
}
