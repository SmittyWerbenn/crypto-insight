import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes'].includes(v.toLowerCase())));

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.string().default('info'),

  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),

  BINANCE_API_URL: z.string().url().default('https://api.binance.com'),
  BINANCE_API_FALLBACK_URL: z.string().default('https://data-api.binance.vision'),
  BINANCE_WS_URL: z.string().default('wss://stream.binance.com:9443'),
  BINANCE_WS_FALLBACK_URL: z.string().default('wss://data-stream.binance.vision'),
  BINANCE_FUTURES_API_URL: z.string().url().default('https://fapi.binance.com'),
  BINANCE_FUTURES_WS_URL: z.string().default('wss://fstream.binance.com'),
  BINANCE_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  // anthropic = Claude via the Anthropic API; openai-compatible = Google Gemini, Groq, OpenRouter, ... (AI_COMPAT_*)
  AI_PROVIDER: z.enum(['anthropic', 'openai-compatible']).default('anthropic'),
  AI_COMPAT_BASE_URL: z.string().url().default('https://generativelanguage.googleapis.com/v1beta/openai'),
  AI_COMPAT_API_KEY: z.string().optional(),
  AI_COMPAT_MODEL: z.string().default('gemini-3.1-flash-lite'),
  AI_COMPAT_JSON_MODE: z.enum(['json_schema', 'json_object']).default('json_schema'),
  AI_COMPAT_REASONING_EFFORT: z.string().optional(),

  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-opus-5'),
  ANTHROPIC_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('medium'),
  ANTHROPIC_ENABLE_FALLBACKS: bool.default(true),
  AI_LANGUAGE: z.enum(['id', 'en']).default('id'),
  AI_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(1800),
  ANTHROPIC_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),

  COINGECKO_API_URL: z.string().default('https://api.coingecko.com/api/v3'),
  FX_FALLBACK_API_URL: z.string().url().default('https://open.er-api.com/v6/latest/USD'),
  FEAR_GREED_API_URL: z.string().url().default('https://api.alternative.me/fng/'),
  CRYPTOPANIC_API_KEY: z.string().optional(),

  APP_TIMEZONE: z.string().default('Asia/Jakarta'),
  CORS_ORIGIN: z.string().default('http://localhost:5173,http://localhost:8080'),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),

  // Single-user login. Empty = no authentication (local development only).
  APP_PASSWORD: z.string().optional(),
  AUTH_TOKEN_TTL_HOURS: z.coerce.number().int().positive().default(168),

  MOCK_MODE: bool.default(false),
  ENABLE_JOBS: bool.default(true),
  ENABLE_WEBSOCKET: bool.default(true),
  // Suppress counter-trend signals: SELL/STRONG_SELL in a BULL regime (price & MA50 above MA200)
  // and BUY/STRONG_BUY in a BEAR regime are downgraded to HOLD with no trade levels.
  ENABLE_REGIME_FILTER: bool.default(true),
  AI_ANALYSIS_CRON: z.string().default('*/15 * * * *'),
  AI_MARKET_SUMMARY_MINUTES: z.coerce.number().int().positive().default(60),
  // Paper Trading V2: hourly entry scan + 5-minute exit monitor on a simulated Rp1.000.000 portfolio
  ENABLE_PAPER_JOB: bool.default(true),
  SIGNAL_TRACKER_CRON: z.string().default('*/5 * * * *'),
  TRACKED_SYMBOLS: z.string().default('BTCUSDT,ETHUSDT,BNBUSDT,SOLUSDT,XRPUSDT,DOGEUSDT,ADAUSDT,AVAXUSDT'),
  ANALYSIS_TIMEFRAME: z.string().default('4h'),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration', z.treeifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
export const trackedSymbols = env.TRACKED_SYMBOLS.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
export const isAiConfigured = () => Boolean(env.AI_PROVIDER === 'openai-compatible' ? env.AI_COMPAT_API_KEY : env.ANTHROPIC_API_KEY);
export const aiModelName = () => (env.AI_PROVIDER === 'openai-compatible' ? env.AI_COMPAT_MODEL : env.ANTHROPIC_MODEL);
