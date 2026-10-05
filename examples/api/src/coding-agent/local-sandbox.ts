import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { dirname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import type { HarnessV1NetworkSandboxSession as Sandbox } from '@ai-sdk/harness';

/** A free local port, for the bridge the harness talks to its runtime through. */
function freePort(): Promise<number> {
  return new Promise((done) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => done(port));
    });
  });
}

/** Resolves with the exit code once the process has exited. */
const exitOf = (child: ChildProcess): Promise<{ exitCode: number }> =>
  new Promise((done, fail) => {
    child.once('error', fail);
    child.once('close', (code) => done({ exitCode: code ?? 1 }));
  });

/**
 * The sandbox a `HarnessAgent` runs its runtime in, on this machine: commands run through the
 * shell in `directory`, files are read and written there, and the bridge listens on a local port.
 * **There is no isolation** — the agent has this process's permissions. A real deployment would
 * use a remote or containerised sandbox instead.
 */
export class LocalSandbox implements Sandbox {
  readonly id = randomUUID();
  readonly description = 'This machine. Commands run with the host user’s permissions.';
  private readonly children = new Set<ChildProcess>();

  private constructor(
    readonly defaultWorkingDirectory: string,
    readonly ports: readonly number[],
  ) {}

  static async open(directory: string): Promise<LocalSandbox> {
    await mkdir(directory, { recursive: true });
    return new LocalSandbox(directory, [await freePort()]);
  }

  readonly spawn: Sandbox['spawn'] = ({ command, workingDirectory = '.', env }) => {
    const child = spawn(command, {
      shell: true,
      cwd: this.path(workingDirectory),
      env: { ...process.env, ...env },
    });
    this.children.add(child);
    const exited = exitOf(child).finally(() => this.children.delete(child));
    return Promise.resolve({
      pid: child.pid,
      stdout: Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
      stderr: Readable.toWeb(child.stderr) as ReadableStream<Uint8Array>,
      wait: () => exited,
      kill: () => Promise.resolve(void child.kill()),
    });
  };

  readonly run: Sandbox['run'] = async (options) => {
    const process = await this.spawn(options);
    const [stdout, stderr, { exitCode }] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.wait(),
    ]);
    return { exitCode, stdout, stderr };
  };

  readonly readBinaryFile: Sandbox['readBinaryFile'] = ({ path }) =>
    readFile(this.path(path)).then(
      (bytes) => new Uint8Array(bytes),
      () => null,
    );

  readonly readFile: Sandbox['readFile'] = async (options) => {
    const bytes = await this.readBinaryFile(options);
    return bytes && (Readable.toWeb(Readable.from([bytes])) as ReadableStream<Uint8Array>);
  };

  readonly readTextFile: Sandbox['readTextFile'] = async ({ startLine, endLine, ...options }) => {
    const bytes = await this.readBinaryFile(options);
    if (bytes === null) return null;
    const lines = Buffer.from(bytes).toString().split('\n');
    return lines.slice(Math.max(1, startLine ?? 1) - 1, endLine ?? lines.length).join('\n');
  };

  readonly writeBinaryFile: Sandbox['writeBinaryFile'] = async ({ path, content }) => {
    await mkdir(dirname(this.path(path)), { recursive: true });
    await writeFile(this.path(path), content);
  };

  readonly writeFile: Sandbox['writeFile'] = async ({ path, content }) =>
    this.writeBinaryFile({ path, content: new Uint8Array(await new Response(content).bytes()) });

  readonly writeTextFile: Sandbox['writeTextFile'] = ({ path, content }) =>
    this.writeBinaryFile({ path, content: new TextEncoder().encode(content) });

  readonly getPortEndpoint: Sandbox['getPortEndpoint'] = ({ port, protocol = 'http' }) =>
    Promise.resolve({ url: `${protocol}://127.0.0.1:${port}` });

  readonly getPortUrl: Sandbox['getPortUrl'] = async (options) =>
    (await this.getPortEndpoint(options)).url;

  readonly restricted: Sandbox['restricted'] = () => this;

  readonly stop: Sandbox['stop'] = () => {
    for (const child of this.children) child.kill();
    return Promise.resolve();
  };

  readonly destroy: Sandbox['destroy'] = () => this.stop();

  private path(path: string): string {
    return resolve(this.defaultWorkingDirectory, path);
  }
}
