/** DI token for `CommanderCollectorModuleOptions`. */
export const COMMANDER_COLLECTOR_OPTIONS = Symbol('COMMANDER_COLLECTOR_OPTIONS');

/** `Profile.entrypoint.type` value marking a profile as a CLI command. */
export const COMMAND_ENTRYPOINT_TYPE = 'command';

/** Payload of a `command` entrypoint — the CLI command a profile describes. */
export interface CommandInfo {
  /** Command name as declared via `@Command({ name })`, e.g. `sync:posts`. */
  name: string;
  /** Positional parameters passed to the command. */
  arguments: string[];
  /** Parsed flag options passed to the command. */
  options?: Record<string, unknown>;
  /** Process exit code — `0` on success, `1` when the command threw. */
  exitCode: number;
  /** `true` when the command completed without throwing. */
  success: boolean;
}
