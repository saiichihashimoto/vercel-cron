# vercel-cron

[![NPM Downloads](https://img.shields.io/npm/dw/vercel-cron?style=flat&logo=npm)](https://www.npmjs.com/package/vercel-cron)
[![Mutation testing badge](https://img.shields.io/endpoint?logo=stryker&style=flat&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Fsaiichihashimoto%2Fvercel-cron%2Fmain)](https://dashboard.stryker-mutator.io/reports/github.com/saiichihashimoto/vercel-cron/main)
[![GitHub commit activity (branch)](https://img.shields.io/github/commit-activity/m/saiichihashimoto/vercel-cron?style=flat&logo=github)](https://github.com/saiichihashimoto/vercel-cron/pulls?q=is%3Apr+is%3Aclosed)
[![GitHub Repo stars](https://img.shields.io/github/stars/saiichihashimoto/vercel-cron?style=flat&logo=github)](https://github.com/saiichihashimoto/vercel-cron/stargazers)
[![GitHub contributors](https://img.shields.io/github/contributors/saiichihashimoto/vercel-cron?style=flat&logo=github)](https://github.com/saiichihashimoto/vercel-cron/graphs/contributors)
[![GitHub issues by-label](https://img.shields.io/github/issues/saiichihashimoto/vercel-cron/help%20wanted?style=flat&logo=github&color=007286)](https://github.com/saiichihashimoto/vercel-cron/labels/help%20wanted)
[![Minified Size](https://img.shields.io/bundlephobia/min/vercel-cron?style=flat)](https://www.npmjs.com/package/vercel-cron?activeTab=code)
[![License](https://img.shields.io/github/license/saiichihashimoto/vercel-cron?style=flat)](LICENSE)

[![GitHub Sponsors](https://img.shields.io/github/sponsors/saiichihashimoto?style=flat)](https://github.com/sponsors/saiichihashimoto)

[Vercel Crons](https://vercel.com/docs/cron-jobs) for local development

## Getting Started

```bash
npm install --save-dev vercel-cron
npx vercel-cron
# See the other options!
npx vercel-cron --help
```

Crons will be loaded from your `vercel.json` and ping `localhost:3000`! Your config will be watched and reloaded on changes, so there's no need to restart.

`process.env.CRON_SECRET` will be used to [secure your cron jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs). You don't need to provide this any differently than you would `next dev`: we're loading your environment variables the [same way that next does](https://www.npmjs.com/package/@next/env).

## Running alongside server

My favorite is [concurrently](https://www.npmjs.com/search?q=concurrently), but there are many libraries that do this.

`package.json`

```json
{
  "scripts": {
    "dev": "concurrently npm:dev:*",
    "dev:cron": "vercel-cron",
    "dev:next": "next dev"
  }
}
```

## Differences from Vercel

### Cron Expressions

Under the covers, we're using [croner](https://www.npmjs.com/package/croner), which has slightly different [cron expressions](https://vercel.com/docs/cron-jobs#cron-expressions) than vercel does. Until we can find an exact validation method, vercel's suggestion is to validate expressions against [crontab guru](https://crontab.guru/).
