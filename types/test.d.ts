import type log from "../src/logger.ts"

import type { Page } from "playwright";

export interface TestOptions {
	logger: typeof log;
	wptUrls: {
		test: string;
		api: string;
	};
	maxTests: number | "all";
	underProxy: boolean;
	filter: string;
	outputFailed: boolean | string;
	report: boolean | string;
	// biome-ignore lint/complexity/noBannedTypes: I will elaborate later leave me alone
	setupPage: (page: Page, url: string) => Promise<FrameLocator>;
	debug: boolean;
	verbose: boolean;
	silent: boolean;
}
