import { defineConfig, devices } from "@playwright/test";

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
	testDir: "./tests",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: 2,
	/* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
	use: {
		/* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
		trace: "on-first-retry",
		actionTimeout: 10000,
		baseURL: "http://localhost:1337",
	},

	/* Configure projects for major browsers */
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
		// {
		//   name: "firefox",
		//   use: { ...devices["Desktop Firefox"] },
		// },
	],

	/* Run your local dev server before starting the tests */
	webServer: {
		command: "cd scramjet && pnpm run dev",
		url: "http://127.0.0.1:1337",
		reuseExistingServer: false,
	},
});
