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
