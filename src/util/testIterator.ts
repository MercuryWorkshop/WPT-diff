import {
	ResultAsync,
	errAsync as nErrAsync,
	okAsync as nOkAsync,
} from "neverthrow";

import type { TestOptions } from "#types/test.d.ts";

export interface TestPath {
	test: string;
}

export interface TestIteratorOptions {
	wptUrls: {
		test: string;
		api: string;
	};
	testPaths: TestPath[];
	maxTests?: number;
}

export default function* createTestIterator(options: TestIteratorOptions) {
	const { testPaths, maxTests = 30 } = options;

	let actualMaxTests = maxTests;
	let testsProcessed = 0;

	for (let i = 0; i < testPaths.length; i++) {
		const testPath = testPaths[i];
		const rawFullUrl = options.wptUrls.test + testPath.test;
		let fullUrl: URL;

		try {
			fullUrl = new URL(rawFullUrl);
		} catch (err) {
			throw new Error(`Failed to parse the test URL ${rawFullUrl}: ${err}`);
		}

		// We don't yet have the capability to run these tests on our WPT runner
		const skipTest = fullUrl.pathname.startsWith("/wasm/");
		if (skipTest) {
			actualMaxTests++;
			continue;
		}

		yield {
			i,
			testPath: testPath.test,
			rawFullUrl,
			fullUrl,
			testsProcessed,
		};

		testsProcessed++;

		if (actualMaxTests && testsProcessed >= actualMaxTests) break;
	}
}

export async function* getWPTTestListIterator(
	options: Pick<TestOptions, "wptUrls" | "maxTests" | "logger">,
) {
	const { logger: log } = options;

	const getRunsApiEndpoint = `${options.wptUrls.api}/api/run?label=master&label=stable&product=chrome&aligned`;
	const latestChromeRespRes = await ResultAsync.fromPromise(
		fetch(getRunsApiEndpoint),
		(err) =>
			`Failed to fetch the current WPT Results from the latest Chrome on Linux run from the WPT API ${options.wptUrls.api}: ${err}`,
	);
	if (latestChromeRespRes.isErr()) {
		yield nErrAsync(latestChromeRespRes.error);
		return;
	}
	const latestChrome = latestChromeRespRes.value;

	// biome-ignore lint/suspicious/noExplicitAny: Validation is not a concern right now
	let chromeData: any;
	try {
		chromeData = await latestChrome.json();
	} catch (err) {
		yield nErrAsync(`Failed to parse the WPT Results as JSON: ${err}`);
		return;
	}
	if (!("raw_results_url" in chromeData)) {
		yield nErrAsync(
			"Failed to find the raw results URL as expected for the latest Chrome results",
		);
		return;
	}
	const chromeReportRes = await ResultAsync.fromPromise(
		fetch(chromeData.raw_results_url),
		(err) =>
			`Failed to get the fetch the raw results URL found in the latest Chrome Linux run ${chromeData.raw_results_url}: ${err}`,
	);
	if (chromeReportRes.isErr()) {
		yield nErrAsync(chromeReportRes.error);
		return;
	}
	const chromeReport = chromeReportRes.value;
	let reportData: any;
	try {
		reportData = await chromeReport.json();
	} catch (err) {
		yield nErrAsync(
			`Failed to parse the WPT Report for the latest Chrome Linux run: ${err}`,
		);
		return;
	}
	let testPaths: {
		test: string;
	}[] = reportData.results;

	if (options.maxTests) testPaths = testPaths.slice(0, options.maxTests);

	const testIterator = createTestIterator({
		wptUrls: options.wptUrls,
		testPaths,
		maxTests: options.maxTests,
	});

	for (const testInfo of testIterator) {
		yield nOkAsync({
			testPath: testInfo.testPath,
			rawFullUrl: testInfo.rawFullUrl,
			fullUrl: testInfo.fullUrl,
		});
	}
}
