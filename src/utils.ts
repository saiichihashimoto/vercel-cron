// Stryker disable all

// TODO [typescript@>=5.8]: Replace with AbortSignal.any https://github.com/microsoft/TypeScript/issues/60695
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
