# Code Review — `5e62425` feat: trainer-authored zone overrides + profile changelog + cross-tab invalidation

Two-axis review of the diff between `HEAD~1` (`4690503`) and `HEAD` (`5e62425`).
Spec source: the commit message itself (user-directed, no issue/spec/ADR found).
Standards sources: `AGENTS.md` + the fixed smell baseline.

## Standards

### Documented-standard violations (hard)
- `apps/server/src/lib/tools/setZones.ts:142-155` & `apps/server/src/routes/me.ts:123-133` — AGENTS.md: Maintainability (duplicate logic across files) — the `diff.powerZones/diff.hrZones = {old:before,new:after}` + `profileChangesRepo.append(..., diff)` block is copy-pasted between the `set_zones` tool and `PUT /me/zones`. Same for reset: `setZones.ts:219-226` ≈ `me.ts:152-159`. Extract a `buildZoneDiff(before, after, hasPower, hasHr)` helper into `profileChanges.ts`.
- `apps/server/src/lib/tools/setZones.ts:157-174` — AGENTS.md: Maintainability — `setZonesHandler` re-fetches profile+estimates, calls `resolveZones` + `applyZoneOverrides` inline, duplicating `buildUserZones` (`zonesService.ts:88`). `resetZonesHandler:228-233` does the same. Both should call `buildUserZones(userId, profile, athleteZonesRepo)`.
- `apps/web/src/components/ZoneOverrideSettings.tsx:297-300` — AGENTS.md: Maintainability / package roles — `ZoneDisplay` hand-rolls `${z.lower}+` / `${z.lower}–${z.upper}` instead of using `formatZoneRange` from `packages/shared/src/zones.ts`, which `renderSetZones.tsx:1` already imports. Cross-app duplicate of shared logic.

### Baseline smells (judgement calls)
- **Duplicated Code** — `apps/server/src/routes/me.ts:48-54` `normalizeZones` and `apps/server/src/lib/tools/setZones.ts:22-42` `coerceZones` both normalize `upper == null → Infinity`; the shared shape wants one helper in `packages/shared/src/zones.ts`.
- **Speculative Generality** — `apps/server/src/lib/tools/setZones.ts:24` — `coerceZones(raw, bands: readonly { name: string }[])` never reads `bands`; dead parameter, inline it.
- **Primitive Obsession** — `packages/shared/src/types.ts:498` — `ProfileChangeEntry.source: string` is really a closed set (`"manual" | "update_profile" | "set_zones" | "reset_zones"`); `ProfileChangelogCard.tsx:30-35` `sourceLabel` already assumes it.
- **Repeated Switches** — `apps/web/src/components/ProfileChangelogCard.tsx:30-35` — `sourceLabel` if-cascade on source strings that reappear as literals in `me.ts:133,159,319` and `setZones.ts:155,226`; a shared `ProfileChangeSource` union + label map in `packages/shared` would collapse both sites.
- **Data Clumps** — `apps/server/src/lib/zonesService.ts:28-31` — `{ ftp, maxHr }` travels as `ProfileRef` inline; the same pair re-appears in `setZones.ts:230-231` and `me.ts` profile reads. Small, but a hint the profile snapshot wants a named type.

### Verification
- `bun fmt`: pass (187 files, no fixes)
- `bun lint`: pass (187 files, no fixes)
- `bun typecheck`: pass (3/3 packages, turbo cached)
- tests: pass — `packages/shared/src/zones.test.ts` 6/6; `apps/server/src/lib/athleteZones.test.ts` + `profileChanges.test.ts` 14/14. No `test` script in `apps/server`/`apps/web` package.json, so only shared/server lib tests run.

## Spec

### Missing or partial
- None

### Scope creep
- None

### Implemented but wrong
- "ZonesCard shows 'Custom' badge when overrides are active" — `apps/web/src/components/ZonesCard.tsx:165-167` — Renders as inline text `" · Custom"` appended to the source label, not a distinct styled badge element. Contrast with `ZoneOverrideSettings.tsx:288-292` which renders a proper `<span>` badge. Functionally the "Custom" indicator shows, but the spec says "badge" and ZonesCard uses plain text. Minor presentation mismatch only.
- "Passing null clears that side" (PUT /me/zones route comment) — `apps/server/src/routes/me.ts:104-105` — `hasPower = body.powerZones !== undefined && body.powerZones !== null` treats `null` identically to `undefined` (leaves unchanged), contradicting the route's own comment at line 93 ("Passing null clears that side"). The UI never sends `null` so it's unexercised, and the spec doesn't require null-clearing, but the code contradicts its own documented contract.

## Summary

- **Standards:** 3 hard + 5 judgement. Worst hard violation: duplicated zone-diff / `buildUserZones` logic across `setZones.ts` and `me.ts` — extract `buildZoneDiff` and reuse `buildUserZones`.
- **Spec:** 0 missing, 0 scope creep, 2 implemented-but-wrong. Worst: self-contradicting `null`-handling contract in `PUT /me/zones` (`me.ts:104-105` vs its own comment at line 93).
- `bun fmt` / `lint` / `typecheck` and tests all pass.