import {
	ResultAsync,
	errAsync as nErrAsync,
	okAsync as nOkAsync,
} from "neverthrow";
import createTestIterator from "#util/testIterator.ts";

export interface GetTestPathsOptions {
	wptUrls: {
		test: string;
		api: string;
	};
	maxTests: number | "all";
}

export async function getWPTTestPaths(options: GetTestPathsOptions): Promise<
	ResultAsync<
		Array<{
			testPath: string;
			rawFullUrl: string;
			fullUrl: URL;
		}>,
		string
	>
> {
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
	
	if (options.maxTests && typeof options.maxTests === "number") testPaths = testPaths.slice(0, options.maxTests);
	
	const testIterator = createTestIterator({
		wptUrls: options.wptUrls,
		testPaths,
		maxTests: options.maxTests,
	});

	const results: Array<{
		testPath: string;
		rawFullUrl: string;
		fullUrl: URL;
	}> = [];

	for (const testInfo of testIterator) {
		results.push({
			testPath: testInfo.testPath,
			rawFullUrl: testInfo.rawFullUrl,
			fullUrl: testInfo.fullUrl,
		});
	}

	return nOkAsync(results);
}
