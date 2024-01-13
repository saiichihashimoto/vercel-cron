import fs from "node:fs/promises";

import boxen from "boxen";
import chalk, { supportsColor } from "chalk";
import { Cron } from "croner";
import cronstrue from "cronstrue";
import pino from "pino";
import z from "zod";

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

const unshiftIterable = async function* <T>(
  value: T,
  iterable: AsyncIterable<T>
) {
  yield value;

  // eslint-disable-next-line no-restricted-syntax, fp/no-loops -- Generator loop
  for await (const value of iterable) {
    yield value;
  }
};

export const zOpts = z.object({
  url: z.string(),
  config: z.string(),
  secret: z.optional(z.string()),
  ignoreTime: z.optional(z.boolean()),
  dryRun: z.boolean(),
  level: z.union([
    z.literal("trace"),
    z.literal("debug"),
    z.literal("info"),
    z.literal("warn"),
    z.literal("error"),
    z.literal("fatal"),
  ]),
});

export const main = async (opts: z.infer<typeof zOpts>) => {
  // eslint-disable-next-line no-console -- boxen!
  console.log(
    boxen("▲   Vercel CRON   ▲", {
      borderColor: "magenta",
      borderStyle: "round",
      margin: { left: 0, right: 0, top: 0, bottom: 1 },
      padding: 1,
    })
  );

  const { config, dryRun, ignoreTime, level, secret, url } = opts;

  const logger = pino({
    level,
    timestamp: !ignoreTime,
    errorKey: "error",
    transport: {
      target: "pino-pretty",
      options: {
        colorize: Boolean(supportsColor),
        float: "center",
        levelFirst: true,
        singleLine: true,
        translateTime: "UTC:yyyy-mm-dd'T'HH:MM:ss.l'Z'",
        ignore: "pid,hostname",
      },
    },
  });

  logger.trace({ opts }, "Parsed Options");

  const watchConfig = async () => {
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
      .parse(JSON.parse((await fs.readFile(config)).toString()));

    const abortController = new AbortController();

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
              signal: abortController.signal,
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

      abortController.signal.addEventListener("abort", cron.stop.bind(cron));

      logger.info(`Scheduled ${pathString}`);

      return cron;
    });

    if (!crons.length) {
      logger.info("No CRONs Scheduled");
    }

    return abortController.abort.bind(abortController);
  };

  logger.debug({ config }, "Watching Config");

  let abortPrevious: (() => void) | undefined;

  // eslint-disable-next-line no-restricted-syntax, fp/no-loops -- Generator loop
  for await (const value of unshiftIterable(
    {
      eventType: "rename",
      filename: config,
    },
    fs.watch(config, { persistent: true })
  )) {
    if (abortPrevious) {
      logger.trace(value, "fs.watch");
      logger.info({ config }, "Config Changed");
      abortPrevious();
    }

    abortPrevious = await watchConfig();

    if (dryRun) {
      abortPrevious();

      break;
    }
  }
};
