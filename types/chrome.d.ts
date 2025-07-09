/**
 * Chrome WPT API response types
 */

export interface ChromeWPTApiResponse {
	raw_results_url: string;
	[key: string]: unknown;
}

export interface ChromeWPTReport {
	run_info: ChromeRunInfo;
	results: ChromeTestResult[];
	[key: string]: unknown;
}

export interface ChromeRunInfo {
	product?: string;
	browser_version?: string;
	os?: string;
	version?: string;
	processor?: string;
	[key: string]: unknown;
}

export interface ChromeTestResult {
	test: string;
	status: string;
	message: string | null;
	subtests: ChromeSubtest[];
	known_intermittent: string[];
	[key: string]: unknown;
}

export interface ChromeSubtest {
	name: string;
	status: string;
	message: string | null;
	known_intermittent: string[];
	[key: string]: unknown;
}
