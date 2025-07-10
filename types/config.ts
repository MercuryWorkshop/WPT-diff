import { z } from "zod";
export const ParsedTomlConfigSchema = z.object({
	debug: z.object({
		debug: z.boolean(),
		verbose: z.boolean(),
	}),
	wpt: z.object({
		max_tests: z.number().or(z.literal("all")),
		under_proxy: z.boolean(),
		urls: z.object({
			proxy_base_url: z.string(),
			tests_base_url: z.string(),
			api_base_url: z.string(),
		}),
	}),
});

export type ParsedTomlConfig = z.infer<typeof ParsedTomlConfigSchema>;

export interface ConfigPaths {
	main: string;
	example: string;
}
