import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";

import { beforeAll, describe, expect, it } from "@jest/globals";

// eslint-disable-next-line global-require, @typescript-eslint/no-require-imports, unicorn/prefer-module, @typescript-eslint/no-unused-vars -- HACK We're "including" bin by running a process against the built file so jest won't pick it up with `--findRelatedTests`.
const helpJestFindRelatedTests = () => require("./vercel-cron");

const exec = promisify(execCallback);

describe("vercel-cron", () => {
  beforeAll(async () => {
    await exec("npm run build");
  });

  it("--version", async () => {
    const { stderr, stdout } = await exec(
      "node ./dist/vercel-cron.js --version"
    );

    expect(stderr).toBe("");
    expect(stdout).toBe("0.0.0-development\n");
  });

  it("--help", async () => {
    const { stderr, stdout } = await exec("node ./dist/vercel-cron.js --help");

    expect(stderr).toBe("");
    expect(stdout).toBe(`Usage: vercel-cron [options]

Options:
  -V, --version         output the version number
  -u --url <url>        Base URL (default: "http://localhost:3000")
  -p --config <config>  Vercel Config (default: "./vercel.json")
  -s --secret <secret>  Cron Secret (default: \`process.env.CRON_SECRET\`)
  --dry                 Shows scheduled CRONs and quit
  --color               Show terminal colors (default: \`chalk.supportsColor\`)
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

  it("runs without error", async () => {
    const { stderr, stdout } = await exec(
      "node ./dist/vercel-cron.js --ignoreTimestamp --dry --no-color"
    );

    expect(stderr).toBe("");
    expect(stdout).toBe(`╭─────────────────────────╮
│                         │
│   ▲   Vercel CRON   ▲   │
│                         │
╰─────────────────────────╯

INFO: No CRONs Scheduled
`);
  });
});
