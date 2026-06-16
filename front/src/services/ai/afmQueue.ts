/**
 * Apple Foundation Models runs ONE on-device request at a time. Firing several
 * `generateText({ model: apple() })` calls concurrently (e.g. action extraction +
 * follow-up suggestions + title/emoji) makes them queue inside the native bridge,
 * so the later ones blow their timeout budget.
 *
 * This module serializes all AFM work through a single promise chain so each call
 * gets the full model to itself, and applies a per-task timeout to the *active*
 * run (not to time spent waiting in the queue).
 */

let chain: Promise<unknown> = Promise.resolve();

/**
 * Enqueue an AFM task. It only starts once all previously-enqueued tasks finish.
 * `timeoutMs` bounds the task's own execution; on timeout the task rejects (and
 * the queue advances). The task itself should swallow/normalize errors.
 */
export function runAfm<T>(
    task: () => Promise<T>,
    timeoutMs: number,
): Promise<T> {
    const run = chain.then(() => withTimeout(task(), timeoutMs));
    // Keep the chain alive regardless of this task's outcome.
    chain = run.then(
        () => undefined,
        () => undefined,
    );
    return run;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
            () => reject(new Error('AFM task timeout')),
            timeoutMs,
        );
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
