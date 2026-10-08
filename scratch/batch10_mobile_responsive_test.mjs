import assert from "node:assert/strict";
import fs from "node:fs";

const landing = fs.readFileSync("src/app/components/landing-page-view.tsx", "utf8");
const login = fs.readFileSync("src/app/components/login-view.tsx", "utf8");

const checks = [
  [landing.includes("w-full max-w-full overflow-x-clip"), "Landing root bounds horizontal overflow"],
  [landing.includes("w-full min-w-0 px-3 sm:px-6"), "Landing header is shrinkable with mobile padding"],
  [landing.includes("grid min-w-0 lg:grid-cols-12"), "Landing hero grid permits child shrinking"],
  [landing.includes("grid min-w-0 grid-cols-1 min-[430px]:grid-cols-3"), "Landing KPI stacks below 430px"],
  [landing.includes("w-full sm:w-auto min-w-0"), "Landing calls to action fit narrow viewports"],
  [landing.includes("block w-full max-w-full h-full"), "Landing illustration is width-bounded"],
  [login.includes("min-h-[100dvh] w-full max-w-full overflow-x-clip overflow-y-auto"), "Login outer layout is viewport-bounded"],
  [login.includes("px-4 py-6 sm:p-6 md:p-8"), "Login uses safe mobile padding"],
  [login.includes("w-full min-w-0 max-w-full sm:max-w-md"), "Login cards use full mobile width and desktop maximum"],
  [login.includes("flex flex-wrap items-center justify-between"), "Forgot-password row can reflow"],
  [login.includes("w-full min-w-0 pl-10"), "Login inputs remain within the card"],
  [login.includes("flex flex-wrap items-center justify-center"), "Registration prompt can wrap"],
  [login.includes('aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}'), "Password visibility remains accessible"],
  [login.includes('aria-label={showConfirmPassword ? "Sembunyikan konfirmasi password" : "Tampilkan konfirmasi password"}'), "Confirm-password visibility is accessible"],
];

for (const [ok, message] of checks) assert.equal(ok, true, message);
console.log("PASS Batch 10 static responsive contract (" + checks.length + " checks)");
