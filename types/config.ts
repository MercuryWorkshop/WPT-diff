import { z } from "zod";
export const ParsedTomlConfigSchema = z.object({
  promise_timeout: z.number(),
  wpt: z.object({
	max_tests: z.number().or(z.literal("all")),
    under_proxy: z.boolean(),
    urls: z.object({
      tests_base_url: z.string(),
      api_base_url: z.string(),
    }),
  }),
});

export type ParsedTomlConfig = z.infer<typeof ParsedTomlConfigSchema>;

export interface ConfigPaths {
	main: string;
	example: string;
	dotenv: string;
}
