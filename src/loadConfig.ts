/**
 * @module
 * This is a module made for runtime use with the cli in `cli.ts` and does not affect operation on the actual WPT-diff tests
 */

import {
	okAsync as nOkAsync,
	errAsync as nErrAsync,
	type ResultAsync,
} from "neverthrow";

import type { ConfigPaths } from "#types/config.d.ts";

import { parse } from "smol-toml";
// import typia from "typia";
import type { ParsedTomlConfig } from "#types/config.d.ts";

import { readFile, copyFile, constants } from "node:fs/promises";

export default async function loadConfig(
	configPaths: ConfigPaths,
): Promise<ResultAsync<ParsedTomlConfig, string>> {
	// Create a `config.yaml` if one doesn't already exist by using the example config
	try {
		await copyFile(
			configPaths.example,
			configPaths.main,
			constants.COPYFILE_EXCL,
		);
	} catch {}

	const rawToml = await readFile(configPaths.main, "utf-8");
	const parsedToml = parse(rawToml);

	// FIXME: Fix the runtime validation
	/*
	const configValidationRes = typia.validate<ParsedTomlConfig>(parsedToml);
	if (!configValidationRes.success)
		return nErrAsync(
			`Failed to validate the 'config.toml' that you provided: ${configValidationRes.errors}`,
		);
	const toml = configValidationRes.data;

	return nOkAsync(toml);
	*/

	// @ts-ignore
	return nOkAsync(parsedToml);
}
