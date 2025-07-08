export namespace WPT {
	/**
	 *
	 */
	export enum TestStatus {
		PASS = 0,
		FAIL = 1,
		TIMEOUT = 2,
		NOTRUN = 3,
		OPTIONAL_FEATURE_UNSUPPORTED = 4,
	}

	namespace UpdateManifest {
		type TestHarness = {
			[key: string]: [
				/**
				 * Test path
				 */
				string,
				{
					/**
					 * `null` or `timeout` being omitted entirely means default, which is 10 seconds
					 * `long` means 30 seconds
					 */
					timeout?: null | "long";
				},
			];
		};
		type RefTest = {
			[key: string]: [
				/**
				 * Test path
				 */
				string,
				[
					[
						/**
						 * Reference test path
						 */
						string,
						"==",
					],
				],
				{
					/**
					 * `null` or `timeout` being omitted entirely means default, which is 10 seconds
					 * `long` means 30 seconds
					 */
					timeout?: null | "long";
				},
			];
		};
		type ManualTest = {
			[key: string]: [
				/**
				 * Test path
				 */
				string,
				{},
			];
		};

		export interface Manifest {
			items: {
				testharness: TestHarness;
				reftest: RefTest;
				manual: ManualTest;
			};
			/** Base path for the WPT tests on the API URI */
			urlBase: string;
		}
	}
}
