import { parseScript } from './parser';
import { scriptIdentity, type PlaybackPosition } from './playback-position';
import { translateText } from './text-variables';
import { readingMarkup } from './sticker-color';

export interface ScriptSource {
  script: string;
  variables: Record<string, unknown>;
}
export function previewAt(source: ScriptSource, position: PlaybackPosition, nickname: string) {
  if (scriptIdentity(source.script, source.variables) !== position.script) return;
  const command = parseScript(source.script, source.variables)[position.index];
  if (!command) return;
  const plain = (value: unknown) => {
    const text = translateText(value, source.variables, nickname);
    return readingMarkup(text)?.plain ?? text;
  };
  const { name, params: p } = command;
  const speaker = name === 'dialog' || name === 'multiline' ? plain(p.name) : '';
  const text =
    name === 'decision'
      ? '待选择：' + plain(p.options).split(';').join(' / ')
      : name === 'endtip'
        ? '本段剧情末尾'
        : name === 'subtitle' || name === 'sticker'
          ? plain(p.text)
          : plain(command.text);
  return { speaker, text, line: command.line };
}
