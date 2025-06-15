/**
 * @module
 * This is a module made for runtime use with the cli in `cli.ts` and does not affect operation on the actual WPT-diff tests
 */

import {
	type ResultAsync,
	errAsync as nErrAsync,
	okAsync as nOkAsync,
} from "neverthrow";

import type { ConfigPaths } from "#types/config.d.ts";

import { parse } from "smol-toml";
import typia from "typia";
import type { ParsedTomlConfig } from "#types/config.d.ts";

import { constants, copyFile, readFile } from "node:fs/promises";

export default async function loadConfig(
	configPaths: ConfigPaths,
): Promise<ResultAsync<ParsedTomlConfig, string>> {
	// Create a config.yaml if one doesn't already exist by using the example config
	try {
		await copyFile(
			configPaths.example,
			configPaths.main,
			constants.COPYFILE_EXCL,
		);
	} catch {}

	const rawToml = await readFile(configPaths.main, "utf-8");
	const parsedToml = parse(rawToml);

	const configValidationRes = typia.validate<ParsedTomlConfig>(parsedToml);
	if (!configValidationRes.success) {
		const err = configValidationRes.errors
			.map((err) => `${err.path}: ${err.expected} but got ${err.value}`)
			.join(", ");

		return nErrAsync(
			`Failed to validate the 'config.toml' that you provided: ${err}`,
		);
	}
	const toml = configValidationRes.data;

	return nOkAsync(toml);
}
