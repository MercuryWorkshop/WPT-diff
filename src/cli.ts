import { Command } from "commander"
import { startTest } from "./index"
const program = new Command();

program
    .name("WPT-diff")
    .description("A way to test proxies")
    .version("1.0.0");

program.option("-f, --filter <directories>",  "only run test directories that match filter (ex: /dom,/js)")

program.parse()

const opts = program.opts()


startTest({
        
});