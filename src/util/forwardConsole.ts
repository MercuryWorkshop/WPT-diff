import type logger from "../logger.ts";

import type { TestOptions } from "../../types/test.d.ts";

import { Page } from "playwright";

// For propagating colored logs from the page
// @ts-ignore: This module is not typed
import supportsColor from "supports-color";
// @ts-ignore: This module is not typed
//import createFormatter from "console-with-style";

// @ts-ignore: This library is typed wrong
/*
const level = supportsColor.stdout?.level || 0;
const formatWithColor = createFormatter(level);
*/

interface Passthrough {
	verbose: boolean;
	page: Page;
	options: TestOptions;
	log: typeof logger;
}

export default function forwardConsole(passthrough: Passthrough) {
	const { verbose, page, options, log } = passthrough;

	return;
	if (!verbose) return;

	page.on("console", async (msg) => {
		const msgText = msg.text();
		const pageUrl = msg.location().url;
		if (
			options.underProxy
				? (pageUrl.includes("/scram/") || pageUrl.includes("/scramjet/")) &&
					// Hide known messages for init and rewriting
					!msgText.includes("bare-mux:") &&
					!msgText.includes("[dreamland.js]") &&
					!msgText.includes("config loaded") &&
					!msgText.includes("handleSubmit") &&
					!msgText.includes("rewrite") &&
					!msgText.includes("initializing scramjet client")
				: true
		) {
			if (options.silent) return;

			const prefix = options.underProxy
				? "[Iframe Console]"
				: "[Browser Console]";

			/*
			let formattedWithColor: string;
			try {
				formattedWithColor = formatWithColor(msgText);
			} catch {
				formattedWithColor = msgText;
			}
			*/
			const formattedWithColor = msgText;

			const msgType = msg.type();
			switch (msgType) {
				case "log":
				case "info":
					log.info(prefix, formattedWithColor);
					break;
				case "debug":
					log.debug(prefix, formattedWithColor);
					break;
				case "warning":
					log.warn(prefix, formattedWithColor);
					break;
				case "error":
					log.error(prefix, formattedWithColor);
					break;
			}
		}
	});
}
