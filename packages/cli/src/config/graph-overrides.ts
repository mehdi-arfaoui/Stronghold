import path from 'node:path';

import {
  DEFAULT_GRAPH_OVERRIDES_PATH,
  GraphOverrideValidationError,
  loadGraphOverrides,
  type GraphOverrides,
} from '@stronghold-dr/core';
import { Option, type Command } from 'commander';

export interface GraphOverrideCommandOptions {
  readonly overrides?: string;
  readonly useOverrides: boolean;
}

export interface ResolvedGraphOverrides {
  readonly overrides: GraphOverrides | null;
  readonly warnings: readonly string[];
  readonly path: string | null;
}

class NoOverridesOption extends Option {
  public override attributeName(): string {
    return 'useOverrides';
  }
}

export function addGraphOverrideOptions<TCommand extends Command>(command: TCommand): TCommand {
  command.option(
    '--overrides <path>',
    'Path to graph overrides YAML',
    DEFAULT_GRAPH_OVERRIDES_PATH,
  );
  command.addOption(
    new NoOverridesOption('--no-overrides', 'Disable graph overrides').default(true),
  );
  return command;
}

export function resolveGraphOverrides(
  options: GraphOverrideCommandOptions,
): ResolvedGraphOverrides {
  if (options.useOverrides === false) {
    return {
      overrides: null,
      warnings: [],
      path: null,
    };
  }

  const resolvedPath = path.resolve(options.overrides ?? DEFAULT_GRAPH_OVERRIDES_PATH);

  try {
    return {
      overrides: loadGraphOverrides(resolvedPath),
      warnings: [],
      path: resolvedPath,
    };
  } catch (error) {
    if (error instanceof GraphOverrideValidationError) {
      return {
        overrides: null,
        warnings: [error.message],
        path: resolvedPath,
      };
    }

    throw error;
  }
}
