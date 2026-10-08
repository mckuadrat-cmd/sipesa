import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.TZ = "Asia/Jakarta";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helperPath = path.join(root, "src/app/lib/scheduled-at.ts");
const helperSource = fs.readFileSync(helperPath, "utf8");
const broadcastUi = fs.readFileSync(path.join(root, "src/app/components/broadcast-view.tsx"), "utf8");
const apiSource = fs.readFileSync(path.join(root, "src/app/lib/api.ts"), "utf8");
const { formatLocalScheduledAt } = await import(`../src/app/lib/scheduled-at.ts?test=${Date.now()}`);

const scheduledAt = formatLocalScheduledAt("2026-10-06", "10:25");
assert.equal(scheduledAt, "2026-10-06T10:25:00+07:00");
assert.match(scheduledAt, /(?:Z|[+-]\d{2}:\d{2})$/);
assert.notEqual(scheduledAt, "2026-10-06T10:25:00");
assert.equal(Date.parse(scheduledAt), Date.UTC(2026, 9, 6, 3, 25, 0));

// Immediate broadcasts keep their existing null schedule contract.
assert.equal(formatLocalScheduledAt("", ""), null);

// The implementation derives the offset from the browser runtime rather than
// embedding a region-specific value.
assert.doesNotMatch(helperSource, /["'`]\+07:00["'`]/);
assert.match(helperSource, /getTimezoneOffset\(\)/);
assert.match(broadcastUi, /let scheduledAt: string \| null = null;[\s\S]*if \(scheduleEnabled[\s\S]*formatLocalScheduledAt/);
assert.match(broadcastUi, /scheduled: scheduledAt/);
assert.match(apiSource, /scheduledAt: payload\.scheduled \|\| null/);

console.log("PASS - Asia/Jakarta local wall time retains 10:25 with explicit +07:00 offset");
console.log("PASS - timezone-less scheduled payload is not emitted");
console.log("PASS - immediate broadcast remains scheduledAt=null");
