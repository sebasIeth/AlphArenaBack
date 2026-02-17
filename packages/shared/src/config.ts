import { z } from "zod";

const envSchema = z.object({
  MONGODB_URI: z.string().min(1),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default("0.0.0.0"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  JWT_SECRET: z.string().min(1),
  JWT_EXPIRES_IN: z.string().default("7d"),
  RPC_URL: z.string().url().optional(),
  CHAIN_ID: z.coerce.number().default(1),
  CONTRACT_ADDRESS: z.string().optional(),
  PRIVATE_KEY: z.string().optional(),
  MATCH_DURATION_MS: z.coerce.number().default(1_200_000),
  TURN_TIMEOUT_MS: z.coerce.number().default(30_000),
  MAX_TIMEOUTS: z.coerce.number().default(3),
  MIN_STAKE: z.coerce.number().default(10),
  MAX_STAKE: z.coerce.number().default(10_000),
  PLATFORM_FEE_PERCENT: z.coerce.number().default(5),
  MATCHMAKING_INTERVAL_MS: z.coerce.number().default(2_000),
  ELO_MATCH_RANGE: z.coerce.number().default(200),
});

export type EnvConfig = z.infer<typeof envSchema>;

let cachedConfig: EnvConfig | null = null;

export function loadConfig(): EnvConfig {
  if (cachedConfig) return cachedConfig;
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const formatted = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${formatted}`);
  }
  cachedConfig = result.data;
  return cachedConfig;
}

export function resetConfigCache(): void {
  cachedConfig = null;
}
