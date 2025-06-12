import { Command } from "commander";
import { startTest } from "./index";

import log from "./logger";

import { config as dotenvConfig } from "dotenv";
import type { ConfigPaths } from "#types/config.d.ts";
import loadConfig from "./loadConfig";

const program = new Command();

import { access } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * The paths to the config files in the repo
 */
const CONFIG_PATHS: ConfigPaths = {
	main: resolve(import.meta.dirname, "../config.toml"),
	example: resolve(import.meta.dirname, "../config.example.toml"),
	dotenv: resolve(import.meta.dirname, "../.env"),
};

program.name("WPT-diff").description("A way to test proxies").version("1.0.0");

program.option(
	"-f, --filter <directories>",
	"only run test directories that match filter (ex: /dom,/js)",
);

program.parse();

program.opts();

let dotenvExists = false;
try {
	await access(CONFIG_PATHS.dotenv);
	dotenvExists = true;
} catch {}
if (dotenvExists) {
	const dotenvRes = dotenvConfig({
		path: CONFIG_PATHS.dotenv,
	});
	if (dotenvRes.error)
		throw new Error(`Failed to load the dotenv config: ${dotenvRes.error}`);
}
const debugMode =
	process.env.DEBUG === "1" ||
	process.env.DEBUG?.toLowerCase() === "true" ||
	process.env.DEBUG?.toLowerCase() === "t" ||
	true;
const verboseMode =
	process.env.VERBOSE === "1" ||
	process.env.VERBOSE?.toLowerCase() === "true" ||
	process.env.VERBOSE?.toLowerCase() === "t" ||
	debugMode;

const configRes = await loadConfig(CONFIG_PATHS);
if (configRes.isErr())
	throw new Error(`Failed to load the TOML config: ${configRes.error}`);
const config = configRes.value;

log.info(
	`About to run the tests with debug mode ${debugMode ? "enabled" : "disabled"}`,
);

const startTestRes = await startTest({
	wptUrls: {
		test: config.wpt.urls.tests_base_url,
		api: config.wpt.urls.api_base_url,
	},
	logger: log,
	headless: debugMode,
	maxTests: config.wpt.max_tests,
	silent: !verboseMode,
	underProxy: config.wpt.under_proxy,
});
if (startTestRes.isErr())
	throw new Error(`Failed to run WPT-diff: ${startTestRes.error}`);
const wptDiffRes = startTestRes.value;

log.success(`Passed Tests: ${wptDiffRes.results.pass}`);
log.error(`Failed Tests: ${wptDiffRes.results.fail}`);
log.debug(`Other Test results: ${wptDiffRes.results.other}`);
