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

	export namespace UpdateManifest {
		type TestHarnessItem = [
			/**
			 * Test URL (without leading slash)
			 */
			string,
			{
				/**
				 * `null` or `timeout` being omitted entirely means default, which is 10 seconds
				 * `long` means 60 seconds
				 */
				timeout?: null | "long";
			},
		];

		type RefTestItem = [
			/**
			 * Test URL (without leading slash)
			 */
			string,
			/**
			 * Array of reference comparisons
			 */
			[string, "==" | "!="][],
			{
				/**
				 * `null` or `timeout` being omitted entirely means default, which is 10 seconds
				 * `long` means 60 seconds
				 */
				timeout?: null | "long";
			},
		];

		type ManualTestItem = [
			/**
			 * Test URL (without leading slash)
			 */
			string,
			/**
			 * Empty object for manual tests
			 */
			{},
		];

		type TestHarness = {
			[path: string]: TestHarnessItem[];
		};
		type RefTest = {
			[path: string]: RefTestItem[];
		};
		type ManualTest = {
			[path: string]: ManualTestItem[];
		};

		export interface Manifest {
			items: {
				testharness: TestHarness;
				reftest: RefTest;
				manual: ManualTest;
			};
			/** Base path for the WPT tests on the API URI */
			urlBase?: string;
		}
	}
}
