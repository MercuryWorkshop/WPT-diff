/**
 * This only works in Scramjet
 */

import type logger from "../logger.ts";

import type { Page } from "playwright";

/**
 * @param pass
 */
export async function enterNewUrl(pass: {
	page: Page;
	url: string;
	log: typeof logger;
}): Promise<void> {
	const { page, url, log } = pass;

	log.debug(
		`Attempting to navigate to ${url} in the proxy frame through the URL bar`,
	);

	// Manually enter the new test URL inside of the page
	const bar = page.locator(".bar");
	await bar.fill(url);
	await bar.press("Enter");
	// @ts-ignore Do something less hacky than a timeout
	await page.waitForTimeout(1000);
}
