import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { z } from 'zod';
export const root = fileURLToPath(new URL('../../../', import.meta.url));
// For bundled output in apps/server/dist the project root is also three levels up.
config({ path: resolve(root, '.env'), quiet: true });
export const env = z.object({ HOST: z.string().default('127.0.0.1'), PORT: z.coerce.number().int().min(1).max(65535).default(3007), WEB_ORIGIN: z.url().default('http://localhost:5177'), DATABASE_PATH: z.string().default('./data/ludo.sqlite') }).parse(process.env);
export const databasePath = resolve(root, env.DATABASE_PATH);
