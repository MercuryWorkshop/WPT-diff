export interface ParsedTomlConfig {
	promise_timeout: number;
	wpt: {
		urls: {
			tests_base_url: string;
			api_base_url: string;
		};
		max_tests: number;
		under_proxy?: boolean;
	};
}

export interface ConfigPaths {
	main: string;
	example: string;
	dotenv: string;
}
