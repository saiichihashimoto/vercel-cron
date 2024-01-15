import { exec as execCallback } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import chalk from "chalk";

// eslint-disable-next-line global-require, @typescript-eslint/no-require-imports, unicorn/prefer-module, @typescript-eslint/no-unused-vars -- HACK We're "including" bin by running a process against the built file so jest won't pick it up with `--findRelatedTests`.
const helpJestFindRelatedTests = () => require("./vercel-cron");

jest.useRealTimers();

describe("vercel-cron", () => {
  const exec = promisify(execCallback);
  let controller: AbortController;

  beforeEach(() => {
    controller = new AbortController();
  });

  afterEach(() => {
    controller.abort();
  });

  it("prints version", async () => {
    const { stderr, stdout } = await exec(
      "ts-node ./src/vercel-cron.ts --version",
      { signal: controller.signal }
    );

    expect(stderr).toBe("");
    expect(stdout).toBe("0.0.0-development\n");
  });

  it("prints help", async () => {
    const { stderr, stdout } = await exec(
      "ts-node ./src/vercel-cron.ts --help",
      { signal: controller.signal }
    );

    expect(stderr).toBe("");
    expect(stdout).toBe(`Usage: vercel-cron [options]

Options:
  -V, --version         output the version number
  -u --url <url>        Base URL (default: "http://localhost:3000")
  -p --config <config>  Vercel Config (default: "./vercel.json")
  -s --secret <secret>  Cron Secret (default: \`process.env.CRON_SECRET\`)
  --dry                 Shows scheduled CRONs and quit
  --color               Show terminal colors (default: \`chalk.supportsColor\`)
  --no-pretty           No pretty printing, just a JSON stream of logs
  -l --level <level>    Logging Level (choices: "trace", "debug", "info",
                        "warn", "error", "fatal", "silent", default: "info")
  --trace
  --debug
  --info
  --warn
  --error
  --fatal
  --silent
  -h, --help            display help for command
`);
  });

  it("runs forever", async () => {
    const winner = await Promise.race([
      setTimeout(500, "timeout", { signal: controller.signal }),
      exec("ts-node ./src/vercel-cron.ts", {
        signal: controller.signal,
      }),
    ]);

    expect(winner).toBe("timeout");
  });

  it("prints banner", async () => {
    const { stderr, stdout } = await exec(
      "ts-node ./src/vercel-cron.ts --ignoreTimestamp --dry",
      { signal: controller.signal }
    );

    expect(stderr).toBe("");
    expect(stdout).toBe(
      `${chalk.magenta("╭─────────────────────────╮")}
${chalk.magenta("│")}                         ${chalk.magenta("│")}
${chalk.magenta("│")}   ▲   Vercel CRON   ▲   ${chalk.magenta("│")}
${chalk.magenta("│")}                         ${chalk.magenta("│")}
${chalk.magenta("╰─────────────────────────╯")}

${chalk.yellow("WARN")}: ${chalk.cyan(`No CRONs Scheduled`)}
`
    );
  });
});
