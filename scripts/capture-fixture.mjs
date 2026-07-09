import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const url = process.argv[2];
const outPath = process.argv[3];
if (!url || !outPath) {
  console.error("Usage: node scripts/capture-fixture.mjs <url> <outPath>");
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
});
await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });
await page.waitForTimeout(10000);
const html = await page.content();
writeFileSync(outPath, html, "utf-8");
console.log(`Saved ${html.length} bytes to ${outPath}`);
await browser.close();
