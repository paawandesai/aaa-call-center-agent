// Manual check of the staff screens against a local server: makes two policy handoffs (no model call), then
// screenshots each staff page at desktop and phone width and runs axe. Saves to $SHOTS.
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const base = process.env.BASE ?? "http://localhost:3100";
const shots = process.env.SHOTS ?? ".";
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });
const login = async (code, w = 1280) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(base + "/");
  await page.fill("#code", code);
  await page.check("input[type=checkbox]");
  await page.click("button[type=submit]");
  await page.waitForURL(/\/(chat|staff)/);
  return page;
};
const caller = await login(process.env.CODE ?? "demo-invite-1");
for (const t of ["I want to talk to a real person", "there's a burning smell coming from the vents"]) {
  await caller.fill("#msg", t);
  await caller.keyboard.press("Enter");
  await caller.waitForSelector("button:has-text('Send')", { timeout: 60000 });
}
for (const w of [1280, 390]) {
  const page = await login(process.env.STAFF ?? "demo-staff-1", w);
  for (const p of ["/staff/handoffs", "/staff/dashboard", "/staff/review", "/evaluation"]) {
    await page.goto(base + p);
    if (p === "/staff/handoffs" && w === 1280) {
      await page.click("button:has-text('Flag: assistant could have answered')");
      await page.waitForSelector("text=Flagged");
    }
    const axe = (await new AxeBuilder({ page }).analyze()).violations.map((v) => `${v.id}(${v.nodes.length})`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    console.log(w, p, "axe:", axe, "overflow:", overflow);
    await page.screenshot({ path: `${shots}/${p.split("/").pop()}_${w}.png`, fullPage: true });
  }
}
await browser.close();
