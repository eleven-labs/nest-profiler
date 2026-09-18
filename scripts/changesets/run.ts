import { spawnSync } from 'node:child_process';

/** Run a command, streaming its output, and return its exit code. */
export function run(command: string, args: string[], cwd?: string): number {
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(result.error.message);
    return 1;
  }

  return result.status ?? 1;
}

/** Run a command silently and return its exit code alongside its stdout. */
export function capture(
  command: string,
  args: string[],
  cwd?: string,
): { exitCode: number; stdout: string } {
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    encoding: 'utf-8',
  });

  if (result.error) {
    return { exitCode: 1, stdout: '' };
  }

  return { exitCode: result.status ?? 1, stdout: result.stdout ?? '' };
}
