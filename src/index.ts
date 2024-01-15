import fsNative from "node:fs";
import { promisify } from "node:util";

import boxen from "boxen";
import chalk from "chalk";
import { Cron } from "croner";
import cronstrue from "cronstrue";
import pino from "pino";
import z from "zod";

// TODO [engine:node@>=20.3.0]: Replace with AbortSignal.any
const anySignal = (signals: Array<AbortSignal | null | undefined>) => {
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

type MaybePromise<V> = Promise<V> | V;

const ignoreAbortError = async <V>(
  fn: Promise<V> | (() => MaybePromise<V>)
): Promise<V | undefined> => {
  try {
    return await (fn instanceof Promise ? fn : fn());
  } catch (error) {
    if (
      !z
        .intersection(
          z.instanceof(Error),
          z.object({
            cause: z.intersection(
              z.instanceof(DOMException),
              z.object({ name: z.literal("AbortError") })
            ),
          })
        )
        .safeParse(error).success
    ) {
      throw error;
    }
  }

  return undefined;
};

export const zOpts = z
  .object({
    color: z.boolean(),
    config: z.string(),
    dry: z.boolean(),
    ignoreTimestamp: z.boolean(),
    secret: z.nullable(z.string()),
    url: z.string(),
    level: z.union([
      z.literal("trace"),
      z.literal("debug"),
      z.literal("info"),
      z.literal("warn"),
      z.literal("error"),
      z.literal("fatal"),
      z.literal("silent"),
    ]),
  })
  .partial();

export const defaults = {
  color: Boolean(chalk.supportsColor),
  config: "./vercel.json",
  level: "info",
  secret: process.env.CRON_SECRET ?? null,
  url: "http://localhost:3000",
} satisfies z.infer<typeof zOpts>;

export const main = async ({
  fs = fsNative,
  signal,
  ...opts
}: z.infer<typeof zOpts> & { fs?: typeof fsNative; signal?: AbortSignal }) => {
  const { color, config, dry, ignoreTimestamp, level, secret, url } = {
    ...defaults,
    ...opts,
  };

  const logger = pino({
    level,
    timestamp: !ignoreTimestamp,
    errorKey: "error",
    transport: {
      target: "pino-pretty",
      options: {
        colorize: color,
        float: "center",
        levelFirst: true,
        singleLine: true,
        translateTime: "UTC:yyyy-mm-dd'T'HH:MM:ss.l'Z'",
        ignore: "pid,hostname",
      },
    },
  });

  if (logger.isLevelEnabled("info")) {
    // eslint-disable-next-line no-console -- boxen!
    console.log(
      boxen("▲   Vercel CRON   ▲", {
        borderColor: color ? "magenta" : undefined,
        borderStyle: "round",
        margin: { left: 0, right: 0, top: 0, bottom: 1 },
        padding: 1,
      })
    );
  }

  logger.trace({ opts }, "Parsed Options");

  const readFile = promisify(fs.readFile);

  const scheduleCrons = () => {
    const controller = new AbortController();

    (async () => {
      const { crons: cronConfigs = [] } = z
        .object({
          crons: z.optional(
            z.array(
              z.object({
                path: z.string(),
                schedule: z.string(),
              })
            )
          ),
        })
        .parse(JSON.parse((await readFile(config)).toString()));

      const crons = cronConfigs.map(({ path, schedule }) => {
        const pathString = `${chalk.magenta(path)} ${chalk.yellow(
          cronstrue.toString(schedule)
        )}`;

        const cron = Cron(schedule, { timezone: "UTC" }, async () => {
          const runLogger = logger.child({ currentRun: cron.currentRun() });
          runLogger.info(`Started ${pathString}`);

          let res: Response | undefined;

          try {
            res = await ignoreAbortError(
              fetch(url + path, {
                method: "GET",
                redirect: "manual",
                signal: anySignal([signal, controller.signal]),
                headers: !secret ? {} : { Authorization: `Bearer ${secret}` },
              })
            );
          } catch (error) {
            runLogger.error({ error }, `Failed ${pathString}`);

            return;
          }

          if (!res) {
            return;
          }

          if (res.status >= 300) {
            runLogger.error(
              { status: res.status, error: new Error(await res.text()) },
              `Failed ${pathString}`
            );
          } else {
            runLogger.info(
              { status: res.status, text: await res.text() },
              `Succeeded ${pathString}`
            );
          }
        });

        controller.signal.addEventListener("abort", cron.stop.bind(cron));

        logger.info(`Scheduled ${pathString}`);

        return cron;
      });

      if (!crons.length) {
        logger.info("No CRONs Scheduled");
      }
    })();

    return controller.abort.bind(controller);
  };

  logger.debug({ config }, "Watching Config");

  let abortPrevious: (() => void) | undefined;

  const handler = ((eventType, filename) => {
    logger.trace({ eventType, filename }, "fs.watch");

    if (abortPrevious) {
      logger.info({ config }, "Config Changed");
    }

    abortPrevious?.();
    abortPrevious = scheduleCrons();
  }) satisfies Parameters<typeof fs.watch>[1];

  handler("rename", config);

  if (dry) {
    abortPrevious?.();

    return;
  }

  const watcher = fs.watch(config, { signal }, handler);

  await promisify(watcher.on.bind(watcher))("close");
};
