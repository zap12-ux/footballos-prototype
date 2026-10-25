import { defineConfig } from 'drizzle-kit';

// Generates SQL migrations into ./drizzle from the Drizzle schema. The API applies them at startup.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
