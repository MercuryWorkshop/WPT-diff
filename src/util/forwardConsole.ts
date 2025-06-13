import { Logger, Page } from "playwright";

export default function forwardConsole(page: Page, log: Logger) {
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
			// FIXME: console.log(formatWithColor(msgText));
			if (log[msg.type()]) log[msg.type()](prefix, msgText);
			else log.info(prefix, msgText);
		}
	});
}
