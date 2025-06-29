import { test } from "@playwright/test";

const testsToRegister: Array<{ path: string; fn: any }> = [];

globalThis.test = (name: string, fn: any) => {
	testsToRegister.push({ path: name, fn });
};

const { startTest } = await import("../src/index.js");
const { default: log } = await import("../src/logger.js");

const setupPageWrapper = async (page: any, url: string) => {
	const { setupPage } = await import("../scramjet/tests/util/setupPage.js");
	return setupPage(page, url);
};

await startTest({
	logger: log,
	wptUrls: {
		test: process.env.WPT_TEST_URL || "https://wpt.live",
		api: process.env.WPT_API_URL || "https://wpt.fyi",
	},
	setupPage: setupPageWrapper,
	headless: process.env.HEADLESS === "true",
	underProxy: true,
	enablePlaywrightTestRunner: true,
	maxTests: parseInt(process.env.MAX_TESTS || "10"),
});

test.describe("WPT Tests", () => {
	for (const testToRegister of testsToRegister) {
		test(testToRegister.path, testToRegister.fn);
	}
});
