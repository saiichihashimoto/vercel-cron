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
          text: async () => "Some Text",
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

    proc = main({ destination, fs, signal: controller.signal });

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
        config: "./vercel.json",
        level: 20,
        time: 1696486441293,
        msg: "Watching Config",
      },
      { level: 40, time: 1696486441293, msg: "No CRONs Scheduled" },
    ]);
  });

  it("dry ends the process immediately", async () => {
    const { fs } = memfs(
      { "./vercel.json": JSON.stringify({}) },
      process.cwd()
    );

    proc = main({ destination, fs, signal: controller.signal, dry: true });

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
        config: "./vercel.json",
        level: 20,
        time: 1696486441293,
        msg: "Watching Config",
      },
      { level: 40, time: 1696486441293, msg: "No CRONs Scheduled" },
    ]);
  });

  it("executes CRON when schedule passes", async () => {
    const { fs } = memfs(
      {
        "./vercel.json": JSON.stringify({
          crons: [{ path: "/some-api", schedule: "* * * * *" }],
        }),
      },
      process.cwd()
    );

    proc = main({ destination, fs, signal: controller.signal });

    await jest.advanceTimersByTimeAsync(0);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(destination.logs).toStrictEqual([
      {
        config: "./vercel.json",
        level: 20,
        time: 1696486441293,
        msg: "Watching Config",
      },
      {
        level: 30,
        msg: "Scheduled /some-api Every minute",
        time: 1696486441293,
      },
    ]);
    destination.clear();

    await jest.advanceTimersByTimeAsync(60000);

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:3000/some-api",
      expect.objectContaining({
        method: "GET",
        redirect: "manual",
        headers: {},
      })
    );
    expect(destination.logs).toStrictEqual([
      {
        currentRun: "2023-10-05T06:15:00.000Z",
        level: 30,
        msg: "Started /some-api Every minute",
        time: 1696486500000,
      },
      {
        currentRun: "2023-10-05T06:15:00.000Z",
        level: 30,
        msg: "Succeeded /some-api Every minute",
        status: 200,
        text: "Some Text",
        time: 1696486500000,
      },
    ]);
    destination.clear();

    await jest.advanceTimersByTimeAsync(60000);

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:3000/some-api",
      expect.objectContaining({})
    );
    expect(destination.logs).toStrictEqual([
      {
        currentRun: "2023-10-05T06:16:00.000Z",
        level: 30,
        msg: "Started /some-api Every minute",
        time: 1696486560000,
      },
      {
        currentRun: "2023-10-05T06:16:00.000Z",
        level: 30,
        msg: "Succeeded /some-api Every minute",
        status: 200,
        text: "Some Text",
        time: 1696486560000,
      },
    ]);
  });

  it("handles multiple schedules", async () => {
    const { fs } = memfs(
      {
        "./vercel.json": JSON.stringify({
          crons: [
            { path: "/some-api", schedule: "15,17 * * * *" },
            { path: "/some-other-api", schedule: "16 * * * *" },
          ],
        }),
      },
      process.cwd()
    );

    proc = main({ destination, fs, signal: controller.signal });

    await jest.advanceTimersByTimeAsync(0);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(destination.logs).toStrictEqual([
      {
        config: "./vercel.json",
        level: 20,
        time: 1696486441293,
        msg: "Watching Config",
      },
      {
        level: 30,
        msg: "Scheduled /some-api At 15 and 17 minutes past the hour",
        time: 1696486441293,
      },
      {
        level: 30,
        msg: "Scheduled /some-other-api At 16 minutes past the hour",
        time: 1696486441293,
      },
    ]);
    destination.clear();

    await jest.advanceTimersByTimeAsync(60000);

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:3000/some-api",
      expect.objectContaining({})
    );
    expect(destination.logs).toStrictEqual([
      {
        currentRun: "2023-10-05T06:15:00.000Z",
        level: 30,
        msg: "Started /some-api At 15 and 17 minutes past the hour",
        time: 1696486500000,
      },
      {
        currentRun: "2023-10-05T06:15:00.000Z",
        level: 30,
        msg: "Succeeded /some-api At 15 and 17 minutes past the hour",
        status: 200,
        text: "Some Text",
        time: 1696486500000,
      },
    ]);
    destination.clear();

    await jest.advanceTimersByTimeAsync(60000);

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:3000/some-other-api",
      expect.objectContaining({})
    );
    expect(destination.logs).toStrictEqual([
      {
        currentRun: "2023-10-05T06:16:00.000Z",
        level: 30,
        msg: "Started /some-other-api At 16 minutes past the hour",
        time: 1696486560000,
      },
      {
        currentRun: "2023-10-05T06:16:00.000Z",
        level: 30,
        msg: "Succeeded /some-other-api At 16 minutes past the hour",
        status: 200,
        text: "Some Text",
        time: 1696486560000,
      },
    ]);
    destination.clear();

    await jest.advanceTimersByTimeAsync(60000);

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:3000/some-api",
      expect.objectContaining({})
    );
    expect(destination.logs).toStrictEqual([
      {
        currentRun: "2023-10-05T06:17:00.000Z",
        level: 30,
        msg: "Started /some-api At 15 and 17 minutes past the hour",
        time: 1696486620000,
      },
      {
        currentRun: "2023-10-05T06:17:00.000Z",
        level: 30,
        msg: "Succeeded /some-api At 15 and 17 minutes past the hour",
        status: 200,
        text: "Some Text",
        time: 1696486620000,
      },
    ]);
    destination.clear();
  });

  it("reschedules CRONs on file change", async () => {
    const { fs, vol } = memfs(
      {
        "./vercel.json": JSON.stringify({
          crons: [{ path: "/some-api", schedule: "* * * * *" }],
        }),
      },
      process.cwd()
    );

    proc = main({ destination, fs, signal: controller.signal });

    await jest.advanceTimersByTimeAsync(0);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(destination.logs).toStrictEqual([
      {
        config: "./vercel.json",
        level: 20,
        time: 1696486441293,
        msg: "Watching Config",
      },
      {
        level: 30,
        msg: "Scheduled /some-api Every minute",
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
      { level: 40, msg: "No CRONs Scheduled", time: 1696486441293 },
    ]);
    destination.clear();

    await jest.advanceTimersByTimeAsync(100000);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(destination.logs).toHaveLength(0);
  });

  it("keeps running with malformed config", async () => {
    const { fs, vol } = memfs(
      { "./vercel.json": JSON.stringify([]) },
      process.cwd()
    );

    proc = main({ destination, fs, signal: controller.signal });

    await jest.advanceTimersByTimeAsync(0);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(destination.logs).toStrictEqual([
      {
        config: "./vercel.json",
        level: 20,
        time: 1696486441293,
        msg: "Watching Config",
      },
      {
        level: 60,
        msg: "Failed to Schedule CRONs",
        time: 1696486441293,
        error: {
          type: "ZodError",
          name: "ZodError",
          message: expect.any(String),
          stack: expect.any(String),
          aggregateErrors: [
            {
              code: "invalid_type",
              expected: "object",
              message: "Expected object, received array",
              path: [],
              received: "array",
              stack: "",
              type: "Object",
            },
          ],
          issues: [
            {
              code: "invalid_type",
              expected: "object",
              message: "Expected object, received array",
              path: [],
              received: "array",
            },
          ],
        },
      },
    ]);
    destination.clear();

    vol.fromNestedJSON(
      {
        "./vercel.json": JSON.stringify({
          crons: [{ path: "/some-api", schedule: "* * * * *" }],
        }),
      },
      process.cwd()
    );
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
        msg: "Scheduled /some-api Every minute",
        time: 1696486441293,
      },
    ]);
    destination.clear();

    await jest.advanceTimersByTimeAsync(60000);

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:3000/some-api",
      expect.objectContaining({})
    );
    expect(destination.logs).toStrictEqual([
      {
        currentRun: "2023-10-05T06:15:00.000Z",
        level: 30,
        msg: "Started /some-api Every minute",
        time: 1696486500000,
      },
      {
        currentRun: "2023-10-05T06:15:00.000Z",
        level: 30,
        msg: "Succeeded /some-api Every minute",
        status: 200,
        text: "Some Text",
        time: 1696486500000,
      },
    ]);
  });

  it("uses specified config", async () => {
    const { fs } = memfs(
      {
        "./vercel-other.json": JSON.stringify({
          crons: [{ path: "/some-api", schedule: "* * * * *" }],
        }),
      },
      process.cwd()
    );

    proc = main({
      destination,
      fs,
      signal: controller.signal,
      config: "./vercel-other.json",
    });

    await jest.advanceTimersByTimeAsync(0);
    destination.clear();
    await jest.advanceTimersByTimeAsync(60000);

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:3000/some-api",
      expect.objectContaining({})
    );
    expect(destination.logs).toStrictEqual([
      {
        currentRun: "2023-10-05T06:15:00.000Z",
        level: 30,
        msg: "Started /some-api Every minute",
        time: 1696486500000,
      },
      {
        currentRun: "2023-10-05T06:15:00.000Z",
        level: 30,
        msg: "Succeeded /some-api Every minute",
        status: 200,
        text: "Some Text",
        time: 1696486500000,
      },
    ]);
  });

  it("uses specified url", async () => {
    const { fs } = memfs(
      {
        "./vercel.json": JSON.stringify({
          crons: [{ path: "/some-api", schedule: "* * * * *" }],
        }),
      },
      process.cwd()
    );

    proc = main({
      destination,
      fs,
      signal: controller.signal,
      url: "https://my-website.com",
    });

    await jest.advanceTimersByTimeAsync(0);
    destination.clear();
    await jest.advanceTimersByTimeAsync(60000);

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://my-website.com/some-api",
      expect.objectContaining({})
    );
    expect(destination.logs).toStrictEqual([
      {
        currentRun: "2023-10-05T06:15:00.000Z",
        level: 30,
        msg: "Started /some-api Every minute",
        time: 1696486500000,
      },
      {
        currentRun: "2023-10-05T06:15:00.000Z",
        level: 30,
        msg: "Succeeded /some-api Every minute",
        status: 200,
        text: "Some Text",
        time: 1696486500000,
      },
    ]);
  });

  it("uses specified secret", async () => {
    const { fs } = memfs(
      {
        "./vercel.json": JSON.stringify({
          crons: [{ path: "/some-api", schedule: "* * * * *" }],
        }),
      },
      process.cwd()
    );

    proc = main({
      destination,
      fs,
      signal: controller.signal,
      secret: "mock-secret",
    });

    await jest.advanceTimersByTimeAsync(0);
    destination.clear();
    await jest.advanceTimersByTimeAsync(60000);

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:3000/some-api",
      expect.objectContaining({
        headers: { Authorization: "Bearer mock-secret" },
      })
    );
    expect(destination.logs).toStrictEqual([
      {
        currentRun: "2023-10-05T06:15:00.000Z",
        level: 30,
        msg: "Started /some-api Every minute",
        time: 1696486500000,
      },
      {
        currentRun: "2023-10-05T06:15:00.000Z",
        level: 30,
        msg: "Succeeded /some-api Every minute",
        status: 200,
        text: "Some Text",
        time: 1696486500000,
      },
    ]);
  });

  it("prints not-ok fetch responses", async () => {
    const { fs } = memfs(
      {
        "./vercel.json": JSON.stringify({
          crons: [{ path: "/some-api", schedule: "* * * * *" }],
        }),
      },
      process.cwd()
    );

    fetchSpy.mockImplementation(
      async (url) =>
        ({
          headers: {},
          ok: false,
          redirected: false,
          status: 400,
          statusText: "OK",
          type: "basic",
          url: url.toString(),
          text: async () => "Mock Error",
        } as Response)
    );

    proc = main({ destination, fs, signal: controller.signal });

    await jest.advanceTimersByTimeAsync(0);
    destination.clear();
    await jest.advanceTimersByTimeAsync(60000);

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:3000/some-api",
      expect.objectContaining({})
    );
    expect(destination.logs).toStrictEqual([
      {
        currentRun: "2023-10-05T06:15:00.000Z",
        level: 30,
        msg: "Started /some-api Every minute",
        time: 1696486500000,
      },
      {
        currentRun: "2023-10-05T06:15:00.000Z",
        level: 50,
        msg: "Failed /some-api Every minute",
        status: 400,
        text: "Mock Error",
        time: 1696486500000,
        error: {
          message: "Mock Error",
          type: "Error",
          stack: expect.any(String),
        },
      },
    ]);
  });

  it("prints fetch errors", async () => {
    const { fs } = memfs(
      {
        "./vercel.json": JSON.stringify({
          crons: [{ path: "/some-api", schedule: "* * * * *" }],
        }),
      },
      process.cwd()
    );

    fetchSpy.mockRejectedValue(new Error("Mock Error"));

    proc = main({ destination, fs, signal: controller.signal });

    await jest.advanceTimersByTimeAsync(0);
    destination.clear();
    await jest.advanceTimersByTimeAsync(60000);

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:3000/some-api",
      expect.objectContaining({})
    );
    expect(destination.logs).toStrictEqual([
      {
        currentRun: "2023-10-05T06:15:00.000Z",
        level: 30,
        msg: "Started /some-api Every minute",
        time: 1696486500000,
      },
      {
        currentRun: "2023-10-05T06:15:00.000Z",
        level: 50,
        msg: "Failed /some-api Every minute",
        time: 1696486500000,
        error: {
          message: "Mock Error",
          type: "Error",
          stack: expect.any(String),
        },
      },
    ]);
  });
});
