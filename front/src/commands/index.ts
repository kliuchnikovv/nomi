import type { ComponentType } from 'react';
import type { CommandSpec, CommandResult } from './types';
import { PlanBuildScreen } from './screens/PlanBuildScreen';

export interface CommandScreenProps {
  spec: CommandSpec;
  onResult: (result: CommandResult) => void;
  onCancel: () => void;
}

/**
 * Registry for commands that open a dedicated full-screen UI instead of the
 * inline CommandArgForm. Task 14 will populate this with `plan.build`.
 */
export const CUSTOM_COMMAND_SCREENS: Record<string, ComponentType<CommandScreenProps>> = {
  'plan.build': PlanBuildScreen,
};
