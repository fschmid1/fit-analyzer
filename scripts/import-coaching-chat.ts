/**
 * Parses "Cycling coach.md" and imports the conversation into the
 * trainer_chats table as a general (non-activity) coaching chat.
 *
 * Run with:
 *   bun run scripts/import-coaching-chat.ts
 */

import { Database } from "bun:sqlite";
import { readFileSync } from "fs";
import { randomUUID } from "crypto";
import { resolve } from "path";

// ── Config ──────────────────────────────────────────────────────────────────
const MD_FILE = resolve(import.meta.dir, "../Cycling coach.md");
const DB_FILE = resolve(import.meta.dir, "../apps/server/data/fit-analyzer.db");
const USER_ID = "dev";
const ACTIVITY_ID = "general"; // sentinel — not tied to a FIT file

// ── Types ────────────────────────────────────────────────────────────────────
interface TrainerMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string; // ISO-8601
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Remove <details>…</details> blocks (reasoning) from assistant text */
function stripDetails(text: string): string {
  // Non-greedy match across newlines
  return text.replace(/<details[\s\S]*?<\/details>/gi, "").trim();
}

/** Parse the markdown file into an ordered list of TrainerMessages */
function parseMarkdown(raw: string): TrainerMessage[] {
  // Split on the horizontal rule separators that divide messages
  const sections = raw.split(/\n---\n/);

  // Extract the file creation timestamp from the header section
  const headerSection = sections[0] ?? "";
  const createdMatch = headerSection.match(/Created:\s*(\d{2})\/(\d{2})\/(\d{4}),\s*(\d{2}):(\d{2}):(\d{2})/);
  let baseTime = createdMatch
    ? new Date(
        `${createdMatch[3]}-${createdMatch[2]}-${createdMatch[1]}T${createdMatch[4]}:${createdMatch[5]}:${createdMatch[6]}`
      ).getTime()
    : Date.now();

  const messages: TrainerMessage[] = [];
  // Each message gets a synthetic timestamp 30 s apart
  let msgIndex = 0;

  for (const section of sections) {
    const trimmed = section.trim();

    let role: "user" | "assistant" | null = null;
    let contentStart = 0;

    if (/^###\s+User/.test(trimmed)) {
      role = "user";
      // Content starts after the heading line
      contentStart = trimmed.indexOf("\n") + 1;
    } else if (/^###\s+Assistant/.test(trimmed)) {
      role = "assistant";
      contentStart = trimmed.indexOf("\n") + 1;
    } else {
      // Header or other non-message section — skip
      continue;
    }

    let content = trimmed.slice(contentStart).trim();

    if (role === "assistant") {
      content = stripDetails(content);
    }

    if (!content) continue;

    messages.push({
      id: randomUUID(),
      role,
      content,
      createdAt: new Date(baseTime + msgIndex * 30_000).toISOString(),
    });
    msgIndex++;
  }

  return messages;
}

// ── Main ─────────────────────────────────────────────────────────────────────

const raw = readFileSync(MD_FILE, "utf-8");
const messages = parseMarkdown(raw);

console.log(`Parsed ${messages.length} messages (${messages.filter((m) => m.role === "user").length} user, ${messages.filter((m) => m.role === "assistant").length} assistant)`);

const db = new Database(DB_FILE);

// Ensure the trainer_chats table exists (it should already)
db.exec(`
  CREATE TABLE IF NOT EXISTS trainer_chats (
    id TEXT PRIMARY KEY,
    activity_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    messages TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_trainer_chats_user_activity
    ON trainer_chats(user_id, activity_id);
`);

const chatId = `${USER_ID}:${ACTIVITY_ID}`;
const messagesJson = JSON.stringify(messages);

const upsert = db.prepare(`
  INSERT INTO trainer_chats (id, activity_id, user_id, messages, updated_at)
  VALUES (?, ?, ?, ?, datetime('now'))
  ON CONFLICT(user_id, activity_id) DO UPDATE SET
    messages = excluded.messages,
    updated_at = datetime('now')
`);

upsert.run(chatId, ACTIVITY_ID, USER_ID, messagesJson);

console.log(`✓ Upserted coaching chat into trainer_chats`);
console.log(`  id          = ${chatId}`);
console.log(`  activity_id = ${ACTIVITY_ID}`);
console.log(`  user_id     = ${USER_ID}`);
console.log(`  messages    = ${messages.length}`);

db.close();
