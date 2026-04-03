import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
    server: {
        PORT: z.coerce.number().default(3001),
        DB_PATH: z.string().default("./data/fit-analyzer.db"),
        OPENROUTER_KEY: z.string().optional(),
        STRAVA_CLIENT_ID: z.string().optional(),
        STRAVA_CLIENT_SECRET: z.string().optional(),
        STRAVA_REDIRECT_URI: z.string().optional(),
    },
    runtimeEnv: process.env,
    emptyStringAsUndefined: true,
});
