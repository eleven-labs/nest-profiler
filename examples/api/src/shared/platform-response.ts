import { Writable } from 'node:stream';
import type { ServerResponse } from 'node:http';

/** The raw Node response an `@Res()` handler receives, which is what the AI SDK writes to. */
export type PlatformResponse = ServerResponse;

/**
 * Writes a web-standard `Response` to the Node response Express handed us.
 *
 * The AI SDK ships both shapes: `pipeAgentUIStreamToResponse` writes to a Node response directly,
 * while `createAgentUIStreamResponse` returns a `Response` — what an edge runtime or a Fastify
 * handler returns as-is. Express speaks neither, so the bridge lives here rather than in a
 * controller. The profiler measures the stream the same way in both cases: it watches what the
 * transport wrote, not how the handler produced it.
 */
export async function writeWebResponse(
  source: Response,
  response: PlatformResponse,
): Promise<void> {
  response.writeHead(source.status, Object.fromEntries(source.headers.entries()));
  if (!source.body) {
    response.end();
    return;
  }
  await source.body.pipeTo(Writable.toWeb(response) as WritableStream<Uint8Array>);
}
