/**
 * M1 visual verification (M1 follow-up): drive the REAL terminal against the
 * REAL backend and capture screenshots for comparison with the Figma design.
 *
 * Flow: open the terminal â†’ log in (dev demo account) â†’ add AAPL to Markets
 * â†’ select it (quotes stream into the chart) â†’ fill the order ticket â†’
 * submit a PAPER order (simulated broker; SIM_AUTO_FILL fills it) â†’ capture
 * desktop + mobile screenshots of the resulting terminal, then the Dashboard
 * (M2), Portfolio (M3), Positions/Orders (M4), Activity (M5) and Markets (M6)
 * screens, and the M8 Risk Management workspace.
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
/** Every >=400 response with its URL — evidence, not a guess, for the report. */
const httpFailures = [];
/**
 * M7 evidence: the Strategies screen must issue NO request at all (there is no
 * strategy endpoint to call). Anything matched here is a defect, not a feature.
 */
const strategyRequests = [];

async function main() {
  await mkdir(outDir, { recursive: true });

  const launchOptions = { headless: !headed };
  if (channel !== "") launchOptions.channel = channel;

  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on("response", (response) => {
    if (response.status() >= 400) {
      httpFailures.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));
  page.on("request", (request) => {
    // Only real API traffic counts: Vite serves the screen's own modules over
    // HTTP too, and those URLs legitimately contain "strateg".
    const type = request.resourceType();
    if ((type === "xhr" || type === "fetch") && /strateg/i.test(request.url())) {
      strategyRequests.push(request.url());
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(`console: ${message.text()}`);
  });

  const shot = (name) => path.join(outDir, name);

  try {
    // 1. Login screen ---------------------------------------------------------
    console.log(`[1/14] opening ${url} â€¦`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.getByLabel("Username").waitFor({ timeout: 15_000 });
    await page.screenshot({ path: shot("01-login-desktop.png") });
    console.log("      captured 01-login-desktop.png");

    // 2. Log in with the dev demo account ------------------------------------
    console.log(`[2/14] logging in as ${username} â€¦`);
    await page.getByLabel("Username").fill(username);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("heading", { name: "Trading Terminal" }).waitFor({ timeout: 20_000 });
    console.log("      trading terminal loaded");

    // 3. Markets: add the demo AAPL row and select it ------------------------
    console.log("[3/14] adding AAPL to Markets (demo) â€¦");
    await page.getByRole("button", { name: "Add AAPL (demo)" }).click();
    const aaplRow = page.getByTestId("watch-AAPL");
    await aaplRow.waitFor({ timeout: 10_000 });
    await aaplRow.locator("td").first().click();

    // 4. Wait for live quotes to stream into the chart -----------------------
    console.log("[4/14] waiting for streaming quotes (sim ticks every 2s) â€¦");
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
    console.log("[5/14] filling the order ticket â€¦");
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
    console.log("[6/14] submitting BUY 10 AAPL @ 150.25 (paper/simulated) â€¦");
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
    console.log("[7/14] capturing screenshots â€¦");
    await page.screenshot({ path: shot("03-terminal-final.png"), fullPage: true });
    console.log("      captured 03-terminal-final.png (1440px desktop, full page)");

    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(500); // let the responsive CSS settle
    await page.screenshot({ path: shot("04-terminal-mobile.png"), fullPage: true });
    console.log("      captured 04-terminal-mobile.png (375px mobile breakpoint, full page)");

    // 8. M2 Dashboard: navigate via the sidebar and capture both breakpoints ----
    console.log("[8/14] navigating to the Dashboard (Overview) â€¦");
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
    console.log("[9/14] navigating to the Portfolio (Accounts) â€¦");
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
    console.log("[10/14] capturing the M4 management screens …");
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

    // 11. M5 Activity: order history + executions ------------------------------
    console.log("[11/14] capturing the M5 Activity screens …");

    await page.getByRole("button", { name: "Activity", exact: true }).click();
    await page
      .getByRole("heading", { name: "Activity", exact: true, level: 1 })
      .waitFor({ timeout: 10_000 });
    await page.waitForTimeout(800);
    const historyRows = await page.locator("[data-testid^='history-']").count();
    const historyStatuses = [
      ...new Set(await page.locator("[data-testid^='history-'] .badge").allInnerTexts()),
    ];
    console.log(
      `      order history: ${historyRows} row(s) — statuses: ${historyStatuses.join(", ") || "(none)"}`,
    );
    await page.screenshot({ path: shot("11-activity-orders-desktop.png"), fullPage: true });
    console.log("      captured 11-activity-orders-desktop.png (order history, full page)");

    // The executions tab shows the fills this run actually produced live.
    await page.getByRole("radio", { name: "Executions", exact: true }).click();
    await page.waitForTimeout(600);
    const executionRows = await page.locator("[data-testid^='execution-']").count();
    await page.screenshot({ path: shot("12-activity-executions-desktop.png"), fullPage: true });
    console.log(
      `      captured 12-activity-executions-desktop.png (${executionRows} live fill(s) captured)`,
    );

    // Order detail dialog from the history table.
    await page.getByRole("radio", { name: "Order history", exact: true }).click();
    const detailsButton = page.getByRole("button", { name: "Details", exact: true }).first();
    if ((await detailsButton.count()) > 0) {
      await detailsButton.click();
      await page.getByRole("dialog").waitFor({ timeout: 10_000 });
      await page.waitForTimeout(400);
      await page.screenshot({ path: shot("13-order-detail-dialog.png") });
      console.log("      captured 13-order-detail-dialog.png (order detail + executions)");
      await page.getByRole("button", { name: "Close", exact: true }).click();
    } else {
      console.log("      skipped the detail dialog: no historical order rows to open");
    }

    // Responsive check: the history table scrolls inside its panel, the toolbar
    // wraps — capture the 375px breakpoint so the claim is evidenced.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: shot("14-activity-mobile.png"), fullPage: true });
    console.log("      captured 14-activity-mobile.png (375px mobile breakpoint, full page)");
    await page.setViewportSize({ width: 1440, height: 900 });

    // 12. M6 Markets: watchlists + market data --------------------------------
    console.log("[12/14] capturing the M6 Markets screen (watchlists & quotes) ...");
    await page.getByRole("button", { name: "Markets", exact: true }).click();
    await page
      .getByRole("heading", { name: "Markets", exact: true, level: 1 })
      .waitFor({ timeout: 10_000 });
    await page.waitForTimeout(1_000); // let a quote poll land
    const watchlistCount = await page.locator(".rail-item").count();
    const marketRows = await page.locator("[data-testid^='market-row-']").count();
    const quoteStates = [
      ...new Set(await page.locator("[data-testid^='market-row-'] .badge").allInnerTexts()),
    ];
    const sessionChangeCells = await page.locator(".markets-table tbody tr td:nth-child(5)").allInnerTexts();
    console.log(
      `      watchlists: ${watchlistCount} — rows: ${marketRows} — quote states: ${
        quoteStates.join(", ") || "(none)"
      } — session delta cells: ${sessionChangeCells.length}`,
    );
    await page.screenshot({ path: shot("15-markets-desktop.png"), fullPage: true });
    console.log("      captured 15-markets-desktop.png (1440px desktop, full page)");

    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: shot("16-markets-mobile.png"), fullPage: true });
    console.log("      captured 16-markets-mobile.png (375px mobile breakpoint, full page)");
    await page.setViewportSize({ width: 1440, height: 900 });

    // 13. M7 Strategies: capability state (no strategy service exists) --------
    console.log("[13/14] capturing the M7 Strategies screen (capability state) ...");
    await page.getByRole("button", { name: "Strategies", exact: true }).click();
    await page
      .getByRole("heading", { name: "Strategies", exact: true, level: 1 })
      .waitFor({ timeout: 10_000 });
    await page.waitForTimeout(300);

    const capabilityBadge = await page.locator(".page-title .badge").allInnerTexts();
    const metricValues = await page
      .locator("[aria-label='Strategy metrics'] .stat-value")
      .allInnerTexts();
    const capabilityCards = await page.locator("[data-testid^='strategy-capability-']").count();
    const disabledStrategyActions = await page.locator(".strategy-actions button:disabled").count();
    const strategyRows = await page.locator(".strategies-table tbody tr").count();
    const strategyNotes = await page.locator(".strategies-table [role='note']").count();
    console.log(
      `      header badge: ${capabilityBadge.join(", ") || "(none)"} — metric values: ${
        metricValues.join(", ") || "(none)"
      }`,
    );
    console.log(
      `      capability cards: ${capabilityCards} — disabled actions: ${disabledStrategyActions} — table rows: ${strategyRows} (absent-state notes: ${strategyNotes})`,
    );
    await page.screenshot({ path: shot("17-strategies-desktop.png"), fullPage: true });
    console.log("      captured 17-strategies-desktop.png (1440px desktop, full page)");

    // The tab group is a real control: switching it must change the cards shown.
    await page.getByRole("radio", { name: "Backtest", exact: true }).click();
    await page.waitForTimeout(200);
    const backtestCards = await page.locator("[data-testid^='strategy-capability-']").count();
    const backtestAction = await page
      .getByRole("button", { name: "Run backtest", exact: true })
      .isDisabled();
    console.log(
      `      backtest tab: ${backtestCards} card(s) — "Run backtest" disabled: ${backtestAction}`,
    );
    await page.screenshot({ path: shot("18-strategies-backtest-tab.png"), fullPage: true });
    console.log("      captured 18-strategies-backtest-tab.png (capability tab switch)");

    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: shot("19-strategies-mobile.png"), fullPage: true });
    console.log("      captured 19-strategies-mobile.png (375px mobile breakpoint, full page)");
    await page.setViewportSize({ width: 1440, height: 900 });

    // 14. M8 Risk Management: enforcement, limits, alerts, pre-trade check -----
    console.log("[14/14] capturing the M8 Risk Management screen ...");
    await page.getByRole("button", { name: "Risk Management", exact: true }).click();
    await page
      .getByRole("heading", { name: "Risk Management", exact: true, level: 1 })
      .waitFor({ timeout: 10_000 });
    await page.waitForTimeout(600);

    const contextBadge = await page.locator(".risk-page .page-title .badge").allInnerTexts();
    const riskStatValues = await page
      .locator("[aria-label='Risk overview'] .stat-value")
      .allInnerTexts();
    const notExposed = await page.getByText("Not exposed", { exact: true }).count();
    const notReported = await page.getByText("Not reported", { exact: true }).count();
    const limitRows = await page.locator(".risk-limits-table tbody tr").count();
    const positionRows = await page.locator(".risk-position-table tbody tr").count();
    const alertItems = await page.locator(".risk-page .violation-list li").count();
    const dryRunButton = await page
      .getByRole("button", { name: "Run risk check", exact: true })
      .isDisabled();
    console.log(`      context badge: ${contextBadge.join(", ") || "(none)"}`);
    console.log(`      metric values: ${riskStatValues.join(" | ") || "(none)"}`);
    console.log(
      `      limits: ${limitRows} rule(s) — "Not exposed": ${notExposed} — "Not reported": ${notReported}`,
    );
    console.log(
      `      position rows: ${positionRows} — alert rows: ${alertItems} — dry-run disabled (empty form): ${dryRunButton}`,
    );
    await page.screenshot({ path: shot("20-risk-desktop.png"), fullPage: true });
    console.log("      captured 20-risk-desktop.png (1440px desktop, full page)");

    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: shot("21-risk-mobile.png"), fullPage: true });
    console.log("      captured 21-risk-mobile.png (375px mobile breakpoint, full page)");
    await page.setViewportSize({ width: 1440, height: 900 });

    if (strategyRequests.length > 0) {
      console.log(
        `\nDEFECT: ${strategyRequests.length} request(s) matched "strateg" — this screen must issue none:`,
      );
      for (const line of [...new Set(strategyRequests)]) console.log(`  - ${line}`);
    } else {
      console.log(
        '      no request matched "strateg": the screen issued no strategy call (as designed)',
      );
    }

    if (consoleErrors.length > 0) {
      console.log(`\nNOTE: ${consoleErrors.length} browser console error(s) during the run:`);
      for (const line of consoleErrors.slice(0, 10)) console.log(`  - ${line}`);
    } else {
      console.log("\nno browser console errors");
    }
    if (httpFailures.length > 0) {
      console.log(`\n${httpFailures.length} HTTP failure response(s) (URL-level evidence):`);
      for (const line of [...new Set(httpFailures)]) console.log(`  - ${line}`);
    } else {
      console.log("no HTTP 4xx/5xx responses");
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
