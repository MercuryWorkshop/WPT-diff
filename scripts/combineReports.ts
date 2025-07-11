/**
 * @fileoverview Combines multiple WPT report shards into the final report

 * @see https://github.com/web-platform-tests/wpt
 */

import { Result as nResult, ResultAsync as nResultAsync, ok as nOk, err as nErr } from 'neverthrow';
import { Logger } from "tslog";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Command } from "commander";
import { JsonStreamStringify } from "json-stream-stringify";

import type { WPTReport, FailedTest } from "../types/index.d.ts";
import type { ShardReportsReadResult } from "../types/reports.d.ts";

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
	private readShardReports(inputDir: string): nResultAsync<ShardReportsReadResult, string> {
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

			const wptDiffReports: WPTReport[] = [];
			const wptProxyReports: WPTReport[] = [];
			const failedTests: FailedTest[] = [];
			let successfulShards = 0;

			// Process all shards in parallel
			const shardPromises = shardDirs.map(async (shardDir) => {
				const shardPath = join(inputDir, shardDir);

				// Read both report types
				const diffReportNRes = await this.readJsonFile<WPTReport>(join(shardPath, "wpt-report-diff.json"));
				const proxyReportNRes = await this.readJsonFile<WPTReport>(join(shardPath, "wpt-report-proxy.json"));
				const failedNRes = await this.readJsonFile<FailedTest[]>(join(shardPath, "failed-tests.json"));

				return { shardDir, diffReportNRes, proxyReportNRes, failedNRes };
			});

			return nResultAsync.fromPromise(
				Promise.all(shardPromises),
				(err) => `Failed to process shard reports: ${err}`
			).map((shardResults) => {
				for (const { shardDir, diffReportNRes, proxyReportNRes, failedNRes } of shardResults) {
					if (diffReportNRes.isOk()) {
						wptDiffReports.push(diffReportNRes.value);
					} else {
						this.log.warn(`Failed to read WPT diff report from shard '${shardDir}'`, {
							error: diffReportNRes.error
						});
					}

					if (proxyReportNRes.isOk()) {
						wptProxyReports.push(proxyReportNRes.value);
					} else {
						this.log.warn(`Failed to read WPT proxy report from shard '${shardDir}'`, {
							error: proxyReportNRes.error
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
				return { wptDiffReports, wptProxyReports, failedTests, successfulShards };
			});
		});
	}

	/**
	 * Writes a large JSON object to file using streaming to avoid memory issues
	 *
	 * @param filePath Path where the JSON file will be written
	 * @param data The data object to write
	 * @param indent Number of spaces for indentation (default: 4)
	 * @returns A *Neverthrow*-wrapped Result indicating success, or an error message if writing fails
	 */
	private writeJsonFile(filePath: string, data: any, indent: number = 4): nResultAsync<void, string> {
		return nResultAsync.fromPromise(
			(async () => {
				// Use streaming for large WPT reports to avoid memory issues
				if (data.results && Array.isArray(data.results) && data.results.length > 1000) {
					this.log.debug(`Writing large JSON file with streaming to '${filePath}' (${data.results.length} results)`);
					
					const jsonStream = new JsonStreamStringify(data, undefined, indent);
					const writeStream = createWriteStream(filePath);
					
					await pipeline(jsonStream, writeStream);
				} else {
					// For smaller files, use regular writeFile
					await writeFile(filePath, JSON.stringify(data, null, indent));
				}
			})(),
			(err) => `Failed to write JSON file '${filePath}': ${err}`
		);
	}

	/**
	 * Writes the combined reports to the output directory
	 *
	 * @param outputDir Directory where combined reports will be written
	 * @param combinedDiffReport Combined WPT diff report
	 * @param combinedProxyReport Combined WPT proxy report
	 * @param failedTests Array of all failed tests
	 * @returns A *Neverthrow*-wrapped Result indicating success, or an error message if writing fails
	 */
	private writeReports(outputDir: string, combinedDiffReport: WPTReport, combinedProxyReport: WPTReport, failedTests: FailedTest[]): nResultAsync<void, string> {
		return nResultAsync.fromPromise(
			mkdir(outputDir, { recursive: true }),
			(err) => `Failed to create output directory '${outputDir}': ${err}`
		).andThen(() => {
			const wptDiffOutputPath = join(outputDir, "wpt-report-diff.json");
			const wptProxyOutputPath = join(outputDir, "wpt-report-proxy.json");
			const failedOutputPath = join(outputDir, "failed-tests.json");

			const writeWptDiffNRes = this.writeJsonFile(wptDiffOutputPath, combinedDiffReport);
			const writeWptProxyNRes = this.writeJsonFile(wptProxyOutputPath, combinedProxyReport);
			const writeFailedNRes = this.writeJsonFile(failedOutputPath, failedTests);

			return nResultAsync.combine([writeWptDiffNRes, writeWptProxyNRes, writeFailedNRes]).map(() => {
				const totalTests = combinedDiffReport.results.length;
				const totalSubtests = combinedDiffReport.results.reduce((sum, test) => {
					return sum + (test.subtests?.length || 0);
				}, 0);

				this.log.info("Report combination completed successfully", {
					totalTestFiles: totalTests,
					totalSubtests: totalSubtests,
					failedTests: failedTests.length,
					timeStart: new Date(combinedDiffReport.time_start).toISOString(),
					timeEnd: new Date(combinedDiffReport.time_end).toISOString(),
					outputFiles: {
						wptDiffReport: wptDiffOutputPath,
						wptProxyReport: wptProxyOutputPath,
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
			.andThen(({ wptDiffReports, wptProxyReports, failedTests }) => {
				if (wptDiffReports.length === 0 && wptProxyReports.length === 0) {
					return nErr("No WPT reports found to combine");
				}

				const combineDiffNRes = this.combineWPTReports(wptDiffReports);
				if (combineDiffNRes.isErr()) {
					return nErr(`Failed to combine diff reports: ${combineDiffNRes.error}`);
				}

				const combineProxyNRes = this.combineWPTReports(wptProxyReports);
				if (combineProxyNRes.isErr()) {
					return nErr(`Failed to combine proxy reports: ${combineProxyNRes.error}`);
				}

				return this.writeReports(outputDir, combineDiffNRes.value, combineProxyNRes.value, failedTests);
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