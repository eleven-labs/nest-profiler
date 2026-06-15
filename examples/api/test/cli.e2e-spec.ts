import { CommandTestFactory } from 'nest-commander-testing';
import request from 'supertest';
import { ProfilerStorageService } from '@eleven-labs/nest-profiler';
import type { Profile } from '@eleven-labs/nest-profiler';
import { COMMAND_ENTRYPOINT_TYPE } from '@eleven-labs/nest-profiler-commander';
import type { CommandInfo } from '@eleven-labs/nest-profiler-commander';
import type { HttpRequestEntry } from '@eleven-labs/nest-profiler-axios';
import type { CacheOperationEntry } from '@eleven-labs/nest-profiler-cache';
import { CliModule } from '../src/cli.module.js';
import { createE2EApp, server } from './helpers/app.js';
import { lockNetwork, mockJsonPlaceholder, unlockNetwork } from './helpers/jsonplaceholder.js';

/**
 * Runs a CLI command in-process (CommandTestFactory) and returns the profile it wrote to the
 * shared file storage. Failing commands rethrow after the profile is saved — tolerated here.
 */
async function runCommand(args: string[]): Promise<Profile<CommandInfo>> {
  const cmd = await CommandTestFactory.createTestingCommand({ imports: [CliModule] }).compile();
  const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  try {
    await CommandTestFactory.run(cmd, args);
  } catch {
    // CommandProfiler saves the failed profile, then rethrows the command error.
  } finally {
    exitSpy.mockRestore();
  }

  const storage = cmd.get(ProfilerStorageService);
  const profiles = await storage.findAll();
  const profile = profiles
    .filter(
      (p) =>
        p.entrypoint.type === COMMAND_ENTRYPOINT_TYPE &&
        (p.entrypoint.data as CommandInfo).name === args[0],
    )
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!profile) throw new Error(`no profile recorded for command "${args[0] ?? ''}"`);
  return profile as Profile<CommandInfo>;
}

describe('CLI commands (e2e) — commander collector + cross-process file storage', () => {
  it('profiles demo:greet with its parsed options', async () => {
    const profile = await runCommand(['demo:greet', '-n', 'Ada']);

    expect(profile.entrypoint.type).toBe(COMMAND_ENTRYPOINT_TYPE);
    expect(profile.entrypoint.data).toMatchObject({
      name: 'demo:greet',
      options: { name: 'Ada' },
      exitCode: 0,
      success: true,
    });
    expect(profile.response).toMatchObject({ statusCode: 200 });
    expect(profile.logs.map((l) => l.message)).toEqual(
      expect.arrayContaining([expect.stringContaining('Hello, Ada!')]),
    );
  });

  it('records a failed command with its exception', async () => {
    const profile = await runCommand(['demo:greet', '--fail']);

    expect(profile.entrypoint.data).toMatchObject({
      name: 'demo:greet',
      exitCode: 1,
      success: false,
    });
    expect(profile.exceptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining('Greeting failed on purpose') as string,
        }),
      ]),
    );
  });

  it('profiles sync:posts with the axios and cache collectors', async () => {
    mockJsonPlaceholder();
    lockNetwork();
    try {
      const profile = await runCommand(['sync:posts', '-l', '3']);

      expect(profile.entrypoint.data).toMatchObject({
        name: 'sync:posts',
        success: true,
      });

      const axios = profile.collectors['axios'] as HttpRequestEntry[];
      expect(axios).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            method: 'GET',
            url: expect.stringContaining('/posts?_limit=3') as string,
            statusCode: 200,
          }),
        ]),
      );

      const cache = profile.collectors['cache'] as CacheOperationEntry[];
      expect(cache).toEqual(
        expect.arrayContaining([expect.objectContaining({ operation: 'SET', key: 'cli:posts' })]),
      );

      expect((profile.spans ?? []).map((s) => s.phase)).toContain('cli.sync-posts.fetch');
    } finally {
      unlockNetwork();
    }
  });

  it('command profiles are visible from the HTTP app via the shared file storage', async () => {
    const cmdProfile = await runCommand(['demo:greet', '-n', 'CrossProcess']);

    // A separate Nest application reads the same storage directory.
    const app = await createE2EApp();
    try {
      const res = await request(server(app)).get(`/_profiler/${cmdProfile.token}/data`);
      expect(res.status).toBe(200);
      expect((res.body as Profile<CommandInfo>).entrypoint.data).toMatchObject({
        name: 'demo:greet',
      });

      const list = await request(server(app)).get('/_profiler');
      expect(list.status).toBe(200);
      expect(list.text).toContain('demo:greet');
      expect(list.text).toContain(cmdProfile.token.slice(0, 8));
    } finally {
      await app.close();
    }
  });
});
