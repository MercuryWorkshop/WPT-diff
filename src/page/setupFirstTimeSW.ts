/* eslint-disable @typescript-eslint/no-unsafe-function-type */
import {
	okAsync as nOkAsync,
	errAsync as nErrAsync,
	ResultAsync,
} from "neverthrow";

import type { setupPage } from "../../../tests/util/setupPage.ts";

import type logger from "../logger";

import type { BrowserContext, Page } from "playwright";

import {
	default as createTestHarnessSW,
	shouldRoute as shouldRouteTestHarnessSW,
} from "../routeInterceptors/testHarnessSW";

import type WptCollector from "./wptCollector";

interface Passthrough {
   	url: string;
   	page: Page;
   	setupPage: typeof setupPage;
	browserContext: BrowserContext;
	wptCollector: WptCollector;
	log: typeof logger;
}

/**
 * Enter in the first test into the Scramjet Demo Site so that the SW proxy initializes properly
 */
export default async function setupFirstTimeSW(
	passthrough: Passthrough,
): Promise<ResultAsync<void, Error>> {
	const { url, page, setupPage, browserContext, wptCollector, log } =
		passthrough;

	const swPromise = browserContext.serviceWorkers();
	// @ts-ignore
	await setupPage(page, url);
	// This is a sanity check to ensure that the SW has been setup properly by setupPage`
	try {
		const sws = await Promise.race([
			swPromise,
			new Promise((_resolve, reject) =>
				setTimeout(() => reject({ failed: true }), 30000),
			),
		]);
		// @ts-ignore: The other promise will Reject regardless if the other promise takes too long and we will catch that
		if (typeof sws !== "object" && !Array.isArray(sws) && sws.length < 1)
			return nErrAsync(
				new Error("Failed to find any SWs from the browser context"),
			);
	} catch (err) {
		if (typeof err === "object" && err !== null && "failed" in err)
			return nErrAsync(
				new Error(
					"Failed to get the SW from the browser context because the Promise took to long to resolve",
				),
			);

		return nErrAsync(
			new Error(`Failed to get the SW from the browser context: ${err}`),
		);
	}

	await browserContext.route(
		shouldRouteTestHarnessSW,
		createTestHarnessSW({
			underProxy: true,
			bodyAddition: wptCollector.bodyAddition,
			log,
		}),
	);

	return nOkAsync(undefined);
}
