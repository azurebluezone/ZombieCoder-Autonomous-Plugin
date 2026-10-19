// OpenCode's `transform` door is DEFERRED, not synchronous.
//
// Evidence (measured in a real run, OpenCode desktop CLI 2.0.32, plugin loaded
// from <project>/.opencode/plugins/):
//
//   setup:enter                  ms 2655
//   agent:transform:resolved     ms 2661   <- the promise resolves here
//   tool:transform:disposed      ms 2661   <- we disposed it here
//   agent:transform:CALLBACK     ms 3929   <- callback fires 1.27s LATER
//   (tool callback never fires, because its registration was disposed)
//
// Two consequences, both of which were live bugs in this plugin:
//
//   1. Reading a value out of a transform callback and using it immediately
//      gives you an empty result. You must wait for the callback.
//   2. Disposing a Registration cancels the pending apply. A transform that is
//      disposed right after registering never takes effect. Registrations meant
//      to APPLY something must be kept for the plugin's lifetime.
//
// This module is the single place that knows both facts, so the rest of the code
// stops repeating the mistake.

export type Registration = { dispose: () => Promise<void> };

export type TransformDoor<E> = {
  transform: (callback: (editor: E) => void) => Promise<Registration>;
};

export type KeptTransform<E, T> = {
  /** Resolves on the callback's FIRST invocation with what `fn` returned (null if it never fired). */
  first: Promise<T | null>;
  /** Did the callback fire at all yet? */
  hasFired: () => boolean;
  /** Error from registering, or from inside `fn`. */
  error: () => string | undefined;
  /** How many times the callback has run. */
  invocations: () => number;
  /** Resolves once registration has settled (resolved or failed). */
  settled: Promise<void>;
  /** Release the transform. Only for teardown — releasing CANCELS a pending apply. */
  release: () => Promise<void>;
};

export function keepTransform<E, T>(
  door: TransformDoor<E> | undefined,
  fn: (editor: E) => T,
): KeptTransform<E, T> {
  let releaseFirst: (value: T | null) => void = () => {};
  const first = new Promise<T | null>((resolve) => {
    releaseFirst = resolve;
  });

  let registration: Registration | null = null;
  let registrationError: string | undefined;
  let callbackError: string | undefined;
  let fired = false;
  let invocations = 0;

  const settled = (async () => {
    if (!door || typeof door.transform !== "function") {
      registrationError = "transform door not available at runtime";
      releaseFirst(null);
      return;
    }
    try {
      registration = await door.transform((editor: E) => {
        invocations += 1;
        let value: T | null = null;
        try {
          value = fn(editor);
        } catch (error: any) {
          callbackError = String(error?.message ?? error);
        }
        // Only the first run is reported; later runs are re-applies of the same edit.
        if (!fired) {
          fired = true;
          releaseFirst(value);
        }
      });
    } catch (error: any) {
      registrationError = String(error?.message ?? error);
      releaseFirst(null);
    }
  })();

  return {
    first,
    settled,
    hasFired: () => fired,
    invocations: () => invocations,
    error: () => registrationError ?? callbackError,
    release: async () => {
      try {
        await registration?.dispose?.();
      } catch {
        /* teardown must never throw */
      }
    },
  };
}

/** Wait for a value, but never hang: returns the fallback when the budget runs out. */
export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    if (typeof (timer as any).unref === "function") (timer as any).unref();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}
