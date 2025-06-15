import type log from "../src/logger.ts"

export interface TestOptions {
	logger: typeof log;
	wptUrls: {
		test: string;
		api: string;
	};
	// biome-ignore lint/complexity/noBannedTypes: I will elaborate later leave me alone
	setupPage: Function;
	headless?: boolean;
	maxTests?: number;
	silent?: boolean;
	underProxy?: boolean;
}
