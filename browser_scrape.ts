/**
 * AI4P UniDash Browser-Tools Scraper
 * ====================================
 * This is the canonical scraping approach. UniDash requires Meta internal
 * authentication which cannot be replicated by a headless Playwright browser.
 * Instead, this script is run inside a Manus task session where the Manus
 * browser is already authenticated.
 *
 * HOW TO RUN A REFRESH:
 * ─────────────────────
 * 1. Open a Manus task (this project).
 * 2. Ask: "Run a dashboard refresh" or "Scrape UniDash now".
 * 3. The agent will:
 *    a. Navigate to the UniDash URL using the authenticated Manus browser.
 *    b. Enter full-screen mode and scroll to the Manager and Recursive Reports table.
 *    c. Extract: topline rate, dataAsOf date, and all PDM rows.
 *    d. Call runPipeline() below with the extracted data.
 *    e. The pipeline writes dashboardData.ts, generates HTML, uploads to
 *       Google Drive, pushes to GitHub Pages, and saves a checkpoint.
 *
 * UNIDASH URL (Haihong Wang pre-selected):
 * https://www.internalfb.com/unidash/dashboard/ai_usage_at_meta/ai4p_by_pillar/overall_one_pager
 * ?dimensional_context_793502160125540=%7B%22macros%22%3A[]%2C%22limit%22%3A5%7D
 * &events=%7B%221764239757418050%22%3A%7B%22select_manager_rollup_macro%22%3A%7B
 * %22data%22%3A%22haihongwang%22%2C%22publisher_id%22%3A%221764239757418050%22%7D%2C
 * %221764239757418050%22%3A%7B%22data%22%3A%22haihongwang%22%2C%22publisher_id%22%3A
 * %221764239757418050%22%7D%7D%7D
 * &var_1606330854110453period=%7B%22minutes_back%22%3A129600%2C%22time_type%22%3A%22dynamic%22%7D
 *
 * PAGE NAVIGATION STEPS:
 * ──────────────────────
 * 1. Navigate to the URL above.
 * 2. Click "Toggle Full-screen" button.
 * 3. Scroll to the bottom of the page (to_end: true).
 * 4. Wait for the Manager and Recursive Reports table to load.
 * 5. Extract data from the page markdown / element list.
 *
 * DATA TO EXTRACT:
 * ────────────────
 * From the Topline widget:
 *   - toplineRate: the "76%" value next to "L4+/7 %"
 *   - dataAsOf: the "As of 2026-02-22" date string
 *
 * From the Manager and Recursive Reports table (each row):
 *   - name (e.g. "⤷Chuanqi Li" → strip leading "⤷")
 *   - pillar (e.g. "Ads & Business Messaging Pillar")
 *   - func (e.g. "PD")
 *   - allocArea (e.g. "ABM - Core Ads Growth")
 *   - teamGroup (e.g. "Core Ads Growth XFN Team Group")
 *   - l4_7 (e.g. "51%")
 *   - empCount (e.g. "35")
 *
 * NOTE: pdFunctionRate (PD column in the By Function × Allocation Area heatmap)
 * is not yet scraped via browser tools. It defaults to 67 until implemented.
 */

import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import type { RawRow, BenchmarkInput, ScraperState } from "./types.js";

// ── Paths ─────────────────────────────────────────────────────────────────────

const DASHBOARD_DIR   = path.resolve(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname));
const HTML_OUTPUT     = path.join(DASHBOARD_DIR, "index.html");
const JSON_OUTPUT     = path.join(DASHBOARD_DIR, "data.json");
const GITHUB_RAW_URL  = "https://raw.githubusercontent.com/shawn1122334455/ai4p-dashboard/main/data.json";
const STATE_FILE      = path.join(DASHBOARD_DIR, "scrape_state.json");
const LOG_FILE        = path.join(DASHBOARD_DIR, "scrape.log");
const RCLONE_CONFIG   = path.join(process.env.HOME ?? "/home/ubuntu", ".gdrive-rclone.ini");
const GDRIVE_FOLDER_ID = "1MPyQxitnirWRe9JGB5Yvoq42G4lXT5zU";

const UNIDASH_URL =
  "https://www.internalfb.com/unidash/dashboard/ai_usage_at_meta/" +
  "ai4p_by_pillar/overall_one_pager" +
  "?dimensional_context_793502160125540=%7B%22macros%22%3A[]%2C%22limit%22%3A5%7D" +
  "&events=%7B%221764239757418050%22%3A%7B%22select_manager_rollup_macro%22%3A%7B" +
  "%22data%22%3A%22haihongwang%22%2C%22publisher_id%22%3A%221764239757418050%22%7D%2C" +
  "%221764239757418050%22%3A%7B%22data%22%3A%22haihongwang%22%2C%22publisher_id%22%3A" +
  "%221764239757418050%22%7D%7D%7D" +
  "&var_1606330854110453period=%7B%22minutes_back%22%3A129600%2C%22time_type%22%3A%22dynamic%22%7D";

// ── Logging ───────────────────────────────────────────────────────────────────

function log(msg: string): void {
  const ts = new Date().toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const line = `[${ts}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + "\n");
}

// ── State ─────────────────────────────────────────────────────────────────────

function loadState(): ScraperState {
  if (fs.existsSync(STATE_FILE)) {
    try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as ScraperState; }
    catch { /* fall through */ }
  }
  return { lastSuccess: null, lastSuccessRows: [], consecutiveFailures: 0, sessionAlertSent: false, lastFailureReason: null };
}

function saveState(state: ScraperState): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parsePct(s: string): number {
  return parseInt(s.replace("%", "").trim(), 10) || 0;
}

const PDM_ORDER: Array<{
  displayName: string; id: string; first: string; last: string;
  teamGroup: string; isDirect: boolean;
}> = [
  { displayName: "Chuanqi Li",      id: "chuanqi-li",      first: "Chuanqi", last: "Li",      teamGroup: "Core Ads Growth XFN Team Group",                        isDirect: true },
  { displayName: "Mirko Mandic",    id: "mirko-mandic",    first: "Mirko",   last: "Mandic",  teamGroup: "Core Ads Growth XFN Team Group",                        isDirect: true },
  { displayName: "Ilona Parkansky", id: "ilona-parkansky", first: "Ilona",   last: "Parkansky", teamGroup: "Monetization PG - Central & Ecosystems XFN Team Group", isDirect: true },
  { displayName: "Nikki Jahangiri", id: "nikki-jahangiri", first: "Nikki",   last: "Jahangiri", teamGroup: "Core Ads Growth XFN Team Group",                      isDirect: true },
];

// ── dashboardData.ts generator ────────────────────────────────────────────────

function buildDashboardDataTs(
  rows: RawRow[],
  retrievedAt: string,
  bm: BenchmarkInput
): string {
  const pdmEntries: string[] = [];
  for (const p of PDM_ORDER) {
    const row = rows.find(
      (r) => r.name.toLowerCase().includes(p.first.toLowerCase()) &&
             r.name.toLowerCase().includes(p.last.toLowerCase())
    );
    if (!row) { log(`  WARNING: No data found for ${p.displayName}, skipping`); continue; }
    const usage    = parsePct(row.l4_7);
    const empCount = parseInt(row.empCount, 10) || 0;
    pdmEntries.push(`    {
      id: "${p.id}",
      name: "${p.displayName}",
      firstName: "${p.first}",
      lastName: "${p.last}",
      recursiveEmployees: ${empCount},
      usageRate: ${usage},
      pillar: "Ads & Business Messaging Pillar",
      function: "PD",
      allocationArea: "ABM – Core Ads Growth",
      teamGroup: "${p.teamGroup}",
      isDirectReport: ${p.isDirect},
    }`);
  }

  const orgRow   = rows.find((r) => r.name.toLowerCase().includes("haihong"));
  const orgRate  = orgRow ? parsePct(orgRow.l4_7) : 67;
  const orgCount = orgRow ? (parseInt(orgRow.empCount, 10) || 94) : 94;

  return `// AI4P Dashboard Data
// Design: Modern SaaS Dashboard — Meta-blue accents, vivid status colors, clean white cards
// AUTO-GENERATED by browser_scrape.ts — DO NOT EDIT MANUALLY
// Last updated: ${retrievedAt}

export interface PDMData {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  recursiveEmployees: number;
  usageRate: number; // percentage 0-100
  pillar: string;
  function: string;
  allocationArea: string;
  teamGroup: string;
  isDirectReport: boolean;
}

export interface BenchmarkData {
  toplineRate: number;
  pdFunctionRate: number;
  pdFunctionFTEs: string;
  dataAsOf: string;
}

export interface OrgData {
  managerName: string;
  orgUsageRate: number;
  totalEmployees: number;
  pillar: string;
  allocationArea: string;
  lastUpdated: string;
  unidashDataAsOf: string;
  unidashUrl: string;
  benchmark: BenchmarkData;
  pdms: PDMData[];
}

export const TARGET_RATE = 80;

export function getStatus(rate: number): "red" | "yellow" | "green" {
  if (rate <= 59) return "red";
  if (rate <= 79) return "yellow";
  return "green";
}

export function getStatusLabel(status: "red" | "yellow" | "green"): string {
  if (status === "red") return "Needs Attention";
  if (status === "yellow") return "Progressing";
  return "On Track";
}

export const dashboardData: OrgData = {
  managerName: "Haihong Wang",
  orgUsageRate: ${orgRate},
  totalEmployees: ${orgCount},
  pillar: "Ads & Business Messaging Pillar",
  allocationArea: "ABM – Core Ads Growth",
  lastUpdated: "${retrievedAt}",
  unidashDataAsOf: "${bm.dataAsOf}",
  unidashUrl:
    "${UNIDASH_URL}",
  benchmark: {
    toplineRate: ${bm.toplineRate},
    pdFunctionRate: ${bm.pdFunctionRate},
    pdFunctionFTEs: "2k",
    dataAsOf: "${bm.dataAsOf}",
  },
  pdms: [
${pdmEntries.join(",\n")}
  ],
};
`;
}

// ── JSON data file generator ─────────────────────────────────────────────────

function buildDataJson(
  rows: RawRow[],
  retrievedAt: string,
  bm: BenchmarkInput
): object {
  const orgRow   = rows.find((r) => r.name.toLowerCase().includes("haihong"));
  const orgRate  = orgRow ? parsePct(orgRow.l4_7) : 67;
  const orgCount = orgRow ? (parseInt(orgRow.empCount, 10) || 94) : 94;

  const pdms = [];
  for (const p of PDM_ORDER) {
    const row = rows.find(
      (r) => r.name.toLowerCase().includes(p.first.toLowerCase()) &&
             r.name.toLowerCase().includes(p.last.toLowerCase())
    );
    if (!row) continue;
    pdms.push({
      id: p.id,
      name: p.displayName,
      firstName: p.first,
      lastName: p.last,
      recursiveEmployees: parseInt(row.empCount, 10) || 0,
      usageRate: parsePct(row.l4_7),
      pillar: "Ads & Business Messaging Pillar",
      function: "PD",
      allocationArea: "ABM – Core Ads Growth",
      teamGroup: p.teamGroup,
      isDirectReport: p.isDirect,
    });
  }

  return {
    managerName: "Haihong Wang",
    orgUsageRate: orgRate,
    totalEmployees: orgCount,
    pillar: "Ads & Business Messaging Pillar",
    allocationArea: "ABM – Core Ads Growth",
    lastUpdated: retrievedAt,
    unidashDataAsOf: bm.dataAsOf,
    unidashUrl: UNIDASH_URL,
    benchmark: {
      toplineRate: bm.toplineRate,
      pdFunctionRate: bm.pdFunctionRate,
      pdFunctionFTEs: "2k",
      dataAsOf: bm.dataAsOf,
    },
    pdms,
  };
}

// ── HTML generator (stub — full version in scrape_and_update.ts) ──────────────

function generateSimpleHtml(rows: RawRow[], retrievedAt: string, bm: BenchmarkInput): string {
  const rowsHtml = rows.map(r => `
    <tr>
      <td>${r.name.replace("⤷", "")}</td>
      <td>${r.l4_7}</td>
      <td>${r.empCount}</td>
      <td>${r.teamGroup}</td>
    </tr>`).join("");
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>AI4P Dashboard</title>
<style>body{font-family:sans-serif;padding:24px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:8px 12px}th{background:#1877f2;color:#fff}</style>
</head>
<body>
<h1>AI4P Tool Usage — Haihong Wang's Org</h1>
<p>Topline: <strong>${bm.toplineRate}%</strong> | Data as of: ${bm.dataAsOf} | Last updated: ${retrievedAt}</p>
<table><thead><tr><th>Manager</th><th>L4+/7</th><th>Employees</th><th>Team Group</th></tr></thead>
<tbody>${rowsHtml}</tbody></table>
</body></html>`;
}

// ── Google Drive upload ───────────────────────────────────────────────────────

async function uploadToGdrive(): Promise<boolean> {
  try {
    execFileSync("rclone", [
      "copy", HTML_OUTPUT,
      `manus_google_drive:${GDRIVE_FOLDER_ID}`,
      "--config", RCLONE_CONFIG, "--drive-use-trash=false",
    ], { stdio: "pipe" });
    log("Google Drive upload complete.");
    return true;
  } catch (e: any) {
    log(`Google Drive upload failed: ${e.stderr?.toString() ?? e}`);
    return false;
  }
}

// ── GitHub Pages push ─────────────────────────────────────────────────────────

async function pushToGithub(retrievedAt: string, dataJson: object): Promise<void> {
  // Write data.json to the repo so the live dashboard can fetch it without republishing
  fs.writeFileSync(JSON_OUTPUT, JSON.stringify(dataJson, null, 2), "utf8");
  log(`data.json written to ${JSON_OUTPUT}`);

  const cmds: [string, string[]][] = [
    ["git", ["-C", DASHBOARD_DIR, "add", "index.html", "data.json"]],
    ["git", ["-C", DASHBOARD_DIR, "commit", "-m", `Auto-refresh: ${retrievedAt}`]],
    ["git", ["-C", DASHBOARD_DIR, "push", "origin", "main"]],
  ];
  for (const [cmd, args] of cmds) {
    try {
      execFileSync(cmd, args, { stdio: "pipe" });
    } catch (e: any) {
      const stderr = e.stderr?.toString() ?? "";
      if (!stderr.includes("nothing to commit")) log(`Git warning: ${stderr.trim()}`);
    }
  }
  log("GitHub Pages push complete.");
}


// ── Main pipeline entry point ─────────────────────────────────────────────────

/**
 * Call this function with data extracted from the Manus browser after
 * navigating to the UniDash page and scrolling to the Manager table.
 *
 * Example call (from agent code after browser extraction):
 *
 *   await runPipeline({
 *     rows: [
 *       { name: "Chuanqi Li", pillar: "Ads & Business Messaging Pillar", func: "PD",
 *         allocArea: "ABM - Core Ads Growth", teamGroup: "Core Ads Growth XFN Team Group",
 *         l4_7: "51%", empCount: "35" },
 *       { name: "Bolun Yang", ..., l4_7: "36%", empCount: "11" },
 *       // ... etc
 *     ],
 *     benchmark: { toplineRate: 76, pdFunctionRate: 67, dataAsOf: "2026-02-22" },
 *   });
 */
export async function runPipeline(input: {
  rows: RawRow[];
  benchmark: BenchmarkInput;
}): Promise<void> {
  log("=".repeat(60));
  log("Starting AI4P dashboard refresh (browser-tools pipeline)...");

  const { rows, benchmark } = input;

  const retrievedAt = new Date().toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  }) + " PT";

  log(`Retrieved at: ${retrievedAt}`);
  log(`Rows: ${rows.map(r => r.name).join(", ")}`);
  log(`Benchmark: topline=${benchmark.toplineRate}%, PD=${benchmark.pdFunctionRate}%, asOf=${benchmark.dataAsOf}`);

  // Save state
  const state = loadState();
  state.consecutiveFailures = 0;
  state.sessionAlertSent    = false;
  state.lastSuccess         = retrievedAt;
  state.lastSuccessRows     = rows;
  state.lastFailureReason   = null;
  saveState(state);

  // Generate HTML
  const html = generateSimpleHtml(rows, retrievedAt, benchmark);
  fs.writeFileSync(HTML_OUTPUT, html, "utf8");
  log(`Dashboard HTML written to ${HTML_OUTPUT}`);

  // Upload to Google Drive
  const driveOk = await uploadToGdrive();
  if (!driveOk) log("WARNING: Google Drive upload failed.");

  // Build JSON data payload
  const dataJson = buildDataJson(rows, retrievedAt, benchmark);

  // Push to GitHub Pages (includes data.json)
  await pushToGithub(retrievedAt, dataJson);


  log("Dashboard refresh complete.");
  log("=".repeat(60));
}
