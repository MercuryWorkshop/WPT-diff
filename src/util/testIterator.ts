export interface TestPath {
	test: string;
}

export interface TestIteratorOptions {
	wptUrls: {
		test: string;
		api: string;
	};
	testPaths: TestPath[];
	maxTests?: number;
}

export default function* createTestIterator(options: TestIteratorOptions) {
	const { testPaths, maxTests = 30 } = options;

	let actualMaxTests = maxTests;
	let testsProcessed = 0;

	for (let i = 0; i < testPaths.length; i++) {
		const testPath = testPaths[i];
		const rawFullUrl = options.wptUrls.test + testPath.test;
		let fullUrl: URL;

		try {
			fullUrl = new URL(rawFullUrl);
		} catch (err) {
			throw new Error(`Failed to parse the test URL ${rawFullUrl}: ${err}`);
		}

		// We don't yet have the capability to run these tests on our WPT runner
		const skipTest = fullUrl.pathname.startsWith("/wasm/");
		if (skipTest) {
			actualMaxTests++;
			continue;
		}

		yield {
			i,
			testPath: testPath.test,
			rawFullUrl,
			fullUrl,
			testsProcessed,
		};

		testsProcessed++;

		if (actualMaxTests && testsProcessed >= actualMaxTests) break;
	}
}
