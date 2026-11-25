import { collectResourceRefs } from './resource_refs';
import { capabilityGaps, unsupportedCommands } from '../src/core/capabilities';
import { parseScript } from '../src/core/parser';
import { sceneResources } from '../src/core/scene-resources';
import { unsupportedStandaloneHostCommands } from '../src/core/story-host-requirements';
import { inspectScript } from '../src/core/script-compatibility';

Object.assign(globalThis, {
  arkreaderAnalyze(mode: string, payload: string): string {
    const { script, variables } = JSON.parse(payload);
    if (mode === 'references') return JSON.stringify(collectResourceRefs(script, variables));
    if (mode === 'compatibility') return JSON.stringify(inspectScript(script, variables));
    const commands = parseScript(script, variables);
    const gaps = [
      ...capabilityGaps(commands),
      ...unsupportedCommands(commands).map((c) => ({ feature: c.name, line: c.line })),
      ...unsupportedStandaloneHostCommands(commands).map((c) => ({
        feature: 'external-host:' + c.name,
        line: c.line,
      })),
    ];
    return JSON.stringify({ ...sceneResources(commands), gaps });
  },
});
