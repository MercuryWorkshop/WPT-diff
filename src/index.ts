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

/**
 * Path-based detection for test driver test directories (we don't support test driver)
 *
 * TODO: Support *some* test driver tests using Adapt Appium Playwright Driver
 *
 * @see https://web-platform-tests.org/writing-tests/testdriver.html#testdriver-tests
 */
const TESTDRIVER_PATHS = new Set([
	"/webdriver/",
	"/permissions/",
	// TODO: Support
	"/permissions-policy/",
	"/geolocation-API/",
	"/notifications/",
	"/mediacapture-streams/",
	"/push-api/",
	"/webauthn/",
	"/fullscreen/",
	"/pointerlock/",
	"/gamepad/",
	"/screen-orientation/",
	"/vibration/",
	"/battery-status/",
	"/device-memory/",
	// TODO: Support
	"/payment-request/",
]);
/**
 * Filename pattern detection for testdriver tests
 *
 * @see https://web-platform-tests.org/writing-tests/testdriver.html
 */
const TESTDRIVER_PATTERNS = new Set([
	/testdriver/,
	/user-activation/,
	/automation/,
	/interaction/,
]);
/**
 * Directory patterns for user interaction tests
 *
 * @see https://web-platform-tests.org/writing-tests/testdriver.html
 */
const INTERACTION_PATHS = new Set([
	"/touch-events/",
	"/pointerevents/",
	"/uievents/",
	"/keyboard-lock/",
	"/keyboard-map/",
	"/input-events/",
]);
// Browser internals and functionality that proxies don't affect
const PROXY_IRRELEVANT_PATHS = new Set([
	"/css/",
	// Cryptography
	"/WebCryptoAPI/",
	"/crypto/",
	"/webcrypto/",
	"/subtle-crypto/",
	// Hardware
	"/accelerometer/",
	"/gyroscope/",
	"/magnetometer/",
	"/orientation-sensor/",
	"/ambient-light/",
	"/proximity/",
	"/device-orientation/",
	"/generic-sensor/",
	// Memory/Performance
	"/memory-api/",
	"/compute-pressure/",
	"/largest-contentful-paint/",
	"/layout-instability/",
	// Encoding
	"/encoding/",
	"/compression/",
	"/streams/",
	// File System APIs (for now, we aren't making proxy browsers yet)
	"/file-system-access/",
	"/file-api/",
	"/fileapi/",
	// Outside of browser
	"/fullscreen/",
	"/screen-capture/",
	"/picture-in-picture/",
	// Maybe when we are making proxy browsers
	"/web-share/",
	"/web-locks/",
	// WASM
	"/wasm/",
	"/webassembly/",
	// Media
	"/media-capabilities/",
	"/media-session/",
	"/mediasession/",
	"/mediacapture-record/",
	"/webcodecs/",
	// Payment
	"/payment-request/",
	"/payment-handler/",
	"/payment-method-basic-card/",
	"/payment-method-id/",
	"/secure-payment-confirmation/",
	// Web Auth
	"/credential-management/",
	"/webauthn/",
	"/fido-u2f/",
	// Observers
	"/intersection-observer/",
	"/resize-observer/",
	// Low-level hardware access
	"/web-bluetooth/",
	"/webusb/",
	"/serial/",
	"/webhid/",
	// Clipboard (we aren't making proxy browsers yet)
	"/clipboard-apis/",
	// Device information
	"/battery-status/",
	"/device-memory/",
	"/netinfo/",
	// Origin Trials (proxies are made for the general user, not for developers)
	"/origin-trial/",
	// WebRTC (we don't care)
	"/webrtc/",
	"/webrtc-stats/",
	"/webrtc-identity/",
	"/webrtc-priority/",
	"/webrtc-encoded-transform/",
	// Typography and text rendering
	"/mathml/",
	"/svg/text/",
	// Selection APIs (browser-level selection handling)
	"/selection/",
	// Internationalization APIs (browser-level locale handling)
	"/intl/",
	"/Intl/",
	"/internationalization/",
	// HTML parsing, semantics, and syntax (browser-level behavior)
	"/html/semantics/",
	"/html/syntax/",
	"/html/parsing/",
	"/html/browsers/",
	"/html/infrastructure/",
	"/html/obsolete/",
	// Form Controls
	"/html/forms/",
	"/html/input/",
	"/html/select/",
	"/html/textarea/",
	"/html/fieldset/",
	"/html/datalist/",
	// Table rendering
	"/html/tables/",
	// Media and graphics
	"/html/canvas/",
	"/html/media/",
	"/html/interaction/",
	// File uploads and form file handling
	"/FileAPI/",
	"/file-upload/",
	"/html/semantics/forms/the-input-element/file-upload/",
	"/html/semantics/forms/form-submission-0/",
	// Accessibility
	"/accname/",
	"/core-aam/",
	"/dpub-aam/",
	"/graphics-aam/",
	"/html-aam/",
	"/svg-aam/",
	"/wai-aria/",
	// Devtools
	"/console/",
	"/reporting/",
	"/deprecation-reporting/",
	"/intervention-reporting/",
	// Animations
	"/web-animations/",
	"/animation-worklet/",
	"/scroll-animations/",
	// WebAudio API (browser-level audio processing)
	"/webaudio/",
]);

// Regex patterns for proxy-irrelevant tests
const PROXY_IRRELEVANT_PATTERNS = new Set([
	/\/interfaces\//,
	/\/idlharness/,
	/\/tools\//,
	/\/resources\//,
	/\.tentative\./,
	/\.https\./,
	/-manual\./,
	/-visual\./,
	/-print\./,
	/-rendering/,
	/-formatting/,
	/-layout/,
	/-styling/,
	/-css-/,
	/currency/,
	/financial/,
	/payment/,
	/money/,
	// File upload patterns
	/file-upload/,
	/upload/,
	/multipart/,
	/form-data/,
	/-file\./,
	/\.file\./,
]);

export default class TestRunner {
	private initialized = false;
	private options: TestOptions;
	private filterLogger: {
		debug: (message: string) => void;
	};

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
		reportType: "wpt-diff" | "wpt-proxy",
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

		const finalResults: WPTReportTest[] = [];

		if (reportType === "wpt-diff") {
			// For wpt-diff-report: Use Chrome results for tests we didn't run or that timed out
			if (chromeReportData?.results) {
				for (const chromeTest of chromeReportData.results) {
					if (proxyTestsMap.has(chromeTest.test)) {
						const proxyTest = proxyTestsMap.get(chromeTest.test)!;
						// Check if the test timed out or wasn't run
						const hasTimeout = proxyTest.subtests.some(
							(subtest) =>
								subtest.status === "TIMEOUT" || subtest.status === "NOTRUN",
						);
						if (hasTimeout) {
							// Use Chrome results for timeouts/not run
							finalResults.push(chromeTest);
						} else {
							// Use our proxy results
							finalResults.push(proxyTest);
						}
					} else {
						// Test wasn't run by us, fallback to Chrome results
						finalResults.push(chromeTest);
					}
				}

				// Add any proxy tests that Chrome didn't have
				for (const [testPath, testReport] of proxyTestsMap) {
					if (
						!chromeReportData.results.find(
							(chromeTest) => chromeTest.test === testPath,
						)
					) {
						finalResults.push(testReport);
					}
				}
			} else {
				finalResults.push(...proxyTestsMap.values());
			}
		} else {
			// For wpt-proxy-report: Default timeouts/not run to `PASS`
			for (const [path, testReport] of proxyTestsMap) {
				const modifiedReport = {
					...testReport,
					subtests: testReport.subtests.map((subtest) => {
						if (subtest.status === "TIMEOUT" || subtest.status === "NOTRUN") {
							return {
								...subtest,
								status: "PASS",
								message: null,
							};
						}
						return subtest;
					}),
				};

				// Update test status if all subtests pass after modification
				const hasFailure = modifiedReport.subtests.some(
					(subtest) => subtest.status !== "PASS",
				);
				if (!hasFailure) {
					modifiedReport.status = "OK";
				}

				finalResults.push(modifiedReport);
			}

			// Add Chrome results for tests we didn't run, defaulting to PASS
			if (chromeReportData?.results) {
				for (const chromeTest of chromeReportData.results) {
					if (!proxyTestsMap.has(chromeTest.test)) {
						const passedTest = {
							...chromeTest,
							status: "OK" as const,
							subtests: chromeTest.subtests.map((subtest) => ({
								...subtest,
								status: "PASS" as const,
								message: null,
							})),
						};
						finalResults.push(passedTest);
					}
				}
			}
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
			results: finalResults,
			time_end: timeEnd,
		};

		return report;
	}

	constructor(options: TestOptions) {
		this.options = options;
		this.filterLogger = {
			debug: (message: string) => {
				this.options.logger.debug(message);
			},
		};
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
					JSON.stringify(failed, null, 4),
				);
			} else {
				log.debug(JSON.stringify(failed, null, 4));
			}
		}

		if (this.options.report) {
			const timeEnd = Date.now();

			const wptDiffReport = await TestRunner.generateWPTReport(
				resultsList,
				chromeReportData,
				timeStart,
				timeEnd,
				this.options,
				"wpt-diff",
			);
			const wptProxyReport = await TestRunner.generateWPTReport(
				resultsList,
				chromeReportData,
				timeStart,
				timeEnd,
				this.options,
				"wpt-proxy",
			);

			if (typeof this.options.report === "string") {
				const lastDotIndex = this.options.report.lastIndexOf(".");
				const baseName =
					lastDotIndex > -1
						? this.options.report.slice(0, lastDotIndex)
						: this.options.report;
				const extension =
					lastDotIndex > -1 ? this.options.report.slice(lastDotIndex) : ".json";

				await writeFile(
					`${baseName}-diff${extension}`,
					JSON.stringify(wptDiffReport, null, 4),
				);
				await writeFile(
					`${baseName}-proxy${extension}`,
					JSON.stringify(wptProxyReport, null, 4),
				);
				log.info(
					`Generated both report types: ${baseName}-diff${extension} and ${baseName}-proxy${extension}`,
				);
			} else {
				/*
				log.debug(
					JSON.stringify(
						{
							"wpt-diff-report": wptDiffReport,
							"wpt-proxy-report": wptProxyReport,
						},
						null,
						4,
					),
				);
				*/
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
		path: { test: string }[],
		testTimeoutMap: Map<string, 10 | 60>,
	): { test: string }[] {
		if (!path || !Array.isArray(path)) {
			return [];
		}

		if (this.options.testPaths && this.options.testPaths.length > 0) {
			const requestedPaths = this.options.testPaths;
			path = path.filter((test) => {
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
			path = path.filter((test) => test.test.startsWith(this.options.scope!));
		}

		path = path.filter((test) => {
			if (
				test.test.startsWith("/reftest/") ||
				test.test.startsWith("/manual/")
			) {
				this.filterLogger.debug(
					`Skipping non-testharness test: '${test.test}'`,
				);
				return false;
			}

			for (const testdriverPath of TESTDRIVER_PATHS) {
				if (test.test.startsWith(testdriverPath)) {
					this.filterLogger.debug(`Skipping testdriver test: '${test.test}'`);
					return false;
				}
			}

			for (const interactionPath of INTERACTION_PATHS) {
				if (test.test.startsWith(interactionPath)) {
					this.filterLogger.debug(`Skipping interaction test: '${test.test}'`);
					return false;
				}
			}

			for (const pattern of TESTDRIVER_PATTERNS) {
				if (pattern.test(test.test)) {
					this.filterLogger.debug(
						`Skipping testdriver pattern test: '${test.test}'`,
					);
					return false;
				}
			}

			for (const irrelevantPath of PROXY_IRRELEVANT_PATHS) {
				if (test.test.startsWith(irrelevantPath)) {
					this.filterLogger.debug(
						`Skipping proxy-irrelevant test: '${test.test}'`,
					);
					return false;
				}
			}

			for (const pattern of PROXY_IRRELEVANT_PATTERNS) {
				if (pattern.test(test.test)) {
					this.filterLogger.debug(
						`Skipping proxy-irrelevant pattern test: '${test.test}'`,
					);
					return false;
				}
			}

			return true;
		});

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
			path = path.filter((test) => {
				const hash = createHash("sha256").update(test.test).digest("hex");
				const hashValue = parseInt(hash.slice(0, 8), 16);
				const shardIndex = hashValue % totalShards;
				return shardIndex === shard - 1;
			});

			this.options.logger.info(
				`Running shard ${shard} of ${totalShards} (${path.length} tests)`,
			);
		}

		if (this.options.maxTests && typeof this.options.maxTests === "number")
			path = path.slice(0, this.options.maxTests);
		// Only use tests we can run in our runner
		path = path.filter((test) => testTimeoutMap.has(test.test));
		return path;
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
