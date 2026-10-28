/**
 * M1 visual verification (M1 follow-up): drive the REAL terminal against the
 * REAL backend and capture screenshots for comparison with the Figma design.
 *
 * Flow: open the terminal â†’ log in (dev demo account) â†’ add AAPL to Markets
 * â†’ select it (quotes stream into the chart) â†’ fill the order ticket â†’
 * submit a PAPER order (simulated broker; SIM_AUTO_FILL fills it) â†’ capture
 * desktop + mobile screenshots of the resulting terminal.
 *
 * Credentials are NEVER hardcoded: the trader password comes from the
 * TRADER_PASSWORD environment variable (dev-only demo credential provisioned
 * by the operator via AUTH_DEMO_TRADER_PASSWORD on the backend).
 *
 * Usage (from frontend/):
 *   TRADER_PASSWORD=... npm run visual:check [-- --url http://localhost:5173 --out ./output]
 *
 * Browser: uses the installed Google Chrome (channel "chrome") by default â€”
 * no browser download needed. Set PLAYWRIGHT_CHANNEL="" to use the bundled
 * Chromium instead (requires `npx playwright install chromium`).
 */

import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index !== -1 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

const url = argValue("--url", "http://localhost:5173");
const outDir = path.resolve(SCRIPT_DIR, argValue("--out", "./output"));
const username = process.env.TRADER_USER ?? "trader";
const password = process.env.TRADER_PASSWORD;

if (password === undefined || password === "") {
  console.error("TRADER_PASSWORD is required (dev-only demo credential; never commit it).");
  process.exit(1);
}

const channel = process.env.PLAYWRIGHT_CHANNEL !== undefined ? process.env.PLAYWRIGHT_CHANNEL : "chrome";
const headed = process.env.HEADED === "1";

const consoleErrors = [];

async function main() {
  await mkdir(outDir, { recursive: true });

  const launchOptions = { headless: !headed };
  if (channel !== "") launchOptions.channel = channel;

  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(`console: ${message.text()}`);
  });

  const shot = (name) => path.join(outDir, name);

  try {
    // 1. Login screen ---------------------------------------------------------
    console.log(`[1/10] opening ${url} â€¦`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.getByLabel("Username").waitFor({ timeout: 15_000 });
    await page.screenshot({ path: shot("01-login-desktop.png") });
    console.log("      captured 01-login-desktop.png");

    // 2. Log in with the dev demo account ------------------------------------
    console.log(`[2/10] logging in as ${username} â€¦`);
    await page.getByLabel("Username").fill(username);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("heading", { name: "Trading Terminal" }).waitFor({ timeout: 20_000 });
    console.log("      trading terminal loaded");

    // 3. Markets: add the demo AAPL row and select it ------------------------
    console.log("[3/10] adding AAPL to Markets (demo) â€¦");
    await page.getByRole("button", { name: "Add AAPL (demo)" }).click();
    const aaplRow = page.getByTestId("watch-AAPL");
    await aaplRow.waitFor({ timeout: 10_000 });
    await aaplRow.locator("td").first().click();

    // 4. Wait for live quotes to stream into the chart -----------------------
    console.log("[4/10] waiting for streaming quotes (sim ticks every 2s) â€¦");
    let chartLive = true;
    try {
      await page.locator(".chart-line").waitFor({ timeout: 25_000 });
      console.log("      chart is live â€” price history is streaming");
    } catch {
      chartLive = false;
      console.log("      WARN: no chart points yet (quotes not streaming) â€” capturing anyway");
    }
    await page.waitForTimeout(2_000); // let a few more points land
    await page.screenshot({ path: shot("02-terminal-live.png"), fullPage: true });
    console.log("      captured 02-terminal-live.png");

    // 5. Fill the order ticket -------------------------------------------------
    console.log("[5/10] filling the order ticket â€¦");
    await page.locator("#ticket-symbol").fill("AAPL");
    // The Exchange select's wrapping <label> text includes its <option> texts
    // ("ExchangeUNKNOWNNYSEâ€¦"), so match it structurally instead.
    await page
      .locator("select:has(option[value='NASDAQ'])")
      .first()
      .selectOption("NASDAQ");
    await page.getByLabel("Quantity", { exact: true }).fill("10");
    await page.getByLabel("Limit price", { exact: true }).fill("150.25");

    // 6. Submit the PAPER order and wait for the simulated fill ----------------
    console.log("[6/10] submitting BUY 10 AAPL @ 150.25 (paper/simulated) â€¦");
    await page.getByRole("button", { name: "Submit BUY" }).click();
    const outcome = page.locator(".ticket-outcome");
    await outcome.waitFor({ timeout: 20_000 });
    const outcomeText = (await outcome.textContent())?.trim() ?? "";
    console.log(`      ticket outcome: ${outcomeText.replace(/\s+/g, " ")}`);
    // SIM_AUTO_FILL (sim broker, 1.5s fill delay) drives the order lifecycle
    // through the real WS path â€” give it time, then capture whatever state is
    // honest (working order or filled).
    await page.waitForTimeout(6_000);
    const statuses = await page.locator(".positions-card .badge").allTextContents();
    console.log(`      blotter statuses: ${statuses.join(", ") || "(none)"}`);

    // 7. Screenshots: desktop full page, then the mobile breakpoint -----------
    console.log("[7/10] capturing screenshots â€¦");
    await page.screenshot({ path: shot("03-terminal-final.png"), fullPage: true });
    console.log("      captured 03-terminal-final.png (1440px desktop, full page)");

    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(500); // let the responsive CSS settle
    await page.screenshot({ path: shot("04-terminal-mobile.png"), fullPage: true });
    console.log("      captured 04-terminal-mobile.png (375px mobile breakpoint, full page)");

    // 8. M2 Dashboard: navigate via the sidebar and capture both breakpoints ----
    console.log("[8/10] navigating to the Dashboard (Overview) â€¦");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("button", { name: "Overview" }).click();
    await page
      .getByRole("heading", { name: /Good (morning|afternoon|evening)/ })
      .waitFor({ timeout: 10_000 });
    await page.screenshot({ path: shot("05-overview-desktop.png"), fullPage: true });
    console.log("      captured 05-overview-desktop.png (1440px desktop, full page)");

    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: shot("06-overview-mobile.png"), fullPage: true });
    console.log("      captured 06-overview-mobile.png (375px mobile breakpoint, full page)");

    // 9. M3 Portfolio: navigate via the sidebar and capture both breakpoints
    console.log("[9/10] navigating to the Portfolio (Accounts) â€¦");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("button", { name: "Accounts" }).click();
    await page.getByRole("heading", { name: "Portfolio", exact: true }).waitFor({ timeout: 10_000 });
    await page.screenshot({ path: shot("07-portfolio-desktop.png"), fullPage: true });
    console.log("      captured 07-portfolio-desktop.png (1440px desktop, full page)");

    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: shot("08-portfolio-mobile.png"), fullPage: true });
    console.log("      captured 08-portfolio-mobile.png (375px mobile breakpoint, full page)");

    // 10. M4 Positions & Orders management screens -----------------------------
    console.log("[10/10] capturing the M4 management screens …");
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.getByRole("button", { name: "Positions", exact: true }).click();
    await page
      .getByRole("heading", { name: "Positions", exact: true, level: 1 })
      .waitFor({ timeout: 10_000 });
    await page.waitForTimeout(800); // let the table settle with live data
    await page.screenshot({ path: shot("09-positions-desktop.png"), fullPage: true });
    console.log("      captured 09-positions-desktop.png (1440px desktop, full page)");

    await page.getByRole("button", { name: "Orders", exact: true }).click();
    await page
      .getByRole("heading", { name: "Orders", exact: true, level: 1 })
      .waitFor({ timeout: 10_000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: shot("10-orders-desktop.png"), fullPage: true });
    console.log("      captured 10-orders-desktop.png (1440px desktop, full page)");

    if (consoleErrors.length > 0) {
      console.log(`\nNOTE: ${consoleErrors.length} browser console error(s) during the run:`);
      for (const line of consoleErrors.slice(0, 10)) console.log(`  - ${line}`);
    } else {
      console.log("\nno browser console errors");
    }
    if (!chartLive) {
      console.log("WARNING: chart had no live points â€” check MARKET_SUBSCRIPTIONS/SIM_TICK_SECONDS on the backend.");
    }
    console.log(`\noutput directory: ${outDir}`);
    console.log("compare against: https://www.figma.com/make/u7bqch89fB2Z6UtUbHSVB3/Multi-Broker-Trading-Engine-UI");
  } catch (error) {
    await page.screenshot({ path: shot("00-error-state.png"), fullPage: true }).catch(() => {});
    console.error(`\nFAILED: ${error instanceof Error ? error.message : String(error)}`);
    if (consoleErrors.length > 0) {
      console.error(`browser console during the failed run (${consoleErrors.length}):`);
      for (const line of consoleErrors.slice(0, 10)) console.error(`  - ${line}`);
    }
    console.error(`error-state screenshot: ${shot("00-error-state.png")}`);
    await browser.close();
    process.exit(1);
  }

  await browser.close();
  console.log("visual check completed.");
}

await main();
