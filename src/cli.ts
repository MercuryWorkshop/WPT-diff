import { Command } from "commander";

import { setupPage } from "../scramjet/tests/util/setupPage.ts";
import { startTest } from "./index";

import log from "./logger";

import { config as dotenvConfig } from "dotenv";
import type { ConfigPaths } from "#types/config.d.ts";
import loadConfig from "./util/loadConfig";

const program = new Command();

import { access } from "node:fs/promises";
import { resolve } from "node:path";

import { spawn } from "node:child_process";

/**
 * The paths to the config files in the repo
 */
const CONFIG_PATHS: ConfigPaths = {
	main: resolve(import.meta.dirname, "../config.toml"),
	example: resolve(import.meta.dirname, "../config.example.toml"),
	dotenv: resolve(import.meta.dirname, "../.env"),
};

program.name("WPT-diff").description("A web-platform-tests runner meant for interception proxies to test against to ensure proper API interceptor compatibility.").version("1.0.0");

program.option(
	"-f, --filter <directories>",
	"only run test directories that match filter (ex: /dom,/js)",
);

program.option(
	"-o, --output-failed [file]",
	"output failed test results compared to Chrome baseline as JSON (to stdout if no file specified)",
);

program.option(
	"-r, --report [file]",
	"generate a standardized test report in JSON format (to stdout if no file specified)",
);
program.argument("[scope]", "The scope of tests to run. (optional)")
program.parse();

const programOptions = program.opts();

const configRes = await loadConfig(CONFIG_PATHS);
if (configRes.isErr())
	throw new Error(`Failed to load the TOML config: ${configRes.error}`);
const config = configRes.value;

const debugMode = config.debug.debug;
const verboseMode = config.debug.verbose;
	
log.info(
	`About to run the tests with debug mode ${debugMode ? "enabled" : "disabled"}`,
);
log.info(
	`About to run the tests with verbose mode ${verboseMode ? "enabled" : "disabled"}`,
);

const startTestRes = await startTest({
	logger: log,
	wptUrls: {
		test: config.wpt.urls.tests_base_url,
		api: config.wpt.urls.api_base_url,
	},
	maxTests: config.wpt.max_tests,
	underProxy: config.wpt.under_proxy,
	filter: programOptions.filter,
	outputFailed: programOptions.outputFailed,
	report: programOptions.report,
	setupPage,
	debug: debugMode,
	verbose: verboseMode,
	silent: !verboseMode,
});
if (startTestRes.isErr())
	throw new Error(`Failed to run WPT-diff: ${startTestRes.error}`);

const wptDiffRes = startTestRes.value;

if (!wptDiffRes || !("results" in wptDiffRes)) {
	log.error("No results were returned from the WPT-diff run");
} else {
	log.success(`Passed Tests: ${wptDiffRes.results.pass}`);
	log.error(`Failed Tests: ${wptDiffRes.results.fail}`);
	log.debug(`Other Test results: ${wptDiffRes.results.other}`);
}
