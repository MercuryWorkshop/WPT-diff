import { Command } from "commander";

import { setupPage } from "../scramjet/tests/util/setupPage.ts";
import TestRunner from "./index";

import log from "./logger";

import type { ConfigPaths } from "#types/config.d.ts";
import loadConfig from "./util/loadConfig";

const program = new Command();

import { resolve } from "node:path";

/**
 * The paths to the config files in the repo
 */
const CONFIG_PATHS: ConfigPaths = {
	main: resolve(import.meta.dirname, "../config.toml"),
	example: resolve(import.meta.dirname, "../config.example.toml"),
};

program
	.name("WPT-diff")
	.description(
		"A web-platform-tests runner meant for interception proxies to test against to ensure proper API interceptor compatibility.",
	)
	.version("1.0.0");

program.option(
	"-o, --output-failed [file]",
	"output failed test results compared to Chrome baseline as JSON (to stdout if no file specified)",
);

program.option(
	"-r, --report [file]",
	"generate a standardized test report in JSON format (to stdout if no file specified)",
);

program.argument("[scope]", "The scope of tests to run. (optional)");

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

const testRunner = new TestRunner({
	logger: log,
	wptUrls: {
		test: config.wpt.urls.tests_base_url,
		api: config.wpt.urls.api_base_url,
		testsBaseUrl: config.wpt.urls.tests_base_url,
	},
	maxTests: config.wpt.max_tests,
	underProxy: config.wpt.under_proxy,
	scope: program.args[0],
	outputFailed: programOptions.outputFailed,
	report: programOptions.report,
	setupPage,
	debug: debugMode,
	verbose: verboseMode,
	silent: !verboseMode,
});

const startTestRes = await testRunner.startTest();
if (startTestRes.isErr())
	throw new Error(`Failed to run WPT-diff: ${startTestRes.error}`);

const wptDiffRes = startTestRes.value;

if (!wptDiffRes || !("results" in wptDiffRes)) {
	log.error("No results were returned from the WPT-diff run");
} else {
	log.success(`Passed Subtests: ${wptDiffRes.results.pass}`);
	log.error(`Failed Subtests: ${wptDiffRes.results.fail}`);
	log.info(
		`Total Subtests: ${wptDiffRes.results.pass}/${wptDiffRes.results.pass + wptDiffRes.results.fail}`,
	);
	log.debug(`Other Test results: ${wptDiffRes.results.other}`);
}
