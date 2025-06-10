export interface WPTTestResult {
	name: string;
	status: number;
	message?: string;
	stack?: string;
}

export enum WPTTestStatus {
	PASS = 0,
	FAIL = 1,
	TIMEOUT = 2,
	NOTRUN = 3,
	OPTIONALFEATURE_UNSUPPORTED = 4,
}
