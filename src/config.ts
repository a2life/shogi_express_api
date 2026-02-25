import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

export interface AppConfig {
  port: number;
  enginePath: string;
  engineOptions: Record<string, string | number>;
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

const config: AppConfig = {
  port: parseInt(process.env.PORT ?? '3000', 10),
  enginePath:  './engine/engine.exe',
  engineOptions: loadEngineConfig(),
};

export default config;
