/**
 * Creates a new git worktree, installs dependencies, and copies over the
 * data folder and env file so the new workspace is ready to run.
 *
 * Usage:
 *   bun run scripts/setup-worktree.ts <branch-name> [path]
 *
 * Arguments:
 *   branch-name    Name of the new branch to create in the worktree
 *   path           Optional path for the worktree (default: ../fit-analyzer-<branch>)
 *
 * Example:
 *   bun run scripts/setup-worktree.ts feat/new-feature
 *   bun run scripts/setup-worktree.ts feat/new-feature /tmp/my-worktree
 */

import { $ } from "bun";
import { existsSync, mkdirSync, cpSync } from "node:fs";
import { resolve, dirname } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..");

const branch = process.argv[2];
if (!branch) {
	console.error(
		"Usage: bun run scripts/setup-worktree.ts <branch-name> [path]",
	);
	process.exit(1);
}

const worktreePath =
	process.argv[3] ?? resolve(REPO_ROOT, `../fit-analyzer-${branch}`);

if (existsSync(worktreePath)) {
	console.error(`Path already exists: ${worktreePath}`);
	process.exit(1);
}

const dataSrc = resolve(REPO_ROOT, "apps/server/data");
const envSrc = resolve(REPO_ROOT, "apps/server/.env");

const dataDst = resolve(worktreePath, "apps/server/data");
const envDst = resolve(worktreePath, "apps/server/.env");

async function run() {
	console.log(`Creating worktree at: ${worktreePath}`);
	await $`git worktree add -b ${branch} ${worktreePath}`.cwd(REPO_ROOT);

	console.log("Installing dependencies...");
	await $`bun install`.cwd(worktreePath);

	if (existsSync(dataSrc)) {
		console.log("Copying data folder...");
		mkdirSync(dirname(dataDst), { recursive: true });
		cpSync(dataSrc, dataDst, { recursive: true });
	} else {
		console.log("No data folder found, skipping.");
	}

	if (existsSync(envSrc)) {
		console.log("Copying env file...");
		cpSync(envSrc, envDst);
	} else {
		console.log("No env file found, skipping.");
	}

	console.log("Done! Worktree ready:");
	console.log(`  cd ${worktreePath}`);
	console.log("  bun dev");
}

run().catch((err) => {
	console.error(err.message);
	process.exit(1);
});
