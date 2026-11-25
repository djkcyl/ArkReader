import type { Command } from '../core/scheduler';
import { nativeBoolean } from '../core/values';
import { parseStoryHeader } from '../core/story-header';
import { NATIVE } from './runtime';

type Params = Record<string, unknown>;
const slotNames: Record<string, string> = {
  m: '中间',
  middle: '中间',
  l: '左侧',
  left: '左侧',
  r: '右侧',
  right: '右侧',
  all: '全部',
};
const actions: Record<string, string> = {
  move: '移动',
  jump: '跳跃',
  shake: '震动',
  shakemove: '震动并移动',
  zoom: '缩放',
  exit: '退场',
};
const slot = (value: unknown) =>
  slotNames[String(value ?? '').toLowerCase()] ?? String(value ?? '');
const flag = (value: unknown, fallback = false) =>
  value === undefined ? fallback : nativeBoolean(value);
const seconds = (value: unknown) => `${value} 秒`;
const transition = (value: unknown) =>
  Number(value) === 0 ? '立即切换' : `在 ${seconds(value)} 内过渡`;
const wait = (enabled: boolean) => (enabled ? '完成后再执行下一条' : '同时继续执行后续指令');

/** Defaults read by the corresponding executors, before temporary quick-play scaling. */
export function commandDefaults(command: Command): Params {
  const p = command.params;
  switch (command.name) {
    case 'character':
      return {
        focus: 0,
        fadetime: NATIVE.characterFade,
        isblock: false,
        blackstart: 0,
        blackend: 0,
        blackstart2: 0,
        blackend2: 0,
        xscale: 1,
        yscale: 1,
        xscale2: 1,
        yscale2: 1,
      };
    case 'charslot':
      return {
        slot: '',
        duration: 0,
        focusduration: 0,
        delay: 0,
        focus: 'all',
        end: true,
        isblock: false,
      };
    case 'characteraction':
      return {
        name: 'left',
        fadetime: ['exit', 'zoom'].includes(String(p.type)) ? 1 : 0.5,
        isblock: false,
      };
    case 'background':
    case 'image':
      return {
        x: 0,
        y: 0,
        xScale: 1,
        yScale: 1,
        width: 1,
        height: 1,
        fadetime: 0,
        block: false,
        tiled: false,
        screenadapt: '',
      };
    case 'backgroundtween':
    case 'imagetween':
    case 'largebgtween':
      return { duration: 0, block: false, ease: 1, loop: false };
    case 'largebg':
    case 'verticalbg':
    case 'gridbg':
      return { x: 0, y: 0, xScale: 1, yScale: 1, fadetime: 0, block: false };
    case 'blocker':
      return { r: 0, g: 0, b: 0, a: 1, fadetime: NATIVE.blockerFade, block: false, inverse: false };
    case 'imagerotate':
      return { angle: 0, circles: 0, inverse: false, fadetime: 0, block: false };
    case 'glitchtween':
      return { duration: 0, glitchto: 'greenscreen_middle' };
    case 'playmusic':
      return { volume: 1, delay: 0, crossfade: 0.4 };
    case 'playsound':
      return { volume: 1, delay: 0, loop: false };
    case 'stopmusic':
    case 'stopsound':
      return { fadetime: 0 };
    case 'musicvolume':
    case 'soundvolume':
      return { volume: 1, fadetime: 0 };
    case 'delay':
      return { time: 0 };
    case 'multiline':
      return { end: false };
    case 'subtitle':
      return { x: 0, y: 0, width: 1280, size: 24, hidelog: false };
    case 'sticker':
      return {
        x: 0,
        y: 0,
        width: 1280,
        size: 24,
        alignment: 'left',
        multi: false,
        hidelog: false,
        delay: 1,
        block: '新建时为 true，更新已有标识时为 false',
        duration: '新建默认 0.15 秒；隐藏已有贴字时使用原版淡出时间',
      };
    case 'theater':
      return { mode: true };
    case 'camerashake':
      return {
        duration: -1,
        xstrength: 1,
        ystrength: 0,
        vibrato: 10,
        randomness: 90,
        fadeout: false,
        stop: false,
        block: false,
      };
    case 'cameraeffect':
      return String(p.effect) === 'Grayscale'
        ? { fadetime: 0.4, initamount: -1, amount: 1, keep: false, block: false }
        : String(p.effect) === 'Chaos'
          ? { fadetime: 0.4, keep: false }
          : { keep: false };
    case 'curtain':
      return {
        direction: -1,
        fillfrom: 1,
        fillto: 0,
        fadetime: 0.4,
        delay: 0,
        grad: false,
        block: false,
      };
    case 'focusparam':
      return { blur: true };
    case 'focusout':
      return { from: -1, to: 0, duration: 0, block: false };
    case 'video':
      return { fadeoutdelay: 0 };
    case 'showitem':
      return { offsetx: 0, offsety: 0, black: 0.4, fadetime: 0.5 };
    case 'hideitem':
      return { fadetime: 0.5 };
    case 'hidecgitem':
      return { duration: p.fadetime ?? 0.13, block: false };
    case 'cgitem':
      return {
        sfrom: 1,
        sto: 1,
        afrom: 1,
        ato: 1,
        rfrom: -1,
        rto: 0,
        rduration: 0,
        pduration: 0,
        pdelay: 0,
        sduration: 0,
        sdelay: 0,
        aduration: 0,
        adelay: 0,
        ease: 1,
        block: false,
      };
    case 'charactercutin':
      return { fadetime: 0.4 };
    case 'timerclear':
      return { duration: 0.13 };
    case 'timersticker':
      return { x: 0, y: 0, width: 1280, afrom: 0, ato: 1, duration: 1 };
    case 'animtext':
    case 'spellsticker':
    case 'spellstickerclear':
      return { block: false };
    case 'effect':
      return {
        x: 0,
        y: 0,
        rox: 0,
        roy: 0,
        roz: 0,
        delay: 0,
        movedelay: 0,
        movetime: 0,
        duration: 0,
      };
    case 'bgeffect':
      return { x: 0, y: 0, delay: 0, movedelay: 0, movetime: 0, fadetime: 0, fade: false };
    default:
      return {};
  }
}

export function parameterApplies(command: Command, key: string): boolean {
  if (command.name === 'cameraeffect') {
    const fields: Record<string, string[]> = {
      Grayscale: ['effect', 'initamount', 'amount', 'fadetime', 'keep', 'block'],
      Colorinverse: ['effect', 'keep'],
      Chaos: ['effect', 'keep', 'from', 'to', 'fadetime'],
    };
    const relevant = fields[String(command.params.effect)];
    if (relevant) return relevant.includes(key);
  }
  return true;
}

export function commandBehavior(command: Command, plain: (value: unknown) => string): string {
  const p = command.params,
    d = commandDefaults(command),
    value = (key: string) => p[key] ?? d[key];
  const resource = (key: string) => plain(p[key]) || '空';
  const blocking = (key = 'block') => wait(flag(value(key)));
  switch (command.name) {
    case 'header': {
      const h = parseStoryHeader([command]);
      return `${h.isAutoable ? '允许' : '禁止'}自动播放；${h.isSkippable ? '允许' : '禁止'}跳过${h.isTutorial ? '；教程剧情' : ''}${h.isVideoOnly ? '；纯影片剧情' : ''}。`;
    }
    case 'dialog':
    case 'aside':
      return command.text ? '' : '隐藏对白框，继续执行后续指令。';
    case 'multiline':
      if (!command.text) return '隐藏对白框，继续执行后续指令。';
      return `${flag(p.end) ? '合并到当前段落后结束本段' : '追加到当前段落'}；${p.delay === undefined ? '逐字速度跟随当前播放模式' : `逐字延迟基准 ${seconds(p.delay)}，随播放速度调整`}。`;
    case 'character': {
      const first = plain(p.name),
        second = plain(p.name2),
        focus = Number(value('focus'));
      if (!first && !second)
        return `清除全部立绘；${transition(value('fadetime'))}，${blocking('isblock')}。`;
      const images =
        first && !second
          ? `居中显示「${first}」`
          : [first && `左侧「${first}」`, second && `右侧「${second}」`].filter(Boolean).join('，');
      return `${images}；${focus === 0 ? '全部立绘正常亮度' : focus === 2 ? '聚焦第二位立绘' : focus <= 1 ? '聚焦第一位立绘' : '全部立绘变暗'}。${transition(value('fadetime'))}，${blocking('isblock')}；同一角色换表情时直接替换。`;
    }
    case 'charslot': {
      const s = String(value('slot')).toLowerCase();
      if (!s)
        return `清空全部立绘槽位并重置位移、缩放；${transition(value('duration'))}，${blocking('isblock')}。`;
      const focus = String(value('focus') || 'all')
        .split(';')
        .map(slot)
        .join('、');
      if (!['m', 'middle', 'l', 'left', 'r', 'right'].includes(s))
        return `只调整立绘焦点：${focus}；此槽位名不对应图片对象。`;
      const image =
        p.name === 'char_empty'
          ? '清空槽位立绘'
          : p.name
            ? `换为「${resource('name')}」`
            : '保留当前立绘';
      const motion = p.action ? `；${actions[String(p.action)] ?? p.action}` : '';
      return `${slot(s)}槽位：${image}${motion}；焦点为${focus}，其余立绘变暗。演出 ${seconds(value('duration'))}，焦点过渡 ${seconds(value('focusduration'))}。${flag(value('end')) ? blocking('isblock') : '继续组装当前动画序列，不在此等待结束'}。`;
    }
    case 'characteraction': {
      const name = String(value('name')),
        target =
          p.type === 'exit'
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
      return `${slot(target)}立绘${actions[String(p.type)] ?? `执行动作「${plain(p.type)}」`}；${seconds(value('fadetime'))}，${blocking('isblock')}。移动与跳跃的位置是相对位移；退场位置是目标坐标，缩放位置是归一化锚点。`;
    }
    case 'background':
    case 'image':
      return `${p.image ? '显示或替换' : '清除'}${command.name === 'background' ? '背景' : '叠加图片'}${p.image ? `「${resource('image')}」` : ''}；${transition(value('fadetime'))}，${blocking()}。位置（${value('x')}，${value('y')}），缩放（${value('xScale')}，${value('yScale')}）。`;
    case 'backgroundtween':
    case 'imagetween':
    case 'largebgtween':
      return `对当前${command.name === 'backgroundtween' ? '背景' : command.name === 'imagetween' ? '叠加图片' : '大型背景'}的位置与缩放做过渡；${transition(value('duration'))}，${flag(value('loop')) ? '循环执行' : '执行一次'}，${blocking()}。未写出的起点沿用当前值，未写出的终点沿用起点。`;
    case 'largebg':
    case 'verticalbg':
    case 'gridbg':
      return `${p.imagegroup || p.cggroup ? '使用图片组拼接' : '清除'}${command.name === 'verticalbg' ? '纵向背景' : command.name === 'gridbg' ? '网格背景' : '大型背景'}；${transition(value('fadetime'))}，${blocking()}。`;
    case 'blocker':
      return `将遮罩变为 RGB（${value('r')}，${value('g')}，${value('b')}），透明度 ${value('a')}；${transition(value('fadetime'))}，${blocking()}。未指定的起始颜色与透明度沿用当前遮罩。`;
    case 'imagerotate':
      return `将当前叠加图片旋转至 ${value('angle')}°，附加 ${value('circles')} 圈${flag(value('inverse')) ? '，反向旋转' : ''}；${transition(value('fadetime'))}，${blocking()}。`;
    case 'glitchtween':
      return `将${slot(p.slot)}槽位的故障材质参数过渡到「${value('glitchto')}」，耗时 ${seconds(value('duration'))}；完成后继续。此指令本身不启用故障效果。`;
    case 'playmusic':
      return `${p.intro ? `先播放前奏「${resource('intro')}」，再` : '直接'}循环播放「${resource('key')}」；音量 ${Number(value('volume')) * 100}%，延迟 ${seconds(value('delay'))}，交叉淡化 ${seconds(value('crossfade'))}；不等待音乐结束。`;
    case 'playsound':
      return `在声道「${plain(p.channel ?? p.key)}」${flag(value('loop')) ? '循环' : '单次'}播放「${resource('key')}」；音量 ${Number(value('volume')) * 100}%，延迟 ${seconds(value('delay'))}；不等待音效结束。`;
    case 'stopmusic':
      return `停止背景音乐；淡出 ${seconds(value('fadetime'))}，继续执行后续指令。`;
    case 'stopsound':
      return `停止声道「${plain(p.channel ?? p.key) || '默认'}」的音效；淡出 ${seconds(value('fadetime'))}。`;
    case 'musicvolume':
    case 'soundvolume':
      return `把${command.name === 'musicvolume' ? '背景音乐' : `声道「${plain(p.channel) || '默认'}」`}音量调整为 ${Number(value('volume')) * 100}%；过渡 ${seconds(value('fadetime'))}。`;
    case 'video':
      return `播放影片「${resource('res')}」，等影片结束后再继续；淡出前延迟 ${seconds(value('fadeoutdelay'))}。`;
    case 'delay':
      return `暂停脚本推进 ${seconds(value('time'))}；快进与阅读模式会按播放器规则省略此等待。`;
    case 'decision':
      return '等待玩家选择；选中项对应的值用于后续条件分支。';
    case 'predicate':
      return p.references === undefined
        ? '结束条件限制，继续公共剧情。'
        : `仅当最近选择值属于「${plain(p.references)}」时执行接下来的分支，直到下一条条件指令。`;
    case 'label':
      return '注册跳转位置；跳转后从标签的下一条指令继续。';
    case 'warp':
      return '跳到同名标签之后，不重置已有画面与音频；不存在的标签不改变执行位置。';
    case 'subtitle':
      return '显示字幕；位置使用 1280×720 基准坐标，点击或自动推进后继续。未提供文字时隐藏字幕。';
    case 'sticker':
      return '新标识创建贴字；已有标识在 multi=true 时追加文字，否则隐藏该贴字。新建空文本或未提供标识时不创建；block 的默认值在新建与更新时不同。';
    case 'stickertween':
      return `按标识驱动贴字的位置、旋转、透明度与缩放动画；${flag(p.join) ? '与已有动画并行' : '接在已有动画之后'}${flag(p.isend) ? '，结束本段序列' : ''}。各属性分别使用自己的持续时间。`;
    case 'stickerclear':
      return '清除当前贴字显示，并释放相应的文字等待。';
    case 'spellsticker':
      return `${String(p.action).toLowerCase() === 'hide' ? '隐藏' : '显示'}咒文贴字「${resource('id')}」，使用样式「${plain(p.style) || 'sami'}」；${blocking()}。`;
    case 'spellstickerclear':
      return '清除咒文贴字及其等待状态。';
    case 'timersticker':
      return `显示计时文字，目标时间为 ${plain(p.time)}；透明度从 ${value('afrom')} 到 ${value('ato')}，过渡 ${seconds(value('duration'))}。`;
    case 'timerclear':
      return `在 ${seconds(value('duration'))} 内隐藏计时文字。`;
    case 'camerashake':
      return flag(value('stop')) || Number(value('duration')) === 0
        ? '停止镜头震动并复位。'
        : `镜头按横向强度 ${value('xstrength')}、纵向强度 ${value('ystrength')} 震动；${Number(value('duration')) < 0 ? '持续循环，直到停止指令' : `持续 ${seconds(value('duration'))}`}，${blocking()}。`;
    case 'cameraeffect': {
      const e = String(p.effect);
      if (e === 'Grayscale')
        return `灰度从${Number(value('initamount')) < 0 ? '当前值' : value('initamount')}过渡到 ${value('amount')}，耗时 ${seconds(value('fadetime'))}；${flag(value('keep')) ? '保留最终灰度' : '完成后恢复彩色'}，${blocking()}。`;
      if (e === 'Colorinverse') return `${flag(value('keep')) ? '启用' : '关闭'}反色；立即继续。`;
      if (e === 'Chaos')
        return `${flag(value('keep')) ? '启用' : '关闭'}扰动材质，过渡 ${seconds(value('fadetime'))}；材质首次启用时绑定起始和目标预设。`;
      return `应用镜头效果「${resource('effect')}」。`;
    }
    case 'theater':
      return `${flag(value('mode'), true) ? '进入' : '退出'}剧场模式；剧场内按脚本演出，暂时隐藏常规播放操作。`;
    case 'effect':
      return `${p.name ? '生成' : '清除'}前景特效${p.name ? `「${resource('name')}」` : ''}；延迟 ${seconds(value('delay'))}，寿命 ${Number(value('duration')) > 0 ? seconds(value('duration')) : '由资源本身或清除指令决定'}。可设置移动终点和三轴旋转。`;
    case 'bgeffect':
      return `${p.name ? '设置' : '清除'}背景特效${p.name ? `「${resource('name')}」` : ''}；${flag(value('fade')) ? `使用 ${seconds(value('fadetime'))} 的淡变` : '不额外启用淡变'}，支持延迟和移动。`;
    case 'imgeffect':
      return p.name
        ? `把图片「${resource('image')}」绑定到图片特效「${resource('name')}」，按层级和坐标显示。`
        : '清除指定层的图片特效。';
    case 'focusparam':
      return `${flag(value('blur'), true) ? '启用' : '关闭'}景深模糊；更新失焦效果预设。`;
    case 'focusout':
      return `调整指定层或对象的失焦强度，从${Number(value('from')) < 0 ? '当前值' : value('from')}到 ${value('to')}，耗时 ${seconds(value('duration'))}；${blocking()}。`;
    case 'curtain':
      return `${Number(value('direction')) < 0 ? '清除幕布' : `调整方向 ${value('direction')} 的幕布`}；填充从 ${value('fillfrom')} 到 ${value('fillto')}，过渡 ${seconds(value('fadetime'))}，延迟 ${seconds(value('delay'))}；${blocking()}。`;
    case 'avgdisplay':
      return `${p.name ? '创建或更新' : '清除'}演出对象「${resource('id')}」${p.name ? `，资源「${resource('name')}」，样式「${resource('style')}」` : ''}；对象按槽位及层级管理，重复标识会更新原对象。`;
    case 'animtext':
      return `使用「${resource('name')}」的动画播放分段文字；${blocking()}。`;
    case 'animtextclean':
      return p.id ? `清除动画文字对象「${resource('id')}」。` : '清除全部动画文字。';
    case 'showitem':
      return `展示物品图片「${resource('image')}」，背景遮暗 ${Number(value('black')) * 100}%，淡入 ${seconds(value('fadetime'))}；过渡完成后继续。有旧物品时先收起旧图。`;
    case 'hideitem':
      return `在 ${seconds(value('fadetime'))} 内收起物品图片。`;
    case 'cgitem':
      return `按标识与层级显示 CG 图片「${resource('image')}」，替换同标识对象；新对象居中、缩放与透明度均为 1。位置需同时提供起点和终点，旋转起点为正数时原版跳过旋转段；各属性独立计时，${blocking()}。`;
    case 'hidecgitem':
      return `隐藏匹配标识、图片或层级的 CG 对象；${transition(value('duration'))}，${blocking()}。`;
    case 'charactercutin':
      return `${p.name ? '显示' : '隐藏'}立绘切入组件「${resource('widgetID')}」${p.name ? `，资源「${resource('name')}」` : ''}；使用指定样式和进入方式，渐变 ${seconds(value('fadetime'))}。`;
    case 'interlude':
      return `在通道「${plain(p.channel) || '0'}」配置过场遮罩与图片${flag(p.clear) ? '，清理对应通道' : ''}；遮罩、位置、缩放和透明度按各自参数过渡。`;
    case 'skipnode':
      return `设置可跳过的节点${p.mode === 'nofirstskip' ? '；首次观看时锁定此节点' : ''}。`;
    case 'skiptothis':
      return '设置点击“跳过”时优先到达的位置。';
    case 'usewhiteloadingmaskonfinish':
      return '剧情结束时使用白色过渡遮罩。';
    case 'startbattle':
      return `请求进入关卡「${resource('stageId')}」的战斗衔接。`;
    case 'gotopage':
      return `请求切换至「${resource('dest')}」${p.waitForSignal ? `并等待信号「${resource('waitForSignal')}」` : ''}。`;
    case 'tutorial':
      return `等待宿主信号「${resource('waitForSignal')}」${p.abortForSignal ? `；收到「${resource('abortForSignal')}」时中止后续剧情` : ''}。`;
    case 'endtip':
      return '到达本段剧情末尾，等待确认后结束。';
    default:
      return '';
  }
}
