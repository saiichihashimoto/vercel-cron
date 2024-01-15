import fsNative from "node:fs";

// import { setTimeout } from "node:timers/promises";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { memfs } from "memfs";

import { main } from ".";

const setTimeout = (
  delay?: number,
  { signal }: { signal?: AbortSignal } = {}
) =>
  new Promise<void>((resolve) => {
    global.setTimeout(resolve, delay);

    signal?.addEventListener("abort", () => resolve());
  });

describe("main", () => {
  let controller: AbortController;

  beforeEach(() => {
    controller = new AbortController();
  });

  afterEach(() => {
    controller.abort();
    jest.clearAllTimers();
  });

  it("runs continuously", async () => {
    const { fs } = memfs({
      [process.cwd()]: {
        "./vercel.json": "{}",
      },
    });

    const [winner] = await Promise.all([
      Promise.race([
        (async () => {
          await setTimeout(500, { signal: controller.signal });

          return "timeout";
        })(),
        (async () => {
          await main({
            fs: fs as unknown as typeof fsNative,
            level: "silent",
            signal: controller.signal,
          });

          return "main";
        })(),
      ]),
      jest.advanceTimersByTimeAsync(500),
    ]);

    expect(winner).toBe("timeout");
  });

  it("dry ends the process immediately", async () => {
    const { fs } = memfs({
      [process.cwd()]: {
        "./vercel.json": "{}",
      },
    });

    const [winner] = await Promise.all([
      Promise.race([
        (async () => {
          await setTimeout(500, { signal: controller.signal });

          return "timeout";
        })(),
        (async () => {
          await main({
            fs: fs as unknown as typeof fsNative,
            level: "silent",
            signal: controller.signal,
            dry: true,
          });

          return "main";
        })(),
      ]),
      jest.advanceTimersByTimeAsync(500),
    ]);

    expect(winner).toBe("main");
  });
});
