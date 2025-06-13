import type logger from "../logger";

import type { Route } from "playwright";

export default function createTestHarness(
	bodyAddition: string,
	log: typeof logger,
	// biome-ignore lint/suspicious/noExplicitAny: This is how it is typed, directly from playwright
): (route: Route, req: Request) => Promise<any> {
	const testHarness = async (
		route: Route,
		_req: Request,
		// biome-ignore lint/suspicious/noExplicitAny: This is how it is typed inside of playwright, so we will just go with it
	): Promise<any> => {
		log.debug("Attempting to intercept the test harness to rewrite it...");

		const resp = await route.fetch();
		const body = await resp.text();

		await route.fulfill({
			body: body + bodyAddition,
			contentType: "text/javascript",
			status: 200,
		});
	};

	return testHarness;
}
