import type logger from "../logger";

import type { WPTTestResult } from "#types/index.d.ts";

import type { Page } from "playwright";

export default class WptCollector {
	mainPage: Page;
	currentTestUrl: string;
	underProxy: boolean;
	testResults: Map<string, WPTTestResult[]>;
	currentTestResolve: (() => void) | null = null;
	log: typeof logger;

	constructor(pass: {
		mainPage: Page;
		underProxy: boolean;
		testResults: Map<string, WPTTestResult[]>;
		log: typeof logger;
	}) {
		this.mainPage = pass.mainPage;
		this.currentTestUrl = "";
		this.underProxy = pass.underProxy;
		this.testResults = pass.testResults;
		this.log = pass.log;
	}

	setCurrentTest(testUrl: string, resolve: () => void) {
		this.currentTestUrl = testUrl;
		this.currentTestResolve = resolve;
	}

	async start() {
		this.log.info("Exposing collectWptResults function to the page");
		await this.mainPage.exposeFunction(
			"collectWptResults",
			(tests: WPTTestResult[], _harness_status: any) => {
				this.log.debug("Collecting WPT results for", this.currentTestUrl);
				this.testResults.set(
					this.currentTestUrl,
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
				if (this.currentTestResolve) {
					this.currentTestResolve();
					this.currentTestResolve = null;
				}
			},
		);

		if (this.underProxy) {
			await this.mainPage.addInitScript(/* js */ `
				console.debug(
					"Creating the parent listener for allowing the proxy iframe to call collectWPTResults via IPC",
				);
				// @ts-ignore
				window.addEventListener("message", (event) => {
					// The data has to be serialized because a JS rewriter bug in Scramjet is breaking whatever WPT does to the object passed into the postMessage
					const rawData = event.data;
					if (rawData) {
						const data = JSON.parse(rawData);
						if (data.type === "wpt-results") {
							console.log(window);
							console.debug(
								"Forwarding the WPT results to the function on the parent",
							);
							// @ts-ignore: This function has just been exposed
							collectWptResults(data.tests, data.harness_status);
						}
					}
				});
			`);
		}
	}

	getBodyAddition() {
		return this.underProxy
			? /* js */ `
			console.debug("Proxy subframe WPT completion callback inject added succesfully")
			add_completion_callback((tests, harness_status) => {
				console.debug("Proxy subframe WPT completion callback inject fired successfully")
				// Post message to parent window
				if (window.parent && window.parent !== window)
					window.parent.postMessage(JSON.stringify({
						type: 'wpt-results',
						tests: tests,
						harness_status: harness_status
					}), '*');
			});
		`
			: /* js */ `
			console.debug("WPT completion callback inject added succesfully")
			add_completion_callback((tests, harness_status) => {
				console.debug("WPT completion callback inject fired successfully")
				window.collectWptResults(tests, harness_status);
			});
		`;
	}
}
