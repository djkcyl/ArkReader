import { labelTargets, type Command } from '../core/scheduler';
import { IGNORED_PARAMETERS } from '../core/capabilities';
import { nativeUnhandledCommands } from '../core/native-unhandled';
import { translateText } from '../core/text-variables';
import { readingMarkup } from '../core/sticker-color';
import { decisionButtons } from '../core/decision';
import { commandBehavior, commandDefaults, parameterApplies } from './script-semantics';

const commandNames: Record<string, string> = {
  header: '剧情设置',
  dialog: '对白',
  aside: '旁白',
  multiline: '分段对白',
  subtitle: '字幕',
  decision: '选择',
  predicate: '条件分支',
  label: '标签',
  warp: '跳转',
  delay: '等待',
  endtip: '剧情结束',
  character: '立绘',
  charslot: '立绘槽位',
  characteraction: '立绘动作',
  charactercutin: '立绘切入',
  background: '背景',
  backgroundtween: '背景过渡',
  image: '图片',
  imagetween: '图片过渡',
  imagerotate: '图片旋转',
  largebg: '大型背景',
  verticalbg: '纵向背景',
  largebgtween: '大型背景移动',
  gridbg: '网格背景',
  blocker: '遮罩',
  cameraeffect: '镜头滤镜',
  camerashake: '镜头震动',
  glitchtween: '故障效果',
  effect: '特效',
  bgeffect: '背景特效',
  imgeffect: '图片特效',
  focusout: '失焦',
  focusparam: '景深设置',
  curtain: '幕布',
  interlude: '过场',
  avgdisplay: '演出对象',
  animtext: '动画文字',
  animtextclean: '清除动画文字',
  cgitem: 'CG 对象',
  hidecgitem: '隐藏 CG 对象',
  showitem: '展示物品',
  hideitem: '隐藏物品',
  sticker: '贴字',
  stickerclear: '清除贴字',
  stickertween: '贴字动画',
  spellsticker: '咒文贴字',
  spellstickerclear: '清除咒文贴字',
  timersticker: '计时文字',
  timerclear: '清除计时文字',
  playmusic: '播放音乐',
  stopmusic: '停止音乐',
  playsound: '播放音效',
  stopsound: '停止音效',
  musicvolume: '音乐音量',
  soundvolume: '音效音量',
  video: '播放影片',
  theater: '剧场模式',
  skipnode: '跳过节点',
  skiptothis: '跳过落点',
  usewhiteloadingmaskonfinish: '结束时使用白色遮罩',
  startbattle: '战斗衔接',
  gotopage: '页面衔接',
  tutorial: '等待场景信号',
};
const parameterNames: Record<string, string> = {
  stageid: '关卡',
  ispractice: '演习模式',
  dest: '目标页面',
  waitforsignal: '等待信号',
  abortforsignal: '中止信号',
  zoneid: '区域',
  join: '并行动画',
  isend: '结束动画序列',
  pduration: '位移动画时长',
  rfrom: '起始旋转',
  rto: '目标旋转',
  rduration: '旋转动画时长',
  aduration: '透明度动画时长',
  sfrom: '起始缩放',
  sto: '目标缩放',
  sduration: '缩放动画时长',
  fadeoutdelay: '淡出前等待',
  offsetx: '水平偏移',
  offsety: '垂直偏移',
  black: '背景遮暗程度',
  solidwidth: '拼接宽度',
  solidheight: '拼接高度',
  initposmode: '初始定位模式',
  widgetid: '组件标识',
  fadestyle: '进入方式',
  povx: '视角横向偏移',
  xscalefrom: '起始横向缩放',
  xscaleto: '目标横向缩放',
  yscalefrom: '起始纵向缩放',
  yscaleto: '目标纵向缩放',
  flip: '翻转方式',
  movedelay: '移动前等待',
  movetime: '移动时长',
  rox: 'X 轴旋转',
  roy: 'Y 轴旋转',
  roz: 'Z 轴旋转',
  icharpos: '初始立绘位置',
  icharscale: '初始立绘缩放',
  char: '立绘资源',
  maskid: '遮罩资源',
  offset: '偏移',
  tsfrom: '起始遮罩变换',
  tsto: '目标遮罩变换',
  tsduration: '遮罩变换时长',
  type: '类型',
  switch: '切换',
  clear: '清理通道',
  pdelay: '位移动画延迟',
  sdelay: '缩放动画延迟',
  adelay: '透明度动画延迟',
  height: '高度',
  width: '宽度',
  size: '尺寸',
  multi: '追加文字模式',
  alignment: '对齐方式',
  fade: '启用淡变',
  blur: '模糊',
  direction: '方向',
  fillfrom: '起始填充',
  fillto: '目标填充',
  grad: '渐变边缘',
  gfrom: '起始绿色',
  bfrom: '起始蓝色',
  fit_mode: '画面适配模式',
  is_video_only: '纯影片剧情',
  deny_auto_switch_scene: '禁止自动切场景',
  dont_clear_gameobjectpool_onstart: '开始时保留对象池',
  char_sort_type: '角色排序方式',
  blackstart: '第一位立绘遮黑起点',
  blackend: '第一位立绘遮黑终点',
  blackstart2: '第二位立绘遮黑起点',
  blackend2: '第二位立绘遮黑终点',
  enter: '第一位立绘入场方向',
  enter2: '第二位立绘入场方向',
  xpos1: '第一位立绘起始横坐标',
  ypos1: '第一位立绘起始纵坐标',
  xpos2: '第二位立绘起始横坐标',
  ypos2: '第二位立绘起始纵坐标',
  xscale2: '第二位立绘横向缩放',
  yscale2: '第二位立绘纵向缩放',
  xpos: '横向位置或位移',
  ypos: '纵向位置或位移',
  power: '振幅',
  times: '次数',
  random: '随机角度',
  scale: '缩放倍率',
  tiled: '平铺',
  screenadapt: '画面适配',
  inverse: '反向',
  circles: '附加旋转圈数',
  glitchto: '目标故障材质预设',
  glitch: '启用故障材质',
  matname: '材质预设',
  posfrom: '起始位置',
  posto: '目标位置',
  action: '动作',
  poszoom: '缩放锚点',
  bstart: '遮黑起点',
  bend: '遮黑终点',
  xstrength: '横向震动强度',
  ystrength: '纵向震动强度',
  vibrato: '震动频率',
  randomness: '方向随机范围',
  fadeout: '震动逐渐衰减',
  stop: '停止震动',
  initamount: '起始强度',
  keep: '保留效果',
  entryindex: '入场动画索引',
  entryfrom: '入场动画起始进度',
  entryto: '入场动画目标进度',
  scalex: '横向缩放',
  scaley: '纵向缩放',
  scalexfrom: '起始横向缩放',
  scaleyfrom: '起始纵向缩放',
  scalexto: '目标横向缩放',
  scaleyto: '目标纵向缩放',
  name: '名称',
  name2: '第二名称',
  name3: '第三名称',
  image: '图片',
  imagegroup: '图片组',
  cggroup: 'CG 组',
  text: '文字',
  id: '标识',
  key: '资源',
  res: '资源',
  slot: '槽位',
  focus: '焦点',
  focusduration: '聚焦时间',
  pos: '位置',
  pfrom: '起始位置',
  pto: '目标位置',
  xfrom: '起始横坐标',
  xto: '目标横坐标',
  yfrom: '起始纵坐标',
  yto: '目标纵坐标',
  afrom: '起始透明度',
  ato: '目标透明度',
  layer: '层级',
  style: '样式',
  block: '等待完成',
  isblock: '等待完成',
  duration: '持续时间',
  fadetime: '渐变时间',
  delay: '延迟',
  time: '时间',
  volume: '音量',
  intro: '前奏',
  crossfade: '交叉淡化',
  channel: '声道',
  loop: '循环',
  x: '横向位置',
  y: '纵向位置',
  xscale: '横向缩放',
  yscale: '纵向缩放',
  angle: '角度',
  alpha: '透明度',
  a: '透明度',
  r: '红色',
  g: '绿色',
  b: '蓝色',
  from: '起点',
  to: '终点',
  amount: '强度',
  effect: '效果',
  ease: '缓动',
  end: '段落结束',
  hidelog: '不加入回顾',
  references: '条件值',
  options: '选项',
  values: '选项值',
  is_autoable: '允许自动',
  is_skippable: '允许跳过',
  is_tutorial: '教程剧情',
  mode: '模式',
};
export interface ScriptRow {
  line: number;
  endLine: number;
  commandIndex?: number;
  title: string;
  detail: string;
  raw: string;
  parameters?: ScriptParameter[];
}
export interface ScriptParameter {
  key: string;
  label: string;
  value: string;
  origin: '脚本' | '默认' | '原版忽略' | '此模式不使用';
}
export function scriptParameters(
  command: Command,
  plain: (value: unknown) => string = String,
): ScriptParameter[] {
  const defaults = commandDefaults(command);
  return Object.entries({
    ...command.params,
    ...Object.fromEntries(
      Object.entries(defaults).filter(([key]) => !Object.hasOwn(command.params, key)),
    ),
  }).map(([key, value]) => {
    const ignored = IGNORED_PARAMETERS[command.name]?.includes(key) === true;
    let label = parameterNames[key.toLowerCase()] ?? (ignored ? '未使用字段' : key);
    if (key === 'rfrom' && ['blocker', 'curtain'].includes(command.name)) label = '起始红色';
    if (key === 'name' && command.name === 'characteraction') label = '立绘槽位';
    if (['width', 'height'].includes(key) && ['background', 'image'].includes(command.name))
      label = key === 'width' ? '宽度倍率' : '高度倍率';
    if (key === 'size' && ['subtitle', 'sticker', 'timersticker'].includes(command.name))
      label = '字号';
    if (key === 'key' && command.name === 'header') label = '剧情标识';
    if (key === 'key' && command.name === 'playmusic') label = '循环音乐';
    let rendered =
      typeof value === 'string'
        ? plain(value)
        : typeof value === 'boolean'
          ? value
            ? '是'
            : '否'
          : value === null
            ? '空'
            : JSON.stringify(value);
    if (rendered === '') rendered = '空';
    const enumValues: Record<string, Record<string, string>> = {
      alignment: { left: '左对齐', center: '居中', right: '右对齐' },
      screenadapt: {
        fill: '拉伸铺满',
        width: '按宽度缩放',
        height: '按高度缩放',
        showall: '完整显示',
        coverall: '覆盖画面并裁边',
      },
      action: { jump: '跳跃', shake: '震动', shakemove: '震动并移动', zoom: '缩放' },
      effect: { Grayscale: '灰度', Colorinverse: '反色', Chaos: '扰动材质' },
      style: { animekv: '动画 CG', bg: '背景图像' },
    };
    const resolved = enumValues[key]?.[String(value)];
    if (resolved) rendered = `${resolved}（${value}）`;
    return {
      key,
      label,
      value: rendered,
      origin: ignored
        ? '原版忽略'
        : !parameterApplies(command, key)
          ? '此模式不使用'
          : Object.hasOwn(command.params, key)
            ? '脚本'
            : '默认',
    };
  });
}
export function describeCommand(
  command: Command,
  variables: Record<string, unknown>,
  nickname: string,
) {
  const plain = (value: unknown) => {
    const text = translateText(value, variables, nickname);
    return readingMarkup(text)?.plain ?? text;
  };
  const { name, params: p } = command;
  let title = commandNames[name] ?? name;
  if (nativeUnhandledCommands.has(name)) title = `原版略过 · ${name}`;
  if (['dialog', 'multiline', 'aside'].includes(name)) {
    const speaker = name === 'aside' ? '' : plain(p.name);
    title = command.text
      ? (speaker || '旁白') + (name === 'multiline' ? ' · 分段对白' : '')
      : '隐藏对白';
  }
  if (name === 'delay') title = `等待 ${p.time ?? 0} 秒`;
  if (name === 'warp') title = `跳转至「${plain(p.name)}」`;
  if (name === 'label') title = `标签「${plain(p.name)}」`;
  if (name === 'predicate')
    title =
      p.references === undefined
        ? '结束条件分支'
        : `分支条件：选择值为 ${plain(p.references).split(';').join('、')}`;
  const parameters = scriptParameters(command, plain).filter(
    (parameter) => !(parameter.key === 'name' && ['dialog', 'multiline'].includes(name)),
  );
  if (name === 'decision')
    return {
      title,
      parameters,
      detail: decisionButtons(p.options, p.values)
        .map(
          (option, i) =>
            `${i + 1}. ${plain(option.text)}${option.disabled ? '（不可选）' : ''}〔值 ${option.value}〕`,
        )
        .join('\n'),
    };
  const text = ['subtitle', 'sticker'].includes(name) ? plain(p.text) : plain(command.text);
  const behavior = nativeUnhandledCommands.has(name)
    ? '原版没有此拼写对应的剧情执行器，会略过这一行。'
    : commandBehavior(command, plain);
  return { title, detail: [text, behavior].filter(Boolean).join('\n'), parameters };
}
export function scriptRows(
  script: string,
  commands: readonly Command[],
  variables: Record<string, unknown>,
  nickname: string,
) {
  const physical = script.split(/\r\n|\n|\r/);
  const labels = labelTargets([...commands]);
  const readable = commands.map((command, commandIndex): ScriptRow => {
    let endLine = command.line;
    while (endLine > 0 && endLine < physical.length && physical[endLine - 1].endsWith('\\'))
      endLine++;
    const description = describeCommand(command, variables, nickname);
    if (command.name === 'warp') {
      const target = labels.get(String(command.params.name));
      description.detail +=
        target === undefined
          ? ' 标签未找到。'
          : ` 目标：${commands[target]?.line ? `第 ${commands[target].line} 行` : '剧情结束'}。`;
    }
    return {
      line: command.line,
      endLine,
      commandIndex,
      ...description,
      raw: command.line ? physical.slice(command.line - 1, endLine).join('\n') : '',
    };
  });
  const source = physical.map((raw, index): ScriptRow => ({
    line: index + 1,
    endLine: index + 1,
    title: '',
    detail: '',
    raw,
  }));
  for (const row of readable)
    for (let line = row.line; line > 0 && line <= row.endLine; line++)
      source[line - 1].commandIndex = row.commandIndex;
  return { readable, source };
}
