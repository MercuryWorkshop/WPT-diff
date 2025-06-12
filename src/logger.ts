import chalk from "chalk";

export default {
	// biome-ignore lint/suspicious/noExplicitAny: generic
	info: (...args: any[]) => console.log(chalk.cyanBright("i >"), ...args),
	// biome-ignore lint/suspicious/noExplicitAny: generic
	warn: (...args: any[]) => console.log(chalk.yellow("⚠ >"), ...args),
	// biome-ignore lint/suspicious/noExplicitAny: generic
	error: (...args: any[]) => console.log(chalk.red("! >"), ...args),
	// biome-ignore lint/suspicious/noExplicitAny: generic
	success: (...args: any[]) => console.log(chalk.green("✓ >"), ...args),
	// biome-ignore lint/suspicious/noExplicitAny: generic
	debug: (...args: any[]) => console.log(chalk.gray("ൠ >"), ...args),
};
