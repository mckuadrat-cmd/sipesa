import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const template = read("src/app/components/template-management.tsx");
const modal = read("src/app/components/AppModal.tsx");
const header = read("src/app/components/header-nav.tsx");
const dashboard = read("src/app/components/dashboard-view.tsx");
const contacts = read("src/app/components/contact-list-view.tsx");
const history = read("src/app/components/broadcast-history.tsx");
const detail = read("src/app/components/broadcast-detail-view.tsx");
const chat = read("src/app/components/chat-interface.tsx");
const settings = read("src/app/components/settings-view.tsx");
const dialogFocus = read("src/app/hooks/use-dialog-focus.ts");

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("B8-014 template loading, empty, no-result, error, stale, reset, and usage scope are distinct", () => {
  assert.match(template, /Template belum dapat dimuat/);
  assert.match(template, /Belum ada template WhatsApp/);
  assert.match(template, /Tidak ada template yang cocok/);
  assert.match(template, /Data terakhir ditampilkan\. Gagal memperbarui template/);
  assert.match(template, /Reset pencarian dan filter/);
  assert.match(template, /Terkirim \(50 broadcast terbaru\)/);
  assert.match(template, /Jumlah terkirim dari maksimal 50 broadcast terbaru/);
});

test("B8-015 template submit and delete require named, mutation-locked confirmations", () => {
  assert.match(template, /Kirim template <strong[^>]*>\{templateToSubmit\?\.name\}<\/strong> untuk ditinjau Meta/);
  assert.match(template, /Ya, Kirim untuk Ditinjau/);
  assert.match(template, /tidak menjamin template akan disetujui/);
  assert.match(template, /Hapus template <strong>\{templateToDelete\?\.name/);
  assert.match(template, /Hapus Template/);
  assert.match(template, /closeDisabled=\{deletingTemplate\}/);
  assert.match(template, /closeDisabled=\{pushingId !== null\}/);
  assert.match(template, /if \(!templateIdToDelete \|\| deletingTemplate\) return/);
  assert.match(template, /if \(pushingId\) return/);
});

test("B8-021 shared modal exposes dialog semantics, focus lifecycle, Escape, and mutation lock", () => {
  assert.match(modal, /role="dialog"/);
  assert.match(modal, /aria-modal="true"/);
  assert.match(modal, /aria-labelledby=\{title \? titleId/);
  assert.match(modal, /aria-describedby=\{description \? descriptionId/);
  assert.match(modal, /aria-label="Tutup dialog"/);
  assert.match(modal, /event\.key === "Escape"/);
  assert.match(modal, /event\.key !== "Tab"/);
  assert.match(modal, /previouslyFocused\?\.focus\(\)/);
  assert.match(modal, /disabled=\{closeDisabled\}/);
  assert.match(dialogFocus, /event\.key === "Escape"/);
  assert.match(dialogFocus, /event\.key !== "Tab"/);
  assert.match(dialogFocus, /previouslyFocused\?\.focus\(\)/);
  for (const source of [template, contacts, settings, chat]) {
    assert.match(source, /role="dialog"/);
    assert.match(source, /aria-modal="true"/);
    assert.match(source, /aria-labelledby=/);
    assert.match(source, /useDialogFocus/);
  }
});

test("B8-024 campaign and message status presentation is localized without changing internal values", () => {
  for (const label of ["Menunggu", "Sedang Dikirim", "Selesai", "Dibatalkan", "Gagal", "Dijeda"]) {
    assert.match(history + detail, new RegExp(label));
  }
  for (const label of ["Mengirim", "Terkirim", "Diterima", "Dibaca", "Gagal"]) {
    assert.match(chat + detail, new RegExp(label));
  }
  assert.match(history, /Nomor Pengirim/);
  assert.match(history, /Penerima/);
  assert.doesNotMatch(history, />All Status</);
  assert.doesNotMatch(history, />All Sender</);
});

test("B8-025 navigation exposes active state, controlled mobile nav, and preserves role visibility", () => {
  assert.match(header, /aria-current=\{isActive \? "page" : undefined\}/);
  assert.match(header, /aria-controls="mobile-primary-navigation"/);
  assert.match(header, /aria-expanded=\{showMobileMenu\}/);
  assert.match(header, /id="mobile-primary-navigation"/);
  assert.match(header, /isSuperadmin/);
  assert.match(header, /onLogout/);
  assert.match(detail, /Kembali ke Riwayat Broadcast/);
});

test("B8-026 changed icon, search, filter, pagination, and form controls have accessible names", () => {
  assert.match(contacts, /aria-label="Cari kontak"/);
  assert.match(contacts, /aria-label="Filter kontak berdasarkan label"/);
  assert.match(contacts, /aria-label=\{`Edit kontak \$\{contact\.name\}`\}/);
  assert.match(contacts, /aria-label=\{`Hapus kontak \$\{contact\.name\}`\}/);
  assert.match(history, /aria-label="Cari riwayat broadcast"/);
  assert.match(history, /aria-label="Filter status broadcast"/);
  assert.match(history, /aria-label="Halaman riwayat sebelumnya"/);
  assert.match(detail, /aria-label="Cari penerima broadcast"/);
  assert.match(detail, /role="button"/);
  assert.match(detail, /onKeyDown=/);
  assert.match(chat, /aria-label="Perbarui pesan"/);
});

test("B8-027 contacts preserve stale rows and distinguish initial error, empty, and search no-result", () => {
  assert.match(contacts, /Kontak belum dapat dimuat/);
  assert.match(contacts, /Data terakhir ditampilkan\. Gagal memperbarui kontak/);
  assert.match(contacts, /Tidak ada kontak yang cocok/);
  assert.match(contacts, /Belum ada kontak/);
  assert.match(contacts, /Reset Pencarian dan Filter/);
  assert.match(contacts, /Coba Lagi/);
});

test("B8-028 dashboard static cards do not expose false card-level click affordance", () => {
  assert.doesNotMatch(dashboard, /hover:-translate-y-1/);
  assert.doesNotMatch(dashboard, /hover:scale-105/);
  assert.doesNotMatch(dashboard, /group-hover:scale/);
  assert.match(dashboard, /Data terakhir ditampilkan\. Gagal memperbarui/);
  assert.match(dashboard, /Total Penerima/);
});

test("B8-029 realtime remains bounded and media has safe loading, retry, and accessible actions", () => {
  assert.match(chat, /intervalMs: 30_000/);
  assert.doesNotMatch(chat, /intervalMs:\s*1_?000/);
  assert.match(chat, /new Map\(current\.map/);
  assert.match(chat, /MESSAGE_STATUS_RANK/);
  assert.match(chat, /return incomingRank >= existingRank/);
  assert.match(chat, /Memuat media/);
  assert.match(chat, /Coba muat dokumen lagi/);
  assert.match(chat, /aria-label=\{`Buka atau unduh dokumen/);
  assert.match(chat, /api\.getMediaObjectUrl/);
  assert.match(chat, /URL\.revokeObjectURL/);
  assert.doesNotMatch(chat, /service_role|service-role/i);
});

test("B8-030 changed layouts retain bounded mobile modals, wrapping, and horizontal table access", () => {
  assert.match(modal, /p-2 sm:p-4 overflow-y-auto/);
  assert.match(contacts, /max-h-\[calc\(100dvh-2rem\)\] overflow-y-auto/);
  assert.match(settings, /max-h-\[calc\(100dvh-3rem\)\]/);
  assert.match(template, /max-h-\[90vh\] overflow-hidden/);
  assert.match(history, /flex flex-col gap-4 lg:flex-row/);
  assert.match(history, /overflow-auto max-h-\[60vh\]/);
  assert.match(detail, /overflow-x-auto/);
  assert.match(header, /left-4 right-4/);
});

test("performance safety preserves bounded refresh and avoids new fetch-all or one-second polling", () => {
  const changedUi = [template, dashboard, contacts, history, detail, chat].join("\n");
  assert.doesNotMatch(chat, /setInterval\([\s\S]{0,200},\s*1000\s*\)/);
  assert.match(history, /const pollInterval = isSubscribed \? 20 : 5/);
  assert.doesNotMatch(changedUi, /while\s*\([^)]*hasNext|for\s*\([^)]*totalPages/i);
  assert.match(chat, /active conversation|selectedContact/i);
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

console.log(`Batch 8B Final UI\/UX Polish regression: ${passed}\/${tests.length} PASS`);
