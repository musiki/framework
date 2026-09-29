// Serial render queue with a per-job timeout (used by mermaid-render.mjs).
// Mermaid renders in a shared JSDOM with process globals installed, so jobs
// must run one at a time; a job that never settles (e.g. JSDOM waiting for an
// <img> in a node label to load) must not wedge every later render. After
// `timeoutMs` the job's promise rejects, `onTimeout(job)` lets the renderer
// clean up (restore globals, drop the DOM), and the queue moves on.
// Pure (no jsdom/mermaid imports): tested in mermaid-queue.test.mjs.

export const MERMAID_RENDER_TIMEOUT_MS = 8_000;

export class MermaidTimeoutError extends Error {
  constructor(ms) {
    super(`Mermaid render timed out after ${ms} ms`);
    this.name = 'MermaidTimeoutError';
  }
}

/**
 * `run(job)` starts the work for one job and returns a promise. `job` is a
 * fresh object per call (`{ timedOut: false }`) the worker may use to register
 * cleanup; it is marked `timedOut` before `onTimeout(job)` is called.
 */
export function createRenderQueue({ timeoutMs = MERMAID_RENDER_TIMEOUT_MS, onTimeout = () => {} } = {}) {
  let tail = Promise.resolve();
  return function enqueue(run) {
    const start = () => new Promise((resolve, reject) => {
      const job = { timedOut: false };
      const timer = setTimeout(() => {
        job.timedOut = true;
        try {
          onTimeout(job);
        } finally {
          reject(new MermaidTimeoutError(timeoutMs));
        }
      }, timeoutMs);
      // Not unref'd: in a build, a stuck render must still time out rather
      // than let the process exit with the render unsettled.
      Promise.resolve()
        .then(() => run(job))
        .then(
          (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          (error) => {
            clearTimeout(timer);
            reject(error);
          },
        );
    });
    const result = tail.then(start, start);
    tail = result.catch(() => undefined);
    return result;
  };
}
