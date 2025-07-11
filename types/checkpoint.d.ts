import type { WPTTestResult } from "./index.d.ts";

export interface TestCheckpoint {
	/**
	 * Timestamp when the checkpoint was created
	 */
	timestamp: number;
	/**
	 * Test configuration at the time of checkpoint
	 */
	config: {
		scope?: string;
		maxTests: number | "all";
		underProxy: boolean;
		wptUrls: {
			proxy: string;
			test: string;
			api: string;
		};
	};
	/**
	 * Progress information
	 */
	progress: {
		/**
		 * Total number of tests to run
		 */
		totalTests: number;
		/**
		 * Number of tests completed
		 */
		completedTests: number;
		/**
		 * List of test paths that have been completed
		 */
		completedTestPaths: string[];
		/**
		 * The last test path that was being processed (for recovery)
		 */
		lastProcessedTest?: string;
	};
	/**
	 * Accumulated test results
	 */
	testResults: Map<string, WPTTestResult[]>;
	/**
	 * Chrome baseline data if available
	 */
	chromeReportData?: any;
	/**
	 * Start time of the overall test run
	 */
	timeStart: number;
}
