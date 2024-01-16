#!/usr/bin/env node
import chalk from "chalk";
import { Command, Option } from "commander";

import { defaults, main, zOpts } from ".";
import pkg from "../package.json";

// Stryker disable all

(async () =>
  main(
    zOpts.parse(
      new Command()
        .name(pkg.name)
        .version(pkg.version)
        .option("-u --url <url>", "Base URL", defaults.url)
        .option("-p --config <config>", "Vercel Config", defaults.config)
        .addOption(
          new Option("-s --secret <secret>", "Cron Secret").default(
            null,
            "`process.env.CRON_SECRET`"
          )
        )
        .option("--dry", "Shows scheduled Crons and quit")
        .addOption(
          new Option("--color", "Show terminal colors").default(
            Boolean(chalk.supportsColor),
            "`chalk.supportsColor`"
          )
        )
        .addOption(
          new Option("--no-color").hideHelp().implies({ color: false })
        )
        .option("--no-pretty", "No pretty printing, just a JSON stream of logs")
        .addOption(
          new Option("-l --level <level>", "Logging Level")
            .default("info")
            .choices([
              "trace",
              "debug",
              "info",
              "warn",
              "error",
              "fatal",
              "silent",
            ])
        )
        .addOption(new Option("--trace").implies({ level: "trace" }))
        .addOption(new Option("--debug").implies({ level: "debug" }))
        .addOption(new Option("--info").implies({ level: "info" }))
        .addOption(new Option("--warn").implies({ level: "warn" }))
        .addOption(new Option("--error").implies({ level: "error" }))
        .addOption(new Option("--fatal").implies({ level: "fatal" }))
        .addOption(new Option("--silent").implies({ level: "silent" }))
        .addOption(new Option("--ignoreTimestamp").hideHelp())
        .parse()
        .opts()
    )
  ))();
