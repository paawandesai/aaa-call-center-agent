// Manual check of verified account features against a server (real model): verify with a demo identity, ask for the
// balance, then cancel the upcoming visit through the confirm card. Screenshots go to $SHOTS.
import { chromium } from "@playwright/test";
const base = process.env.BASE ?? "http://localhost:3100";
const shots = process.env.SHOTS ?? ".";
const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });
const p = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
const errors = [];
p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await p.goto(base + "/");
await p.fill("#code", process.env.CODE ?? "demo-invite-1");
await p.check("input[type=checkbox]");
await p.click("button[type=submit]");
await p.waitForURL(/\/chat/);
const rail = await p.locator("text=Demo accounts to try").count();
const id = (await p.locator(".chat-rail .mono").first().textContent()).split(" · ");
console.log("demo accounts shown:", rail > 0, "using", id.join(" / "));
const say = async (text) => {
  await p.fill("#msg", text);
  await p.click("button[type=submit]");
  await p.waitForSelector("button[type=submit]:has-text('Send')", { timeout: 90_000 });
  const last = await p.locator(".msg .bubble").last().textContent();
  console.log("> " + text + "\n< " + last);
};
await say("What's my current balance?");
await say(`${id[0]}, ZIP ${id[1]}`);
await say("Thanks. I also need to cancel my upcoming appointment.");
const card = p.locator("text=Confirm cancellation");
if (await card.count()) {
  await card.first().click();
  await p.waitForSelector("text=✓ Cancelled", { timeout: 30_000 });
  console.log("cancelled card shown:", await p.locator("text=✓ Cancelled").count() === 1);
} else console.log("no cancellation card appeared");
await p.screenshot({ path: `${shots}/account_cancel.png`, fullPage: true });
console.log("console errors:", errors);
await b.close();
