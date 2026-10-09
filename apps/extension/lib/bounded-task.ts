/** Stops waiting on a remote message after cancellation/deadline; late results are ignored. */
export function boundedTask<T>(task: Promise<T>, signal: AbortSignal, ms = 45000): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => finish(() => reject(new Error('Autofill cancelled.')));
    const timer = setTimeout(() => finish(() => reject(new Error('This request took too long. Fill this answer manually or retry.'))), ms);
    let done = false;
    const finish = (work: () => void) => {
      if (done) return;
      done = true; clearTimeout(timer); signal.removeEventListener('abort', abort); work();
    };
    // Observe rejection even when the signal was already aborted.
    task.then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
