/**
 * No-op stub of `electron-log/renderer` for vitest + evalite.
 *
 * Test/eval runtime is Node, where electron-log's renderer IPC transport
 * has no preload bridge to talk to and produces noisy "logger isn't
 * initialized" output. The renderer build (Vite's normal pipeline) gets
 * the real module; vitest.config's `resolve.alias` swaps in this stub.
 *
 * Shape mirrors the bits `src/lib/logger.ts` actually uses: `default.scope`
 * returning an object with level methods.
 */
const noop = () => {};

const scopedLogger = {
  error: noop,
  warn: noop,
  info: noop,
  verbose: noop,
  debug: noop,
  silly: noop,
};

const electronLog = {
  scope: () => scopedLogger,
  error: noop,
  warn: noop,
  info: noop,
  verbose: noop,
  debug: noop,
  silly: noop,
};

export default electronLog;
