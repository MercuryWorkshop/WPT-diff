import chalk from "chalk";

// Determine logging levels based on environment/config
const isDebug = process.env.DEBUG === "true";
const isVerbose = process.env.VERBOSE === "true";
const isCI = process.env.CI === "true";

const LOG_PREFIX = "";

export default {
	// biome-ignore lint/suspicious/noExplicitAny: Generic
	info: (...args: any[]) => {
		if (isVerbose || isDebug) {
			console.log(LOG_PREFIX, chalk.cyanBright("i >"), ...args);
		}
	},
	// biome-ignore lint/suspicious/noExplicitAny: Generic
	warn: (...args: any[]) =>
		console.log(LOG_PREFIX, chalk.yellow("⚠ >"), ...args),
	// biome-ignore lint/suspicious/noExplicitAny: Generic
	error: (...args: any[]) => console.log(LOG_PREFIX, chalk.red("! >"), ...args),
	// biome-ignore lint/suspicious/noExplicitAny: Generic
	success: (...args: any[]) =>
		console.log(LOG_PREFIX, chalk.green("✓ >"), ...args),
	// biome-ignore lint/suspicious/noExplicitAny: Generic
	debug: (...args: any[]) => {
		if (isDebug) {
			console.log(LOG_PREFIX, chalk.gray("ൠ >"), ...args);
		}
	},
};
