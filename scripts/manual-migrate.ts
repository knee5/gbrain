#!/usr/bin/env bun
/**
 * One-off manual migration script.
 *
 * Bypasses the broken `PostgresEngine.initSchema()` order-of-operations on a
 * v10-era brain (where SCHEMA_SQL references columns added by v11+
 * migrations). Calls `runMigrations(engine)` directly against an already-
 * connected engine, so SCHEMA_SQL never runs.
 *
 * Usage: cd ~/tools/gbrain && bun scripts/manual-migrate.ts
 */
import { loadConfig, toEngineConfig } from '../src/core/config.ts';
import { createEngine } from '../src/core/engine-factory.ts';
import { runMigrations, LATEST_VERSION } from '../src/core/migrate.ts';

async function main() {
  const config = loadConfig();
  if (!config) {
    console.error('No gbrain config found (no env var, no config file). Aborting.');
    process.exit(1);
  }

  const engineConfig = toEngineConfig(config);
  console.log(`Engine: ${engineConfig.engine}`);
  if (engineConfig.engine === 'postgres') {
    const url = engineConfig.database_url || '';
    // Mask credentials for log-safety.
    const masked = url.replace(/:\/\/[^@]+@/, '://***@');
    console.log(`DB URL: ${masked}`);
  }
  console.log(`Latest schema version (in code): ${LATEST_VERSION}`);

  const engine = await createEngine(engineConfig);
  await engine.connect(engineConfig);

  try {
    const beforeStr = (await engine.getConfig('version')) || '<unset>';
    console.log(`Current schema version (in DB): ${beforeStr}`);
    console.log('---');
    console.log('Running migrations directly (bypassing initSchema/SCHEMA_SQL)...');
    console.log('---');

    const result = await runMigrations(engine);
    console.log('---');
    console.log(`Applied ${result.applied} migration(s). Engine reports current=${result.current}.`);

    const afterStr = (await engine.getConfig('version')) || '<unset>';
    console.log(`Schema version after migration (in DB): ${afterStr}`);
  } finally {
    await engine.disconnect();
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
