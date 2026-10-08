import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const baseUrl = (process.argv[2] || "http://127.0.0.1:4173").replace(/\/$/, "");
const chromeCandidates = [
  process.env.CHROME_PATH,
  path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
  path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
].filter(Boolean);
const chrome = chromeCandidates.find((candidate) => fs.existsSync(candidate));
assert.ok(chrome, "Chrome executable is required");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sipesa-batch10-"));
const chromeProcess = spawn(chrome, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--remote-debugging-port=0", "--user-data-dir=" + tempRoot, "about:blank",
], { stdio: "ignore" });

async function readPort() {
  const file = path.join(tempRoot, "DevToolsActivePort");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (fs.existsSync(file)) {
      const port = Number(fs.readFileSync(file, "utf8").trim().split(/\r?\n/)[0]);
      if (port) return port;
    }
    await delay(100);
  }
  throw new Error("Chrome DevTools port was not created");
}

class CdpClient {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.ws = new WebSocket(url);
  }
  async open() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { this.ws.close(); }
}

let client;
try {
  const port = await readPort();
  const response = await fetch("http://127.0.0.1:" + port + "/json/new?" + encodeURIComponent(baseUrl), { method: "PUT" });
  assert.equal(response.ok, true, "Chrome target creation failed");
  const target = await response.json();
  client = new CdpClient(target.webSocketDebuggerUrl);
  await client.open();
  await client.send("Page.enable");
  await client.send("Runtime.enable");

  const routes = [["Landing", baseUrl + "/#/landing"], ["Login", baseUrl + "/#/login"]];
  const widths = [375, 390, 430, 768, 1024, 1280];
  const expression = "(" + (() => {
    const doc = document.documentElement;
    const body = document.body;
    const viewport = window.innerWidth;
    const scrollWidth = Math.max(doc.scrollWidth, body ? body.scrollWidth : 0);
    const elements = [...document.querySelectorAll("header, h1, form, input, button, a, img")];
    const offenders = elements.filter((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0 && (rect.left < -0.5 || rect.right > viewport + 0.5);
    }).map((element) => {
      const rect = element.getBoundingClientRect();
      return { tag: element.tagName, text: (element.textContent || element.getAttribute("alt") || "").trim().slice(0, 70), left: rect.left, right: rect.right };
    });
    return { href: location.href, viewport, clientWidth: doc.clientWidth, scrollWidth, offenders };
  }).toString() + ")()";

  for (const [name, url] of routes) {
    for (const width of widths) {
      await client.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: true, screenWidth: width, screenHeight: 900 });
      await client.send("Page.navigate", { url });
      await delay(1200);
      const evaluated = await client.send("Runtime.evaluate", { returnByValue: true, expression });
      const metrics = evaluated.result.value;
      assert.equal(metrics.viewport, width, name + " " + width + ": viewport mismatch");
      assert.ok(metrics.scrollWidth <= metrics.clientWidth, name + " " + width + ": horizontal overflow " + metrics.scrollWidth + " > " + metrics.clientWidth);
      assert.deepEqual(metrics.offenders, [], name + " " + width + ": visible content exceeds viewport");
      console.log("PASS browser " + name + " " + width + "px: scrollWidth=" + metrics.scrollWidth + ", clientWidth=" + metrics.clientWidth);
    }
  }
} finally {
  if (client) client.close();
  chromeProcess.kill();
  await delay(250);
  const resolvedTemp = path.resolve(tempRoot);
  const systemTemp = path.resolve(os.tmpdir());
  if (resolvedTemp.startsWith(systemTemp + path.sep) && path.basename(resolvedTemp).startsWith("sipesa-batch10-")) {
    fs.rmSync(resolvedTemp, { recursive: true, force: true });
  }
}
