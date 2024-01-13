import {
  ChildProcess,
  ExecException,
  ExecOptions,
  exec as execCallback,
} from "node:child_process";

import { beforeAll, describe, expect, it } from "@jest/globals";

const exec = (command: string, options: ExecOptions = {}) => {
  let proc: ChildProcess;

  const promise = new Promise<{
    error: ExecException | null;
    stderr: string;
    stdout: string;
  }>((resolve) => {
    proc = execCallback(
      command,
      options,
      // eslint-disable-next-line promise/prefer-await-to-callbacks -- HACK promisify loses reference to process, which we need
      (error, stdout, stderr) => resolve({ error, stderr, stdout })
    );
  });

  return {
    // @ts-expect-error -- HACK it gets set immediately in the promise
    proc,
    promise,
  };
};

describe("bin", () => {
  beforeAll(async () => {
    await exec("npm run build").promise;
  });

  it("--version", async () => {
    const { stderr, stdout } = await exec("node ./dist/bin.js --version")
      .promise;

    expect(stderr).toBe("");
    expect(stdout).toBe("0.0.0-development\n");
  });

  it("--help", async () => {
    const { stderr, stdout } = await exec("node ./dist/bin.js --help").promise;

    expect(stderr).toBe("");
    expect(stdout).toBe(`Usage: vercel-cron [options]

Options:
  -V, --version         output the version number
  -u --url <url>        Base URL (default: "http://localhost:3000")
  -p --config <config>  Vercel Config (default: "./vercel.json")
  -s --secret <secret>  Cron Secret
  -l --level <level>    Logging Level (choices: "trace", "debug", "info",
                        "warn", "error", "fatal", default: "info")
  -h, --help            display help for command
`);
  });

  it("runs with empty vercel.json", async () => {
    const { proc, promise } = exec("node ./dist/bin.js", {
      env: { ...process.env, FORCE_COLOR: "0", IGNORE_TIME: "1" },
    });

    setTimeout(() => proc.kill("SIGINT"), 1000);

    const { error, stderr, stdout } = await promise;

    expect(error).toHaveProperty("signal", "SIGINT");
    expect(stderr).toBe("");
    expect(stdout).toBe(`╭─────────────────────────╮
│                         │
│   ▲   Vercel CRON   ▲   │
│                         │
╰─────────────────────────╯

INFO [test]: No CRONs Scheduled
`);
  });
});
