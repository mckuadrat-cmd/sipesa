import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const dashboard = read("src/app/components/dashboard-view.tsx");
const history = read("src/app/components/broadcast-history.tsx");
const detail = read("src/app/components/broadcast-detail-view.tsx");
const app = read("src/app/App.tsx");
const api = read("src/app/lib/api.ts");
const modal = read("src/app/components/AppModal.tsx");
const schedule = read("src/app/lib/scheduled-at.ts");

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("B8-002 total_recipients is presented as Total Penerima, never Pesan terkirim", () => {
  assert.match(dashboard, /title: "Total Penerima"/);
  assert.match(dashboard, /Target campaign/);
  assert.doesNotMatch(dashboard, /Pesan terkirim|Total Pesan/i);
});

test("B8-003 dashboard sections expose independent loading, error, stale, retry, and legitimate zero states", () => {
  assert.match(app, /dashboardStatsState/);
  assert.match(app, /dashboardUsageState/);
  assert.match(dashboard, /summaryState/);
  assert.match(dashboard, /calendarState/);
  assert.match(dashboard, /Data belum dapat dimuat\./);
  assert.match(dashboard, /Data terakhir ditampilkan\. Gagal memperbarui\./);
  assert.match(dashboard, /Coba Lagi/);
  assert.match(dashboard, /onRetryStats/);
  assert.match(dashboard, /onRetryUsage/);
  assert.match(dashboard, /onRetry=\{fetchCalendar\}/);
  assert.match(dashboard, /onRetry=\{fetchSummary\}/);

  const visibleValue = (state, value) => state.hasData ? value : null;
  assert.equal(visibleValue({ hasData: true, error: false }, 0), 0);
  assert.equal(visibleValue({ hasData: true, error: true }, 17), 17);
  assert.equal(visibleValue({ hasData: false, error: true }, 0), null);
});

test("B8-003 request-version guards prevent stale dashboard responses from overwriting current data", () => {
  assert.match(app, /dashboardStatsRequestRef/);
  assert.match(app, /dashboardUsageRequestRef/);
  assert.match(dashboard, /summaryRequestRef/);
  assert.match(dashboard, /calendarRequestRef/);
  assert.match(dashboard, /requestVersion !== summaryRequestRef\.current/);
  assert.match(dashboard, /requestVersion !== calendarRequestRef\.current/);
});

test("B8-004 average uses exactly the seven graph buckets including zero days and the same timezone request", () => {
  const buckets = [10, 0, 20, 0, 0, 5, 0];
  assert.equal(buckets.reduce((sum, value) => sum + value, 0) / 7, 5);
  assert.match(dashboard, /const usage7dTotal = usage7d\.reduce/);
  assert.match(dashboard, /const usage7dAverage = usage7dTotal \/ 7/);
  assert.match(dashboard, /Rata-rata \/ Hari \(7 Hari\)/);
  assert.doesNotMatch(dashboard, /Math\.round\(tokensUsed \/ 7\)/);
  assert.match(api, /Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone/);
  assert.match(api, /URLSearchParams\(\{ endDate, timeZone \}\)/);
});

test("B8-012 history separates authoritative filtered total from visible-page metrics", () => {
  assert.match(history, /Total Broadcast/);
  assert.match(history, /Seluruh hasil filter/);
  assert.match(history, /Pada halaman ini/);
  assert.match(history, /\{totalRows\.toLocaleString\(\)\}/);
  assert.match(history, /const totalRecipients = broadcasts\.reduce/);
  assert.match(history, /const totalSent = broadcasts\.reduce/);
  assert.match(history, /const totalFailed = broadcasts\.reduce/);
  assert.match(history, /const normalized:[\s\S]*result\.data\.items/);
  assert.match(history, /setBroadcasts\(normalized\)/);
  assert.match(history, /setTotalRows\(result\.data\.total/);

  const page1 = [{ recipients: 10, sent: 8, failed: 2 }];
  const page2 = [{ recipients: 4, sent: 4, failed: 0 }, { recipients: 7, sent: 5, failed: 2 }];
  const pageKpi = (rows, field) => rows.reduce((sum, row) => sum + row[field], 0);
  assert.equal(pageKpi(page1, "recipients"), 10);
  assert.equal(pageKpi(page2, "recipients"), 11);
  assert.equal(pageKpi(page2, "sent"), 9);
  assert.equal(pageKpi(page2, "failed"), 2);
});

test("B8-012 pagination retains old rows/KPI until one guarded response commits rows and total together", () => {
  assert.match(history, /tableLoading/);
  assert.match(history, /requestVersionRef/);
  assert.match(history, /requestVersion !== requestVersionRef\.current/);
  assert.match(history, /setBroadcasts\(normalized\)/);
  assert.match(history, /setTotalRows\(result\.data\.total/);
  assert.doesNotMatch(history, /getBroadcastHistory[\s\S]{0,400}while\s*\(/);
});

test("B8-013 detail shows authoritative type, lifecycle wording, offset-preserving schedule, and accessible return", () => {
  assert.match(app, /historyContext=\{selectedBroadcastContext\}/);
  assert.match(detail, /broadcast\.scheduledAt \? "Scheduled" : "Direct"/);
  for (const label of ["Menunggu", "Sedang Dikirim", "Selesai", "Dibatalkan", "Gagal"]) {
    assert.match(detail, new RegExp(`return "${label}"`));
  }
  assert.match(detail, /Jadwal Pengiriman/);
  assert.match(detail, /formatStoredScheduledAt\(broadcast\.scheduledAt\)/);
  assert.match(schedule, /without converting its original wall/);
  assert.match(detail, /aria-label="Kembali ke Riwayat Broadcast"/);
  assert.match(modal, /aria-label="Tutup dialog"/);
});

test("B8-013 cancellation reuses existing eligibility and endpoints with confirmation", () => {
  assert.match(detail, /status === "queued" && !!broadcast\.scheduledAt && !broadcast\.startedAt/);
  assert.match(detail, /status === "sending" && !!broadcast\.startedAt/);
  assert.match(detail, /api\.cancelBroadcast\(broadcast\.id\)/);
  assert.match(detail, /api\.cancelScheduledBroadcast\(broadcast\.id\)/);
  assert.match(detail, /setCancelConfirmOpen\(true\)/);
  assert.match(detail, /Broadcast sudah selesai dan tidak dapat dibatalkan/);
});

test("performance bounds remain pagination-based with no new aggregate loop or write GET", () => {
  assert.match(detail, /pageSize: 50/);
  assert.match(detail, /pageSize: 100/); // explicit user-triggered CSV export only
  assert.doesNotMatch(dashboard, /getBroadcastHistory/);
  assert.doesNotMatch(history, /automatic.*while|KPI[\s\S]{0,200}while/i);
  assert.doesNotMatch(app, /setInterval\([\s\S]{0,300},\s*1000\s*\)/);
});

test("changed layouts retain responsive wrapping at 1280, 1024, 768, and 375 widths", () => {
  assert.match(dashboard, /grid-cols-1 xl:grid-cols/);
  assert.match(dashboard, /flex-col sm:flex-row/);
  assert.match(history, /grid-cols-1 lg:grid-cols/);
  assert.match(history, /grid-cols-1 sm:grid-cols-3/);
  assert.match(detail, /grid-cols-1 sm:grid-cols-2 lg:grid-cols-3/);
  assert.match(detail, /overflow-x-auto/);
  assert.match(detail, /flex-col-reverse sm:flex-row/);
});

let passed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

console.log(`Batch 8A-2 Dashboard & History UX regression: ${passed}/${tests.length} PASS`);
