import { parseScript } from './parser';
import { capabilityGaps, unsupportedCommands } from './capabilities';
import { unsupportedStandaloneHostCommands } from './story-host-requirements';

export interface CompatibilityIssue {
  line: number;
  command: string;
  feature: string;
  reason: string;
}
export interface ScriptCompatibility {
  status: 'supported' | 'unsupported';
  commandCount: number;
  decisionCount: number;
  issues: CompatibilityIssue[];
  resourceVersion?: string;
  clientVersion?: string;
}
/** Inspect the complete parsed script, without choosing a decision path. */
export function inspectScript(
  script: string,
  variables: Record<string, unknown> = {},
): ScriptCompatibility {
  try {
    const commands = parseScript(script, variables),
      unknown = unsupportedCommands(commands),
      unknownLines = new Set(unknown.map((c) => c.line));
    const issues: CompatibilityIssue[] = [
      ...unknown.map((c) => ({
        line: c.line,
        command: c.name,
        feature: c.name,
        reason: '当前版本不支持此指令',
      })),
      ...capabilityGaps(commands).filter((g) => !unknownLines.has(g.line)),
      ...unsupportedStandaloneHostCommands(commands).map((c) => ({
        line: c.line,
        command: c.name,
        feature: 'external-host:' + c.name,
        reason: '这段剧情需要当前版本不支持的场景',
      })),
    ];
    const unique = [
      ...new Map(
        issues.map((issue) => [[issue.line, issue.feature, issue.reason].join('|'), issue]),
      ).values(),
    ];
    return {
      status: unique.length ? 'unsupported' : 'supported',
      commandCount: commands.length,
      decisionCount: commands.filter((c) => c.name === 'decision').length,
      issues: unique,
    };
  } catch (error) {
    return {
      status: 'unsupported',
      commandCount: 0,
      decisionCount: 0,
      issues: [
        {
          line: 0,
          command: 'script',
          feature: 'script.parse',
          reason: '无法读取这段剧情：' + String(error),
        },
      ],
    };
  }
}

export class ScriptCompatibilityError extends Error {
  constructor(readonly report: ScriptCompatibility) {
    super('这段剧情含有当前程序尚未适配的功能，请更新程序后再试。');
    this.name = 'ScriptCompatibilityError';
  }
}
