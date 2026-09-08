import type { ClientRequest } from 'node:http';
import { Injectable } from '@nestjs/common';
import type { HttpInstrumentation } from '../http-instrumentation.interface';
import { instrumentClientRequest } from './client-request-timer';

type RequestFactory = (...args: never[]) => ClientRequest;

/** The mutable exports object of a Node HTTP module, which is what we replace factories on. */
type HttpModuleExports = Record<string, RequestFactory & { [PATCHED]?: true }>;

/**
 * Resolved with `require`, not `import * as`: an `import` namespace is a *copy* exposed through
 * getters, so assigning to it throws and — worse, if it did not — would patch an object no client
 * ever calls. `require('node:http')` returns the one exports object every consumer reaches
 * through, whether they got it by `require` or by importing the builtin's default export.
 */
function moduleExports(specifier: 'node:http' | 'node:https'): HttpModuleExports {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(specifier) as HttpModuleExports;
}

/**
 * Shared across duplicate copies of this package in a dependency tree: patching a Node builtin
 * twice would time the same request twice, and a registry-global symbol is the only marker two
 * instances of the same module can both see.
 */
const PATCHED = Symbol.for('@eleven-labs/nest-profiler-http.phases.nodeHttpPatched');

/** The factories to wrap. `get` is not routed through the exported `request`, so both need it. */
const FACTORIES = ['request', 'get'] as const;

/**
 * Phases provider for every client built on `node:http` / `node:https` — axios, superagent,
 * `node-fetch`, `got`, or a hand-rolled `https.request`. It wraps the four request factories to
 * start a {@link instrumentClientRequest} timer on each outgoing request, and **records nothing**:
 * no entry, no header, no body. Adapters pick the breakdown up with `readHttpPhases(...)`.
 *
 * This is the timings-only counterpart of the `node:http` *recording* adapter this package
 * deliberately does not ship. The objection to that adapter does not apply here: capturing a
 * response body means reading the stream, which steals chunks from a caller consuming it in
 * paused mode, whereas a timer only notes when events fired and leaves both streams untouched.
 *
 * ```ts
 * import { NodeHttpPhases } from '@eleven-labs/nest-profiler-http/phases';
 *
 * HttpCollectorModule.forRoot({ instrumentations: [AxiosInstrumentation, NodeHttpPhases] });
 * ```
 *
 * Not covered: a request built by hand with `new http.ClientRequest(...)`, and any client that
 * captured a reference to `http.request` before the application booted. Both can be timed
 * explicitly with {@link instrumentClientRequest}.
 */
@Injectable()
export class NodeHttpPhases implements HttpInstrumentation {
  install(): void {
    patchModule(moduleExports('node:http'));
    patchModule(moduleExports('node:https'));
  }
}

function patchModule(factories: HttpModuleExports): void {
  for (const name of FACTORIES) {
    const original = factories[name];
    if (typeof original !== 'function' || original[PATCHED]) continue;

    const patched = function (this: unknown, ...args: never[]): ClientRequest {
      const request = original.apply(this, args);
      try {
        instrumentClientRequest(request);
      } catch {
        // A foreign `request` implementation (a mock, an interceptor) that is not event-shaped.
        // No phases for that call; the call itself must still go through untouched.
      }
      return request;
    } as RequestFactory & { [PATCHED]?: true };

    patched[PATCHED] = true;
    factories[name] = patched;
  }
}
