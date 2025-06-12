/* eslint-disable @typescript-eslint/no-unsafe-function-type */
/* eslint-disable no-await-in-loop */
import {
	errAsync as nErrAsync,
	okAsync as nOkAsync,
	ResultAsync,
} from "neverthrow";

import type log from "./logger";

import { chromium } from "playwright";
import type { WPTDiffResults, WPTTestResult } from "#types/index.d.ts";
import { WPTTestStatus } from "#types/wpt.ts";
import { setupPage } from "../../tests/util/setupPage";
// For propagating colored logs from the page
//import supportsColor from "supports-color";
//import createFormatter from "console-with-style";

// @ts-ignore: This library is typed wrong
//const level = supportsColor.stdout?.level || 0;
//const formatWithColor = createFormatter(level);

/**
 * Starts the test for WPT-diff
 * @param headless Runs the browser in headless mode if enabled (only useful for debugging)
 * @param maxTests The max number of tests to execute
 * @param silent Enables verbose logging
 */
export async function startTest(options: {
	logger: typeof log;
	wptUrls: {
		test: string;
		api: string;
	};
	// biome-ignore lint/complexity/noBannedTypes: I will elaborate later leave me alone
	setupPage?: Function;
	headless?: boolean;
	maxTests?: number;
	silent?: boolean;
	underProxy?: boolean;
}): Promise<
	ResultAsync<
		{
			results: WPTDiffResults;
		},
		string
	>
> {
	const { logger: log } = options;

	const getRunsApiEndpoint = `${options.wptUrls.api}/api/run?label=master&label=stable&product=chrome&aligned`;
	const latestChromeRes = await ResultAsync.fromPromise(
		fetch(getRunsApiEndpoint),
		(err) =>
			`Failed to fetch the current WPT Results from the latest Chrome on Linux run from the WPT API (${options.wptUrls.api}): ${err}`,
	);
	if (latestChromeRes.isErr()) return nErrAsync(latestChromeRes.error);
	const latestChrome = latestChromeRes.value;

	const chromeData = await latestChrome.json();
	const chromeReport = await fetch(chromeData.raw_results_url);
	const chromeReportRes = await ResultAsync.fromPromise(
		fetch(chromeData.raw_results_url),
		(err) =>
			`Failed to fetch the WPT Report from the latest Chrome on Linux WPT Results run from the WPT API (${chromeData.raw_results_url}): ${err}`,
	);
	if (chromeReportRes.isErr()) return nErrAsync(chromeReportRes.error);
	const reportData = await chromeReport.json();
	let testPaths: {
		test: string;
	}[] = reportData.results;

	if (options.maxTests) testPaths = testPaths.slice(0, options.maxTests);

	const browser = await chromium.launch({
		headless: false /*options.headless || false*/,
	});

	const page = await browser.newPage();

	page.on("console", async (msg) => {
		const msgText = msg.text();
		const pageUrl = msg.location().url;
		if (
			options.underProxy
				? (pageUrl.startsWith("http://localhost:1337/scram/") ||
						pageUrl.startsWith("http://localhost:1337/scramjet/")) &&
					// Hide known messages for init and rewriting
					!msgText.includes("bare-mux:") &&
					!msgText.includes("[dreamland.js]") &&
					!msgText.includes("config loaded") &&
					!msgText.includes("handleSubmit") &&
					!msgText.includes("rewrite") &&
					!msgText.includes("initializing scramjet client")
				: true
		) {
			if (options.silent) return;

			const prefix = options.underProxy
				? "[Iframe Console]"
				: "[Browser Console]";
			// FIXME: console.log(formatWithColor(msgText));
			if (log[msg.type()]) log[msg.type()](prefix, msgText);
			else log.info(prefix, msgText);
		}
	});

	// Collect the results
	const testResults = new Map<string, WPTTestResult[]>();
	let currentTestPath = "";
	let currentTestResolve: (() => void) | null = null;

	await page.exposeFunction("collectWPTResults", (tests, _harness_status) => {
		testResults.set(
			currentTestPath,
			tests.map((test) => {
				return {
					name: test.name,
					status: test.status,
					message: test.message,
					stack: test.stack,
				};
			}),
		);
		// Resolve the promise to indicate test completion
		if (currentTestResolve) {
			currentTestResolve();
			currentTestResolve = null;
		}
	});

	if (options.underProxy) {
		await page.evaluate(() => {
			console.debug(
				"Creating the parent listener for allowing the proxy iframe to call collectWPTResults via IPC",
			);
			window.addEventListener("message", (event) => {
				if (event.data && event.data.type === "wpt-results") {
					console.debug(
						"Forwarding the WPT results to the function on the parent",
					);
					// @ts-ignore: we just exposed this to the page
					window.collectWPTResults(event.data.tests, event.data.harness_status);
				}
			});
		});
	}
	const bodyAddition = options.underProxy
		? /* js */ `
			add_completion_callback((tests, harness_status) => {
				// Post message to parent window
				if (window.parent && window.parent !== window)
					window.parent.postMessage({
						type: 'wpt-results',
						tests: tests,
						harness_status: harness_status
					}, '*');
			});
		`
		: /* js */ `
			add_completion_callback(collectWPTResults);
		`;
	let interceptedSwAtLeastOnce = false;
	if (options.underProxy) {
		log.debug("Setting up an interceptor for the SW");
		// FIXME: Intercepting a SW like this won't work
		// I am going to need to change my approach and get the SW through the Browser Context
		// @see https://playwright.dev/docs/network#missing-network-events-and-service-workers (original issue)
		// @see https://playwright.dev/docs/service-workers-experimental (SW request interception gained as an experimental feature)
		// @see https://github.com/microsoft/playwright/issues/15684 (feedback PR)
		await page.route("**/sw.js", async (route) => {
			log.debug("Intercepted the SW, rewriting...");
			interceptedSwAtLeastOnce = true;

			const resp = await route.fetch();
			let body = await resp.text();

			body = `
				const originalAddEventListener = self.addEventListener;
				self.addEventListener = new Proxy(originalAddEventListener, {
					apply(target, that, args) {
						if (args[0] === "fetch") {
							console.debug("[WPT-diff SW] Intercepted the fetch handler of the SW");

							const originalHandler = args[1];
							args[1] = async (event) => {
								const url = new URL(event.request.url);
								const decodedUrl = self.$scramjet?.codec?.decode(url.href) || url.href;
								
								if (decodedUrl.includes("/resources/testharness.js")) {
									console.log("[WPT-diff SW] Intercepted the test harness: ", decodedUrl)

									event.respondWith(
										(async () => {
											const resp = await fetch(event.request);
											let script = await resp.text();
											script += \`${bodyAddition}\`;
											// @ts-ignore
											return new Response(script, {
												status: resp.status,
												statusText: resp.statusText,
												headers: resp.headers
											});
										})()
									);
								} else
									return originalHandler.call(that, event);
							};
						}
						return target.apply(that, args);
					}
				});
			${body}`;

			await route.fulfill({
				body: body,
				contentType: "text/javascript",
				status: 200,
			});
		});
	} else {
		await page.route(
			`${options.wptUrls.test}/resources/testharness.js`,
			async (route) => {
				const resp = await route.fetch();
				const body = await resp.text();

				await route.fulfill({
					body: body + bodyAddition,
					contentType: "text/javascript",
					status: 200,
				});
			},
		);
	}

	const underAProxyText = options.underProxy ? " under a proxy" : "";
	if (!options.silent)
		log.info(
			`Running ${testPaths.length} test${
				testPaths.length === 1 ? "" : "s"
			}${underAProxyText}`,
		);

	const maxTests = options.maxTests || 30;
	// This will dynamically change depending on the number of tests skipped to get to the actual number of max tests
	let actualMaxTests = maxTests;
	// Track if proxy has been set up
	let proxySetup = false;

	for (let i = 0; i < testPaths.length; i++) {
		currentTestPath = testPaths[i].test;
		const fullUrl = options.wptUrls.test + testPaths[i].test;

		// We don't yet have the capability to run these tests on our WPT runner
		const skipTest = fullUrl.includes("/jsapi/") || fullUrl.includes("/wasm/");
		if (skipTest) {
			actualMaxTests++;
			continue;
		}

		if (!options.silent)
			log.debug(`Running: ${testPaths[i].test}${underAProxyText}`);

		try {
			const testCompletePromise = new Promise<void>((resolve) => {
				currentTestResolve = resolve;
			});

			if (options.underProxy) {
				if (!proxySetup) {
					// @ts-ignore
					await setupPage(page, fullUrl);
					proxySetup = true;
				} else {
					// Sanity check
					if (!interceptedSwAtLeastOnce)
						return nErrAsync(
							"Failed to intercept the SW back when the first test (before this one) executed",
						);
					const bar = page.locator(".bar");
					await bar.fill(fullUrl);
					await bar.press("Enter");
					await page.waitForTimeout(1000);
				}
			} else
				await page.goto(fullUrl, {
					waitUntil: "commit",
				});

			await page.waitForLoadState("load");

			// Wait for the tests to complete or timeout in 30 seconds
			await Promise.race([
				testCompletePromise,
				new Promise((resolve) => setTimeout(resolve, 30000)),
			]);

			if (!options.silent && currentTestResolve) {
				log.warn(`Test ${testPaths[i].test} timed out waiting for results`);
				// Sanity check
				if (i === 0)
					return nErrAsync(
						"Quitting because the first test timed out (there must be something seriously wrong)",
					);
			}
		} catch (error) {
			if (!options.silent)
				log.error(`Error running test ${testPaths[i].test}:`, error);
		}

		if (actualMaxTests && i > actualMaxTests) break;
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
