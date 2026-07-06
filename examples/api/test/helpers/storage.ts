import { FileStorageAdapter } from '@eleven-labs/nest-profiler';
import type { IProfilerStorageAdapter, Profile } from '@eleven-labs/nest-profiler';
import { SqliteStorageAdapter } from '@eleven-labs/nest-profiler/sqlite';

export type StorageType = 'file' | 'sqlite';

/**
 * The persistent storage backend selected for this run. `setup-env.ts` sets
 * `PROFILER_STORAGE_TYPE` (default `file`); the CI matrix / local scripts override it with
 * `sqlite`. The whole suite is backend-agnostic — only this env var changes.
 */
export const activeStorageType = (): StorageType =>
  process.env['PROFILER_STORAGE_TYPE'] === 'sqlite' ? 'sqlite' : 'file';

/**
 * Opens a **fresh** adapter over the run's shared storage — a separate handle, exactly as
 * another process would. Both backends are cross-process (files on disk / a SQLite file in
 * WAL mode), so a reader that never touched the writer's connection still sees its profiles.
 */
function openStorage(): IProfilerStorageAdapter {
  const storagePath = process.env['PROFILER_STORAGE_PATH'];
  const ttl = parseInt(process.env['PROFILER_TTL'] ?? '3600', 10);
  return activeStorageType() === 'sqlite'
    ? new SqliteStorageAdapter({ path: storagePath, ttl })
    : new FileStorageAdapter({ storagePath, ttl });
}

/**
 * Reads every stored profile through a fresh connection, then releases it. Used to observe
 * profiles written by a process that has already shut down (e.g. a CLI command): reading
 * through its own — now closed — adapter would fail for SQLite.
 */
export async function readStoredProfiles(): Promise<Profile[]> {
  const storage = openStorage();
  try {
    return await storage.findAll();
  } finally {
    await storage.close?.();
  }
}
