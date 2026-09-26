import { Database } from "bun:sqlite";
import { env } from "./env.js";

const DB_PATH = env.DB_PATH;
const DB_PATH_ABS = Bun.fileURLToPath(
	new URL(DB_PATH, Bun.pathToFileURL(`${process.cwd()}/`)),
);
const DB_DIRECTORY_URL = new URL(".", Bun.pathToFileURL(DB_PATH_ABS));
const DB_DIRECTORY_SENTINEL_URL = new URL(
	".db-directory-ready",
	DB_DIRECTORY_URL,
);

// Ensure the data directory exists using Bun's file API.
await Bun.write(DB_DIRECTORY_SENTINEL_URL, "");
await Bun.file(DB_DIRECTORY_SENTINEL_URL).delete();

const db = new Database(DB_PATH_ABS);

// Enable WAL mode for better concurrent read performance
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

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
`);

// Migrations: add columns for existing databases
const migrations = [
	`ALTER TABLE activities ADD COLUMN intervals TEXT NOT NULL DEFAULT '[]'`,
	`ALTER TABLE activities ADD COLUMN interval_minutes TEXT NOT NULL DEFAULT ''`,
	`ALTER TABLE activities ADD COLUMN custom_ranges TEXT NOT NULL DEFAULT '[]'`,
	`ALTER TABLE activities ADD COLUMN user_id TEXT NOT NULL DEFAULT ''`,
];

for (const migration of migrations) {
	try {
		db.exec(migration);
	} catch {
		// Column already exists — ignore
	}
}

// Create index for user_id after migrations (idempotent)
db.exec(
	"CREATE INDEX IF NOT EXISTS idx_activities_user_id ON activities(user_id)",
);
db.exec(
	"CREATE INDEX IF NOT EXISTS idx_activities_user_date ON activities(user_id, date)",
);

// Trainer chat history tables
db.exec(`
  CREATE TABLE IF NOT EXISTS trainer_chats (
    id TEXT PRIMARY KEY,
    activity_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS trainer_messages (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL REFERENCES trainer_chats(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_trainer_messages_chat_id
    ON trainer_messages(chat_id);
  CREATE INDEX IF NOT EXISTS idx_trainer_messages_chat_created
    ON trainer_messages(chat_id, created_at, id);
`);

// One-time migration: move messages JSON blob → trainer_messages rows
try {
	interface LegacyChat {
		id: string;
		messages: string;
	}
	const legacyChats = db
		.prepare(
			`SELECT id, messages FROM trainer_chats WHERE messages IS NOT NULL AND messages != '[]'`,
		)
		.all() as LegacyChat[];

	if (legacyChats.length > 0) {
		const countStmt = db.prepare(
			"SELECT COUNT(*) as c FROM trainer_messages WHERE chat_id = ?",
		);
		const insertStmt = db.prepare(
			`INSERT OR IGNORE INTO trainer_messages (id, chat_id, role, content, created_at)
       VALUES (?, ?, ?, ?, ?)`,
		);

		db.transaction(() => {
			for (const chat of legacyChats) {
				const { c } = countStmt.get(chat.id) as { c: number };
				if (c > 0) continue; // already migrated

				const msgs = JSON.parse(chat.messages) as Array<{
					id: string;
					role: string;
					content: string;
					createdAt: string;
				}>;
				for (const m of msgs) {
					insertStmt.run(m.id, chat.id, m.role, m.content, m.createdAt);
				}
			}
		})();

		console.log(
			`[db] Migrated messages from ${legacyChats.length} chat(s) to trainer_messages`,
		);
	}
} catch {
	// messages column may not exist on a fresh DB — safe to ignore
}

// Migration: allow multiple threads per activity (drop unique index, re-add as non-unique)
try {
	db.exec("DROP INDEX IF EXISTS idx_trainer_chats_user_activity");
} catch {
	/* ignore */
}
db.exec(
	"CREATE INDEX IF NOT EXISTS idx_trainer_chats_user_activity ON trainer_chats(user_id, activity_id)",
);

// Migration: add name column to existing trainer_chats rows
try {
	db.exec(
		`ALTER TABLE trainer_chats ADD COLUMN name TEXT NOT NULL DEFAULT 'Thread 1'`,
	);
} catch {
	/* column already exists */
}

// Migration: add coach_model column to existing trainer_chats rows
try {
	db.exec("ALTER TABLE trainer_chats ADD COLUMN coach_model TEXT");
} catch {
	/* column already exists */
}

// Migration: add context_tokens column to trainer_chats (client-computed full context size)
try {
	db.exec("ALTER TABLE trainer_chats ADD COLUMN context_tokens INTEGER");
} catch {
	/* column already exists */
}

// Migration: add tool_calls column to trainer_messages
try {
	db.exec("ALTER TABLE trainer_messages ADD COLUMN tool_calls TEXT");
} catch {
	/* column already exists */
}

// Trainer chat attachments (ADR-0001): metadata row + image bytes in SQLite.
// `data` is a BLOB; referenced by trainer_messages via JSON ref lists.
db.exec(`
  CREATE TABLE IF NOT EXISTS trainer_attachments (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    kind       TEXT NOT NULL,
    name       TEXT NOT NULL,
    media_type TEXT NOT NULL,
    bytes      INTEGER NOT NULL,
    width      INTEGER NOT NULL,
    height     INTEGER NOT NULL,
    data       BLOB NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_trainer_attachments_user
    ON trainer_attachments(user_id);
`);

// Migration: add attachments column to trainer_messages (JSON array of
// TrainerAttachmentRef — ids only, never the bytes).
try {
	db.exec("ALTER TABLE trainer_messages ADD COLUMN attachments TEXT");
} catch {
	/* column already exists */
}

// OAuth2 CSRF state store — shared by Strava and Wahoo flows.
// Replaces the previous in-memory `pendingStates` Maps, which were lost on
// every server restart and aborted any user mid-OAuth. Persisting states in
// the db means a callback that lands after a redeploy still resolves.
db.exec(`
  CREATE TABLE IF NOT EXISTS oauth_states (
    state       TEXT PRIMARY KEY,
    provider    TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at  INTEGER NOT NULL
  )
`);
db.exec(
	"CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON oauth_states(expires_at)",
);

// Provider-scoped callback metadata (e.g. the browser-captured training
// timezone for the Google flow). Same TTL discipline as oauth_states.
db.exec(`
  CREATE TABLE IF NOT EXISTS oauth_state_meta (
    state      TEXT NOT NULL,
    key        TEXT NOT NULL,
    value      TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (state, key)
  )
`);

// Strava OAuth token storage
db.exec(`
  CREATE TABLE IF NOT EXISTS strava_tokens (
    user_id       TEXT PRIMARY KEY,
    access_token  TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at    INTEGER NOT NULL,
    athlete_id    INTEGER NOT NULL,
    scope         TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// Wahoo OAuth token storage
db.exec(`
  CREATE TABLE IF NOT EXISTS wahoo_tokens (
    user_id        TEXT PRIMARY KEY,
    access_token   TEXT NOT NULL,
    refresh_token  TEXT NOT NULL,
    expires_at     INTEGER NOT NULL,
    wahoo_user_id  INTEGER,
    scope          TEXT NOT NULL DEFAULT '',
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// Google OAuth token storage for the training calendar. calendar_id / tz are
// denormalized here so calendar status only ever touches this table.
db.exec(`
  CREATE TABLE IF NOT EXISTS google_tokens (
    user_id        TEXT PRIMARY KEY,
    access_token   TEXT NOT NULL,
    refresh_token  TEXT NOT NULL,
    expires_at     INTEGER NOT NULL,
    scope          TEXT NOT NULL DEFAULT '',
    calendar_id    TEXT,
    tz             TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// User settings
db.exec(`
  CREATE TABLE IF NOT EXISTS user_settings (
    user_id TEXT PRIMARY KEY,
    waxed_chain_reminders_enabled INTEGER NOT NULL DEFAULT 0,
    waxed_chain_reminder_km INTEGER NOT NULL DEFAULT 300,
    waxed_chain_ntfy_topic TEXT NOT NULL DEFAULT '',
    waxed_chain_accumulated_km REAL NOT NULL DEFAULT 0,
    waxed_chain_last_notified_at TEXT,
    coach_model TEXT NOT NULL DEFAULT 'moonshotai/kimi-k2.6',
    favorite_models TEXT NOT NULL DEFAULT '[]',
    ntfy_topic TEXT NOT NULL DEFAULT '',
    plan_refresh_enabled INTEGER NOT NULL DEFAULT 0,
    plan_refresh_week TEXT,
    plan_refresh_at TEXT,
    plan_refresh_status TEXT,
    plan_refresh_error TEXT,
    plan_refresh_attempts INTEGER NOT NULL DEFAULT 0,
    plan_refresh_attempt_week TEXT
  )
`);

// Migration: add coach_model to existing user_settings rows
try {
	db.exec(
		`ALTER TABLE user_settings ADD COLUMN coach_model TEXT NOT NULL DEFAULT 'moonshotai/kimi-k2.6'`,
	);
} catch {
	/* column already exists */
}

// Migration: add favorite_models to existing user_settings rows
try {
	db.exec(
		`ALTER TABLE user_settings ADD COLUMN favorite_models TEXT NOT NULL DEFAULT '[]'`,
	);
} catch {
	/* column already exists */
}

// Migration: add the shared notification topic. ntfy_topic supersedes the
// waxed-chain-scoped column so one topic serves every notification; the
// waxed-chain module seeds it from the legacy column on first read.
try {
	db.exec(
		"ALTER TABLE user_settings ADD COLUMN ntfy_topic TEXT NOT NULL DEFAULT ''",
	);
} catch {
	/* column already exists */
}
try {
	db.exec(
		"INSERT INTO user_settings (user_id, ntfy_topic) SELECT user_id, waxed_chain_ntfy_topic FROM user_settings WHERE waxed_chain_ntfy_topic != '' ON CONFLICT(user_id) DO UPDATE SET ntfy_topic = excluded.ntfy_topic WHERE user_settings.ntfy_topic = ''",
	);
} catch {
	/* legacy column may not exist on a fresh DB */
}

// Migration: add Weekly Plan refresh state to user_settings. The watermark
// (plan_refresh_week/at) makes Plan refresh idempotent; it records when a
// refresh happened, never what the plan contains (see ADR-0003).
try {
	db.exec(
		"ALTER TABLE user_settings ADD COLUMN plan_refresh_enabled INTEGER NOT NULL DEFAULT 0",
	);
} catch {
	/* column already exists */
}
try {
	db.exec("ALTER TABLE user_settings ADD COLUMN plan_refresh_week TEXT");
} catch {
	/* column already exists */
}
try {
	db.exec("ALTER TABLE user_settings ADD COLUMN plan_refresh_at TEXT");
} catch {
	/* column already exists */
}
try {
	db.exec("ALTER TABLE user_settings ADD COLUMN plan_refresh_status TEXT");
} catch {
	/* column already exists */
}
try {
	db.exec("ALTER TABLE user_settings ADD COLUMN plan_refresh_error TEXT");
} catch {
	/* column already exists */
}
// Retry accounting for the current due Plan week: attempts reset when the
// attempt week differs from the week being refreshed. Capped so a persistent
// failure notifies once instead of retrying every tick forever.
try {
	db.exec(
		"ALTER TABLE user_settings ADD COLUMN plan_refresh_attempts INTEGER NOT NULL DEFAULT 0",
	);
} catch {
	/* column already exists */
}
try {
	db.exec(
		"ALTER TABLE user_settings ADD COLUMN plan_refresh_attempt_week TEXT",
	);
} catch {
	/* column already exists */
}

// Migration: add analysis column to activities
// (nullable TEXT, stores markdown ride report)
try {
	db.exec("ALTER TABLE activities ADD COLUMN analysis TEXT");
} catch {
	/* column already exists */
}

// Migration: add analysis_tool_calls column to activities
// (nullable TEXT, stores JSON array of UIToolCall for the generated analysis)
try {
	db.exec("ALTER TABLE activities ADD COLUMN analysis_tool_calls TEXT");
} catch {
	/* column already exists */
}

// Migration: add strava_activity_id to activities for duplicate prevention
try {
	db.exec("ALTER TABLE activities ADD COLUMN strava_activity_id TEXT");
} catch {
	/* column already exists */
}
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_activities_strava_id
    ON activities(user_id, strava_activity_id)
    WHERE strava_activity_id IS NOT NULL
`);

// Migration: add wahoo_activity_id to activities for duplicate prevention
try {
	db.exec("ALTER TABLE activities ADD COLUMN wahoo_activity_id TEXT");
} catch {
	/* column already exists */
}
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_activities_wahoo_id
    ON activities(user_id, wahoo_activity_id)
    WHERE wahoo_activity_id IS NOT NULL
`);

// Migration: add webhook_enabled to wahoo_tokens so the UI can show the
// current webhook registration state without a live Wahoo API call (the
// GET /v1/user response does not include webhook_* fields).
try {
	db.exec(
		"ALTER TABLE wahoo_tokens ADD COLUMN webhook_enabled INTEGER NOT NULL DEFAULT 0",
	);
} catch {
	/* column already exists */
}

// Migration: add ow_user_id to user_settings
try {
	db.exec("ALTER TABLE user_settings ADD COLUMN ow_user_id TEXT");
} catch {
	/* column already exists */
}

// Migration: add compare-mode settings to user_settings
try {
	db.exec(
		"ALTER TABLE user_settings ADD COLUMN compare_thread_ids TEXT NOT NULL DEFAULT '[]'",
	);
} catch {
	/* column already exists */
}
try {
	db.exec(
		"ALTER TABLE user_settings ADD COLUMN compare_enabled INTEGER NOT NULL DEFAULT 0",
	);
} catch {
	/* column already exists */
}

// Migration: add Health Auto Export settings to user_settings
try {
	db.exec("ALTER TABLE user_settings ADD COLUMN hae_api_token TEXT");
} catch {
	/* column already exists */
}
try {
	db.exec(
		"ALTER TABLE user_settings ADD COLUMN health_source TEXT NOT NULL DEFAULT 'openwearables'",
	);
} catch {
	/* column already exists */
}
try {
	db.exec("ALTER TABLE user_settings ADD COLUMN hae_last_sync_at TEXT");
} catch {
	/* column already exists */
}
try {
	db.exec("ALTER TABLE user_settings ADD COLUMN ow_last_sync_at TEXT");
} catch {
	/* column already exists */
}

// Migration: add athlete profile columns to user_settings
try {
	db.exec("ALTER TABLE user_settings ADD COLUMN athlete_ftp INTEGER");
} catch {
	/* column already exists */
}
try {
	db.exec("ALTER TABLE user_settings ADD COLUMN athlete_max_hr INTEGER");
} catch {
	/* column already exists */
}
try {
	db.exec("ALTER TABLE user_settings ADD COLUMN athlete_goal_event_date TEXT");
} catch {
	/* column already exists */
}
try {
	db.exec("ALTER TABLE user_settings ADD COLUMN athlete_goal_event_name TEXT");
} catch {
	/* column already exists */
}
try {
	db.exec("ALTER TABLE user_settings ADD COLUMN athlete_goal_description TEXT");
} catch {
	/* column already exists */
}
try {
	db.exec("ALTER TABLE user_settings ADD COLUMN athlete_weekly_hours REAL");
} catch {
	/* column already exists */
}
try {
	db.exec(
		"ALTER TABLE user_settings ADD COLUMN athlete_focus_areas TEXT NOT NULL DEFAULT '[]'",
	);
} catch {
	/* column already exists */
}
try {
	db.exec("ALTER TABLE user_settings ADD COLUMN athlete_location TEXT");
} catch {
	/* column already exists */
}

// Health Auto Export historical data table
db.exec(`
  CREATE TABLE IF NOT EXISTS hae_health_history (
    user_id TEXT NOT NULL,
    date TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, date)
  )
`);
db.exec(
	"CREATE INDEX IF NOT EXISTS idx_hae_health_user_date ON hae_health_history(user_id, date)",
);

// Shared per-source daily health-snapshot history. Existing HAE rows are
// migrated in with source = 'health_auto_export'; OpenWearables polls write
// their own snapshots under source = 'openwearables'.
db.exec(`
  CREATE TABLE IF NOT EXISTS health_daily_history (
    user_id TEXT NOT NULL,
    source TEXT NOT NULL,
    date TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, source, date)
  )
`);
db.exec(
	"CREATE INDEX IF NOT EXISTS idx_health_daily_user_source_date ON health_daily_history(user_id, source, date)",
);
try {
	db.exec(`
    INSERT INTO health_daily_history (user_id, source, date, data, updated_at)
    SELECT user_id, 'health_auto_export', date, data, updated_at
    FROM hae_health_history
    WHERE true
    ON CONFLICT(user_id, source, date) DO NOTHING
  `);
} catch {
	/* migration already applied */
}

// Athlete zone overrides — per-user custom zone boundaries that replace the
// derived (FTP / max HR) defaults. Stored as JSON arrays of ZoneRange
// aligned by index to POWER_ZONE_BANDS / HR_ZONE_BANDS. NULL = use derived.
db.exec(`
  CREATE TABLE IF NOT EXISTS athlete_zones (
    user_id                  TEXT PRIMARY KEY,
    power_zones_override     TEXT,
    hr_zones_override        TEXT,
    updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// Profile changelog — append-only audit of athlete profile and zone changes.
// One row per logical update event (e.g. one update_profile tool call).
// `changes` is a JSON diff keyed by field name with {old,new} entries.
db.exec(`
  CREATE TABLE IF NOT EXISTS profile_changes (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    source      TEXT NOT NULL,
    changes     TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
db.exec(
	"CREATE INDEX IF NOT EXISTS idx_profile_changes_user_created ON profile_changes(user_id, created_at DESC, id)",
);

export { db };
