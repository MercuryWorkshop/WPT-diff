import { readFile, writeFile } from "node:fs/promises";
import {
	type Result,
	type ResultAsync,
	err as nErr,
	ok as nOk,
	errAsync as nErrAsync,
	okAsync as nOkAsync,
} from "neverthrow";
import type { TestCheckpoint } from "#types/checkpoint.d.ts";
import type { WPTTestResult } from "#types/index.d.ts";
import type { TestOptions } from "#types/test.d.ts";
import type log from "../logger.ts";

export class CheckpointManager {
	private checkpoint: TestCheckpoint | null = null;
	private readonly checkpointPath: string | undefined;
	private readonly logger: typeof log;
	private readonly options: TestOptions;
	private readonly saveInterval: number;
	private testsSinceLastSave = 0;

	constructor(options: TestOptions, saveInterval = 100) {
		this.options = options;
		this.logger = options.logger;
		this.checkpointPath = options.checkpointFile;
		this.saveInterval = saveInterval;
	}

	/**
	 * Initializes the checkpoint manager, either by creating a new checkpoint
	 * or loading an existing one if resuming
	 */
	async initialize(
		totalTests: number,
		timeStart: number,
	): Promise<Result<void, string>> {
		if (this.options.resumeFrom) {
			const loadResult = await this.loadCheckpoint(this.options.resumeFrom);
			if (loadResult.isErr()) {
				return nErr(loadResult.error);
			}

			this.checkpoint = loadResult.value;
			this.logger.info(
				`Resumed from checkpoint with ${this.checkpoint.progress.completedTests} completed tests`,
			);
		} else {
			this.checkpoint = {
				timestamp: Date.now(),
				version: "1.0.0",
				config: {
					scope: this.options.scope,
					maxTests: this.options.maxTests,
					underProxy: this.options.underProxy,
					wptUrls: this.options.wptUrls,
				},
				progress: {
					totalTests,
					completedTests: 0,
					completedTestPaths: [],
					lastProcessedTest: undefined,
				},
				testResults: new Map(),
				chromeReportData: null,
				timeStart,
			};
		}

		return nOk(undefined);
	}

	/**
	 * Records a completed test and its results
	 */
	async recordTestCompletion(
		testPath: string,
		testRests: WPTTestResult[],
	): Promise<Result<void, string>> {
		if (!this.checkpoint) {
			return nErr("Checkpoint not initialized");
		}

		this.checkpoint.testResults.set(testPath, testRests);
		this.checkpoint.progress.completedTests++;
		this.checkpoint.progress.completedTestPaths.push(testPath);
		this.checkpoint.progress.lastProcessedTest = testPath;
		this.checkpoint.timestamp = Date.now();

		this.testsSinceLastSave++;

		if (this.checkpointPath && this.testsSinceLastSave >= this.saveInterval) {
			const saveResult = await this.save();
			if (saveResult.isErr()) {
				this.logger.error(`Failed to save checkpoint: ${saveResult.error}`);
			} else {
				this.testsSinceLastSave = 0;
			}
		}

		return nOk(undefined);
	}

	/**
	 * Checks if a test has already been completed (for resume functionality)
	 */
	isTestCompleted(testPath: string): boolean {
		if (!this.checkpoint) return false;
		return this.checkpoint.progress.completedTestPaths.includes(testPath);
	}

	/**
	 * Gets the list of completed test paths
	 */
	getCompletedTests(): string[] {
		if (!this.checkpoint) return [];
		return this.checkpoint.progress.completedTestPaths;
	}

	/**
	 * Gets the accumulated test results
	 */
	getTestResults(): Map<string, WPTTestResult[]> {
		if (!this.checkpoint) return new Map();
		return this.checkpoint.testResults;
	}

	/**
	 * Sets the Chrome report data
	 */
	setChromeReportData(data: any): void {
		if (this.checkpoint) {
			this.checkpoint.chromeReportData = data;
		}
	}

	/**
	 * Saves the current checkpoint to disk
	 */
	async save(): Promise<ResultAsync<void, string>> {
		if (!this.checkpoint || !this.checkpointPath) {
			return nOkAsync(undefined);
		}

		try {
			const serializable = {
				...this.checkpoint,
				testResults: Array.from(this.checkpoint.testResults.entries()),
			};

			const json = JSON.stringify(serializable, null, 2);
			await writeFile(this.checkpointPath, json, "utf-8");

			this.logger.debug(
				`Checkpoint saved with ${this.checkpoint.progress.completedTests} completed tests`,
			);

			return nOkAsync(undefined);
		} catch (error) {
			return nErrAsync(`Failed to save checkpoint: ${error}`);
		}
	}

	/**
	 * Loads a checkpoint from a file
	 */
	private async loadCheckpoint(
		checkpointPath: string,
	): Promise<ResultAsync<TestCheckpoint, string>> {
		try {
			const json = await readFile(checkpointPath, "utf-8");
			const parsed = JSON.parse(json);

			const checkpoint: TestCheckpoint = {
				...parsed,
				testResults: new Map<string, WPTTestResult[]>(parsed.testResults),
			};

			return nOkAsync(checkpoint);
		} catch (error) {
			return nErrAsync(`Failed to load checkpoint: ${error}`);
		}
	}

	/**
	 * Performs a final save when shutting down
	 */
	async shutdown(): Promise<ResultAsync<void, string>> {
		return await this.save();
	}

	/**
	 * Gets checkpoint information for reporting
	 */
	getCheckpointInfo(): {
		completedTests: number;
		totalTests: number;
		lastProcessedTest?: string;
	} | null {
		if (!this.checkpoint) return null;

		return {
			completedTests: this.checkpoint.progress.completedTests,
			totalTests: this.checkpoint.progress.totalTests,
			lastProcessedTest: this.checkpoint.progress.lastProcessedTest,
		};
	}
}
