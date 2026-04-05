import postgres from 'postgres';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { GBrainError, type EngineConfig } from './types.ts';

let sql: ReturnType<typeof postgres> | null = null;

export function getConnection(): ReturnType<typeof postgres> {
  if (!sql) {
    throw new GBrainError(
      'No database connection',
      'connect() has not been called',
      'Run gbrain init --supabase or gbrain init --url <connection_string>',
    );
  }
  return sql;
}

export async function connect(config: EngineConfig): Promise<void> {
  if (sql) return;

  const url = config.database_url;
  if (!url) {
    throw new GBrainError(
      'No database URL',
      'database_url is missing from config',
      'Run gbrain init --supabase or gbrain init --url <connection_string>',
    );
  }

  try {
    sql = postgres(url, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
      types: {
        // Register pgvector type
        bigint: postgres.BigInt,
      },
    });

    // Test connection
    await sql`SELECT 1`;
  } catch (e: unknown) {
    sql = null;
    const msg = e instanceof Error ? e.message : String(e);
    throw new GBrainError(
      'Cannot connect to database',
      msg,
      'Check your connection URL in ~/.gbrain/config.json',
    );
  }
}

export async function disconnect(): Promise<void> {
  if (sql) {
    await sql.end();
    sql = null;
  }
}

export async function initSchema(): Promise<void> {
  const conn = getConnection();

  // Read schema SQL
  const schemaPath = join(dirname(new URL(import.meta.url).pathname), '..', 'schema.sql');
  const schemaSql = readFileSync(schemaPath, 'utf-8');

  // Split on semicolons and execute each statement
  // (postgres driver can handle multi-statement, but explicit is safer)
  const statements = schemaSql
    .split(/;\s*$/m)
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  for (const stmt of statements) {
    try {
      await conn.unsafe(stmt);
    } catch (e: unknown) {
      // Ignore "already exists" errors for idempotency
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('already exists') || msg.includes('duplicate key')) {
        continue;
      }
      throw e;
    }
  }
}

export async function withTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const conn = getConnection();
  return conn.begin(async (tx) => {
    // Temporarily swap global connection to transaction
    const prev = sql;
    sql = tx as unknown as ReturnType<typeof postgres>;
    try {
      return await fn();
    } finally {
      sql = prev;
    }
  });
}
