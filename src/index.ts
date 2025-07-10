import { writeFile } from "node:fs/promises";
import os from "node:os";
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
// Dynamic import for validator will be done in getWPTUpdateManifest method
import { enterNewUrl } from "./page/enterNewUrl.ts";
import { setupPage } from "./page/setupPage.ts";
import setupFirstTimeSW from "./page/setupFirstTimeSW.ts";
import WptCollector from "./page/wptCollector.ts";
import createTestHarness from "./routeInterceptors/testHarness.ts";
import initTestHarnessInterceptor from "./routeInterceptors/testHarnessSW.ts";

const DEFAULT_WPT_TIMEOUT = 10;
const WPT_UPDATE_MANIFEST_ENDPOINT = "/tools/runner/update_manifest.py";
const WPT_RUNS_ENDPOINT =
	"/api/run?label=master&label=stable&product=chrome&aligned";

export default class TestRunner {
	private initialized = false;
	private options: TestOptions;

	constructor(options: TestOptions) {
		this.options = options;
	}

	static async generateWPTReport(
		testResults: Map<string, WPTTestResult[]>,
		chromeReportData: ChromeWPTReport | null,
		timeStart: number,
		timeEnd: number,
		options: TestOptions,
	): Promise<WPTReport> {
		const proxyTestsMap = new Map<string, WPTReportTest>();

		for (const [testPath, subtests] of testResults) {
			const testReport: WPTReportTest = {
				test: testPath,
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
				testReport.status = "ERROR";
			}

			proxyTestsMap.set(testPath, testReport);
		}

		// Default to Chrome results if we don't have results for a test or subtest
		const results: WPTReportTest[] = [];
		if (chromeReportData?.results) {
			for (const chromeTest of chromeReportData.results) {
				if (proxyTestsMap.has(chromeTest.test)) {
					const proxyTest = proxyTestsMap.get(chromeTest.test);
					if (proxyTest) results.push(proxyTest);
				} else {
					results.push(chromeTest);
				}
			}

			for (const [testPath, testReport] of proxyTestsMap) {
				if (
					!chromeReportData.results.find(
						(chromeTest) => chromeTest.test === testPath,
					)
				) {
					results.push(testReport);
				}
			}
		} else {
			results.push(...proxyTestsMap.values());
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
			results,
			time_end: timeEnd,
		};

		return report;
	}

	/**
	 * Starts the test for WPT-diff
	 * @param headless Runs the browser in headless mode if enabled (only useful for debugging)
	 * @param maxTests The max number of tests to execute
	 * @param silent Enables verbose logging
	 * @param enablePlaywrightTestRunner If true, generates Playwright test cases instead of running tests directly
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

		const getRunsApi = this.options.wptUrls.api + WPT_RUNS_ENDPOINT;
		log.debug(
			`Fetching latest Chrome Linux results from the WPT API ${getRunsApi}`,
		);
		const latestChromeRespRes = await ResultAsync.fromPromise(
			fetch(getRunsApi),
			(err) => `Failed to fetch WPT Results: ${err}`,
		);
		if (latestChromeRespRes.isErr())
			return nErrAsync(latestChromeRespRes.error);
		const latestChrome = latestChromeRespRes.value;

		let chromeData: ChromeWPTApiResponse;
		try {
			chromeData = (await latestChrome.json()) as ChromeWPTApiResponse;
		} catch (rawErr) {
			const err = rawErr instanceof Error ? rawErr.message : String(rawErr);
			return nErrAsync(`Failed to parse the WPT Results as JSON: ${err}`);
		}
		if (!("raw_results_url" in chromeData))
			return nErrAsync(
				"Failed to find the raw results URL as expected for the latest Chrome results",
			);
		const chromeReportRes = await ResultAsync.fromPromise(
			fetch(chromeData.raw_results_url),
			() =>
				`Failed to get the fetch the raw results URL found in the latest Chrome Linux run ${chromeData.raw_results_url}`,
		);
		if (chromeReportRes.isErr()) return nErrAsync(chromeReportRes.error);
		const chromeReport = chromeReportRes.value;
		let reportData: ChromeWPTReport;
		try {
			reportData = (await chromeReport.json()) as ChromeWPTReport;
		} catch (rawErr) {
			const err = rawErr instanceof Error ? rawErr.message : String(rawErr);
			return nErrAsync(
				`Failed to parse the WPT Report for the latest Chrome Linux run: ${err}`,
			);
		}
		let testPaths: {
			test: string;
		}[] = reportData.results;

		// Store Chrome baseline data for comparison if outputFailed is enabled
		// TODO: Implement baseline comparison when outputFailed is enabled

		// Store full Chrome report data if report generation is enabled
		const chromeReportData = this.options.report ? reportData : null;

		const updateManifestRes = await this.getWPTUpdateManifest();
		if (updateManifestRes.isErr()) return nErrAsync(updateManifestRes.error);
		const updateManifest = updateManifestRes.value;
		const testTimeoutMap = await this.getTestTimeoutMap(updateManifest);
		testPaths = this.filterTests(testPaths, testTimeoutMap);

		// Track test run timing
		const timeStart = Date.now();

		const browser = await chromium.launch({
			headless: !this.options.verbose,
		});

		const browserCtx = await browser.newContext({
			baseURL: this.options.underProxy ? this.options.wptUrls.proxy : this.options.wptUrls.test,
			ignoreHTTPSErrors: true,
		});

		const page = await browserCtx.newPage();

		forwardConsole({
			options: this.options,
			page,
			log,
		});

		// Collect the results
		const testResults = new Map<string, WPTTestResult[]>();
		let currentTestPath = "";
		let currentTestResolve: (() => void) | null = null;

		const wptCollector = new WptCollector({
			mainPage: page,
			underProxy: this.options.underProxy,
			testResults: testResults,
			log,
		});
		await wptCollector.start();

		if (!this.options.underProxy)
			await page.route(
				`${this.options.wptUrls.test}/resources/testharness.js`,
				createTestHarness(wptCollector.getBodyAddition(), log),
			);

		if (!this.options.silent) {
			const underProxyText = this.options.underProxy ? " under a proxy" : "";
			log.info(
				`Running ${testPaths.length} test${
					testPaths.length === 1 ? "" : "s"
				}${underProxyText}`,
			);
		}

		const progressReporter = new ProgressReporter({
			verbose: this.options.verbose,
			totalTests: testPaths.length,
			silent: this.options.silent,
		});

		let proxySetup = false;

		const testIterator = createTestIterator({
			wptUrls: this.options.wptUrls,
			testPaths,
			maxTests: this.options.maxTests,
		});

		for (const testInfo of testIterator) {
			currentTestPath = testInfo.testPath;
			const { i: _i, rawFullUrl, _fullUrl } = testInfo;

			progressReporter.startTest(testInfo.testPath);

			try {
				const testCompletionPromise = new Promise<void>((resolve) => {
					currentTestResolve = resolve;
					wptCollector.setCurrentTest(testInfo.testPath, resolve);
				});

				if (this.options.underProxy) {
					await initTestHarnessInterceptor({
						page,
						bodyAddition: wptCollector.getBodyAddition(),
						log,
					});
					if (!proxySetup) {
						await setupFirstTimeSW({
							log,
							browserCtx,
							wptCollector,
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

				const wptUpdateManifestTimeout = (testTimeoutMap.get(currentTestPath)  || DEFAULT_WPT_TIMEOUT) + 5;
				// This is only needed if the timeout is not already "long" (`60` seconds)
				// @see https://web-platform-tests.org/writing-tests/testharness-api.html#harness-timeout
				/*
				if (wptUpdateManifestTimeout === 60) {
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
					setTimeout(() => resolve("timeout"), wptUpdateManifestTimeout * 1000);
				});

				const completionResult = await Promise.race([
					testCompletionPromise.then(() => "completed" as const),
					timeoutPromise,
				]);

				const completedInTime = completionResult === "completed";
				const results = testResults.get(testInfo.testPath) || [];

				if (!completedInTime && currentTestResolve) {
					const timeoutResult: WPTTestResult = {
						name: testInfo.testPath,
						status: WPT.TestStatus.NOTRUN,
						message: "Test timed out",
					};

					const timeoutResults = [timeoutResult];
					testResults.set(testInfo.testPath, timeoutResults);

					progressReporter.testTimeout(testInfo.testPath);
					// Sanity check
					if (testInfo.testsProcessed === 0)
						return nErrAsync(
							"Quitting because the first test timed out (there must be something seriously wrong)",
						);
				} else {
					progressReporter.endTest(results);
				}
			} catch (error) {
				progressReporter.error(testInfo.testPath, error);
			}
		}

		let totalPass = 0;
		let totalFail = 0;
		let totalOther = 0;
		for await (const [_key, val] of testResults)
			for (const test of val) {
				if (test.status === WPT.TestStatus.PASS) totalPass++;
				else if (test.status === WPT.TestStatus.FAIL) totalFail++;
				else totalOther++;
			}

		progressReporter.finish();

		await browser.close();

		const results: WPTDiffResultsWithFailures = {
			pass: totalPass,
			fail: totalFail,
			other: totalOther,
		};

		if (this.options.outputFailed) {
			const failedTests: FailedTest[] = [];

			for (const [testPath, testResultsList] of testResults) {
				for (const testResult of testResultsList) {
					if (testResult.status === WPT.TestStatus.FAIL) {
						failedTests.push({
							testPath,
							testName: testResult.name,
							status: testResult.status,
							message: testResult.message,
							stack: testResult.stack,
						});
					}
				}
			}

			results.failedTests = failedTests;

			if (typeof this.options.outputFailed === "string") {
				await writeFile(
					this.options.outputFailed,
					JSON.stringify(failedTests, null, 2),
				);
			} else {
				console.log(JSON.stringify(failedTests, null, 2));
			}
		}

		// Generate standardized WPT report if requested
		if (this.options.report) {
			const timeEnd = Date.now();
			const wptReport = await TestRunner.generateWPTReport(
				testResults,
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
			results,
		});
	}

	/**
	 * @returns A map of test paths to their timeout values (in seconds)
	 */
	private async getTestTimeoutMap(
		updateManifest: WPT.UpdateManifest.Manifest,
	): Promise<Map<string, 10 | 60>> {
		const timeoutMap = new Map<string, number>();

		for (const [testPath, testInfo] of Object.values(
			updateManifest.items.testharness,
		).map((testArray) => testArray[0])) {
			if (testInfo?.timeout === "long") {
				timeoutMap.set(`/${testPath}`, 60);
				continue;
			}
			timeoutMap.set(`/${testPath}`, 10);
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
		wptUpdateManifestURL.pathname = WPT_UPDATE_MANIFEST_ENDPOINT;
		const updateManifestRespRes = await ResultAsync.fromPromise(
			fetch(wptUpdateManifestURL, {
				method: "POST",
			}),
			(err) => `Failed to get the WPT update manifest: ${err}`,
		);
		if (updateManifestRespRes.isErr())
			return nErrAsync(updateManifestRespRes.error);
		const updateManifest = await updateManifestRespRes.value.json();

		let validateWPTUpdateManifest:
			| typeof import("../generatedValidators/wptManifestValidator.js").validateWPTUpdateManifest
			| null = null;
		try {
			const validatorModule = await import(
				"../generatedValidators/wptManifestValidator.js"
			);
			validateWPTUpdateManifest = validatorModule.validateWPTUpdateManifest;
		} catch (err) {
			if (err instanceof Error && err.message.includes("Cannot find module")) {
				log.warn(
					"Skipping validation because the WPT Manifest Validator was not found. To enable validation, run 'pnpm generate:validators'.",
				);
				return nOkAsync(updateManifest as WPT.UpdateManifest.Manifest);
			}
			return nErrAsync(`Failed to load WPT manifest validator: ${err}`);
		}
		if (validateWPTUpdateManifest) {
			const updateManifestValidationRes =
				validateWPTUpdateManifest(updateManifest);
			if (updateManifestValidationRes.success) {
				log.debug("WPT update manifest validation succeeded");
				return nOkAsync(updateManifest);
			}
			return nErrAsync(
				`Invalid WPT update manifest: ${JSON.stringify(updateManifestValidationRes.errors)}`,
			);
		}

		return nOkAsync(updateManifest as WPT.UpdateManifest.Manifest);
	}

	private filterTests(
		testPaths: { test: string }[],
		testTimeoutMap: Map<string, 10 | 60>,
	): { test: string }[] {
		if (this.options.scope)
			testPaths = testPaths.filter((test) =>
				test.test.startsWith(this.options.scope),
			);
		// We don't have a need to run WASM tests and we don't have a test harness for a good reason
		testPaths = testPaths.filter((test) => !test.test.startsWith("/wasm/"));
		if (this.options.maxTests && typeof this.options.maxTests === "number")
			testPaths = testPaths.slice(0, this.options.maxTests);
		// Only use tests we can run in our runner
		testPaths = testPaths.filter((test) => testTimeoutMap.has(test.test));
		return testPaths;
	}

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
}
