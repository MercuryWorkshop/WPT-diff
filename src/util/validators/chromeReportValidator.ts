import typia from "typia";
import type { ChromeWPTApiResponse, ChromeWPTReport } from "#types/chrome.d.ts";

export const validateChromeWPTApiResponse =
	typia.createValidate<ChromeWPTApiResponse>();

export const validateChromeWPTReport = typia.createValidate<ChromeWPTReport>();
