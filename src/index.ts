import { writeFile } from "node:fs/promises";
import os from "node:os";
import { createHash } from "node:crypto";
/* eslint-disable @typescript-eslint/no-unsafe-function-type */
/* eslint-disable no-await-in-loop */
import {
	errAsync as nErrAsync,
	okAsync as nOkAsync,
	ResultAsync,
} from "neverthrow";
import { chromium } from "playwright";
import type { ChromeWPTApiResponse, ChromeWPTReport } from "#types/chrome.d.ts";
import type {
	FailedTest,
	WPTDiffResultsWithFailures,
	WPTReport,
	WPTReportTest,
	WPTTestResult,
} from "#types/index.d.ts";
import type { TestOptions } from "#types/test.d.ts";
import { WPT } from "#types/wpt.ts";
import { ProgressReporter } from "#util/cli/progressReporter.ts";
import forwardConsole from "#util/forwardConsole.ts";
import createTestIterator from "#util/testIterator.ts";
import { performHealthChecks } from "#util/healthChecks.ts";
import { getWPTTestPaths } from "#util/getTestPaths.ts";
import { enterNewUrl } from "./page/enterNewUrl.ts";
import { setupPage } from "./page/setupPage.ts";
import setupFirstTimeSW from "./page/setupFirstTimeSW.ts";
import WptCollector from "./page/wptCollector.ts";
import createTestHarness from "./routeInterceptors/testHarness.ts";
import initTestHarnessInterceptor from "./routeInterceptors/testHarnessSW.ts";

const DEFAULT_WPT_TIMEOUT = 10;

export default class TestRunner {
	private initialized = false;
	private options: TestOptions;

	static mapTestStatusToJSON(status: number): string {
		switch (status) {
			case WPT.TestStatus.PASS:
				return "PASS";
			case WPT.TestStatus.FAIL:
				return "FAIL";
			case WPT.TestStatus.TIMEOUT:
				return "TIMEOUT";
			case WPT.TestStatus.NOTRUN:
				return "NOTRUN";
			default:
				return "FAIL";
		}
	}

	static async generateWPTReport(
		testResults: Map<string, WPTTestResult[]>,
		chromeReportData: ChromeWPTReport | null,
		timeStart: number,
		timeEnd: number,
		options: TestOptions,
	): Promise<WPTReport> {
		const proxyTestsMap = new Map<string, WPTReportTest>();

		for (const [path, subtests] of testResults) {
			const report: WPTReportTest = {
				test: path,
				status: "OK",
				message: null,
				subtests: subtests.map((subtest) => ({
					name: subtest.name,
					status: TestRunner.mapTestStatusToJSON(subtest.status),
					message: subtest.message || null,
					known_intermittent: [],
				})),
				known_intermittent: [],
			};

			if (subtests.some((subtest) => subtest.status === WPT.TestStatus.FAIL)) {
				report.status = "ERROR";
			}

			proxyTestsMap.set(path, report);
		}

		// Default to Chrome results if we don't have results for a test or subtest
		const chromeReportResults: WPTReportTest[] = [];
		if (chromeReportData?.results) {
			for (const chromeTest of chromeReportData.results) {
				if (proxyTestsMap.has(chromeTest.test)) {
					const proxyTest = proxyTestsMap.get(chromeTest.test);
					if (proxyTest) chromeReportResults.push(proxyTest);
				} else {
					chromeReportResults.push(chromeTest);
				}
			}

			for (const [testPath, testReport] of proxyTestsMap) {
				if (
					!chromeReportData.results.find(
						(chromeTest) => chromeTest.test === testPath,
					)
				) {
					chromeReportResults.push(testReport);
				}
			}
		} else {
			chromeReportResults.push(...proxyTestsMap.values());
		}

		const report: WPTReport = {
			run_info: Object.assign(chromeReportData?.run_info || {}, {
				product: options.underProxy ? "proxy" : "chrome",
				browser_version: options.underProxy ? "unknown" : undefined,
				os: os.platform(),
				version: os.release(),
				processor: os.arch(),
			}),
			time_start: timeStart,
			results: chromeReportResults,
			time_end: timeEnd,
		};

		return report;
	}

	constructor(options: TestOptions) {
		this.options = options;
	}

	/**
	 * Starts the test for WPT-diff
	 *
	 * @param headless Runs the browser in headless mode if enabled (only useful for debugging)
	 * @param maxTests The max number of tests to execute
	 * @param silent Enables verbose logging
	 * @param enablePlaywrightTestRunner If `true`, generates Playwright test cases instead of running tests directly
	 */
	async startTest(): Promise<
		ResultAsync<
			| {
					results: WPTDiffResultsWithFailures;
			  }
			| undefined,
			string
		>
	> {
		const { logger: log } = this.options;

		const healthCheckResult = await performHealthChecks(
			this.options.wptUrls.test,
			this.options.underProxy ? this.options.wptUrls.proxy : null,
			this.options.underProxy,
			log,
			this.options.debug,
		);
		if (healthCheckResult.isErr()) {
			return nErrAsync(healthCheckResult.error);
		}

		// Fetch Chrome test paths and report data
		const chromeDataResult = await getWPTTestPaths({
			wptUrls: this.options.wptUrls,
			debug: this.options.debug,
			logger: log,
		});
		if (chromeDataResult.isErr()) {
			return nErrAsync(chromeDataResult.error);
		}
		const { testPaths: rawTestPaths, chromeReportData: reportData } =
			chromeDataResult.value;
		let paths = rawTestPaths;

		// Store Chrome baseline data for comparison if `outputFailed` is enabled
		// TODO: Implement baseline comparison when `outputFailed` is enabled

		// Store full Chrome report data if report generation is enabled
		const chromeReportData = this.options.report ? reportData : null;

		const updateManifestRes = await this.getWPTUpdateManifest();
		if (updateManifestRes.isErr()) return nErrAsync(updateManifestRes.error);
		const updateManifest = updateManifestRes.value;
		const testTimeoutMap = await this.getTestTimeoutMap(updateManifest);
		paths = this.filterTests(paths, testTimeoutMap);

		const timeStart = Date.now();

		const browser = await chromium.launch({
			headless: process.env.CI === "true" || !this.options.debug,
		});

		const browserCtx = await browser.newContext({
			baseURL: this.options.underProxy
				? this.options.wptUrls.proxy
				: this.options.wptUrls.test,
			ignoreHTTPSErrors: true,
		});

		const page = await browserCtx.newPage();

		forwardConsole({
			options: this.options,
			page,
			log,
		});

		const resultsList = new Map<string, WPTTestResult[]>();
		let currentTestPath = "";
		let currentTestResolve: (() => void) | null = null;

		const collector = new WptCollector({
			mainPage: page,
			underProxy: this.options.underProxy,
			testResults: resultsList,
			log,
		});
		await collector.start();

		if (!this.options.underProxy)
			await page.route(
				`${this.options.wptUrls.test}/resources/testharness.js`,
				createTestHarness(collector.getBodyAddition(), log),
			);

		if (!this.options.silent) {
			const underProxyText = this.options.underProxy ? " under a proxy" : "";
			log.info(
				`Running ${paths.length} test${
					paths.length === 1 ? "" : "s"
				}${underProxyText}`,
			);
		}

		const progressReporter = new ProgressReporter({
			verbose: this.options.verbose,
			totalTests: paths.length,
			silent: this.options.silent,
		});

		// Gracefully shut down, so we don't get flooded with errors
		let isShuttingDown = false;
		const handleShutdown = async (signal: string) => {
			if (isShuttingDown) return;
			isShuttingDown = true;

			log.info(`\nReceived ${signal} (shutting down gracefully)`);
			progressReporter.finish();

			// Close browser
			try {
				await browser.close();
			} catch (err) {
				log.debug(`Error closing browser: ${err}`);
			}

			process.exit(0);
		};

		const sigintHandler = () => handleShutdown("SIGINT");
		const sigtermHandler = () => handleShutdown("SIGTERM");

		process.on("SIGINT", sigintHandler);
		process.on("SIGTERM", sigtermHandler);

		let proxySetup = false;

		const testIterator = createTestIterator({
			wptUrls: this.options.wptUrls,
			testPaths: paths,
			maxTests: this.options.maxTests,
		});

		try {
			for (const info of testIterator) {
				if (isShuttingDown) break;
				if (resultsList.has(info.testPath)) {
					continue;
				}

				currentTestPath = info.testPath;
				const { i: _i, rawFullUrl } = info;

				progressReporter.startTest(info.testPath);

				try {
					const testCompletionPromise = new Promise<void>((resolve) => {
						currentTestResolve = resolve;
						collector.setCurrentTest(info.testPath, resolve);
					});

					if (this.options.underProxy) {
						await initTestHarnessInterceptor({
							page,
							bodyAddition: collector.getBodyAddition(),
							log,
						});
						if (!proxySetup) {
							await setupFirstTimeSW({
								log,
								browserCtx,
								wptCollector: collector,
								setupPage,
								page,
								url: rawFullUrl,
							});
							proxySetup = true;
						} else {
							await enterNewUrl({
								log,
								page,
								url: rawFullUrl,
							});
						}
					}
					// Go to the site directly if there is no proxy, since there is no need to
					else
						await page.goto(rawFullUrl, {
							waitUntil: "commit",
						});

					await page.waitForLoadState("load");

					const updateManifestTimeout =
						(testTimeoutMap.get(currentTestPath) || DEFAULT_WPT_TIMEOUT) + 5;
					// This is only needed if the timeout is not already "long" (`60` seconds)
					// @see https://web-platform-tests.org/writing-tests/testharness-api.html#harness-timeout
					/*
					if (updateManifestTimeout === 60) {
						const timeoutSymbol = Symbol("timeout");
						const metaTimeoutLocator = page.locator(
							'meta[name="timeout"][content="long"]',
						);
						const timeoutCountOrTimeout = await Promise.race([
							metaTimeoutLocator.count(),
							new Promise<typeof timeoutSymbol>((resolve) => {
								setTimeout(() => resolve(timeoutSymbol), 1000);
							}),
						]);
						if (timeoutCountOrTimeout === timeoutSymbol) {
							log.warn("The locator waited for too long");
						} else if (timeoutCountOrTimeout > 0) {
							log.debug(
								"Increasing the timeout to long, because the harness tag was found",
							);
						}
					}
					*/

					// Race between test completion and timeout
					const timeoutPromise = new Promise<"timeout">((resolve) => {
						setTimeout(() => resolve("timeout"), updateManifestTimeout * 1000);
					});

					const completionResult = await Promise.race([
						testCompletionPromise.then(() => "completed" as const),
						timeoutPromise,
					]);

					const completedInTime = completionResult === "completed";
					const result = resultsList.get(info.testPath) || [];

					if (!completedInTime && currentTestResolve) {
						const timeoutResult: WPTTestResult = {
							name: info.testPath,
							status: WPT.TestStatus.NOTRUN,
							message: "Test timed out",
						};

						const timeoutRes = [timeoutResult];
						resultsList.set(info.testPath, timeoutRes);

						progressReporter.testTimeout(info.testPath);

						if (info.testsProcessed === 0)
							return nErrAsync(
								"Quitting because the first test timed out (there must be something seriously wrong)",
							);
					} else {
						progressReporter.endTest(result);
					}
				} catch (err) {
					if (isShuttingDown) break;

					// Check if error is due to browser being closed
					const errMsg = err instanceof Error ? err.message : String(err);
					if (
						errMsg.includes("Target page, context or browser has been closed")
					) {
						log.debug(`Browser closed while testing ${info.testPath}`);
						break;
					}

					progressReporter.error(info.testPath, err);
				}
			}
		} catch (err) {
			// Handle any unexpected errors in the test loop
			if (!isShuttingDown) {
				log.error(`Unexpected error in test loop: ${err}`);
			}
		}

		let totalPass = 0;
		let totalFail = 0;
		let totalOther = 0;
		for (const [_key, val] of resultsList)
			for (const test of val) {
				if (test.status === WPT.TestStatus.PASS) totalPass++;
				else if (test.status === WPT.TestStatus.FAIL) totalFail++;
				else totalOther++;
			}

		if (!isShuttingDown) {
			progressReporter.finish();

			await browser.close();

			// Remove signal handlers
			process.removeListener("SIGINT", sigintHandler);
			process.removeListener("SIGTERM", sigtermHandler);
		}

		const resultsWithFailures: WPTDiffResultsWithFailures = {
			pass: totalPass,
			fail: totalFail,
			other: totalOther,
		};

		if (this.options.outputFailed) {
			const failed: FailedTest[] = [];

			for (const [path, results] of resultsList) {
				for (const result of results) {
					if (result.status === WPT.TestStatus.FAIL) {
						failed.push({
							testPath: path,
							testName: result.name,
							status: result.status,
							message: result.message,
							stack: result.stack,
						});
					}
				}
			}

			resultsWithFailures.failedTests = failed;

			if (typeof this.options.outputFailed === "string") {
				await writeFile(
					this.options.outputFailed,
					JSON.stringify(failed, null, 2),
				);
			} else {
				console.log(JSON.stringify(failed, null, 2));
			}
		}

		// Generate standardized WPT report if requested
		if (this.options.report) {
			const timeEnd = Date.now();
			const wptReport = await TestRunner.generateWPTReport(
				resultsList,
				chromeReportData,
				timeStart,
				timeEnd,
				this.options,
			);

			if (typeof this.options.report === "string") {
				await writeFile(
					this.options.report,
					JSON.stringify(wptReport, null, 2),
				);
			} else {
				console.log(JSON.stringify(wptReport, null, 2));
			}
		}

		return nOkAsync({
			results: resultsWithFailures,
		});
	}

	/**
	 * @returns A map of test paths to their timeout values (in seconds)
	 */
	private async getTestTimeoutMap(
		updateManifest: WPT.UpdateManifest.Manifest,
	): Promise<Map<string, 10 | 60>> {
		const timeoutMap = new Map<string, number>();

		for (const testItems of Object.values(updateManifest.items.testharness)) {
			for (const testItem of testItems) {
				const [testPath, testInfo] = testItem;
				if (testInfo?.timeout === "long") {
					timeoutMap.set(`/${testPath}`, 60);
					continue;
				}
				timeoutMap.set(`/${testPath}`, 10);
			}
		}
		/*
		commenting this out because we dont have support for reftests or manual
		for (const [testPath, refTest, testInfo] of Object.values(
			updateManifest.items.reftest,
		).map((testArray) => testArray[0])) {
			const refTestPath = refTest[0][0];
			const testPaths = [testPath, refTestPath];
			for (const testPath of testPaths) {
				if (!("timeout" in testInfo)) {
					timeoutMap.set(testPath, 10);
					continue;
				}
				if (testInfo.timeout === "long") {
					timeoutMap.set(testPath, 60);
				}
				timeoutMap.set(testPath, 10);
			}
		}
		// The test info is always empty
		for (const [testPath] of Object.values(updateManifest.items.manual).map(
			(testArray) => testArray[0],
		))
			timeoutMap.set(testPath, 10);
		*/

		return timeoutMap as Map<string, 10 | 60>;
	}

	private async getWPTUpdateManifest(): Promise<
		ResultAsync<WPT.UpdateManifest.Manifest, string>
	> {
		const { logger: log } = this.options;

		log.debug(
			"Fetching WPT update manifest for determining timeout settings per-test",
		);
		this.initialized = true;
		const wptUpdateManifestURL = new URL(this.options.wptUrls.test);
		wptUpdateManifestURL.pathname = "/tools/runner/update_manifest.py";
		const updateManifestRespRes = await ResultAsync.fromPromise(
			fetch(wptUpdateManifestURL, {
				method: "POST",
			}),
			(err) => `Failed to get the WPT update manifest: ${err}`,
		);
		if (updateManifestRespRes.isErr())
			return nErrAsync(updateManifestRespRes.error);
		const rawManifest = await updateManifestRespRes.value.json();

		// Normalize the manifest data to handle nested arrays
		const updateManifest = this.normalizeManifest(rawManifest);

		let validateWPTUpdateManifest:
			| typeof import(// @ts-ignore: This is generated by `pnpm generate:validators`
			  "../generatedValidators/wptManifestValidator.js").validateWPTUpdateManifest
			| null = null;
		try {
			const validatorModule = await import(
				// @ts-ignore: This is generated by `pnpm generate:validators`
				"../generatedValidators/wptManifestValidator.js"
			);
			validateWPTUpdateManifest = validatorModule.validateWPTUpdateManifest;
		} catch (err) {
			if (err instanceof Error && err.message.includes("Cannot find module")) {
				const message =
					"Typia validators not generated. Run 'pnpm generate:validators' to enable runtime type checking";
				if (this.options.debug) {
					log.warn(message);
					log.warn(
						"Continuing without runtime type validation (types may not be checked at runtime)",
					);
					return nOkAsync(updateManifest as WPT.UpdateManifest.Manifest);
				} else {
					log.error(message);
					return nErrAsync("Runtime validators not generated");
				}
			}
			return nErrAsync(`Failed to load WPT manifest validator: ${err}`);
		}
		if (validateWPTUpdateManifest && !this.options.debug) {
			const updateManifestValidationRes =
				validateWPTUpdateManifest(updateManifest);
			if (updateManifestValidationRes.success) {
				log.debug("WPT update manifest validation succeeded");
				return nOkAsync(updateManifest);
			}
			const errCount = updateManifestValidationRes.errors?.length || 0;
			const errDetails = this.options.verbose
				? `\n${JSON.stringify(updateManifestValidationRes.errors, null, 4)}`
				: "";
			return nErrAsync(
				`Invalid WPT update manifest: ${errCount} validation errors. Run with debug mode to skip validation.${errDetails}`,
			);
		} else if (this.options.debug) {
			log.warn("Skipping WPT update manifest validation in debug mode");
		}

		return nOkAsync(updateManifest as WPT.UpdateManifest.Manifest);
	}

	private filterTests(
		testPaths: { test: string }[],
		testTimeoutMap: Map<string, 10 | 60>,
	): { test: string }[] {
		if (!testPaths || !Array.isArray(testPaths)) {
			return [];
		}

		if (this.options.testPaths && this.options.testPaths.length > 0) {
			const requestedPaths = this.options.testPaths;
			testPaths = testPaths.filter((test) => {
				for (const requestedPath of requestedPaths) {
					if (requestedPath.endsWith(".html")) {
						if (test.test === requestedPath) {
							return true;
						}
					} else {
						const dirPath = requestedPath.endsWith("/")
							? requestedPath
							: `${requestedPath}/`;
						if (test.test.startsWith(dirPath)) {
							return true;
						}
					}
				}
				return false;
			});
		} else if (this.options.scope) {
			testPaths = testPaths.filter((test) =>
				test.test.startsWith(this.options.scope!),
			);
		}

		// We don't have a need to run WASM tests and we don't have a test harness for a good reason (we will fall back on Chrome official results)
		testPaths = testPaths.filter((test) => !test.test.startsWith("/wasm/"));

		if (this.options.shard && this.options.totalShards) {
			const shard = this.options.shard;
			const totalShards = this.options.totalShards;

			if (shard < 1 || shard > totalShards) {
				this.options.logger.error(
					`Invalid shard configuration: shard ${shard} must be between 1 and ${totalShards}`,
				);
				return [];
			}

			// Use hash-based distribution for even load balancing
			testPaths = testPaths.filter((test) => {
				const hash = createHash("sha256").update(test.test).digest("hex");
				const hashValue = parseInt(hash.slice(0, 8), 16);
				const shardIndex = hashValue % totalShards;
				return shardIndex === shard - 1;
			});

			this.options.logger.info(
				`Running shard ${shard} of ${totalShards} (${testPaths.length} tests)`,
			);
		}

		if (this.options.maxTests && typeof this.options.maxTests === "number")
			testPaths = testPaths.slice(0, this.options.maxTests);
		// Only use tests we can run in our runner
		testPaths = testPaths.filter((test) => testTimeoutMap.has(test.test));
		return testPaths;
	}

	private normalizeManifest(rawManifest: any): any {
		const manifest = {
			...rawManifest,
			urlBase: rawManifest.url_base || rawManifest.urlBase || "/",
		};

		delete manifest.url_base;

		return manifest;
	}
}
