import fs from "node:fs/promises";
import { chromium } from "playwright";
import { type WPTTestResult, WPTTestStatus } from "../types/index.d.ts";

const BASE_URL = "https://wpt.live";

const _STATUS_CODES = {
	0: "Pass",
	1: "Fail",
	2: "Timeout",
	3: "Not Run",
	4: "Optional Feature Unsupported",
} as const;

export const startTest = async (options: {
	headless?: boolean;
	maxTests?: number;
	silent?: boolean;
}) => {
	const latestChrome = await fetch(
		`${BASE_URL}/api/run?label=master&label=stable&product=chrome&aligned`,
	);
	const chromeData = await latestChrome.json();
	const chromeReport = await fetch(chromeData.raw_results_url);
	const reportData = await chromeReport.json();
	let testPaths: {
		test: string;
	}[] = reportData.results;

	if (options.maxTests) testPaths = testPaths.slice(0, options.maxTests);

	const browser = await chromium.launch({
		headless: options.headless ?? true,
	});

	const page = await browser.newPage();

	// Log propagation
	page.on("console", (msg) => {
		if (options.silent) return;

		if (console[msg.type()]) {
			console[msg.type()]("[Browser Console]", msg.text());
		} else console.log("[Browser Console]", msg.text());
	});

	const testResults = new Map<string, WPTTestResult[]>();

	await page.exposeFunction("collectWPTResults", (tests, harness_status) =>
		testResults.set(
			`${page.url}`,
			tests.map((test) => {
				return {
					name: test.name,
					status: test.status,
					message: test.message,
					stack: test.stack,
				};
			}),
		),
	);

	page.route(`${BASE_URL}/resources/testharness.js`, async (route) => {
		const resp = await route.fetch();
		let body = await resp.text();

		body += /* js */ `
            add_completion_callback(collectWPTResults);
        `;

		await route.fulfill({
			body: body,
			contentType: "text/javascript",
			status: 200,
		});
	});

	if (!options.silent) {
		console.log(
			`Running ${testPaths.length} test${testPaths.length === 1 ? "" : "s"}`,
		);
	}

	for (let i = 0; i < testPaths.length; i++) {
		const fullUrl = BASE_URL + testPaths[i].test;
		if (!options.silent) console.log(`Running: ${testPaths[i].test}`);

		try {
			await page.goto(fullUrl, {
				waitUntil: "commit",
			});

			await page.waitForLoadState("load");
		} catch (error) {
			if (!options.silent) {
				console.error(`Error running test ${testPaths[i].test}:`, error);
			}
		}

		if (i > 30) break;
	}

	let TotalPass = 0;
	let TotalFail = 0;
	let TotalOther = 0;

	for await (const [k, v] of testResults) {
		for (const test of v) {
			if (test.status === WPTTestStatus.PASS) TotalPass++;
			else if (test.status === WPTTestStatus.FAIL) TotalFail++;
			else TotalOther++;
		}
	}

	await browser.close();

	console.log("\nTest run completed");
	console.log(`Total Passed Tests: ${TotalPass}`);
	console.log(`Total Failed Tests: ${TotalFail}`);
	console.log(`Other Test results: ${TotalOther}`);
};
