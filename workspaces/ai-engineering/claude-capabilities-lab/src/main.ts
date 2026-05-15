import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  type ParsedFlags,
  type ScenarioName,
  getBoolean,
  parseFlags,
  SCENARIO_NAMES,
} from './cli/args.js';
import { HELP_TEXT, SCENARIO_HELP } from './cli/help.js';
import { loadEnvironment } from './config/env.js';
import { runCacheScenario } from './scenarios/cache.js';
import { runCitationsScenario } from './scenarios/citations.js';
import { runCodeExecScenario } from './scenarios/code-exec.js';
import { runFilesScenario } from './scenarios/files.js';
import { runImageScenario } from './scenarios/image.js';
import { runPdfScenario } from './scenarios/pdf.js';
import { runThinkingScenario } from './scenarios/thinking.js';

function asScenario(name: string | undefined): ScenarioName | undefined {
  return SCENARIO_NAMES.find((known) => known === name);
}

export async function runScenario(name: ScenarioName, parsed: ParsedFlags): Promise<void> {
  switch (name) {
    case 'thinking': {
      await runThinkingScenario(parsed);
      break;
    }

    case 'image': {
      await runImageScenario(parsed);
      break;
    }

    case 'pdf': {
      await runPdfScenario(parsed);
      break;
    }

    case 'citations': {
      await runCitationsScenario(parsed);
      break;
    }

    case 'cache': {
      await runCacheScenario(parsed);
      break;
    }

    case 'files': {
      await runFilesScenario(parsed);
      break;
    }

    case 'code-exec': {
      await runCodeExecScenario(parsed);
      break;
    }
  }
}

export async function main(argv: readonly string[]): Promise<void> {
  const parsed = parseFlags(argv);

  if (getBoolean(parsed, 'help') || parsed.flags.has('h')) {
    console.log(HELP_TEXT);

    return;
  }

  const scenarioArg = parsed.positionals[0];
  const scenario = asScenario(scenarioArg);

  if (scenario === undefined) {
    if (scenarioArg !== undefined) {
      console.error(`Unknown scenario: ${scenarioArg}`);
    }

    console.log(HELP_TEXT);
    process.exitCode = scenarioArg === undefined ? 0 : 1;

    return;
  }

  if (parsed.positionals[1] === 'help' || parsed.flags.has('help')) {
    console.log(SCENARIO_HELP[scenario] ?? HELP_TEXT);

    return;
  }

  loadEnvironment();
  await runScenario(scenario, parsed);
}

export function isDirectExecution(moduleUrl: string, entrypointPath: string | undefined): boolean {
  return entrypointPath !== undefined && fileURLToPath(moduleUrl) === path.resolve(entrypointPath);
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  await main(process.argv.slice(2));
}
