/**
 * This is for an individual test in the internal WPT-diff logic
 */
export interface WPTTestResult {
	name: string;
	status: number;
	message?: string;
	stack?: string;
}

/**
 * These are the final results from WPT-diff
 */
export interface WPTDiffResults {
	pass: number;
	fail: number;
	other: number;
}

/**
 * Failed test compared to Chrome baseline
 */
export interface FailedTest {
	testPath: string;
	testName: string;
	status: number;
	message?: string;
	stack?: string;
	chromeStatus?: string;
}

/**
 * Results with optional failed tests data
 */
export interface WPTDiffResultsWithFailures extends WPTDiffResults {
	failedTests?: FailedTest[];
}

/**
 * Standardized WPT report format (wptreport)
 */
export interface WPTReport {
	results: WPTReportTest[];
	run_info: {
		product: string;
		browser_version?: string;
		os?: string;
		version?: string;
		processor?: string;
		revision?: string;
		[key: string]: any;
	};
	time_start: number;
	time_end: number;
}

export interface WPTReportTest {
	test: string;
	status: string;
	message: string | null;
	duration?: number;
	subtests: WPTReportSubtest[];
	known_intermittent?: string[];
}

export interface WPTReportSubtest {
	name: string;
	status: string;
	message: string | null;
	expected?: string;
	known_intermittent?: string[];
}
