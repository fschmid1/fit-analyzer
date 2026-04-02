/**
 * Parses a ChatGPT-style markdown export and imports the conversation into
 * the trainer_messages table as a named coaching chat.
 *
 * Usage:
 *   bun run scripts/import-coaching-chat.ts [file] [options]
 *
 * Arguments:
 *   file              Path to the markdown file (default: "Cycling coach.md")
 *
 * Options:
 *   --user=<id>       user_id to store under        (default: "dev")
 *   --name=<id>       activity_id / chat name       (default: "general")
 *   --db=<path>       path to SQLite database file  (default: apps/server/data/fit-analyzer.db)
 *   --dry-run         Parse and print stats without writing to the DB
 */

import { Database } from "bun:sqlite";
import { readFileSync } from "fs";
import { randomUUID } from "crypto";
import { resolve } from "path";
import type { TrainerMessage } from "@fit-analyzer/shared";

// ── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getFlag(name: string, fallback: string): string {
  const flag = args.find((a) => a.startsWith(`--${name}=`));
  return flag ? flag.slice(`--${name}=`.length) : fallback;
}

const ROOT = resolve(import.meta.dir, "..");
const mdFile  = args.find((a) => !a.startsWith("--")) ?? "Cycling coach.md";
const MD_FILE = resolve(ROOT, mdFile);
const DB_FILE = resolve(ROOT, getFlag("db", "apps/server/data/fit-analyzer.db"));
const USER_ID = getFlag("user", "dev");
const CHAT_NAME = getFlag("name", "general");
const DRY_RUN  = args.includes("--dry-run");

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Strip <details>…</details> reasoning blocks from assistant messages */
function stripDetails(text: string): string {
  return text.replace(/<details[\s\S]*?<\/details>/gi, "").trim();
}

/** Parse a ChatGPT markdown export into TrainerMessages */
function parseMarkdown(raw: string): TrainerMessage[] {
  const sections = raw.split(/\n---\n/);

  // Derive a base timestamp from the file header ("Created: DD/MM/YYYY, HH:MM:SS")
  const header = sections[0] ?? "";
  const m = header.match(/Created:\s*(\d{2})\/(\d{2})\/(\d{4}),\s*(\d{2}):(\d{2}):(\d{2})/);
  const baseTime = m
    ? new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}`).getTime()
    : Date.now();

  const messages: TrainerMessage[] = [];
  let idx = 0;

  for (const section of sections) {
    const trimmed = section.trim();

    let role: "user" | "assistant" | null = null;
    let contentStart = 0;

    if (/^###\s+User/.test(trimmed)) {
      role = "user";
      contentStart = trimmed.indexOf("\n") + 1;
    } else if (/^###\s+Assistant/.test(trimmed)) {
      role = "assistant";
      contentStart = trimmed.indexOf("\n") + 1;
    } else {
      continue; // preamble / separators
    }

    let content = trimmed.slice(contentStart).trim();
    if (role === "assistant") content = stripDetails(content);
    if (!content) continue;

    messages.push({
      id: randomUUID(),
      role,
      content,
      createdAt: new Date(baseTime + idx * 30_000).toISOString(),
    });
    idx++;
  }

  return messages;
}

// ── Main ─────────────────────────────────────────────────────────────────────

console.log(`File   : ${MD_FILE}`);
console.log(`DB     : ${DB_FILE}`);
console.log(`user   : ${USER_ID}`);
console.log(`name   : ${CHAT_NAME}`);
if (DRY_RUN) console.log("Mode   : dry-run (no writes)\n");

const raw = readFileSync(MD_FILE, "utf-8");
const messages = parseMarkdown(raw);

const userCount = messages.filter((m) => m.role === "user").length;
const assistantCount = messages.filter((m) => m.role === "assistant").length;
console.log(`Parsed : ${messages.length} messages (${userCount} user, ${assistantCount} assistant)`);

if (DRY_RUN) {
  console.log("\nSample messages:");
  for (const msg of messages.slice(0, 3)) {
    console.log(`  [${msg.role}] ${msg.content.slice(0, 80).replace(/\n/g, " ")}…`);
  }
  process.exit(0);
}

const db = new Database(DB_FILE);

// Ensure tables exist (idempotent — safe to run against an already-initialised DB)
db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS trainer_chats (
    id TEXT PRIMARY KEY,
    activity_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_trainer_chats_user_activity
    ON trainer_chats(user_id, activity_id);

  CREATE TABLE IF NOT EXISTS trainer_messages (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL REFERENCES trainer_chats(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_trainer_messages_chat_id
    ON trainer_messages(chat_id);
`);

const chatId = `${USER_ID}:${CHAT_NAME}`;

db.transaction(() => {
  db.prepare(
    `INSERT INTO trainer_chats (id, activity_id, user_id, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, activity_id) DO UPDATE SET updated_at = datetime('now')`
  ).run(chatId, CHAT_NAME, USER_ID);

  db.prepare(`DELETE FROM trainer_messages WHERE chat_id = ?`).run(chatId);

  const insert = db.prepare(
    `INSERT INTO trainer_messages (id, chat_id, role, content, created_at)
     VALUES (?, ?, ?, ?, ?)`
  );
  for (const msg of messages) {
    insert.run(msg.id, chatId, msg.role, msg.content, msg.createdAt);
  }
})();

db.close();

console.log(`\n✓ Imported ${messages.length} messages`);
console.log(`  chat_id     = ${chatId}`);
console.log(`  activity_id = ${CHAT_NAME}`);
