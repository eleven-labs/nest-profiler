import type { ServerResponse } from 'node:http';

/** The raw Node response an `@Res()` handler receives, which is what the AI SDK writes to. */
export type PlatformResponse = ServerResponse;
