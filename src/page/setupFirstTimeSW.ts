/* eslint-disable @typescript-eslint/no-unsafe-function-type */
import {
	okAsync as nOkAsync,
	errAsync as nErrAsync,
	ResultAsync,
} from "neverthrow";

import type logger from "../logger";

import type { BrowserContext, Page, FrameLocator } from "playwright";

/*
import {
	default as createTestHarnessSW,
	createShouldRoute as createShouldRouteTestHarnessSW,
} from "../routeInterceptors/testHarnessSWOLD";
*/
import type WptCollector from "./wptCollector";

interface Passthrough {
	url: string;
	page: Page;
	wptCollector: WptCollector;
	setupPage: (page: Page, url: string) => Promise<FrameLocator>;
	browserContext: BrowserContext;
	log: typeof logger;
}

/**
 * Enter in the first test into the Scramjet Demo Site so that the SW proxy initializes properly
 */
export default async function setupFirstTimeSW(
	passthrough: Passthrough,
): Promise<ResultAsync<void, Error>> {
	const { url, page, wptCollector, setupPage, browserContext, log } =
		passthrough;

	log.debug(
		"Setting up the proxy site demo and the SW for the first time with first url",
		url,
	);

	// Looks like we already did that
	//wptCollector.start();
	await setupPage(page, url);
	const sws = browserContext.serviceWorkers();
	// Sanity check: ensure that the SW has been setup properly by `setupPage`
	if (sws.length === 0)
		return nErrAsync(
			new Error("Failed to find any SWs in the browser context"),
		);

	return nOkAsync(undefined);
}
