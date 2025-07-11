/**
 * @fileoverview Combines multiple WPT report shards into a single comprehensive report.
 *
 * This utility is used in CI/CD pipelines to merge test results from parallel
 * test executions into unified reports for analysis and archival.
 *
 * @see https://github.com/web-platform-tests/wpt
 */

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Logger } from "tslog";
import { Command } from "commander";
import { Result as nResult, ResultAsync as nResultAsync, ok as nOk, err as nErr } from 'neverthrow';

import type { WPTReport } from "../types/index.d.ts";
import type { FailedTest } from "../types/index.d.ts";

/**
 * Configuration options for combining report shards
 */
interface CombineReportsOptions {
	/** Directory containing shard subdirectories with individual reports */
	inputDir: string;
	/** Directory where combined reports will be written */
	outputDir: string;
}

/**
 * Report combiner that merges multiple WPT test report shards into unified reports
 */
class ReportCombiner {
	private readonly log: Logger<unknown>;

	/**
	 * @param log Logger instance to be created into a sublogger
	 */
	constructor(log: Logger<unknown>) {
		this.log = log.getSubLogger({ name: "Report Combiner" });
	}

	/**
	 * Safely reads and parses a JSON file
	 *
	 * @param filePath Path to the JSON file to read
	 * @returns A *Neverthrow*-wrapped Result containing parsed JSON object, or an error message if read/parse fails
	 */
	private readJsonFile<T>(filePath: string): nResultAsync<T, string> {
		return nResultAsync.fromPromise(
			readFile(filePath, "utf-8"),
			(err) => `Failed to read file '${filePath}': ${err}`
		).andThen((content) => {
			const parseNRes = nResult.fromThrowable(() => JSON.parse(content), (err) => 
				`Failed to parse JSON from '${filePath}': ${err}`
			)();

			if (parseNRes.isErr()) {
				return nErr(parseNRes.error);
			}

			return nOk(parseNRes.value as T);
		});
	}

	/**
	 * Combines multiple WPT report shards into a single unified report
	 *
	 * @param reports WPT report shards to combine
	 * @returns A *Neverthrow*-wrapped Result containing combined WPT report with merged results and updated timestamps, or an error message if combining fails
	 */
	private combineWPTReports(reports: WPTReport[]): nResult<WPTReport, string> {
		if (reports.length === 0) {
			return nErr("No reports to combine");
		}

		const combined: WPTReport = {
			...reports[0],
			results: [],
			time_start: Infinity,
			time_end: 0,
		};

		for (const report of reports) {
			if (report.results && Array.isArray(report.results)) {
				combined.results.push(...report.results);
			}

			if (report.time_start && report.time_start < combined.time_start) {
				combined.time_start = report.time_start;
			}
			if (report.time_end && report.time_end > combined.time_end) {
				combined.time_end = report.time_end;
			}
		}

		if (combined.time_start === Infinity) {
			combined.time_start = Date.now();
		}
		if (combined.time_end === 0) {
			combined.time_end = Date.now();
		}

		this.log.debug("Combined WPT reports", {
			reportCount: reports.length,
			totalResults: combined.results.length,
			timeStart: new Date(combined.time_start).toISOString(),
			timeEnd: new Date(combined.time_end).toISOString()
		});

		return nOk(combined);
	}

	/**
	 * Reads shard directories and extracts report data
	 *
	 * @param inputDir Directory containing shard subdirectories
	 * @returns A *Neverthrow*-wrapped Result containing arrays of WPT reports and failed tests, or an error message if reading fails
	 */
	private readShardReports(inputDir: string): nResultAsync<{ wptReports: WPTReport[]; failedTests: FailedTest[]; successfulShards: number }, string> {
		return nResultAsync.fromPromise(
			readdir(inputDir, { withFileTypes: true }),
			(err) => `Failed to read input directory '${inputDir}': ${err}`
		).andThen((entries) => {
			const shardDirs = entries
				.filter((entry) => entry.isDirectory())
				.map((entry) => entry.name)
				.sort();

			this.log.info(`Found ${shardDirs.length} shard directories`);

			if (shardDirs.length === 0) {
				return nErr(`No shard directories found in '${inputDir}'`);
			}

			const wptReports: WPTReport[] = [];
			const failedTests: FailedTest[] = [];
			let successfulShards = 0;

			// Process all shards in parallel
			const shardPromises = shardDirs.map(async (shardDir) => {
				const shardPath = join(inputDir, shardDir);

				const reportNRes = await this.readJsonFile<WPTReport>(join(shardPath, "wpt-report.json"));
				const failedNRes = await this.readJsonFile<FailedTest[]>(join(shardPath, "failed-tests.json"));

				return { shardDir, reportNRes, failedNRes };
			});

			return nResultAsync.fromPromise(
				Promise.all(shardPromises),
				(err) => `Failed to process shard reports: ${err}`
			).map((shardResults) => {
				for (const { shardDir, reportNRes, failedNRes } of shardResults) {
					if (reportNRes.isOk()) {
						wptReports.push(reportNRes.value);
					} else {
						this.log.warn(`Failed to read WPT report from shard '${shardDir}'`, {
							error: reportNRes.error
						});
					}

					if (failedNRes.isOk() && Array.isArray(failedNRes.value)) {
						failedTests.push(...failedNRes.value);
						successfulShards++;
					} else {
						this.log.warn(`Failed to read failed tests from shard '${shardDir}'`, {
							error: failedNRes.isErr() ? failedNRes.error : "Invalid failed tests format"
						});
					}
				}

				this.log.info(`Successfully processed ${successfulShards} shard results`);
				return { wptReports, failedTests, successfulShards };
			});
		});
	}

	/**
	 * Writes the combined reports to the output directory
	 *
	 * @param outputDir Directory where combined reports will be written
	 * @param combinedReport Combined WPT report
	 * @param failedTests Array of all failed tests
	 * @returns A *Neverthrow*-wrapped Result indicating success, or an error message if writing fails
	 */
	private writeReports(outputDir: string, combinedReport: WPTReport, failedTests: FailedTest[]): nResultAsync<void, string> {
		return nResultAsync.fromPromise(
			mkdir(outputDir, { recursive: true }),
			(err) => `Failed to create output directory '${outputDir}': ${err}`
		).andThen(() => {
			const wptOutputPath = join(outputDir, "wpt-report.json");
			const failedOutputPath = join(outputDir, "failed-tests.json");

			const writeWptNRes = nResultAsync.fromPromise(
				writeFile(wptOutputPath, JSON.stringify(combinedReport, null, 2)),
				(err) => `Failed to write WPT report to '${wptOutputPath}': ${err}`
			);

			const writeFailedNRes = nResultAsync.fromPromise(
				writeFile(failedOutputPath, JSON.stringify(failedTests, null, 2)),
				(err) => `Failed to write failed tests to '${failedOutputPath}': ${err}`
			);

			return nResultAsync.combine([writeWptNRes, writeFailedNRes]).map(() => {
				const totalTests = combinedReport.results.length;
				const totalSubtests = combinedReport.results.reduce((sum, test) => {
					return sum + (test.subtests?.length || 0);
				}, 0);

				this.log.info("Report combination completed successfully", {
					totalTestFiles: totalTests,
					totalSubtests: totalSubtests,
					failedTests: failedTests.length,
					timeStart: new Date(combinedReport.time_start).toISOString(),
					timeEnd: new Date(combinedReport.time_end).toISOString(),
					outputFiles: {
						wptReport: wptOutputPath,
						failedTests: failedOutputPath,
					},
				});
			});
		});
	}

	/**
	 * Combines report shards from multiple test runs into unified reports
	 *
	 * @param options Configuration for combining reports
	 * @returns A *Neverthrow*-wrapped Result indicating success, or an error message if the process fails
	 */
	public combineReports(options: CombineReportsOptions): nResultAsync<void, string> {
		const { inputDir, outputDir } = options;

		this.log.info("Starting report combination", {
			inputDir,
			outputDir
		});

		return this.readShardReports(inputDir)
			.andThen(({ wptReports, failedTests }) => {
				if (wptReports.length === 0) {
					return nErr("No WPT reports found to combine");
				}

				const combineNRes = this.combineWPTReports(wptReports);
				if (combineNRes.isErr()) {
					return nErr(combineNRes.error);
				}

				return this.writeReports(outputDir, combineNRes.value, failedTests);
			});
	}

	/**
	 * Sets the log level for the internal logger
	 *
	 * @param level Log level (`0`=debug, `1`=info, `2`=warn, `3`=error, `4`=fatal)
	 */
	public setLogLevel(level: 0 | 1 | 2 | 3 | 4): void {
		this.log.settings.minLevel = level;
	}
}

/**
 * Main entry point for CLI execution
 */
async function main() {
	const program = new Command();

	program
		.name("combine-reports")
		.description("Combines multiple WPT report shards into the final reports")
		.version("0.0.1")
		.argument("<input-dir>", "Directory containing shard subdirectories with report artifacts from the other jobs")
		.argument("<output-dir>", "Directory where combined reports will be written")
		.option("-v, --verbose", "Enable verbose logging")
		.option("-q, --quiet", "Suppress info logs, only show errors")
		.action(async (inputDir: string, outputDir: string, options: { verbose?: boolean; quiet?: boolean }) => {
			try {
				const log = new Logger({ name: "Combine Reports" });
				const combiner = new ReportCombiner(log);

				if (options.quiet) {
					combiner.setLogLevel(4);
				} else if (options.verbose) {
					combiner.setLogLevel(0);
				}

				const combineNRes = await combiner.combineReports({
					inputDir,
					outputDir,
				});

				if (combineNRes.isErr()) {
					log.error("Failed to combine reports", { error: combineNRes.error });
					process.exit(1);
				}
			} catch (error) {
				console.error("Unexpected error:", error);
				process.exit(1);
			}
		});

	await program.parseAsync(process.argv);
}

if (import.meta.filename === process.argv[1]) {
	main().catch(error => {
		console.error("Fatal error:", error);
		process.exit(1);
	});
}

export { ReportCombiner }; 