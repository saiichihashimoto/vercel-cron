#!/usr/bin/env node
import { Command, Option } from "commander";

import { main, zOpts } from ".";
import pkg from "../package.json";

main(
  zOpts.parse(
    new Command()
      .name(pkg.name)
      .version(pkg.version)
      .option("-u --url <url>", "Base URL", "http://localhost:3000")
      .option("-p --config <config>", "Vercel Config", "./vercel.json")
      .addOption(
        new Option("-s --secret <secret>", "Cron Secret").default(
          process.env.CRON_SECRET,
          "process.env.CRON_SECRET"
        )
      )
      .option("--dryRun", "Shows scheduled CRONs and quits", false)
      .addOption(
        new Option("-l --level <level>", "Logging Level")
          .default("info")
          .choices(["trace", "debug", "info", "warn", "error", "fatal"])
      )
      .addOption(new Option("--ignoreTime").hideHelp())
      .parse()
      .opts()
  )
);
