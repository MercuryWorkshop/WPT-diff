import { Command } from "commander";

import TestRunner from "./index.js";

import log from "./logger";

import type { ConfigPaths } from "#types/config.d.ts";
import loadConfig from "./util/loadConfig.js";

const program = new Command();

/**
 * The paths to the config files in the repo
 */
const CONFIG_PATHS: ConfigPaths = {
	main: `${import.meta.dirname}/../config.toml`,
	example: `${import.meta.dirname}/../config.example.toml`,
};

program
	.name("WPT-diff")
	.description(
		"WPT-diff is a test runner for WPT which features its own test harness",
	)
	.version("0.0.1");

program.option(
	"-o, --output-failed [file]",
	"output failed test results compared to Chrome baseline as JSON (to stdout if no file specified)",
);

program.option(
	"-r, --report [file]",
	"generate a standardized test report in JSON format (to stdout if no file specified)",
);

program.option("--shard <index>", "Current shard index for test distribution");

program.option(
	"--total-shards <count>",
	"Total number of shards for test distribution",
);

program.option(
	"--max-tests <count>",
	"Maximum number of tests to run (overrides config file)",
);

program.argument(
	"[paths...]",
	"Specific test paths or directories to run. Can be comma-separated or space-separated. Examples: '/fetch/api/basic.html' or '/fetch/api/' or 'fetch,streams'",
);

program.parse();

async function main() {
	const programOptions = program.opts();

	const configRes = await loadConfig(CONFIG_PATHS);
	if (configRes.isErr())
		throw new Error(`Failed to load the TOML config: ${configRes.error}`);
	const config = configRes.value;

	const debugMode = config.debug.debug;
	const verboseMode = config.debug.verbose;

	if (!process.env.DEBUG) {
		process.env.DEBUG = String(debugMode);
	}
	if (!process.env.VERBOSE) {
		process.env.VERBOSE = String(verboseMode);
	}

	log.info(
		`About to run the tests with debug mode ${debugMode ? "enabled" : "disabled"}`,
	);
	log.info(
		`About to run the tests with verbose mode ${verboseMode ? "enabled" : "disabled"}`,
	);

	let paths: string[] | undefined;
	if (program.args.length > 0) {
		paths = [];
		for (const arg of program.args) {
			if (arg.includes(",")) {
				paths.push(...arg.split(",").map((path) => path.trim()));
			} else {
				paths.push(arg);
			}
		}
		paths = paths.map((path) => {
			if (!path.startsWith("/")) {
				return `/${path}`;
			}
			return path;
		});

		log.info(`Running specific tests: ${paths.join(", ")}`);
	}

	const testRunner = new TestRunner({
		logger: log,
		wptUrls: {
			proxy: config.wpt.urls.proxy_base_url,
			test: config.wpt.urls.tests_base_url,
			api: config.wpt.urls.api_base_url,
		},
		maxTests: programOptions.maxTests
			? parseInt(programOptions.maxTests)
			: config.wpt.max_tests,
		underProxy: config.wpt.under_proxy,
		scope: paths ? paths[0] : "",
		testPaths: paths,
		outputFailed: programOptions.outputFailed,
		report: programOptions.report,
		debug: debugMode,
		verbose: verboseMode,
		silent: !verboseMode,
		shard: programOptions.shard ? parseInt(programOptions.shard) : undefined,
		totalShards: programOptions.totalShards
			? parseInt(programOptions.totalShards)
			: undefined,
	});

	const startTestRes = await testRunner.startTest();
	if (startTestRes.isErr())
		throw new Error(`Failed to run WPT-diff: ${startTestRes.error}`);
	const testRes = startTestRes.value;

	if (!testRes || !("results" in testRes)) {
		log.error("No results were returned from the WPT-diff run");
	} else {
		log.success(`Passed Subtests: ${testRes.results.pass}`);
		log.error(`Failed Subtests: ${testRes.results.fail}`);
		log.info(
			`Total Subtests: ${testRes.results.pass}/${testRes.results.pass + testRes.results.fail}`,
		);
		log.debug(`Other Test results: ${testRes.results.other}`);
	}
}

if (import.meta.filename === process.argv[1]) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
