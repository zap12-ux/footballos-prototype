/**
 * Extra test setup for the product shell (`setup.ts` installs an in-memory localStorage).
 *
 * react-router data routers build a `Request` for every navigation. Under vitest's jsdom
 * environment `AbortController` is jsdom's while `Request` is Node's (undici), and undici
 * rejects a signal that is not its own `AbortSignal` ("Expected signal to be an instance of
 * AbortSignal"). In a browser there is one AbortSignal, so this is test-only: a `Request`
 * built with a foreign signal is created without it. No loaders run in these tests, so the
 * dropped signal has nothing to abort.
 */
const NativeRequest = globalThis.Request;
if (typeof NativeRequest === 'function') {
  class PatchedRequest extends NativeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      if (init && init.signal) {
        try {
          super(input, init);
          return;
        } catch (error) {
          if (!(error instanceof TypeError) || !/signal/i.test(String(error))) throw error;
          const { signal: _signal, ...rest } = init;
          super(input, rest);
          return;
        }
      }
      super(input, init);
    }
  }
  Object.defineProperty(globalThis, 'Request', { value: PatchedRequest, configurable: true, writable: true });
}

// Shell and film screens load several resources before they settle; under a parallel run
// on a busy machine Testing Library's 1 s default for `findBy*` / `waitFor` is too short.
import { configure } from '@testing-library/react';
configure({ asyncUtilTimeout: 8000 });
