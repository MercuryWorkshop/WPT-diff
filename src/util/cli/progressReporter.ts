import { ProgressBar } from "@opentf/cli-pbar";
import ora from "ora";
import { WPT } from "#types/wpt.ts";
import type { WPTTestResult } from "#types/index.d.ts";

export interface ProgressReporterOptions {
	verbose: boolean;
	totalTests: number;
	silent?: boolean;
}

export class ProgressReporter {
	private progressBar?: ProgressBar;
	private spinner?: ReturnType<typeof ora>;
	private readonly verbose: boolean;
	private readonly totalTests: number;
	private readonly silent: boolean;
	private testsCompleted = 0;
	private currentTest = "";

	constructor(options: ProgressReporterOptions) {
		this.verbose = options.verbose;
		this.totalTests = options.totalTests;
		this.silent = options.silent || false;

		if (!this.silent) {
			if (!this.verbose) {
				// Progress bar mode
				this.progressBar = new ProgressBar({
					width: 40,
					color: "b",
					showPercent: true,
					showCount: true,
				});
				this.progressBar.start({ total: this.totalTests });
			}
		}
	}

	startTest(testPath: string): void {
		this.currentTest = testPath;

		if (!this.silent && this.verbose) {
			this.spinner = ora({
				text: `Running test: ${testPath}`,
				prefixText: `[${this.testsCompleted + 1}/${this.totalTests}]`,
			}).start();
		}
	}

	/**
	 * Updates the results and cleans up the spinner
	 * @param testResults The WPT results
	 */
	endTest(testResults: WPTTestResult[]): void {
		this.testsCompleted++;

		let pass = 0;
		let fail = 0;
		let other = 0;

		for (const testResult of testResults) {
			if (testResult.status === WPT.TestStatus.PASS) pass++;
			else if (testResult.status === WPT.TestStatus.FAIL) fail++;
			else other++;
		}

		const total = pass + fail + other;
		const allPassed = fail === 0 && other === 0 && pass > 0;

		if (!this.silent) {
			if (this.verbose && this.spinner) {
				if (allPassed) {
					this.spinner.succeed(`${this.currentTest} (${pass}/${total} passed)`);
				} else if (fail > 0) {
					this.spinner.fail(
						`${this.currentTest} (${pass}/${total} passed, ${fail} failed${other > 0 ? `, ${other} other` : ""})`,
					);
				} else {
					this.spinner.warn(
						`${this.currentTest} (${pass}/${total} passed${other > 0 ? `, ${other} other` : ""})`,
					);
				}

				for (const testResult of testResults) {
					const subSpinner = ora({
						indent: 4,
						isEnabled: true,
					});

					if (testResult.status === WPT.TestStatus.PASS) {
						subSpinner.succeed(testResult.name);
					} else if (testResult.status === WPT.TestStatus.FAIL) {
						const msg = testResult.message
							? `${testResult.name} (${testResult.message})`
							: testResult.name;
						subSpinner.fail(msg);
					} else {
						subSpinner.warn(testResult.name);
					}
				}
			} else if (this.progressBar) {
				const currentDisplay =
					this.currentTest.length > 50
						? `...${this.currentTest.slice(-47)}`
						: this.currentTest;
				this.progressBar.update({
					value: this.testsCompleted,
					suffix: currentDisplay,
				});
			}
		}
	}

	testTimeout(testPath: string): void {
		this.testsCompleted++;

		// Display timeout as skipped/other status
		if (!this.silent && this.verbose && this.spinner) {
			this.spinner.warn(`${testPath} (0/1 passed, 1 skipped (timeout))`);

			// Show the timeout as a skipped test in the subtest list
			const subSpinner = ora({
				indent: 4,
				isEnabled: true,
			});
			subSpinner.warn(`${testPath} (Test timed out)`);
		}

		if (!this.silent && !this.verbose && this.progressBar) {
			this.progressBar.update({
				value: this.testsCompleted,
				suffix: `${testPath} (timed out)`,
			});
		}
	}

	finish(): void {
		if (!this.silent && !this.verbose && this.progressBar) {
			this.progressBar.stop();
		}
	}

	error(testPath: string, error: any): void {
		if (!this.silent && this.verbose && this.spinner) {
			this.spinner.fail(`Error running test ${testPath}: ${error}`);
		}
		this.testsCompleted++;
		if (!this.silent && !this.verbose && this.progressBar) {
			this.progressBar.update({
				value: this.testsCompleted,
				suffix: `${testPath} (error)`,
			});
		}
	}
}
