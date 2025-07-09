import typia from "typia";
import type { WPT } from "#types/wpt.ts";

export const validateWPTUpdateManifest =
	typia.createValidate<WPT.UpdateManifest.Manifest>();
