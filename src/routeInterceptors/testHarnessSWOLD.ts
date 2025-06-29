import type logger from "../logger";

import type { Route, Request } from "playwright";

export default function createTestHarness(
	pass: {
		underProxy: boolean;
		bodyAddition: string;
		log: typeof logger;
	},
	// biome-ignore lint/suspicious/noExplicitAny: This is how it is typed, directly from playwright
): (route: Route, req: Request) => Promise<any> {
	const { bodyAddition, log } = pass;

	const testHarness = async (
		route: Route,
		_req: Request,
		// biome-ignore lint/suspicious/noExplicitAny: This is how it is typed inside of playwright, so we will just go with it
	): Promise<any> => {
		const url = route.request().url();
		log.debug(`[SW Route Handler] Intercepting request: ${url}`);

		const req = route.request();
		const sw = req.serviceWorker();
		if (sw) {
			const reqUrl = req.url();
			let rawDecodedUrl: string;
			try {
				rawDecodedUrl = $scramjet?.codec?.decode(reqUrl);
			} catch (err) {
				throw new Error(
					`[WPT-diff SW] Failed to decode a URL inside of the SW while trying to intercept the test harness: ${err}`,
				);
			}
			let decodedUrl: URL;
			try {
				decodedUrl = new URL(rawDecodedUrl);
			} catch (err) {
				throw new Error(
					`Failed to decode the raw decoded url ${rawDecodedUrl} from Scramjet's config decode method: ${err}`,
				);
			}
			if (decodedUrl.pathname.startsWith("/resources/testharness.js")) {
				log.info("[WPT-diff SW] Intercepted the test harness ", decodedUrl);

				const resp = await route.fetch();
				const body = await resp.text();

				await route.fulfill({
					body: body + bodyAddition,
					contentType: "text/javascript",
					status: 200,
				});
				return;
			}
		}

		// Continue with the request if it doesn't match
		await route.continue();
	};

	return testHarness;
}

/**
 * A factory for creating a function that determines if a request should be routed through the SW, which is processed by browser context router
 * @param url The URL of the request to determine if it should be routed (is it the test harness?)
 * @param log Our logger
 * @returns If we should intercept the request to the test harness (under the SW)
 */
export function createShouldRoute(log: typeof logger): (url: URL) => boolean {
	log.debug(
		"[createShouldRoute] Creating shouldRoute function for test harness SW in the factory",
	);
	return (url: URL): boolean => {
		log.debug(
			"[shouldRoute] Checking if the SW intercepted request is to the test harness",
		);
		log.debug("\tUnproxied URL: ", url.href);
		const shouldInterceptTest = url.href.startsWith(
			"http://localhost:1337/scramjet/",
		);
		const encodedProxyUrl = url.pathname.replace(/^\/scramjet\//, "");
		const proxyUrl = $scramjet?.codec?.decode(encodedProxyUrl);
		if (shouldInterceptTest && proxyUrl.includes("testharness.js")) {
			log.debug("[shouldRoute] Will intercept testharness.js:", url.href);
		} else {
			log.debug("[shouldRoute] Not intercepting request:", url.href);
		}
		return shouldInterceptTest;
	};
}
