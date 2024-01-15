// Stryker disable all

// TODO [engine:node@>=20.3.0]: Replace with AbortSignal.any
export const anySignal = (signals: Array<AbortSignal | null | undefined>) => {
  const controller = new globalThis.AbortController();

  const onAbort = () => {
    controller.abort();

    signals.forEach((signal) => {
      if (signal?.removeEventListener) {
        signal.removeEventListener("abort", onAbort);
      }
    });
  };

  signals.forEach((signal) => {
    if (signal?.addEventListener) {
      signal.addEventListener("abort", onAbort);
    }
  });

  if (signals.some((signal) => signal?.aborted)) {
    onAbort();
  }

  return controller.signal;
};
