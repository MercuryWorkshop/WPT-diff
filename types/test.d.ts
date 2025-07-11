import type log from "../src/logger.ts";

export interface TestOptions {
	logger: typeof log;
	wptUrls: {
		proxy: string;
		test: string;
		api: string;
	};
	maxTests: number | "all";
	underProxy: boolean;
	scope?: string;
	testPaths?: string[];
	outputFailed?: string | boolean;
	report?: string | boolean;
	debug: boolean;
	verbose: boolean;
	silent: boolean;
	shard?: number;
	totalShards?: number;
}
