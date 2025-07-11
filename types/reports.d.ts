import type { WPTReport, FailedTest } from "./index.d.ts";

export interface ShardReportFiles {
	"wpt-report-diff.json": WPTReport;
	"wpt-report-proxy.json": WPTReport;
	"failed-tests.json": FailedTest[];
}

export interface CombinedReportFiles {
	"wpt-report-diff.json": WPTReport;
	"wpt-report-proxy.json": WPTReport;
	"failed-tests.json": FailedTest[];
	"regression-fails.json"?: FailedTest[];
}

export type ReportType = "wpt-diff" | "wpt-proxy";

export interface ReportGenerationConfig {
	reportType: ReportType;
	includeChrome: boolean;
}

export interface DualReportResult {
	diffReport: WPTReport;
	proxyReport: WPTReport;
}

export interface ShardReportData {
	shardName: string;
	diffReport: WPTReport;
	proxyReport: WPTReport;
	failedTests: FailedTest[];
}

export interface ShardReportsReadResult {
	wptDiffReports: WPTReport[];
	wptProxyReports: WPTReport[];
	failedTests: FailedTest[];
	successfulShards: number;
}
