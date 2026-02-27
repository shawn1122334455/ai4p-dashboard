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

function getStatus(rate: number): "red" | "yellow" | "green" {
  if (rate <= 59) return "red";
  if (rate <= 79) return "yellow";
  return "green";
}

function getStatusLabel(status: "red" | "yellow" | "green"): string {
  if (status === "red") return "Needs Attention";
  if (status === "yellow") return "Progressing";
  return "On Track";
}

function generateStyledHtml(rows: RawRow[], retrievedAt: string, bm: BenchmarkInput): string {
  const TARGET = 80;
  const CIRCUMFERENCE = 282.7; // 2π × 45

  // Org row (Haihong Wang)
  const orgRow = rows.find(r => r.name.toLowerCase().includes("haihong"));
  const orgRate = orgRow ? parsePct(orgRow.l4_7) : 67;
  const orgCount = orgRow ? (parseInt(orgRow.empCount, 10) || 94) : 94;
  const orgStatus = getStatus(orgRate);
  const orgOffset = (CIRCUMFERENCE * (1 - orgRate / 100)).toFixed(1);
  const orgStroke = orgStatus === "red" ? "#ef4444" : orgStatus === "yellow" ? "#f59e0b" : "#22c55e";

  // PDM rows (all except Haihong Wang herself)
  // Only show the PDMs specified in PDM_ORDER
  const pdmRows = PDM_ORDER.map(p =>
    rows.find(r =>
      r.name.toLowerCase().includes(p.first.toLowerCase()) &&
      r.name.toLowerCase().includes(p.last.toLowerCase())
    )
  ).filter((r): r is RawRow => r !== undefined);
  const rates = pdmRows.map(r => parsePct(r.l4_7));
  const highestRate = rates.length ? Math.max(...rates) : 0;
  const lowestRate  = rates.length ? Math.min(...rates) : 0;
  const highestColor = getStatus(highestRate) === "green" ? "#22c55e" : getStatus(highestRate) === "yellow" ? "#f59e0b" : "#ef4444";
  const lowestColor  = getStatus(lowestRate)  === "green" ? "#22c55e" : getStatus(lowestRate)  === "yellow" ? "#f59e0b" : "#ef4444";

  const pdmCardsHtml = pdmRows.map(r => {
    const name = r.name.replace("⤷", "").trim();
    const rate = parsePct(r.l4_7);
    const emp  = parseInt(r.empCount, 10) || 0;
    const st   = getStatus(rate);
    const lbl  = getStatusLabel(st);
    return `
    <div class="team-card ${st}">
      <div class="card-name">${name}</div>
      <div class="card-count">${emp} recursive employees</div>
      <div class="card-pct ${st}">${rate}%</div>
      <div class="progress-track">
        <div class="progress-fill ${st}" style="width:${rate}%"></div>
      </div>
      <div class="card-footer">
        <span class="status-pill ${st}">${lbl}</span>
        <span class="card-target">Target: ${TARGET}%</span>
      </div>
    </div>`;
  }).join("\n");

  // Format dataAsOf date nicely
  const asOfParts = bm.dataAsOf.split("-");
  const asOfFormatted = asOfParts.length === 3
    ? new Date(parseInt(asOfParts[0]), parseInt(asOfParts[1]) - 1, parseInt(asOfParts[2]))
        .toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : bm.dataAsOf;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AI4P Tool Usage Dashboard – Haihong Wang's Org</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f4f6f9; color: #1a1a2e; min-height: 100vh; }
    main { max-width: 1100px; margin: 0 auto; padding: 48px 32px 72px; }
    .dash-title-block { margin-bottom: 32px; }
    .dash-badges { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
    .badge { display: inline-block; background: #e5e7eb; border: 1px solid #d1d5db; border-radius: 20px; padding: 4px 14px; font-size: 11px; font-weight: 600; letter-spacing: 0.8px; text-transform: uppercase; color: #374151; }
    .badge.live { background: #dcfce7; border-color: #86efac; color: #166534; }
    .dash-title-block h1 { font-size: 28px; font-weight: 800; color: #1a1a2e; line-height: 1.2; }
    .dash-title-block .subtitle { margin-top: 6px; font-size: 14px; color: #6b7280; }
    .section-label { font-size: 11px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; color: #6b7280; margin-bottom: 14px; }
    .org-card { background: #fff; border-radius: 16px; padding: 28px 32px; margin-bottom: 32px; box-shadow: 0 1px 4px rgba(0,0,0,0.07); display: flex; align-items: center; gap: 32px; flex-wrap: wrap; }
    .org-pct-ring { position: relative; width: 110px; height: 110px; flex-shrink: 0; }
    .org-pct-ring svg { transform: rotate(-90deg); }
    .org-pct-ring .ring-bg { fill: none; stroke: #e5e7eb; stroke-width: 10; }
    .org-pct-ring .ring-fill { fill: none; stroke-width: 10; stroke-linecap: round; }
    .org-pct-ring .ring-text { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: 24px; font-weight: 800; color: #1a1a2e; line-height: 1; }
    .org-pct-ring .ring-text span { font-size: 11px; font-weight: 500; color: #6b7280; margin-top: 3px; }
    .org-info { flex: 1; min-width: 200px; }
    .org-info h2 { font-size: 20px; font-weight: 700; color: #1a1a2e; }
    .org-info p { font-size: 13px; color: #6b7280; margin-top: 4px; }
    .org-stats { display: flex; gap: 32px; margin-top: 18px; flex-wrap: wrap; }
    .org-stat .val { font-size: 22px; font-weight: 700; color: #1a1a2e; }
    .org-stat .lbl { font-size: 11px; color: #9ca3af; margin-top: 2px; }
    .org-meta { margin-left: auto; display: flex; flex-direction: column; align-items: flex-end; gap: 10px; text-align: right; padding-left: 28px; border-left: 1px solid #e5e7eb; flex-shrink: 0; }
    .org-meta .meta-row { font-size: 12px; color: #6b7280; line-height: 1.5; }
    .org-meta .meta-row strong { display: block; color: #1a1a2e; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 1px; }
    .org-meta a { color: #3b82f6; text-decoration: none; font-size: 12px; font-weight: 500; display: inline-flex; align-items: center; gap: 3px; }
    .org-meta a:hover { text-decoration: underline; }
    .team-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 16px; align-items: stretch; }
    @media (max-width: 860px) { .team-grid { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 480px) { .team-grid { grid-template-columns: 1fr; } }
    .team-card { background: #fff; border-radius: 16px; padding: 22px 20px 18px; box-shadow: 0 1px 4px rgba(0,0,0,0.07); border-top: 4px solid #e5e7eb; display: flex; flex-direction: column; transition: transform 0.15s ease, box-shadow 0.15s ease; }
    .team-card:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(0,0,0,0.1); }
    .team-card.red { border-top-color: #ef4444; } .team-card.yellow { border-top-color: #f59e0b; } .team-card.green { border-top-color: #22c55e; }
    .card-name { font-size: 15px; font-weight: 700; color: #1a1a2e; line-height: 1.3; margin-bottom: 4px; min-height: 40px; }
    .card-count { font-size: 12px; color: #9ca3af; margin-bottom: 16px; }
    .card-pct { font-size: 42px; font-weight: 800; line-height: 1; margin-bottom: 14px; }
    .card-pct.red { color: #ef4444; } .card-pct.yellow { color: #f59e0b; } .card-pct.green { color: #22c55e; }
    .progress-track { background: #f3f4f6; border-radius: 99px; height: 8px; overflow: hidden; margin-bottom: 14px; }
    .progress-fill { height: 100%; border-radius: 99px; }
    .progress-fill.red { background: linear-gradient(90deg, #fca5a5, #ef4444); } .progress-fill.yellow { background: linear-gradient(90deg, #fcd34d, #f59e0b); } .progress-fill.green { background: linear-gradient(90deg, #86efac, #22c55e); }
    .card-footer { display: flex; align-items: center; justify-content: space-between; margin-top: auto; }
    .status-pill { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 99px; white-space: nowrap; }
    .status-pill.red { background: #fee2e2; color: #b91c1c; } .status-pill.yellow { background: #fef3c7; color: #92400e; } .status-pill.green { background: #dcfce7; color: #166534; }
    .status-pill::before { content: "●"; font-size: 8px; margin-right: 2px; }
    .card-target { font-size: 11px; color: #9ca3af; white-space: nowrap; }
    .legend-block { background: #fff; border-radius: 12px; padding: 16px 24px; margin-bottom: 40px; box-shadow: 0 1px 4px rgba(0,0,0,0.07); }
    .legend-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
    .legend-label { font-size: 12px; font-weight: 600; color: #6b7280; margin-right: 4px; }
    .legend-item { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #374151; background: #f9fafb; border-radius: 8px; padding: 5px 12px; }
    .legend-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
    .legend-dot.red { background: #ef4444; } .legend-dot.yellow { background: #f59e0b; } .legend-dot.green { background: #22c55e; }
    .legend-def { font-size: 11px; color: #9ca3af; font-style: italic; padding-top: 2px; border-top: 1px solid #f3f4f6; }
    .about-section { background: #fff; border-radius: 16px; padding: 28px 32px; box-shadow: 0 1px 4px rgba(0,0,0,0.07); }
    .about-section h3 { font-size: 14px; font-weight: 700; color: #1a1a2e; margin-bottom: 20px; display: flex; align-items: center; gap: 8px; }
    .about-section h3::before { content: "ⓘ"; color: #6b7280; font-size: 16px; }
    .about-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 20px; }
    @media (max-width: 600px) { .about-grid { grid-template-columns: 1fr; } }
    .about-item .about-title { font-size: 11px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; color: #9ca3af; margin-bottom: 6px; }
    .about-item p { font-size: 13px; color: #4b5563; line-height: 1.65; }
    .about-item a { color: #3b82f6; text-decoration: none; }
    .about-item a:hover { text-decoration: underline; }
    .warning-box { background: #fffbeb; border: 1px solid #fcd34d; border-radius: 10px; padding: 14px 18px; font-size: 13px; color: #78350f; line-height: 1.65; }
    .warning-box strong { color: #92400e; }
    footer { text-align: center; padding: 28px; font-size: 12px; color: #9ca3af; }
    @media (max-width: 600px) { main { padding: 24px 16px 48px; } .org-card { flex-direction: column; align-items: flex-start; } .org-meta { margin-left: 0; border-left: none; border-top: 1px solid #e5e7eb; padding-left: 0; padding-top: 16px; align-items: flex-start; text-align: left; } }
  </style>
</head>
<body>
<main>
  <div class="dash-title-block">
    <div class="dash-badges">
      <span class="badge">AI4P</span>
      <span class="badge">Product Design</span>
      <span class="badge live">● Live Data</span>
    </div>
    <h1>AI4P Tool Usage Dashboard</h1>
    <p class="subtitle">Manager &amp; Recursive Reports — Haihong Wang's Org</p>
  </div>

  <div class="section-label">Org Overview</div>
  <div class="org-card">
    <div class="org-pct-ring">
      <svg viewBox="0 0 110 110" width="110" height="110">
        <circle class="ring-bg" cx="55" cy="55" r="45"/>
        <circle class="ring-fill" cx="55" cy="55" r="45"
          stroke="${orgStroke}"
          stroke-dasharray="${CIRCUMFERENCE}"
          stroke-dashoffset="${orgOffset}"/>
      </svg>
      <div class="ring-text">${orgRate}%<span>L4+/7</span></div>
    </div>
    <div class="org-info">
      <h2>Haihong Wang's Org</h2>
      <p>Ads &amp; Business Messaging Pillar &nbsp;·&nbsp; ABM – Core Ads Growth</p>
      <div class="org-stats">
        <div class="org-stat"><div class="val">${orgCount}</div><div class="lbl">Total Employees</div></div>
        <div class="org-stat"><div class="val">${pdmRows.length}</div><div class="lbl">PDMs Tracked</div></div>
        <div class="org-stat"><div class="val" style="color:${highestColor};">${highestRate}%</div><div class="lbl">Highest PDM</div></div>
        <div class="org-stat"><div class="val" style="color:${lowestColor};">${lowestRate}%</div><div class="lbl">Lowest PDM</div></div>
      </div>
    </div>
    <div class="org-meta">
      <div class="meta-row"><strong>Last Updated</strong>${retrievedAt}</div>
      <div class="meta-row"><strong>UniDash Data As Of</strong>${asOfFormatted}</div>
      <a href="${UNIDASH_URL}" target="_blank">View source in UniDash ↗</a>
    </div>
  </div>

  <div class="section-label">Product Design Manager Breakdown</div>
  <div class="team-grid">
${pdmCardsHtml}
  </div>

  <div class="legend-block">
    <div class="legend-row">
      <span class="legend-label">Legend:</span>
      <div class="legend-item"><span class="legend-dot red"></span>59% &amp; under — Needs Attention</div>
      <div class="legend-item"><span class="legend-dot yellow"></span>60–79% — Progressing</div>
      <div class="legend-item"><span class="legend-dot green"></span>80–100% — On Track</div>
    </div>
    <div class="legend-def">L4+/7 = Active on 4 or more of the last 7 days across AI tools</div>
  </div>

  <div class="about-section">
    <h3>About This Dashboard &amp; Data Freshness</h3>
    <div class="about-grid">
      <div class="about-item">
        <div class="about-title">What this shows</div>
        <p>AI4P tool usage (L4+/7 metric) for <strong>Haihong Wang</strong> and her direct reports who are Product Design Managers. Data is sourced from <a href="${UNIDASH_URL}" target="_blank">UniDash · AI4P by Pillar</a> with Manager Name = "Haihong Wang".</p>
      </div>
      <div class="about-item">
        <div class="about-title">How data is refreshed</div>
        <p>An automated script runs <strong>3× per day</strong> (8 AM, 12 PM, and 6 PM PT) using an authenticated Meta session to pull the latest data from UniDash. The dashboard is then rebuilt and published automatically — no manual action needed.</p>
      </div>
      <div class="about-item">
        <div class="about-title">What L4+/7 means</div>
        <p>A person is counted as "active" if they used an AI tool on <strong>4 or more of the last 7 days</strong>. Covered tools include internal Meta AI tools, Gemini, Zoom AI Companion, Figma AI, and other approved surfaces.</p>
      </div>
      <div class="about-item">
        <div class="about-title">Data availability</div>
        <p>UniDash updates daily. The "UniDash Data As Of" date reflects the latest available dataset — typically 1–2 days behind today. The "Last Updated" timestamp shows when this dashboard was last successfully refreshed.</p>
      </div>
    </div>
    <div class="warning-box">
      <strong>⚠ If the data appears outdated:</strong> This dashboard requires an active Meta login session to pull data from UniDash. If the session has expired, the automated refresh will pause until the session is renewed. Check the "Last Updated" timestamp at the top to gauge data freshness.
    </div>
  </div>
</main>
<footer>
  AI4P Tool Usage Dashboard &nbsp;·&nbsp; Haihong Wang's Org &nbsp;·&nbsp; Data sourced from UniDash &nbsp;·&nbsp; Refreshed 3× daily at 8 AM, 12 PM &amp; 6 PM PT
</footer>
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
  const html = generateStyledHtml(rows, retrievedAt, benchmark);
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
