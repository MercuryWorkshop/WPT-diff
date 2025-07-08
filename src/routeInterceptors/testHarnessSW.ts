import type logger from "../logger";

import type { Page } from "playwright";

export default async function initTestHarnessInterceptor(pass: {
	page: Page;
	bodyAddition: string;
	log: typeof logger;
}): Promise<void> {
	const { page, bodyAddition, log } = pass;
	log.debug(
		"\nCreating a Mutation Observer to detect when a test harness script is added to the page",
	);
	log.debug(`\n\tInjecting: ${bodyAddition}`);
	await page.addInitScript(/* js */ `
		new MutationObserver((mutations) => {
			for (const mutation of mutations)
				for (const node of [...mutation.addedNodes]) {
                    if (node instanceof HTMLScriptElement && node.src) {
                        console.debug("Found a script node being added", node);
					}
					if (
						node instanceof HTMLScriptElement &&
						node.src &&
					    node.src.endsWith("testharnessreport.js")
				    ) {
                        console.debug("Found the test harness script before creation");
                        const collectionScript = document.createElement("script");
                        collectionScript.textContent = \`${bodyAddition.replace(
													/\`/g,
													"\\`",
												)}\`;
                        node.after(collectionScript);
                    }
    }
		}).observe(document, { childList: true, subtree: true });
		console.debug(
			"Starting the Mutation Observer to watch for the addition of the script with the test harness",
		);
	`);
}
