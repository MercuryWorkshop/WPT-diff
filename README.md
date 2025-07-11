# WPT-diff

WPT-diff is a test runner for [web-platform-tests](https://github.com/web-platform-tests/wpt), which features its own test harness

## How to run

1. Ensure you have [pnpm](https://pnpm.io/installation) installed
2. Clone the git repository with `git clone --recursive https://github.com/MercuryWorkshop/wpt-diff`
3. Install the dependencies with `pnpm i`
4. Create a config. You can use the example with `mv config.example.toml config.toml`.
5. Run `pnpm generate:validators` to generate type validations (optional)
6. Run the CLI `pnpm start`

## FAQ

### I want to get test results for my Web Proxy

Use the action at [action.yml](./action.yml)
You could also [see the Scramjet Workflow](https://github.com/MercuryWorkshop/scramjet/blob/main/.github/workflows/wpt_diff_epoch.yml) that uses this action for an example
You need to provide a script with the same API as [setupPage](https://github.com/MercuryWorkshop/scramjet/blob/main/tests/util/setupPage.ts) from [Scramjet](https://scramjet.mercurywork.shop)
