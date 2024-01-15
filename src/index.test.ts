import { Buffer } from "node:buffer";
import fsNative from "node:fs";
import { setTimeout } from "node:timers/promises";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { SpiedFunction } from "jest-mock";
import { memfs as memfsNative } from "memfs";

import { main } from ".";

const memfs = (...args: Parameters<typeof memfsNative>) => {
  const { fs, vol } = memfsNative(...args);

  return {
    vol,
    fs: {
      ...fs,
      /* eslint-disable promise/prefer-await-to-callbacks -- HACK */
      readFile: (
        path: string,
        callback: (err: NodeJS.ErrnoException | null, data: Buffer) => void
      ) => {
        try {
          callback(null, fs.readFileSync(path) as Buffer);
        } catch (error) {
          callback(error as NodeJS.ErrnoException, Buffer.from([]));
        }
      },
      watch: (path: any, options: { signal?: AbortSignal }, handler: any) => {
        const watcher = fs.watch(path, options as any, handler);

        const closeBefore = watcher.close.bind(watcher);

        // TODO PR For https://github.com/streamich/memfs/blob/eac1ce29b7aa0a18b3b20d7f4821c020526420ee/src/volume.ts#L2573
        watcher.close = () => {
          closeBefore();
          watcher.emit("close");
        };

        // TODO PR For this
        options.signal?.addEventListener("abort", () => {
          watcher.close();
        });

        return watcher;
      },
      /* eslint-enable promise/prefer-await-to-callbacks */
    } as unknown as typeof fsNative,
  };
};

describe("main", () => {
  let controller: AbortController;
  let proc: ReturnType<typeof main> | undefined;
  let fetchSpy: SpiedFunction<typeof global.fetch>;
  const destination = {
    logs: [] as any[],
    clear: () => {
      destination.logs = [];
    },
    write: (msg: string) => {
      destination.logs.push(JSON.parse(msg));
    },
  };

  beforeEach(() => {
    controller = new AbortController();
    fetchSpy = jest.spyOn(global, "fetch").mockImplementation(
      async (url) =>
        ({
          headers: {},
          ok: true,
          redirected: false,
          status: 200,
          statusText: "OK",
          type: "basic",
          url: url.toString(),
          text: async () => "",
        } as Response)
    );
  });

  afterEach(async () => {
    controller.abort();

    await proc;

    jest.clearAllTimers();
    destination.clear();
  });

  it("runs forever", async () => {
    const { fs } = memfs(
      { "./vercel.json": JSON.stringify({}) },
      process.cwd()
    );

    proc = main({
      destination,
      fs,
      signal: controller.signal,
    });

    await jest.advanceTimersByTimeAsync(0);

    const [winner] = await Promise.all([
      Promise.race([
        setTimeout(500, "timeout", { signal: controller.signal }),
        proc,
      ]),
      jest.advanceTimersByTimeAsync(500),
    ]);

    expect(winner).toBe("timeout");
    expect(destination.logs).toStrictEqual([
      {
        level: 30,
        time: 1696486441293,
        msg: "No CRONs Scheduled",
      },
    ]);
  });

  it("dry ends the process immediately", async () => {
    const { fs } = memfs(
      { "./vercel.json": JSON.stringify({}) },
      process.cwd()
    );

    proc = main({
      destination,
      fs,
      signal: controller.signal,
      dry: true,
    });

    await jest.advanceTimersByTimeAsync(0);

    const [winner] = await Promise.all([
      Promise.race([
        setTimeout(500, "timeout", { signal: controller.signal }),
        proc,
      ]),
      jest.advanceTimersByTimeAsync(500),
    ]);

    expect(winner).not.toBe("timeout");
    expect(destination.logs).toStrictEqual([
      {
        level: 30,
        time: 1696486441293,
        msg: "No CRONs Scheduled",
      },
    ]);
  });

  it("executes CRON when schedule passes", async () => {
    const { fs } = memfs(
      {
        "./vercel.json": JSON.stringify({
          crons: [{ path: "/some-api", schedule: "* * * * * *" }],
        }),
      },
      process.cwd()
    );

    proc = main({
      destination,
      fs,
      signal: controller.signal,
    });

    await jest.advanceTimersByTimeAsync(0);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(destination.logs).toStrictEqual([
      {
        level: 30,
        msg: "Scheduled /some-api Every second",
        time: 1696486441293,
      },
    ]);
    destination.clear();

    await jest.advanceTimersByTimeAsync(1000);

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "http://localhost:3000/some-api",
      expect.objectContaining({
        method: "GET",
        redirect: "manual",
        headers: {},
      })
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(destination.logs).toStrictEqual([
      {
        currentRun: "2023-10-05T06:14:02.000Z",
        level: 30,
        msg: "Started /some-api Every second",
        time: 1696486442000,
      },
      {
        currentRun: "2023-10-05T06:14:02.000Z",
        level: 30,
        msg: "Succeeded /some-api Every second",
        status: 200,
        text: "",
        time: 1696486442000,
      },
    ]);
    destination.clear();

    await jest.advanceTimersByTimeAsync(1000);

    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "http://localhost:3000/some-api",
      expect.objectContaining({
        method: "GET",
        redirect: "manual",
        headers: {},
      })
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(destination.logs).toStrictEqual([
      {
        currentRun: "2023-10-05T06:14:03.000Z",
        level: 30,
        msg: "Started /some-api Every second",
        time: 1696486443000,
      },
      {
        currentRun: "2023-10-05T06:14:03.000Z",
        level: 30,
        msg: "Succeeded /some-api Every second",
        status: 200,
        text: "",
        time: 1696486443000,
      },
    ]);
  });

  it("misses CRON if config changes", async () => {
    const { fs, vol } = memfs(
      {
        "./vercel.json": JSON.stringify({
          crons: [{ path: "/some-api", schedule: "* * * * * *" }],
        }),
      },
      process.cwd()
    );

    proc = main({
      destination,
      fs,
      signal: controller.signal,
    });

    await jest.advanceTimersByTimeAsync(0);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(destination.logs).toStrictEqual([
      {
        level: 30,
        msg: "Scheduled /some-api Every second",
        time: 1696486441293,
      },
    ]);
    destination.clear();

    vol.fromNestedJSON({ "./vercel.json": JSON.stringify({}) }, process.cwd());
    await jest.advanceTimersByTimeAsync(0);

    expect(destination.logs).toStrictEqual([
      {
        config: "./vercel.json",
        level: 30,
        msg: "Config Changed",
        time: 1696486441293,
      },
      {
        level: 30,
        msg: "No CRONs Scheduled",
        time: 1696486441293,
      },
    ]);
    destination.clear();

    await jest.advanceTimersByTimeAsync(100000);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(0);
    expect(destination.logs).toHaveLength(0);
  });
});
