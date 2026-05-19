/**
 * Sets up a freshly cloned git worktree by installing dependencies and
 * copying the data folder and env file from the original repository.
 *
 * Run this script from inside the already-created worktree directory.
 *
 * Usage:
 *   bun run scripts/setup-worktree.ts
 */

import { $ } from "bun";
import { existsSync, mkdirSync, cpSync } from "node:fs";
import { resolve, dirname } from "node:path";

const worktreePath = process.cwd();

const mainRepo = await $`git rev-parse --path-format=absolute --git-common-dir`
    .cwd(worktreePath)
    .quiet()
    .text();

const mainRepoPath = resolve(mainRepo.trim(), "..");

if (mainRepoPath === worktreePath) {
    console.log("Already in the main repository, nothing to do.");
    process.exit(0);
}

const dataSrc = resolve(mainRepoPath, "apps/server/data");
const envSrc = resolve(mainRepoPath, "apps/server/.env");

const dataDst = resolve(worktreePath, "apps/server/data");
const envDst = resolve(worktreePath, "apps/server/.env");

console.log("Installing dependencies...");
await $`bun i`.cwd(worktreePath);

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

console.log("Done!");
