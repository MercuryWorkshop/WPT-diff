import { test } from "@playwright/test";
/* eslint-disable @typescript-eslint/no-unsafe-function-type */
/* eslint-disable no-await-in-loop */
import {
	ResultAsync,
	errAsync as nErrAsync,
	okAsync as nOkAsync,
} from "neverthrow";

import { chromium, type Page, type BrowserContext } from "playwright";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import type {
	WPTDiffResults,
	WPTTestResult,
	WPTDiffResultsWithFailures,
	FailedTest,
	WPTReport,
	WPTReportTest
} from "#types/index.d.ts";
import { WPTTestStatus } from "#types/wpt.ts";
import forwardConsole from "#util/forwardConsole.ts";
import createTestIterator, {
	getWPTTestListIterator,
} from "#util/testIterator.ts";

// Route Interceptors
import createTestHarness from "./routeInterceptors/testHarness.ts";
import initTestHarnessInterceptor from "./routeInterceptors/testHarnessSW.ts";

import WptCollector from "./page/wptCollector.ts";
import { enterNewUrl } from "./page/enterNewUrl.ts";
import setupFirstTimeSW from "./page/setupFirstTimeSW.ts";

import type { TestOptions } from "#types/test.d.ts";
import { ProgressReporter } from "#util/cli/progressReporter.ts";

const BASE_URL = "http://localhost:1337";

/**
 * Starts the test for WPT-diff
 * @param headless Runs the browser in headless mode if enabled (only useful for debugging)
 * @param maxTests The max number of tests to execute
 * @param silent Enables verbose logging
 * @param enablePlaywrightTestRunner If true, generates Playwright test cases instead of running tests directly
 */
export async function startTest(options: TestOptions): Promise<
	ResultAsync<
		| {
				results: WPTDiffResultsWithFailures;
		  }
		| undefined,
		string
	>
> {
	const { verbose, logger: log } = options;

	const getRunsApiEndpoint = `${options.wptUrls.api}/api/run?label=master&label=stable&product=chrome&aligned`;
	const latestChromeRespRes = await ResultAsync.fromPromise(
		fetch(getRunsApiEndpoint),
		(err) =>
			`Failed to fetch the current WPT Results from the latest Chrome on Linux run from the WPT API ${options.wptUrls.api}: ${err}`,
	);
	if (latestChromeRespRes.isErr()) return nErrAsync(latestChromeRespRes.error);
	const latestChrome = latestChromeRespRes.value;

	let chromeData: any;
	try {
		chromeData = await latestChrome.json();
	} catch (err) {
		return nErrAsync(`Failed to parse the WPT Results as JSON: ${err}`);
	}
	if (!("raw_results_url" in chromeData))
		return nErrAsync(
			"Failed to find the raw results URL as expected for the latest Chrome results",
		);
	const chromeReportRes = await ResultAsync.fromPromise(
		fetch(chromeData.raw_results_url),
		(err) =>
			`Failed to get the fetch the raw results URL found in the latest Chrome Linux run ${chromeData.raw_results_url}: ${err}`,
	);
	if (chromeReportRes.isErr()) return nErrAsync(chromeReportRes.error);
	const chromeReport = chromeReportRes.value;
	// biome-ignore lint/suspicious/noExplicitAny: Validation is not a concern right now
	let reportData: any;
	try {
		reportData = await chromeReport.json();
	} catch (err) {
		return nErrAsync(
			`Failed to parse the WPT Report for the latest Chrome Linux run: ${err}`,
		);
	}
	let testPaths: {
		test: string;
	}[] = reportData.results;

	// Store Chrome baseline data for comparison if outputFailed is enabled
	const chromeBaseline = options.outputFailed ? reportData.results : null;

	// Store full Chrome report data if report generation is enabled
	const chromeReportData = options.report ? reportData : null;

	if (options.maxTests) testPaths = testPaths.slice(0, options.maxTests);

	// Track test run timing
	const timeStart = Date.now();

	const browser = await chromium.launch({
		headless: false,
		//headless: options.headless || false,
	});

	const browserContext = await browser.newContext({
		baseURL: BASE_URL,
		ignoreHTTPSErrors: true,
	});

	const page = await browserContext.newPage();

	forwardConsole({
		verbose,
		page,
		log,
		options,
	});

	// Collect the results
	const testResults = new Map<string, WPTTestResult[]>();
	const failedTests: FailedTest[] = [];
	let currentTestPath = "";
	let currentTestResolve: (() => void) | null = null;

	const wptCollector = new WptCollector({
		mainPage: page,
		underProxy: options.underProxy,
		testResults: testResults,
		log,
	});
	await wptCollector.start();

	if (!options.underProxy)
		await page.route(
			`${options.wptUrls.test}/resources/testharness.js`,
			// @ts-ignore
			createTestHarness(wptCollector.getBodyAddition(), log),
		);

	const underProxyText = options.underProxy ? " under a proxy" : "";
	if (!options.silent)
		log.info(
			`Running ${testPaths.length} test${
				testPaths.length === 1 ? "" : "s"
			}${underProxyText}`,
		);
	console.log();

	const progressReporter = new ProgressReporter({
		verbose: options.verbose || false,
		totalTests: testPaths.length,
		silent: options.silent,
	});

	let proxySetup = false;

	const testIterator = createTestIterator({
		wptUrls: options.wptUrls,
		testPaths,
		maxTests: options.maxTests,
	});

	for (const testInfo of testIterator) {
		currentTestPath = testInfo.testPath;
		const { i: _i, rawFullUrl, fullUrl } = testInfo;

		progressReporter.startTest(testInfo.testPath);

		try {
			const testCompletionPromise = new Promise<void>((resolve) => {
				currentTestResolve = resolve;
				wptCollector.setCurrentTest(testInfo.testPath, resolve);
			});

			if (options.underProxy) {
				await initTestHarnessInterceptor({
					page,
					bodyAddition: wptCollector.getBodyAddition(),
					log,
				});
				if (!proxySetup) {
					await setupFirstTimeSW({
						log,
						browserContext,
						wptCollector,
						setupPage: options.setupPage,
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

			// Wait for the tests to complete or timeout in 30 seconds
			const SECS = 5;
			const completedInTime = await Promise.race([
				testCompletionPromise.then(() => true),
				new Promise<boolean>((resolve) =>
					setTimeout(() => resolve(false), SECS * 1000),
				),
			]);

			const results = testResults.get(testInfo.testPath) || [];

			if (!completedInTime && currentTestResolve) {
				const timeoutResult: WPTTestResult = {
					name: testInfo.testPath,
					status: WPTTestStatus.NOTRUN,
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

	if (options.enablePlaywrightTestRunner) {
		return nOkAsync(undefined);
	}

	let totalPass = 0;
	let totalFail = 0;
	let totalOther = 0;
	for await (const [_key, val] of testResults)
		for (const test of val) {
			if (test.status === WPTTestStatus.PASS) totalPass++;
			else if (test.status === WPTTestStatus.FAIL) totalFail++;
			else totalOther++;
		}

	progressReporter.finish();

	await browser.close();

	const results: WPTDiffResultsWithFailures = {
		pass: totalPass,
		fail: totalFail,
		other: totalOther,
	};

	if (options.outputFailed) {
		const failedTests: FailedTest[] = [];

		for (const [testPath, testResultsList] of testResults) {
			for (const testResult of testResultsList) {
				if (testResult.status === WPTTestStatus.FAIL) {
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

		if (typeof options.outputFailed === 'string') {
			await writeFile(options.outputFailed, JSON.stringify(failedTests, null, 2));
		} else {
			console.log(JSON.stringify(failedTests, null, 2));
		}
	}

	// Generate standardized WPT report if requested
	if (options.report) {
		const timeEnd = Date.now();
		const wptReport = await generateWPTReport(
			testResults,
			chromeReportData,
			timeStart,
			timeEnd,
			options
		);

		if (typeof options.report === 'string') {
			await writeFile(options.report, JSON.stringify(wptReport, null, 2));
		} else {
			console.log(JSON.stringify(wptReport, null, 2));
		}
	}

	return nOkAsync({
		results,
	});
}

async function generateWPTReport(
	testResults: Map<string, WPTTestResult[]>,
	chromeReportData: any,
	timeStart: number,
	timeEnd: number,
	options: TestOptions
): Promise<WPTReport> {
	const proxyTestsMap = new Map<string, WPTReportTest>();

	for (const [testPath, subtests] of testResults) {
		const testReport: WPTReportTest = {
			test: testPath,
			status: "OK",
			message: null,
			subtests: subtests.map(subtest => ({
				name: subtest.name,
				status: mapTestStatusToJSON(subtest.status),
				message: subtest.message || null,
				known_intermittent: []
			})),
			known_intermittent: []
		};

		if (subtests.some(subtest => subtest.status === WPTTestStatus.FAIL)) {
			testReport.status = "ERROR";
		}

		proxyTestsMap.set(testPath, testReport);
	}

	// Default to Chrome results if we don't have results for a test or subtest
	const results: WPTReportTest[] = [];
	if (chromeReportData && chromeReportData.results) {
		for (const chromeTest of chromeReportData.results) {
			if (proxyTestsMap.has(chromeTest.test)) {
				results.push(proxyTestsMap.get(chromeTest.test)!);
			} else {
				results.push(chromeTest);
			}
		}

		for (const [testPath, testReport] of proxyTestsMap) {
			if (!chromeReportData.results.find((chromeTest: any) => chromeTest.test === testPath)) {
				results.push(testReport);
			}
		}
	} else {
		results.push(...proxyTestsMap.values());
	}

	const report: WPTReport = {
		results,
		run_info: {
			product: options.underProxy ? "proxy" : "chrome",
			browser_version: options.underProxy ? "unknown" : undefined,
			os: os.platform(),
			version: os.release(),
			processor: os.arch(),
			...(chromeReportData?.run_info || {})
		},
		time_start: timeStart,
		time_end: timeEnd
	};

	return report;
}

function mapTestStatusToJSON(status: number): string {
	switch (status) {
		case WPTTestStatus.PASS:
			return "PASS";
		case WPTTestStatus.FAIL:
			return "FAIL";
		case WPTTestStatus.TIMEOUT:
			return "TIMEOUT";
		case WPTTestStatus.NOTRUN:
			return "NOTRUN";
		default:
			return "FAIL";
	}
}

export async function runSingleWPTTest(
	testPath: string,
	page: Page,
	browserContext: BrowserContext,
	options: TestOptions,
	proxyAlreadySetup = false,
) {
	const testResults = new Map<string, WPTTestResult[]>();
	let currentTestResolve: (() => void) | null = null;
	let proxySetup = proxyAlreadySetup;

	const rawFullUrl = options.wptUrls.test + testPath;

	const wptCollector = new WptCollector({
		mainPage: page,
		underProxy: options.underProxy,
		testResults: testResults,
		log,
	});
	await wptCollector.start();

	forwardConsole({
		verbose,
		page,
		log: options.logger,
		options,
	});

	if (!options.underProxy)
		await page.route(
			`${options.wptUrls.test}/resources/testharness.js`,
			// @ts-ignore
			createTestHarness(wptCollector.getBodyAddition(), options.logger),
		);

	const testCompletionPromise = new Promise<void>((resolve) => {
		currentTestResolve = resolve;
		wptCollector.setCurrentTest(testPath, resolve);
	});

	if (options.underProxy !== false) {
		if (!proxySetup) {
			await setupFirstTimeSW({
				log: options.logger,
				wptCollector,
				browserContext,
				setupPage: options.setupPage,
				page,
				url: rawFullUrl,
			});
			proxySetup = true;
		} else {
			await enterNewUrl({
				log: options.logger,
				page,
				url: rawFullUrl,
			});
		}
	} else
		await page.goto(rawFullUrl, {
			waitUntil: "commit",
		});

	await page.waitForLoadState("load");

	await Promise.race([
		testCompletionPromise,
		new Promise((resolve) => setTimeout(resolve, 30 * 1000)),
	]);

	const results = testResults.get(testPath) || [];
	let pass = 0;
	let fail = 0;
	let other = 0;

	for (const testResult of results) {
		if (testResult.status === WPTTestStatus.PASS) pass++;
		else if (testResult.status === WPTTestStatus.FAIL) fail++;
		else other++;
	}

	return { pass, fail, other, results, proxySetup };
}
