import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { env } from "./env.js";

const DB_PATH = env.DB_PATH;

// Ensure the data directory exists
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.exec("PRAGMA journal_mode = WAL");

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS activities (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    summary TEXT NOT NULL,
    records TEXT NOT NULL,
    laps TEXT NOT NULL,
    intervals TEXT NOT NULL DEFAULT '[]',
    interval_minutes TEXT NOT NULL DEFAULT '',
    custom_ranges TEXT NOT NULL DEFAULT '[]',
    user_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_activities_date ON activities(date);
  CREATE INDEX IF NOT EXISTS idx_activities_user_id ON activities(user_id);
  CREATE INDEX IF NOT EXISTS idx_activities_user_date ON activities(user_id, date);
`);

// Migrations: add columns for existing databases
const migrations = [
  `ALTER TABLE activities ADD COLUMN intervals TEXT NOT NULL DEFAULT '[]'`,
  `ALTER TABLE activities ADD COLUMN interval_minutes TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE activities ADD COLUMN custom_ranges TEXT NOT NULL DEFAULT '[]'`,
  `ALTER TABLE activities ADD COLUMN user_id TEXT NOT NULL DEFAULT ''`,
];

// Create index for user_id after migrations (idempotent)
db.exec(`CREATE INDEX IF NOT EXISTS idx_activities_user_id ON activities(user_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_activities_user_date ON activities(user_id, date)`);

for (const migration of migrations) {
  try {
    db.exec(migration);
  } catch {
    // Column already exists — ignore
  }
}

export { db };
