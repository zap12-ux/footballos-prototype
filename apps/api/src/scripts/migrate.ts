// Applies pending migrations from apps/api/drizzle to the database under FOOTBALLOS_DATA_DIR and exits.
import { loadConfig, loadEnvFile } from '../config.js';
import { openDatabase } from '../db/db.js';

loadEnvFile();
const config = loadConfig();
const opened = openDatabase(config.dataDir);
const tables = opened.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%' ORDER BY name").all() as { name: string }[];
console.log(`migrations applied: ${opened.file}`);
console.log(`tables: ${tables.map((t) => t.name).join(', ')}`);
opened.close();
