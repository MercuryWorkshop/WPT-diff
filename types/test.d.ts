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
	scope: string;
	outputFailed: boolean | string;
	report: boolean | string;
	debug: boolean;
	verbose: boolean;
	silent: boolean;
}
