import { chromium } from 'playwright';
import fs from "node:fs/promises"
interface WPTTestResult {
    name: string;
    status: number;
    message?: string;
    stack?: string;
}

enum Status {
    PASS = 0,
    FAIL = 1,
    TIMEOUT = 2,
    NOTRUN = 3,
    OPTIONALFEATURE_UNSUPPORTED = 4
}

const TEST_PATHS = [
    'dom/nodes/Element-tagName.html',
    'dom/nodes/Element-matches.html'
];

const BASE_URL = 'https://wpt.live/';

const STATUS_CODES = {
    0: "Pass",
    1: "Fail",
    2: "Timeout",
    3: "Not Run",
    4: "Optional Feature Unsupported"
} as const;

(async () => {
    const browser = await chromium.launch({
        headless: false,
    });

    const page = await browser.newPage();
    page.route("https://wpt.live/resources/testharness.js", async (r) => {
        const text = await fs.readFile("src/testharness.js", "utf8")
        await r.fulfill({
            status: 200,
            contentType: "text/javascript",
            body: text
        })

    })
    page.on('console', (msg) => {
        const text = msg.text();
        if (msg.type() === 'error') {
            console.log('Console error:', text);
        } else {
            console.log("Console: ", text)
        }
    });

    let testResults = new Map<string, WPTTestResult[]>()
    await page.exposeFunction('collectWPTResults', (url: string, tests: WPTTestResult[], harness_status: { message?: string; stack?: string; status: number }, asserts_run: any) => {
        testResults.set(url, tests)
    });

    for (const testPath of TEST_PATHS) {
        const fullUrl = BASE_URL + testPath;
        console.log(`\nRunning: ${testPath}`);


        try {
            await page.goto(fullUrl, {
                waitUntil: "domcontentloaded"
            });

            await page.waitForSelector("table#results")

        } catch (error) {
            console.error(`Error running test ${testPath}:`, error);

        }
    }

    await page.waitForTimeout(100);


    // TODO: todooooooooooooooooooooooooooooooooooooooo
    let TotalPass = 0;
    let TotalFail = 0;
    let TotalOther = 0;
    for await (const [k, v] of testResults) {
        for (const test of v) {
            if (test.status === Status.PASS) {
                TotalPass++;
            } else if (test.status === Status.FAIL) {
                TotalFail++;
            } else {
                TotalOther++
            }
        }


    }

    await browser.close()
    console.log('\n🏁 Test run completed');
    console.log(`Total Passed Tests: ${TotalPass}`);
    console.log(`Total Failed Tests: ${TotalFail}`);
    console.log(`Other Test results: ${TotalOther}`);
})().catch(console.error);