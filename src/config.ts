import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

export interface AppConfig {
  port: number;
  enginePath: string;
  engineOptions: Record<string, string | number>;
  adminApiKey: string;
}

function loadEngineConfig(): Record<string, string | number> {
  const configPath = process.env.ENGINE_CONFIG_PATH ?? path.resolve('./config.json');
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(raw) as Record<string, string | number>;
  } catch (err) {
    console.warn(`[Config] Could not load engine config from "${configPath}": ${err}. Using empty options.`);
    return {};
  }
}

const adminApiKey = process.env.ADMIN_API_KEY;
if (!adminApiKey) {
  console.error('[Config] ADMIN_API_KEY is not set. The /api/setoption route will reject all requests.');
}

const config: AppConfig = {
  port: parseInt(process.env.PORT ?? '3000', 10),
  enginePath: process.env.ENGINE_PATH ?? 'engine/engine',
  engineOptions: loadEngineConfig(),
  adminApiKey: adminApiKey ?? '',
};

export default config;
