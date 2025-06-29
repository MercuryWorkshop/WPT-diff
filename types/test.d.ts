import type log from "../src/logger.ts"

import type { Page } from "playwright";

export interface TestOptions {
	logger: typeof log;
	wptUrls: {
		test: string;
		api: string;
	};
	// biome-ignore lint/complexity/noBannedTypes: I will elaborate later leave me alone
	setupPage: (page: Page, url: string) => Promise<FrameLocator>;
	headless?: boolean;
	maxTests?: number;
	verbose?: boolean;
	silent?: boolean;
	underProxy?: boolean;
	enablePlaywrightTestRunner?: boolean;
	outputFailed?: boolean | string;
	report?: boolean | string;
}
