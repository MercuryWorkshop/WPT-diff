import chalk from "chalk";
// TODO: Use tslog

// TODO: Don't insert newlines before the WPT tests and subtests are being executed and after
//const LOG_PREFIX = "\n";
const LOG_PREFIX = "";
export default {
	// biome-ignore lint/suspicious/noExplicitAny: Generic
	info: (...args: any[]) =>
		console.log(LOG_PREFIX, chalk.cyanBright("i >"), ...args),
	// biome-ignore lint/suspicious/noExplicitAny: Generic
	warn: (...args: any[]) =>
		console.log(LOG_PREFIX, chalk.yellow("⚠ >"), ...args),
	// biome-ignore lint/suspicious/noExplicitAny: Generic
	error: (...args: any[]) => console.log(LOG_PREFIX, chalk.red("! >"), ...args),
	// biome-ignore lint/suspicious/noExplicitAny: Generic
	success: (...args: any[]) =>
		console.log(LOG_PREFIX, chalk.green("✓ >"), ...args),
	// biome-ignore lint/suspicious/noExplicitAny: Generic
	// TODO: Only log debug messages if the debug mode is enabled
	/*
	debug: (...args: any[]) =>
		console.log(LOG_PREFIX, chalk.gray("ൠ >"), ...args),
	*/
	debug: () => ({}),
};
