import type { WPTTestResult } from "#types/index.d.ts";

import type { Page } from "playwright";

export default class WptCollector {
	mainPage: Page;
	firstTestUrl: string;
	underProxy: boolean;

	constructor(pass: {
		mainPage: Page;
		firstTestUrl: string;
		underProxy: boolean;
	}) {
		this.mainPage = pass.mainPage;
		this.firstTestUrl = pass.firstTestUrl;
		this.underProxy = pass.underProxy;
	}

	async start(
		testResults: Map<string, WPTTestResult[]>,
		currentTestResolve: (() => void) | null = null,
	) {
		await this.mainPage.exposeFunction(
			"collectWPTResults",
			(tests, _harness_status) => {
				testResults.set(
					this.firstTestUrl,
					tests.map((test) => {
						return {
							name: test.name,
							status: test.status,
							message: test.message,
							stack: test.stack,
						};
					}),
				);
				// Resolve the promise to indicate test completion
				if (currentTestResolve) {
					currentTestResolve();
					currentTestResolve = null;
				}
			},
		);

		if (this.underProxy) {
			await this.mainPage.evaluate(() => {
				console.debug(
					"Creating the parent listener for allowing the proxy iframe to call collectWPTResults via IPC",
				);
				window.addEventListener("message", (event) => {
					if (event.data && event.data.type === "wpt-results") {
						console.debug(
							"Forwarding the WPT results to the function on the parent",
						);
						// @ts-ignore: We just exposed this to the page
						window.collectWPTResults(
							event.data.tests,
							event.data.harness_status,
						);
					}
				});
			});
		}
	}

	get bodyAddition() {
		return this.underProxy
			? /* js */ `
			add_completion_callback((tests, harness_status) => {
				// Post message to parent window
				if (window.parent && window.parent !== window)
					window.parent.postMessage({
						type: 'wpt-results',
						tests: tests,
						harness_status: harness_status
					}, '*');
			});
		`
			: /* js */ `
			add_completion_callback(collectWPTResults);
		`;
	}
}
