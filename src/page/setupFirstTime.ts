/* eslint-disable @typescript-eslint/no-unsafe-function-type */
import type logger from "../logger";

import type { BrowserContext, Page } from "playwright";

import {
	default as createTestHarnessSW,
	shouldRoute as shouldRouteTestHarnessSW,
} from "../routeInterceptors/testHarnessSW";

import type WptCollector from "./wptCollector";

export default async function setupFirstTime(pass: {
	log: typeof logger;
	browserContext: BrowserContext;
	wptCollector: WptCollector;
	// biome-ignore lint/complexity/noBannedTypes: <explanation>
	setupPage: Function;
	page: Page;
	url: string;
}) {
	const { log, browserContext, wptCollector, page, url } = pass;

	const swPromise = browserContext.serviceWorkers();
	// @ts-ignore
	await setupPage(page, url);
	// Wait for the SW to be registered
	// TODO: Make a timeout for this promise
	await swPromise;
	// @ts-ignore
	await context.route(
		shouldRouteTestHarnessSW,
		createTestHarnessSW(wptCollector.bodyAddition, log),
	);
}
