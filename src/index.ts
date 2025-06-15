/* eslint-disable @typescript-eslint/no-unsafe-function-type */
/* eslint-disable no-await-in-loop */
import {
	ResultAsync,
	errAsync as nErrAsync,
	okAsync as nOkAsync,
} from "neverthrow";

import { chromium } from "playwright";
import type { WPTDiffResults, WPTTestResult } from "#types/index.d.ts";
import { WPTTestStatus } from "#types/wpt.ts";
import forwardConsole from "#util/forwardConsole.ts";
import createTestIterator from "#util/testIterator.ts";

// Route Interceptors
import createTestHarness from "./routeInterceptors/testHarness.ts";

import WptCollector from "./page/wptCollector.ts";
import { enterNewUrl } from "./page/enterNewUrl.ts";
import setupFirstTime from "./page/setupFirstTimeSW.ts";

import type { TestOptions } from "#types/test.d.ts";

/**
 * Starts the test for WPT-diff
 * @param headless Runs the browser in headless mode if enabled (only useful for debugging)
 * @param maxTests The max number of tests to execute
 * @param silent Enables verbose logging
 */
export async function startTest(options: TestOptions): Promise<
    ResultAsync<
        {
            results: WPTDiffResults;
        },
        string
    >
> {
    const { logger: log } = options;

    const getRunsApiEndpoint = `${options.wptUrls.api}/api/run?label=master&label=stable&product=chrome&aligned`;
    const latestChromeRespRes = await ResultAsync.fromPromise(
        fetch(getRunsApiEndpoint),
        (err) =>
            `Failed to fetch the current WPT Results from the latest Chrome on Linux run from the WPT API ${options.wptUrls.api}: ${err}`
    );
    if (latestChromeRespRes.isErr()) return nErrAsync(latestChromeRespRes.error);
    const latestChrome = latestChromeRespRes.value;

    let chromeData: any;
    try {
        chromeData = await latestChrome.json();
    } catch (err) {
        return nErrAsync(`Failed to parse the WPT Results as JSON: ${err}`);
    }
    if ("raw_results_url" in chromeData)
        return nErrAsync("Failed to find the raw results URL as expected for the latest Chrome results");
    const chromeReportRes = await ResultAsync.fromPromise(
        fetch(chromeData.raw_results_url),
        (err) =>
            `Failed to get the fetch the raw results URL found in the latest Chrome Linux run ${chromeData.raw_results_url}: ${err}`,
    );
    if (chromeReportRes.isErr()) return nErrAsync(chromeReportRes.error);
    const chromeReport = chromeReportRes.value;
    let reportData: any;
    try {
        reportData = await chromeReport.json();
    } catch (err) {
        return nErrAsync(`Failed to parse the WPT Report for the latest Chrome Linux run: ${err}`)
    }
    let testPaths: {
        test: string;
    }[] = reportData.results;

    if (options.maxTests) testPaths = testPaths.slice(0, options.maxTests);

    const browser = await chromium.launch({
        headless: options.headless || false,
    });

    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    forwardConsole({
        page,
        log,
        options
    });

	// Collect the results
	const testResults = new Map<string, WPTTestResult[]>();
	let currentTestPath = "";
	let currentTestResolve: (() => void) | null = null;

	const wptCollector = new WptCollector({
		mainPage: page,
		firstTestUrl: currentTestPath,
		underProxy: options.underProxy || true,
	});
	wptCollector.start(testResults, currentTestResolve);

	if (!options.underProxy)
		await page.route(
			`${options.wptUrls.test}/resources/testharness.js`,
			// @ts-ignore
			createTestHarness(wptCollector.bodyAddition, log),
		);

	const underProxyText = options.underProxy ? " under a proxy" : "";
	if (!options.silent)
		log.info(
			`Running ${testPaths.length} test${
				testPaths.length === 1 ? "" : "s"
			}${underProxyText}`,
		);

	// Track if proxy has been set up
	let proxySetup = false;

	// Create the test iterator
	const testIterator = createTestIterator({
		wptUrls: options.wptUrls,
		testPaths,
		maxTests: options.maxTests,
	});

	for (const testInfo of testIterator) {
		currentTestPath = testInfo.testPath;
		const { i: _i, rawFullUrl, fullUrl } = testInfo;

		if (!options.silent) log.debug(`Running: ${fullUrl}${underProxyText}`);

		try {
			const testCompletionPromise = new Promise<void>((resolve) => {
				currentTestResolve = resolve;
			});

			if (options.underProxy) {
				if (!proxySetup) {
					await setupFirstTime({
						log,
						wptCollector,
						browserContext,
						setupPage: options.setupPage,
						page,
						url: rawFullUrl,
					});
				}
				proxySetup = true;
				await enterNewUrl({
					log,
					page,
					url: rawFullUrl,
				});
			}
			// Go to the site directly if there is no proxy, since there is no need to
			else
				await page.goto(rawFullUrl, {
					waitUntil: "commit",
				});

			await page.waitForLoadState("load");

			// Wait for the tests to complete or timeout in 30 seconds
			await Promise.race([
				testCompletionPromise,
				new Promise((resolve) => setTimeout(resolve, 30 * 1000)),
			]);

			if (!options.silent && currentTestResolve) {
				log.warn(`Test ${testInfo.testPath} timed out waiting for results`);
				// Sanity check
				if (testInfo.testsProcessed === 0)
					return nErrAsync(
						"Quitting because the first test timed out (there must be something seriously wrong)",
					);
			}
		} catch (error) {
			if (!options.silent)
				log.error(`Error running test ${testInfo.testPath}:`, error);
		}
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

	await browser.close();

	return nOkAsync({
		results: {
			pass: totalPass,
			fail: totalFail,
			other: totalOther,
		},
	});
}
