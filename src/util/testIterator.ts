import {
	ResultAsync,
	errAsync as nErrAsync,
	okAsync as nOkAsync,
} from "neverthrow";

import type { TestOptions } from "#types/test.d.ts";
export interface TestPath {
	test: string;
}

export interface TestIteratorOptions {
	wptUrls: {
		test: string;
		api: string;
	};
	testPaths: TestPath[];
	maxTests: number | "all";
}

export default function* createTestIterator(options: TestIteratorOptions) {
	let { testPaths, maxTests } = options;
	let actualMaxTests = maxTests === "all" ? testPaths.length : maxTests;
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