import chalk from "chalk";

export default {
	// biome-ignore lint/suspicious/noExplicitAny: Generic
	info: (...args: any[]) => console.log(chalk.cyanBright("i >"), ...args),
	// biome-ignore lint/suspicious/noExplicitAny: Generic
	warn: (...args: any[]) => console.log(chalk.yellow("⚠ >"), ...args),
	// biome-ignore lint/suspicious/noExplicitAny: Generic
	error: (...args: any[]) => console.log(chalk.red("! >"), ...args),
	// biome-ignore lint/suspicious/noExplicitAny: Generic
	success: (...args: any[]) => console.log(chalk.green("✓ >"), ...args),
	// biome-ignore lint/suspicious/noExplicitAny: Generic
	debug: (...args: any[]) => console.log(chalk.gray("ൠ >"), ...args),
};
