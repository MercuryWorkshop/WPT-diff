import typia from "typia";
import type { FailedTest } from "#types/index.d.ts";

export const validateFailedTest = typia.createValidate<FailedTest>();
export const validateFailedTestArray = typia.createValidate<FailedTest[]>();
