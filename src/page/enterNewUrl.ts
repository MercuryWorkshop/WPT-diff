import type logger from "../logger.ts";

import type { Page } from "playwright";

export async function enterNewUrl(pass: {
	log: typeof logger;
	page: Page;
	url: string;
}): Promise<void> {
	const { log, page, url } = pass;

	log.info(
		`Attempting to navigate to ${url} in the proxy frame through the URL bar`,
	);

	// Manually enter the new test URL inside of the page
	const bar = pass.page.locator(".bar");
	await bar.fill(pass.url);
	await bar.press("Enter");
	// @ts-ignore Do something less hacky than a timeout
	await page.waitForTimeout(1000);
}
