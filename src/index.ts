import fsNative from "node:fs";
import { promisify } from "node:util";

import boxen from "boxen";
import chalk from "chalk";
import { Cron } from "croner";
import cronstrue from "cronstrue";
import { debounce } from "lodash/fp";
import pino from "pino";
import type { LoggerOptions } from "pino";
import z from "zod";

import { anySignal } from "./utils";

export const zOpts = z
  .object({
    color: z.boolean(),
    config: z.string(),
    dry: z.boolean(),
    ignoreTimestamp: z.boolean(),
    pretty: z.boolean(),
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
  config: "./vercel.json",
  secret: process.env.CRON_SECRET ?? null,
  url: "http://localhost:3000",
} satisfies z.infer<typeof zOpts>;

export const main = async ({
  destination,
  signal,
  fs = fsNative,
  ...opts
}: z.infer<typeof zOpts> & {
  destination?: pino.DestinationStream;
  fs?: typeof fsNative;
  signal?: AbortSignal;
}) => {
  const {
    color,
    config,
    dry,
    ignoreTimestamp,
    pretty,
    secret,
    url,
    level = "debug",
  } = {
    ...defaults,
    ...opts,
  };

  if (chalk.supportsColor && !color) {
    chalk.level = 0;
  }

  const loggerOptions = {
    level,
    timestamp: !ignoreTimestamp,
    errorKey: "error",
    redact: {
      paths: ["pid", "hostname"],
      remove: true,
    },
    ...(!pretty
      ? {}
      : {
          transport: {
            target: "pino-pretty",
            options: {
              colorize: color,
              float: "center",
              levelFirst: true,
              singleLine: true,
              translateTime: "UTC:yyyy-mm-dd'T'HH:MM:ss.l'Z'",
            },
          },
        }),
  } satisfies LoggerOptions;

  const logger = !destination
    ? pino(loggerOptions)
    : pino(loggerOptions, destination);

  if (logger.isLevelEnabled("info") && pretty) {
    /* eslint-disable no-console -- boxen! */
    console.log(
      boxen("▲   Vercel CRON   ▲", {
        borderColor: color ? "magenta" : undefined,
        borderStyle: "round",
        padding: 1,
      })
    );
    console.log();
    /* eslint-enable no-console */
  }

  logger.trace({ opts }, "Parsed Options");

  const readFile = promisify(fs.readFile.bind(fs));

  const scheduleCrons = async () => {
    const controller = new AbortController();

    const configContent = (await readFile(config)).toString();
    logger.trace({ config: configContent }, "Config");

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
      .parse(JSON.parse(configContent));

    const crons = cronConfigs.map(({ path, schedule }) => {
      const pathString = `${chalk.magenta(path)} ${chalk.yellow(
        cronstrue.toString(schedule)
      )}`;

      const cron = Cron(schedule, async () => {
        const runLogger = logger.child({ currentRun: cron.currentRun() });
        runLogger.info(`Started ${pathString}`);

        let res: Response | undefined;

        try {
          res = await fetch(url + path, {
            method: "GET",
            redirect: "manual",
            signal: anySignal([signal, controller.signal]),
            headers: !secret ? {} : { Authorization: `Bearer ${secret}` },
          });
        } catch (error) {
          runLogger.error({ error }, `Failed ${pathString}`);

          return;
        }

        const text = await res.text();
        if (!res.ok) {
          runLogger.error(
            { status: res.status, text, error: new Error(text) },
            `Failed ${pathString}`
          );
        } else {
          runLogger.info(
            { status: res.status, text },
            `Succeeded ${pathString}`
          );
        }
      });

      controller.signal.addEventListener("abort", cron.stop.bind(cron));

      logger.info(`Scheduled ${pathString}`);

      return cron;
    });

    if (!crons.length) {
      logger.warn("No CRONs Scheduled");
    }

    return controller.abort.bind(controller);
  };

  logger.debug({ config }, "Watching Config");

  let abortPrevious: (() => void) | undefined;

  const handler = debounce(0, (async (eventType, filename) => {
    logger.trace({ eventType, filename }, "fs.watch");

    if (abortPrevious) {
      logger.info({ config }, "Config Changed");
    }

    abortPrevious?.();
    try {
      // eslint-disable-next-line require-atomic-updates -- HACK
      abortPrevious = await scheduleCrons();
    } catch (error) {
      logger.fatal({ error }, "Failed to Schedule CRONs");
      abortPrevious = () => {};
    }
  }) satisfies Parameters<typeof fs.watch>[1]);

  handler("rename", config);

  if (dry) {
    abortPrevious?.();

    return;
  }

  const watcher = fs.watch(config, { signal }, handler);

  await promisify(watcher.on.bind(watcher))("close");
};
