import { glitchPresetNames } from '../player/character-glitch.ts';
import { resourceKey } from './resource-key.ts';
import { IMAGE_EFFECTS } from '../player/image-effects.ts';
import { nativeUnhandledCommands } from './native-unhandled.ts';
import { gridGroup, stripLayout } from './grid-background.ts';
import { stickerColorText, readingMarkup } from './sticker-color.ts';
import { stampParagraphs } from './stamp-text.ts';
import { NATIVE_PARTICLE_EFFECTS } from '../player/native-particles.ts';
import { SIGNAL_EFFECTS } from '../player/particles.ts';
import { MOHU_EFFECTS, FOREGROUND_EFFECTS } from '../player/bg-effects.ts';
import type { Command } from './scheduler';
import { nativeBoolean } from './values.ts';
import { nativeVector } from './vector.ts';
import { nativeEase } from './easing.ts';
import { interludeVector, interludeType } from '../player/interludes.ts';

/** Implemented variants, not a claim that every parameter of a command works.
 * A registered command name alone must never qualify a newer story for playback.
 */
// DialogPanel._ExecuteDialog and PlaybackPanel._ExecuteDialog read only "name".
const ignoredDialogParameters = ['fadetime', 'block', 'delay', 'Delay', 'delay9ti', 'time'];
const unreadCharacterFields = [
  'fadetiem',
  'fadeitme',
  'fadetim',
  'fadtime',
  'fedetime',
  'fatetime',
  'faetime',
  'delay',
];
const unreadImageMotion = [
  'xFrom',
  'yFrom',
  'xTo',
  'yTo',
  'xScaleFrom',
  'yScaleFrom',
  'xScaleTo',
  'yScaleTo',
];
export const PARAMETERS: Record<string, readonly string[]> = {
  aside: [],
  skiptothis: [],
  startbattle: ['stageId', 'isPractice'],
  gotopage: ['dest', 'waitForSignal', 'zoneId', 'stageId'],
  tutorial: ['waitForSignal', 'abortForSignal'],
  imgeffect: ['name', 'image', 'layer', 'x', 'y'],
  usewhiteloadingmaskonfinish: [],
  spellstickerclear: ['block'],
  stickertween: [
    'id',
    'join',
    'isend',
    'block',
    'pfrom',
    'pto',
    'pduration',
    'rfrom',
    'rto',
    'rduration',
    'afrom',
    'ato',
    'aduration',
    'sfrom',
    'sto',
    'sduration',
  ],
  spellsticker: ['id', 'action', 'style', 'x', 'y', 'xScale', 'yScale', 'angle', 'alpha', 'block'],
  video: ['res', 'fadeoutdelay'],
  skipnode: ['mode'],
  label: ['name'],
  warp: ['name'],
  timersticker: ['time', 'x', 'y', 'width', 'size', 'afrom', 'ato', 'duration'],
  timerclear: ['duration'],
  showitem: ['image', 'style', 'offsetx', 'offsety', 'black', 'fadetime', 'fadestyle', 'width'],
  hideitem: ['fadetime', 'block'],
  largebg: [
    'imagegroup',
    'cggroup',
    'solidwidth',
    'solidheight',
    'x',
    'y',
    'xScale',
    'yScale',
    'fadetime',
    'block',
    'initposmode',
  ],
  verticalbg: [
    'imagegroup',
    'cggroup',
    'solidwidth',
    'solidheight',
    'x',
    'y',
    'xScale',
    'yScale',
    'fadetime',
    'block',
    'initposmode',
  ],
  charactercutin: [
    'widgetID',
    'name',
    'style',
    'fadestyle',
    'fadetime',
    'offsetx',
    'width',
    'block',
    'povX',
  ],
  theater: ['mode'],
  avgdisplay: ['id', 'name', 'style', 'slot', 'x', 'y', 'layer'],
  animtext: ['id', 'name', 'style', 'pos', 'block'],
  animtextclean: ['id'],
  gridbg: [
    'imagegroup',
    'cggroup',
    'solidwidth',
    'solidheight',
    'initposmode',
    'x',
    'y',
    'xScale',
    'yScale',
    'block',
    'fadetime',
    'blok',
  ],
  largebgtween: [
    'duration',
    'block',
    'ease',
    'loop',
    'xFrom',
    'yFrom',
    'xScaleFrom',
    'yScaleFrom',
    'xTo',
    'yTo',
    'xScaleTo',
    'yScaleTo',
    'xfrom',
    'yfrom',
    'xto',
    'x',
  ],
  effect: [
    'xTo',
    'name',
    'layer',
    'delay',
    'duration',
    'x',
    'y',
    'flip',
    'xto',
    'yto',
    'movedelay',
    'movetime',
    'rox',
    'roy',
    'roz',
  ],
  interlude: [
    'icharpos',
    'icharscale',
    'char',
    'channel',
    'maskid',
    'size',
    'style',
    'offset',
    'tsfrom',
    'tsto',
    'tsduration',
    'type',
    'slot',
    'switch',
    'name',
    'duration',
    'pfrom',
    'pto',
    'sfrom',
    'sto',
    'sduration',
    'afrom',
    'ato',
    'aduration',
    'clear',
    'block',
  ],
  cgitem: [
    'image',
    'id',
    'style',
    'layer',
    'rfrom',
    'rto',
    'rduration',
    'pfrom',
    'pto',
    'pduration',
    'pdelay',
    'sfrom',
    'sto',
    'sduration',
    'sdelay',
    'afrom',
    'ato',
    'aduration',
    'adelay',
    'width',
    'height',
    'ease',
    'fadetime',
    'block',
  ],
  hidecgitem: ['image', 'id', 'layer', 'block', 'fadetime', 'duration', 'ease'],
  sticker: [
    'hidelog',
    'afrom',
    'ato',
    'fadetime',
    'aduration',
    'id',
    'text',
    'multi',
    'x',
    'y',
    'width',
    'size',
    'alignment',
    'duration',
    'delay',
    'block',
    'isblock',
  ],
  stickerclear: ['block'],
  bgeffect: [
    'name',
    'layer',
    'fade',
    'fadetime',
    'delay',
    'x',
    'y',
    'flip',
    'xto',
    'yto',
    'movedelay',
    'movetime',
    'block',
    'startdelay',
    'duration',
  ],
  focusout: ['duration', 'type', 'id', 'from', 'to', 'block', 'fadetime'],
  focusparam: ['blur', 'effect'],
  curtain: [
    'direction',
    'fillfrom',
    'fillto',
    'fadetime',
    'block',
    'delay',
    'grad',
    'a',
    'r',
    'g',
    'b',
    'afrom',
    'rfrom',
    'gfrom',
    'bfrom',
    'ato',
    'duration',
    'isblock',
  ],
  header: [
    'key',
    'is_skippable',
    'fit_mode',
    'is_autoable',
    'is_tutorial',
    'is_video_only',
    'deny_auto_switch_scene',
    'dont_clear_gameobjectpool_onstart',
    'char_sort_type',
  ],
  dialog: ['name', ...ignoredDialogParameters],
  character: [
    ...unreadCharacterFields,
    'name',
    'name2',
    'focus',
    'fadetime',
    'isblock',
    'block',
    'blackstart',
    'blackend',
    'blackstart2',
    'blackend2',
    'enter',
    'enter2',
    'xpos1',
    'ypos1',
    'xpos2',
    'ypos2',
    'xscale',
    'yscale',
    'xscale2',
    'yscale2',
  ],
  characteraction: [
    'type',
    'name',
    'xpos',
    'ypos',
    'power',
    'times',
    'fadetime',
    'isblock',
    'random',
    'scale',
    'direction',
    'block',
  ],
  background: [
    'tiled',
    'isblock',
    ...unreadImageMotion,
    'xSclae',
    'image',
    'x',
    'y',
    'xScale',
    'yScale',
    'fadetime',
    'block',
    'screenadapt',
    'width',
    'height',
  ],
  image: [
    'tiled',
    ...unreadImageMotion,
    'image',
    'x',
    'y',
    'xScale',
    'yScale',
    'fadetime',
    'block',
    'screenadapt',
    'width',
    'height',
  ],
  imagerotate: ['angle', 'fadetime', 'block', 'inverse', 'circles', 'isblock', 'image', 'ease'],
  imagetween: [
    'tiled',
    'screenadapt',
    'xFrom',
    'yFrom',
    'xTo',
    'yTo',
    'xScaleFrom',
    'yScaleFrom',
    'xScaleTo',
    'yScaleTo',
    'duration',
    'block',
    'ease',
    'loop',
    'image',
    'xScale',
    'yScale',
    'x',
    'y',
    'fadetime',
    'yScaleto',
  ],
  backgroundtween: [
    'tiled',
    'screenadapt',
    'xFrom',
    'yFrom',
    'xTo',
    'yTo',
    'xScaleFrom',
    'yScaleFrom',
    'xScaleTo',
    'yScaleTo',
    'duration',
    'block',
    'ease',
    'loop',
    'image',
    'xScale',
    'yScale',
    'x',
    'y',
    'fadetime',
  ],
  blocker: [
    'a',
    'r',
    'g',
    'b',
    'afrom',
    'rfrom',
    'gfrom',
    'bfrom',
    'fadetime',
    'block',
    'initr',
    'style',
    'inverse',
    'image',
    'duration',
    'isblock',
    'ease',
  ],
  delay: ['time'],
  playmusic: ['block', 'intro', 'key', 'volume', 'delay', 'crossfade', 'fadetime'],
  stopmusic: ['fadetime', 'time'],
  playsound: [
    'key',
    'channel',
    'volume',
    'delay',
    'loop',
    'Delay',
    'block',
    'fadetime',
    'volum',
    'voluyme',
  ],
  stopsound: ['key', 'channel', 'fadetime', 'isblock', 'duration', 'fedatime', 'time', 'volume'],
  musicvolume: ['volume', 'fadetime', 'channel'],
  soundvolume: ['channel', 'volume', 'fadetime'],
  decision: ['options', 'values'],
  predicate: ['references'],
  endtip: ['block'],
  glitchtween: ['slot', 'glitchto', 'duration'],
  charslot: [
    'glitch',
    'matname',
    'ease',
    'slot',
    'name',
    'focus',
    'duration',
    'focusduration',
    'isblock',
    'delay',
    'afrom',
    'ato',
    'posfrom',
    'posto',
    'x',
    'y',
    'xscale',
    'yscale',
    'end',
    'action',
    'poszoom',
    'scale',
    'power',
    'times',
    'random',
    'bstart',
    'bend',
    'inverse',
    'block',
    'isCopy',
    'iscopy',
    'fadetime',
  ],
  multiline: ['name', 'delay', 'end'],
  // Extra keys below are present in the corpus but not read by these native
  // executors. They are explicitly ignored, rather than invented animations.
  camerashake: [
    'duration',
    'xstrength',
    'ystrength',
    'vibrato',
    'randomness',
    'fadeout',
    'stop',
    'block',
    'fadetime',
    'delay',
    'focus',
    'strength',
    'strengthX',
    'strengthY',
    'strengthZ',
  ],
  subtitle: [
    'hidelog',
    'text',
    'x',
    'y',
    'width',
    'size',
    'alignment',
    'delay',
    'duration',
    'block',
    'multi',
    'afrom',
    'ato',
  ],
  cameraeffect: ['effect', 'amount', 'initamount', 'fadetime', 'keep', 'block', 'from', 'to'],
};
export interface CapabilityGap {
  line: number;
  command: string;
  feature: string;
  reason: string;
}
// Literal keys present in official scripts but absent from these executors'
// native parameter readers. In particular, Image does not read a canvas layer.
export const unreadSceneFields: Record<string, readonly string[]> = {
  image: ['layer', 'isblock', 'ease', 'time', 'ypos', 'xpos', 'yScaleT', 'adetime', 'fxScale'],
  background: ['duration', 'xscale', 'yscale', 'ysclae', 'ypos', 'time'],
  character: [
    'blok',
    'time',
    'slot',
    'duration',
    'blo',
    'name1',
    'blackend1',
    'blackstart1',
    'fadeout',
    'blockl',
    'screenadapt',
    'nameage',
    'exit2',
    'foucs',
    'fpcus',
  ],
  imagetween: [
    'xfrom',
    'yfrom',
    'yto',
    'xto',
    'yTO',
    'yT',
    'xTO',
    'yfromScale',
    'xfromScale',
    'xScaleto',
  ],
  backgroundtween: [
    'yScaleto',
    'xfrom',
    'yfrom',
    'isblock',
    'else',
    'yto',
    'xto',
    'posto',
    'posfrom',
  ],
  delay: [
    'TIME',
    'block',
    'black',
    'fadetime',
    'yime',
    'timr',
    'timw',
    'title_test',
    'times',
    'tinme',
    'tim',
    't',
  ],
};
export const unreadPresentationFields: Record<string, readonly string[]> = {
  charslot: [
    'foucs',
    'duraiton',
    'grad',
    'blocker',
    'ocus',
    'pfrom',
    'direction',
    'charslot',
    'duratin',
    'aduration',
    'type',
    'bstrart',
    'duratio',
    'posform',
    'isblocke',
    'time',
    'Duration',
  ],
  characteraction: ['delay', 'duration', 'y', 'time', 'loop'],
  playsound: ['volum', 'voluyme', 'crosstime', 'delai', 'crossfade', 'y'],
  playmusic: ['crosstime', 'volu7me'],
  stopmusic: ['block', 'faddetime', 'fadeetime', 'fdetime', 'crossfade'],
  subtitle: ['fadetime'],
};
export const IGNORED_PARAMETERS: Record<string, readonly string[]> = {
  timerclear: ['afrom', 'ato'],
  delay: unreadSceneFields.delay,
  dialog: ignoredDialogParameters,
  avgdisplay: ['isblock'],
  showitem: ['fadestyle', 'width'],
  hideitem: ['block'],
  cgitem: ['duration', 'aFrom', 'aTo'],
  interlude: ['isblock', 'fadetime'],
  gridbg: ['blok'],
  largebgtween: ['xfrom', 'yfrom', 'xto', 'x'],
  imagerotate: ['isblock', 'image', 'ease'],
  sticker: ['isblock', 'afrom', 'ato', 'aduration', 'fadetime'],
  bgeffect: ['block', 'startdelay', 'duration', 'ease', 'loop'],
  blocker: ['initr', 'duration', 'isblock', 'ease'],
  focusout: ['fadetime'],
  curtain: ['ato', 'duration', 'isblock'],
  effect: ['xTo', 'yScale', 'z', 'ypos'],
  image: [...unreadSceneFields.image, ...unreadImageMotion],
  background: [...unreadSceneFields.background, 'isblock', ...unreadImageMotion, 'xSclae'],
  character: [...unreadSceneFields.character, 'block', ...unreadCharacterFields],
  imagetween: [
    ...unreadSceneFields.imagetween,
    'tiled',
    'screenadapt',
    'image',
    'xScale',
    'yScale',
    'x',
    'y',
    'fadetime',
    'yScaleto',
  ],
  backgroundtween: [
    ...unreadSceneFields.backgroundtween,
    'tiled',
    'screenadapt',
    'image',
    'xScale',
    'yScale',
    'x',
    'y',
    'fadetime',
  ],
  playmusic: [...unreadPresentationFields.playmusic, 'fadetime', 'block'],
  playsound: [...unreadPresentationFields.playsound, 'block', 'Delay', 'fadetime'],
  stopmusic: [...unreadPresentationFields.stopmusic, 'time'],
  charslot: [
    ...unreadPresentationFields.charslot,
    'poasfrom',
    'ease',
    'block',
    'isCopy',
    'iscopy',
    'fadetime',
  ],
  characteraction: [...unreadPresentationFields.characteraction, 'block'],
  stopsound: ['isblock', 'duration', 'fedatime', 'time', 'volume'],
  musicvolume: ['channel'],
  camerashake: [
    'isblock',
    'fadetime',
    'delay',
    'focus',
    'strength',
    'strengthX',
    'strengthY',
    'strengthZ',
  ],
  subtitle: [
    ...unreadPresentationFields.subtitle,
    'delay',
    'duration',
    'block',
    'multi',
    'afrom',
    'ato',
  ],
};
export const SUPPORTED = new Set([
  'skiptothis',
  'startbattle',
  'gotopage',
  'tutorial',
  'glitchtween',
  'imgeffect',
  'stickertween',
  'spellsticker',
  'spellstickerclear',
  'usewhiteloadingmaskonfinish',
  'video',
  'skipnode',
  'label',
  'warp',
  'timersticker',
  'timerclear',
  'showitem',
  'hideitem',
  'largebg',
  'verticalbg',
  'charactercutin',
  'theater',
  'avgdisplay',
  'animtext',
  'animtextclean',
  'cgitem',
  'gridbg',
  'largebgtween',
  'imagerotate',
  'effect',
  'interlude',
  'hidecgitem',
  'sticker',
  'stickerclear',
  'bgeffect',
  'focusout',
  'focusparam',
  'curtain',
  'header',
  'dialog',
  'character',
  'characteraction',
  'charslot',
  'multiline',
  'subtitle',
  'camerashake',
  'cameraeffect',
  'background',
  'image',
  'imagetween',
  'backgroundtween',
  'blocker',
  'delay',
  'playmusic',
  'stopmusic',
  'playsound',
  'stopsound',
  'musicvolume',
  'soundvolume',
  'decision',
  'predicate',
  'endtip',
]);
// DialogPanel, PlaybackPanel and ReaderAdapter all register Aside. It reads
// command text but no name/position parameters (unlike Dialog).
SUPPORTED.add('aside');
export function unsupportedCommands(commands: Command[]): Command[] {
  return commands.filter((c) => !SUPPORTED.has(c.name) && !nativeUnhandledCommands.has(c.name));
}

export function capabilityGaps(commands: Command[]): CapabilityGap[] {
  const gaps: CapabilityGap[] = [];
  const holders = new Map<string, string>();
  for (const c of commands) {
    const add = (feature: string, reason: string) =>
      gaps.push({ line: c.line, command: c.name, feature, reason });
    if (nativeUnhandledCommands.has(c.name)) continue;
    // Native manager disposes by id before inspecting any other parameters when name is empty.
    if (c.name === 'avgdisplay' && !String(c.params.name ?? '')) {
      if (!String(c.params.id ?? '')) add('avgdisplay.id', '缺少显示对象标识');
      holders.delete(String(c.params.id ?? ''));
      continue;
    }
    const imageHolder = c.name === 'avgdisplay' && String(c.params.style).toLowerCase() === 'bg';
    const animatedHolder =
      c.name === 'avgdisplay' && String(c.params.style).toLowerCase() === 'animekv';
    const params = animatedHolder
      ? [
          ...PARAMETERS.avgdisplay,
          'xfrom',
          'yfrom',
          'xto',
          'yto',
          'scalex',
          'scaley',
          'scalexfrom',
          'scaleyfrom',
          'scalexto',
          'scaleyto',
          'entryindex',
          'entryfrom',
          'entryto',
          'duration',
          'ease',
          'block',
        ]
      : imageHolder
        ? [...PARAMETERS.avgdisplay, 'afrom', 'ato', 'duration', 'block', 'isblock']
        : PARAMETERS[c.name];
    if (
      c.name === 'hidecgitem' &&
      !commands.some((previous) => previous.line < c.line && previous.name === 'cgitem')
    )
      continue;
    if (
      c.name === 'video' &&
      (typeof c.params.res !== 'string' ||
        !/^video\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.mp4$/i.test(c.params.res))
    )
      add('video.resource', '不支持的影片路径格式');
    if (
      c.name === 'spellsticker' &&
      String(c.params.id ?? '') &&
      String(c.params.action ?? 'show').toLowerCase() !== 'hide'
    ) {
      if (!['fire', 'sami'].includes(String(c.params.style ?? 'sami').toLowerCase()))
        add('spellsticker.style', '不支持的咒文样式');
      const text = String(c.text ?? ''),
        parts = text ? stampParagraphs(text) : [];
      if (!parts || parts.some((p) => p.includes('\n')))
        add('spellsticker.format', '不支持的咒文排版');
    }
    if (c.name === 'showitem') {
      if (String(c.params.style ?? 'photo') !== 'photo')
        add('showitem.style:' + c.params.style, '道具槽位的演出模板仍待核对');
      if (!c.params.image) add('showitem.empty-image', '空道具图片的显示待核对');
    }
    if (c.name === 'cgitem') {
      if (String(c.params.style ?? 'cg') !== 'cg')
        add('cgitem.style:' + c.params.style, '该 CG 物件样式仍待还原');
      if (!c.params.image) add('cgitem.empty-image', '图像名称为空');
      if (Number(c.params.layer ?? 0) < 0) add('cgitem.negative-layer', '不支持负层级图像');
    }
    if (['largebg', 'verticalbg'].includes(c.name)) {
      const group = gridGroup(c.params);
      if (group.names.length && !stripLayout(c.params, c.name === 'verticalbg'))
        add(c.name + '.layout', '长背景数量或尺寸无效');
      if (
        c.params.initposmode !== undefined &&
        !['default', 'center', 'upperleft', 'lowercenter'].includes(String(c.params.initposmode))
      )
        add(c.name + '.initposmode', '不支持的起始视角');
    }
    if (
      c.name === 'charactercutin' &&
      !['fade', 'horiz_expand_center'].includes(String(c.params.fadestyle ?? 'fade'))
    )
      add('charactercutin.fadestyle:' + c.params.fadestyle, '不支持的切入动画');
    if (c.name === 'theater' && c.params.mode !== undefined) {
      try {
        nativeBoolean(c.params.mode);
      } catch {
        add('theater.mode', '剧场模式参数转换失败');
      }
    }
    if (c.name === 'avgdisplay') {
      const id = String(c.params.id ?? ''),
        name = String(c.params.name ?? '').toLowerCase();
      if (!id) add('avgdisplay.id', '缺少显示对象标识');
      if (name) {
        const identity = [c.params.style, c.params.slot, name, c.params.layer ?? 1]
          .join('/')
          .toLowerCase();
        if (holders.has(id) && !((imageHolder || animatedHolder) && holders.get(id) === identity))
          add('avgdisplay.update', '不支持此显示对象的更新方式');
        holders.set(id, identity);
        const slot = String(c.params.slot).toLowerCase();
        const layer = Number(c.params.layer ?? 1);
        const supported =
          (slot === 'bgover' &&
            ((name === 'avg_66_mantra_source_stone' && layer === 2) ||
              (name === 'avg_056_stage_02' && [2, 3, 4].includes(layer)) ||
              ([
                'avg_fireworks_01',
                'avg_distorsion_01',
                'avg_rain_03',
                'avg_sunshine_01',
                'avg_064_blood_falling_01',
                'avg_spotlight_02',
                'avg_059_purple_fire_01',
              ].includes(name) &&
                layer === 1) ||
              (['avg_042_glow_01', 'avg_042_glow_02'].includes(name) &&
                [1, 2, 5].includes(layer)))) ||
          (name === 'avg_057_steam' && slot === 'charover' && layer === 1);
        const bgSupported =
          imageHolder && slot === 'bgover' && [1, 2].includes(Number(c.params.layer ?? 1));
        const battleHolder =
          String(c.params.style).toLowerCase() === 'effect' &&
          ['avg_062_black_02', 'avg_064_a_flash_of_knife_01', 'avg_064_slashscreen_01'].includes(
            name,
          ) &&
          slot === 'bgover' &&
          layer === 1;
        const kvSupported =
          animatedHolder &&
          [
            'act47side_01',
            'act4mainss_01',
            'act49side_01',
            'act49side_02',
            'act53side_01',
            'act3mainss_01',
            'act3mainss_02',
            'act55side_01',
            'act54side_01',
          ].includes(name) &&
          slot === 'cgover' &&
          layer === 1;
        if (
          !kvSupported &&
          !bgSupported &&
          !battleHolder &&
          (!supported || String(c.params.style).toLowerCase() !== 'bgeffect')
        )
          add('avgdisplay.variant:' + name, '不支持此显示对象的资源类型、位置或层级');
      } else {
        holders.delete(id);
      }
    }
    if (c.name === 'animtext') {
      if (String(c.params.name ?? '').toLowerCase() !== 'group_location_stamp')
        add('animtext.template:' + c.params.name, '不支持此文字动画');
      if (
        !['', 'avg_only_heavy', 'avg_only_medium', 'avg_both'].includes(
          String(c.params.style ?? ''),
        )
      )
        add('animtext.style:' + c.params.style, '不支持的动画片段');
      const parts = stampParagraphs(String(c.text ?? ''));
      if (!parts || parts.some((part) => part.includes('\n')))
        add('animtext.format', '不支持的文字排版');
      const pos = String(c.params.pos ?? '0,0').split(',');
      if (pos.length !== 2 || pos.some((s) => !s.trim() || !Number.isFinite(Number(s))))
        add('animtext.pos', '位置参数格式不正确');
    }
    if (
      c.name === 'animtextclean' &&
      c.params.id &&
      commands.filter((command) => command.name === 'animtext' && command.line < c.line).length > 1
    )
      add('animtextclean.multi-id', '不支持同时清除这些文字动画');
    if (c.name === 'tutorial' && c.text)
      add('tutorial.visual', '独立教程 UI 不属于此非可视信号执行器');
    if (!params) {
      add(c.name, '当前版本不支持此指令');
      continue;
    }
    for (const key of Object.keys(c.params))
      if (
        !params.includes(key) &&
        !IGNORED_PARAMETERS[c.name]?.includes(key) &&
        !(
          c.name === 'interlude' &&
          key === 'direction' &&
          commands.some(
            (previous) =>
              previous.line < c.line &&
              previous.name === 'interlude' &&
              previous.params.channel === c.params.channel &&
              previous.params.maskid,
          ) &&
          !c.params.maskid
        )
      )
        add(`${c.name}.${key}`, '当前版本不支持此参数');
    if (
      !IGNORED_PARAMETERS[c.name]?.includes('ease') &&
      c.params.ease !== undefined &&
      nativeEase(c.params.ease) === null
    )
      add(`${c.name}.ease:${c.params.ease}`, '原版未识别的缓动枚举');
    for (const key of [
      'isPractice',
      'block',
      'isblock',
      'tiled',
      'hidelog',
      'loop',
      'end',
      'stop',
      'fadeout',
      'keep',
      'multi',
      'grad',
      'blur',
      'inverse',
      'fade',
      'is_skippable',
      'is_autoable',
      'is_tutorial',
      'is_video_only',
      'deny_auto_switch_scene',
      'dont_clear_gameobjectpool_onstart',
    ]) {
      if (IGNORED_PARAMETERS[c.name]?.includes(key)) continue;
      if (c.params[key] === undefined) continue;
      try {
        const value = nativeBoolean(c.params[key]);
        if (
          key === 'loop' &&
          ['imagetween', 'backgroundtween', 'largebgtween'].includes(c.name) &&
          value &&
          nativeBoolean(c.params.block ?? false) &&
          Number(c.params.duration ?? 0) > 0
        )
          add(`${c.name}.infinite-block`, '原版无限循环且阻塞，需宿主中断');
      } catch {
        add(`${c.name}.${key}`, '原版布尔参数转换失败');
      }
    }
    if (
      !IGNORED_PARAMETERS[c.name]?.includes('screenadapt') &&
      c.params.screenadapt !== undefined &&
      !(typeof c.params.screenadapt === 'string' && ['image', 'background'].includes(c.name)) &&
      !['coverall', 'showall', 'width', 'height', 'fill'].includes(String(c.params.screenadapt))
    )
      add(`${c.name}.screenadapt:${c.params.screenadapt}`, '未识别的屏幕适配模式');
    if (c.name === 'interlude') {
      if (
        c.params.channel === undefined &&
        nativeBoolean(c.params.clear ?? false) &&
        nativeBoolean(c.params.block ?? false)
      )
        add('interlude.clear-all', '不支持此转场结束方式');
      if (
        c.params.channel !== undefined &&
        Number(c.params.channel) >= 0 &&
        !c.params.maskid &&
        !nativeBoolean(c.params.clear ?? false) &&
        !commands.some(
          (previous) =>
            previous.line < c.line &&
            previous.name === 'interlude' &&
            previous.params.channel === c.params.channel &&
            previous.params.maskid,
        )
      )
        add('interlude.unmasked-channel', '转场缺少遮罩');
      if (
        c.params.maskid &&
        ![
          'group_interclude_vertical_common',
          'ui_cutin_mask_vertical',
          'ui_cutin_mask_horizon',
          'group_interclude_square_common',
          'interlude_dialog_left',
        ].includes(String(c.params.maskid))
      )
        add('interlude.mask:' + c.params.maskid, '不支持此转场遮罩');
      if (
        ![0, 1, 2, 3, 4].includes(interludeType(c.params.type)) ||
        (interludeType(c.params.type) === 4 && nativeBoolean(c.params.block ?? false))
      )
        add('interlude.type:' + c.params.type, '不支持此角色或背景转场');
      if (
        ![0, 1, 2].includes(Number(c.params.style ?? 0)) &&
        !(
          Number(c.params.style) === 3 &&
          ['ui_cutin_mask_horizon', 'interlude_dialog_left'].includes(String(c.params.maskid)) &&
          !nativeBoolean(c.params.clear ?? false)
        )
      )
        add('interlude.style:' + c.params.style, '不支持此遮罩样式');
      for (const k of [
        'size',
        'offset',
        'pfrom',
        'pto',
        'sfrom',
        'sto',
        'tsfrom',
        'tsto',
        'icharpos',
        'icharscale',
      ])
        try {
          interludeVector(c.params[k]);
        } catch {
          add('interlude.' + k, '不支持此坐标格式');
        }
    }
    // Both native fit modes coincide in this player's fixed 1280x720 viewport.
    // Story metadata parses the case-insensitive enum and its native fallback.
    if (
      c.name === 'glitchtween' ||
      (c.name === 'charslot' && nativeBoolean(c.params.glitch ?? false))
    ) {
      const preset = String(
        c.params[c.name === 'glitchtween' ? 'glitchto' : 'matname'] ?? 'greenscreen_middle',
      );
      if (!glitchPresetNames.includes(preset))
        add('glitch.preset:' + preset, '未识别的原版故障材质预设');
      if (
        c.name === 'glitchtween' &&
        !['', 'm', 'middle', 'l', 'left', 'r', 'right'].includes(
          String(c.params.slot ?? '').toLowerCase(),
        )
      )
        add('glitchtween.slot', '不支持此图层特效');
    }
    if (c.name === 'charslot') {
      const slot = String(c.params.slot ?? '').toLowerCase();
      const focusOnly =
        ['n', 'all'].includes(slot) &&
        Object.keys(c.params).every((k) => ['slot', 'focus', 'name'].includes(k));
      if (!focusOnly && !['', 'm', 'middle', 'l', 'left', 'r', 'right'].includes(slot))
        add(`charslot.slot:${slot}`, '不支持此人物位置或层级');
      if (
        c.params.focus !== undefined &&
        String(c.params.focus)
          .split(';')
          .some((s) => s.startsWith('custom'))
      )
        add('charslot.focus', '不支持此聚焦方式');
      for (const key of ['posfrom', 'posto', 'poszoom'] as const)
        if (
          c.params[key] !== undefined &&
          nativeVector(c.params[key], key).some((n) => !Number.isFinite(n))
        )
          add(`charslot.${key}`, '坐标产生非有限几何');
      if (!['', 'jump', 'shake', 'shakemove', 'zoom'].includes(String(c.params.action ?? '')))
        add(`charslot.action:${c.params.action}`, '原版未识别的动作名，需要核查源脚本');
      if (
        Number(c.params.power ?? 0) < 0 &&
        ['shake', 'shakemove'].includes(String(c.params.action))
      )
        add('charslot.negative-shake-power', '不支持负强度震动');
      for (const key of ['xscale', 'yscale'])
        if (c.params[key] !== undefined && Math.abs(Number(c.params[key])) < 1e-5)
          add(`charslot.${key}:zero`, '不支持此缩放比例');
    }
    if (
      c.name === 'characteraction' &&
      !['move', 'jump', 'shake', 'zoom', 'exit'].includes(String(c.params.type ?? ''))
    )
      add('characteraction.type', '原版未识别的人物动作');
    if (c.name === 'camerashake') {
      if (Number(c.params.xstrength ?? 1) < 0 || Number(c.params.ystrength ?? 0) < 0)
        add('camerashake.negative-strength', '不支持负强度镜头震动');
      try {
        if (
          Number(c.params.duration ?? -1) < 0 &&
          nativeBoolean(c.params.block ?? false) &&
          !nativeBoolean(c.params.stop ?? false)
        )
          add('camerashake.infinite-block', '原版无限循环且阻塞，需要宿主中断');
      } catch {
        /* The boolean conversion gap was recorded above. */
      }
    }
    if (c.name === 'cameraeffect') {
      if (!['', 'Grayscale', 'Colorinverse', 'Chaos'].includes(String(c.params.effect ?? '')))
        add('cameraeffect.effect', '原版未识别的滤镜名');
      if (c.params.effect === 'Chaos')
        for (const key of ['from', 'to'])
          if (
            c.params[key] !== undefined &&
            !['', 'chaos_none', 'chaos_normal', 'chaos_hard'].includes(String(c.params[key]))
          )
            add(`cameraeffect.${key}`, '尚未核对的 Chaos 材质预设');
    }
    if (c.name === 'imgeffect') {
      const name = resourceKey(c.params.name);
      if (name && !IMAGE_EFFECTS.includes(name))
        add('imgeffect.prefab:' + name, '不支持此图像特效');
    }
    if (c.name === 'bgeffect') {
      const name = String(c.params.name ?? '').toLowerCase();
      if (name && ![...MOHU_EFFECTS, ...SIGNAL_EFFECTS, ...NATIVE_PARTICLE_EFFECTS].includes(name))
        add('bgeffect.prefab:' + name, '不支持此背景特效');
      if (
        [...MOHU_EFFECTS, ...SIGNAL_EFFECTS].includes(name) &&
        (['x', 'y', 'flip'].some((k) => Number(c.params[k] ?? 0) !== 0) ||
          ['xto', 'yto'].some((k) => Number(c.params[k] ?? -1) !== -1))
      )
        add('bgeffect.camera-transform', '不支持此背景特效的移动或翻转');
    }
    if (c.name === 'effect') {
      const name = String(c.params.name ?? '').toLowerCase();
      if (name && !FOREGROUND_EFFECTS.includes(name))
        add('effect.prefab:' + name, '不支持此前景特效');
      if (!name && Object.keys(c.params).length) add('effect.empty-name', '特效名称为空');
    }
    if (c.name === 'focusout') {
      if (c.params.type === 'customchar') add('focusout.' + c.params.type, '不支持此聚焦对象');
      for (const key of ['from', 'to'])
        if (c.params[key] !== undefined && !Number.isFinite(Math.fround(Number(c.params[key]))))
          add('focusout.' + key, '数值会产生非有限滤镜参数');
    }
    if (
      c.name === 'sticker' &&
      (Number(c.params.width ?? 1280) <= 0 ||
        Number(c.params.size ?? 24) <= 0 ||
        !Number.isInteger(Number(c.params.size ?? 24)))
    )
      add('sticker.invalid-size', '非正尺寸的原版布局需要单独核对');
    const text = ['subtitle', 'sticker'].includes(c.name) ? String(c.params.text ?? '') : c.text;
    if (
      text &&
      /<\/?(?:color|size|b|i|material|quad|sprite)\b/i.test(text) &&
      !(c.name === 'sticker' && stickerColorText(text)) &&
      !(['dialog', 'aside', 'multiline', 'subtitle'].includes(c.name) && readingMarkup(text))
    )
      add('text.richtext', '不支持此文字格式');
  }
  return gaps;
}
