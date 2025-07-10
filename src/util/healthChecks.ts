import {
	type ResultAsync,
	errAsync as nErrAsync,
	okAsync as nOkAsync,
} from "neverthrow";
import { lookup } from "node:dns/promises";
import { readFile, access } from "node:fs/promises";
import { exec, spawn } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import readline from "node:readline";
import simpleGit from "simple-git";
import type log from "../logger.ts";

const HEALTH_FETCH_TIMEOUT = 5 * 1000;
const WPT_SERVER_STARTUP_TIMEOUT = 10 * 1000;
const execAsync = promisify(exec);

/**
 * Checks if the WPT hosts are properly configured
 */
async function checkWPTHosts(
	hostname: string,
): Promise<ResultAsync<void, string>> {
	try {
		await lookup(hostname);
		return nOkAsync(undefined);
	} catch (err) {
		try {
			const hostsContent = await readFile("/etc/hosts", "utf-8");
			if (!hostsContent.includes(hostname)) {
				return nErrAsync(
					`${hostname} not found in /etc/hosts. Run: './wpt make-hosts-file | sudo tee -a /etc/hosts'.`,
				);
			}
			return nOkAsync(undefined);
		} catch (readErr) {
			return nErrAsync(
				`Cannot resolve ${hostname} and failed to check '/etc/hosts': ${readErr}`,
			);
		}
	}
}

/**
 * Checks if a service is running at the given URL
 */
async function checkServiceHealth(
	url: string,
	serviceName: string,
): Promise<ResultAsync<void, string>> {
	try {
		const controller = new AbortController();
		const timeoutId = setTimeout(
			() => controller.abort(),
			HEALTH_FETCH_TIMEOUT,
		);

		const resp = await fetch(url, {
			method: "HEAD",
			signal: controller.signal,
		});

		clearTimeout(timeoutId);

		if (!resp.ok && resp.status !== 404) {
			return nErrAsync(
				`${serviceName} returned status ${resp.status} at '${url}'`,
			);
		}

		return nOkAsync(undefined);
	} catch (err) {
		if (err instanceof Error) {
			if (err.name === "AbortError") {
				return nErrAsync(`${serviceName} request timed out at '${url}'`);
			}
			if (err.message.includes("ECONNREFUSED")) {
				return nErrAsync(`${serviceName} is not running at '${url}'`);
			}
		}
		return nErrAsync(`Failed to connect to ${serviceName} at '${url}': ${err}`);
	}
}

/**
 * Checks if WPT git submodule is properly initialized
 */
async function checkWPTSubmodule(
	logger: typeof log,
): Promise<ResultAsync<boolean, string>> {
	const git = simpleGit();
	const wptPath = join(process.cwd(), "wpt");

	try {
		await access(wptPath);
	} catch {
		return nOkAsync(false);
	}

	try {
		const status = await git.raw(["submodule", "status", "wpt"]);
		const isInitialized = !status.startsWith("-") && !status.startsWith("+");

		if (!isInitialized) {
			logger.info("WPT submodule not initialized, updating submodules");
			await git.submoduleUpdate(["--init", "--recursive", "wpt"]);
			return nOkAsync(true);
		}

		if (status.startsWith("+")) {
			logger.info("WPT submodule out of date, updating");
			await git.submoduleUpdate(["--remote", "--merge", "wpt"]);
		}

		return nOkAsync(true);
	} catch (error) {
		return nErrAsync(`Failed to check WPT submodule: ${error}`);
	}
}

/**
 * Runs ./wpt make-hosts-file to configure hosts
 */
async function configureWPTHosts(
	logger: typeof log,
): Promise<ResultAsync<void, string>> {
	try {
		logger.info("Configuring WPT hosts");
		const { stdout } = await execAsync("./wpt make-hosts-file", {
			cwd: join(process.cwd(), "wpt"),
		});

		await execAsync(`echo "${stdout}" | sudo tee -a /etc/hosts`);
		logger.info("WPT hosts configured successfully");

		return nOkAsync(undefined);
	} catch (error) {
		return nErrAsync(`Failed to configure WPT hosts: ${error}`);
	}
}

/**
 * Prompts user to configure WPT hosts
 */
async function promptConfigureHosts(
	logger: typeof log,
): Promise<ResultAsync<boolean, string>> {
	if (process.env.CI === "true") {
		return nOkAsync(false);
	}

	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	return new Promise((resolve) => {
		rl.question("WPT hosts are not configured. Would you like to configure them now? (y/n) ", (answer) => {
			rl.close();
			resolve(nOkAsync(answer.toLowerCase() === "y"));
		});
	});
}

/**
 * Prompts user to start WPT server
 */
async function promptStartWPTServer(
	logger: typeof log,
): Promise<ResultAsync<boolean, string>> {
	if (process.env.CI === "true") {
		return nOkAsync(false);
	}

	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	return new Promise((resolve) => {
		rl.question("WPT server is not running. Start it now? (y/n) ", (answer) => {
			rl.close();

			if (answer.toLowerCase() === "y") {
				logger.info("Starting WPT server");

				const wptProcess = spawn("./wpt", ["serve"], {
					cwd: join(process.cwd(), "wpt"),
					stdio: "ignore",
					detached: true,
				});

				wptProcess.unref();

				logger.info("WPT server starting in background");
				logger.info(
					`Waiting ${WPT_SERVER_STARTUP_TIMEOUT / 1000} seconds for server to initialize`,
				);

				setTimeout(() => {
					resolve(nOkAsync(true));
				}, WPT_SERVER_STARTUP_TIMEOUT);
			} else {
				resolve(nOkAsync(false));
			}
		});
	});
}

/**
 * Performs health checks before running tests
 */
export async function performHealthChecks(
	wptUrl: string,
	proxyUrl: string | null,
	underProxy: boolean,
	logger: typeof log,
	debug: boolean,
): Promise<ResultAsync<void, string>> {
	logger.info("Performing health checks");

	const wptUrlObj = new URL(wptUrl);
	const isExternalWPT = !wptUrlObj.hostname.includes("web-platform.test");

	if (!isExternalWPT) {
		const submoduleResult = await checkWPTSubmodule(logger);
		if (submoduleResult.isErr()) {
			return nErrAsync(submoduleResult.error);
		}

		if (!submoduleResult.value) {
			return nErrAsync(
				"WPT submodule not found. Run: git submodule update --init --recursive wpt",
			);
		}

		const hostsResult = await checkWPTHosts(wptUrlObj.hostname);
		if (hostsResult.isErr()) {
			logger.warn(`WPT hosts check failed: ${hostsResult.error}`);

			const promptResult = await promptConfigureHosts(logger);
			if (promptResult.isErr()) {
				return nErrAsync(promptResult.error);
			}

			if (promptResult.value) {
				const configureResult = await configureWPTHosts(logger);
				if (configureResult.isErr()) {
					const msg = `Failed to configure WPT hosts: ${configureResult.error}`;
					if (debug) {
						logger.warn(msg);
					} else {
						return nErrAsync(msg);
					}
				}
			} else {
				const msg = "WPT hosts are not configured. Run: cd wpt && ./wpt make-hosts-file | sudo tee -a /etc/hosts";
				if (debug) {
					logger.warn(msg);
					logger.warn("Continuing anyway in debug mode");
				} else {
					return nErrAsync(msg);
				}
			}
		}
	}

	const wptHealthResult = await checkServiceHealth(wptUrl, "WPT server");
	if (wptHealthResult.isErr()) {
		if (!isExternalWPT) {
			logger.warn(`WPT server health check failed: ${wptHealthResult.error}`);

			const startResult = await promptStartWPTServer(logger);
			if (startResult.isErr()) {
				return nErrAsync(startResult.error);
			}

			if (startResult.value) {
				const retryHealthResult = await checkServiceHealth(
					wptUrl,
					"WPT server",
				);
				if (retryHealthResult.isErr()) {
					const msg = `WPT server still not responding after startup: ${retryHealthResult.error}`;
					if (debug) {
						logger.warn(msg);
						logger.warn("Continuing anyway in debug mode");
					} else {
						return nErrAsync(msg);
					}
				}
			} else {
				const msg = "WPT server is not running and user declined to start it";
				if (debug) {
					logger.warn(msg);
					logger.warn("Continuing anyway in debug mode");
				} else {
					return nErrAsync(msg);
				}
			}
		} else {
			const msg = `WPT server health check failed: ${wptHealthResult.error}`;
			if (debug) {
				logger.warn(msg);
				logger.warn("Continuing anyway in debug mode");
			} else {
				return nErrAsync(msg);
			}
		}
	} else {
		logger.info("WPT server is running");
	}

	if (underProxy && proxyUrl) {
		const proxyHealthResult = await checkServiceHealth(
			proxyUrl,
			"Web Proxy Server",
		);
		if (proxyHealthResult.isErr()) {
			const msg = `Web Proxy Server health check failed: ${proxyHealthResult.error}`;
			if (debug) {
				logger.warn(msg);
				logger.warn("Continuing anyway in debug mode");
			} else {
				return nErrAsync(msg);
			}
		} else {
			logger.info("Web Proxy Server is running");
		}
	}

	return nOkAsync(undefined);
}
