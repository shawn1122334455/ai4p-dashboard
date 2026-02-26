#!/usr/bin/env python3
"""
AI4P UniDash Scraper & Dashboard Updater
Scrapes the Manager and Recursive Reports table for Chuanqi Li from UniDash,
updates the dashboard HTML, and uploads it to Google Drive.
"""

import asyncio
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from playwright.async_api import async_playwright

UNIDASH_URL = (
    "https://www.internalfb.com/unidash/dashboard/ai_usage_at_meta/"
    "ai4p_by_pillar/overall_one_pager"
    "?dimensional_context_793502160125540=%7B%22macros%22%3A[]%2C%22limit%22%3A5%7D"
    "&events=%7B%221764239757418050%22%3A%7B%22select_manager_rollup_macro%22%3A%7B"
    "%22data%22%3A%22chuanqi%22%2C%22publisher_id%22%3A%221764239757418050%22%7D%2C"
    "%221764239757418050%22%3A%7B%22data%22%3A%22chuanqi%22%2C%22publisher_id%22%3A"
    "%221764239757418050%22%7D%7D%7D"
    "&var_1606330854110453period=%7B%22minutes_back%22%3A129600%2C%22time_type%22%3A%22dynamic%22%7D"
)

DASHBOARD_DIR = Path("/home/ubuntu/ai4p_dashboard")
HTML_OUTPUT   = DASHBOARD_DIR / "index.html"
GDRIVE_PATH   = "ai4p_dashboard/index.html"
RCLONE_CONFIG = "/home/ubuntu/.gdrive-rclone.ini"

# People to include in the dashboard (in display order)
INCLUDE_NAMES = ["Chuanqi Li", "Bolun Yang", "Eleanor Pachaud", "Vivian Wang (Ads)"]

LOG_FILE = DASHBOARD_DIR / "scrape.log"


def log(msg: str):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line)
    with open(LOG_FILE, "a") as f:
        f.write(line + "\n")


async def scrape_unidash() -> list[dict]:
    """Navigate to UniDash with Chuanqi Li pre-selected and extract table rows."""
    log("Launching browser with existing profile...")
    async with async_playwright() as p:
        browser = await p.chromium.launch_persistent_context(
            user_data_dir="/home/ubuntu/.browser_data_dir",
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        page = browser.pages[0] if browser.pages else await browser.new_page()

        log(f"Navigating to UniDash (Chuanqi Li pre-selected)...")
        await page.goto(UNIDASH_URL, wait_until="networkidle", timeout=60000)

        # Wait for the Manager and Recursive Reports table to appear
        log("Waiting for Manager and Recursive Reports table...")
        try:
            await page.wait_for_selector("text=Manager and Recursive Reports", timeout=30000)
            await page.wait_for_selector("text=Chuanqi Li", timeout=20000)
            # Extra wait for table data to fully render
            await asyncio.sleep(4)
        except Exception as e:
            log(f"Warning during wait: {e}")

        # Extract table rows
        log("Extracting table data...")
        rows = await page.evaluate("""
            () => {
                const results = [];
                // Find all table rows in the Manager and Recursive Reports section
                const tables = document.querySelectorAll('table');
                for (const table of tables) {
                    const rows = table.querySelectorAll('tbody tr');
                    for (const row of rows) {
                        const cells = row.querySelectorAll('td');
                        if (cells.length >= 7) {
                            const name = cells[0].innerText.trim().replace(/^[⤷↳\\s]+/, '').trim();
                            const pillar = cells[1].innerText.trim();
                            const func = cells[2].innerText.trim();
                            const allocArea = cells[3].innerText.trim();
                            const teamGroup = cells[4].innerText.trim();
                            const l4_7 = cells[5].innerText.trim();
                            const empCount = cells[6].innerText.trim();
                            if (name && l4_7 && l4_7.includes('%')) {
                                results.push({ name, pillar, func, allocArea, teamGroup, l4_7, empCount });
                            }
                        }
                    }
                }
                return results;
            }
        """)

        await browser.close()

        log(f"Raw rows extracted: {len(rows)}")
        return rows


def filter_rows(rows: list[dict]) -> list[dict]:
    """Keep only the rows for the 4 people in scope."""
    filtered = []
    for name in INCLUDE_NAMES:
        for row in rows:
            # Normalize comparison
            if name.lower() in row["name"].lower() or row["name"].lower() in name.lower():
                row["name"] = name  # normalize display name
                filtered.append(row)
                break
    return filtered


def get_pill_class(pct_str: str) -> str:
    """Return CSS class based on new thresholds: <70 red, 70-84 yellow, 85+ green."""
    try:
        val = int(pct_str.replace("%", "").strip())
        if val >= 85:
            return "green"
        elif val >= 70:
            return "yellow"
        else:
            return "low"
    except:
        return "low"


def get_bar_color(pct_str: str) -> str:
    try:
        val = int(pct_str.replace("%", "").strip())
        if val >= 85:
            return "#166534"
        elif val >= 70:
            return "#92400e"
        else:
            return "#b91c1c"
    except:
        return "#b91c1c"


def get_bar_chart_color(pct_str: str) -> str:
    try:
        val = int(pct_str.replace("%", "").strip())
        if val >= 85:
            return "#36b37e"
        elif val >= 70:
            return "#f5a623"
        else:
            return "#b91c1c"
    except:
        return "#b91c1c"


def build_table_rows(rows: list[dict]) -> str:
    html = ""
    for i, row in enumerate(rows):
        is_manager = row["name"] == "Chuanqi Li"
        indent = ""
        if not is_manager:
            # Check if Vivian Wang (sub-report of Eleanor)
            if "Vivian" in row["name"]:
                indent = "padding-left:48px;"
            else:
                indent = "padding-left:28px;"

        row_class = ' class="manager-row"' if is_manager else ""
        pill = get_pill_class(row["l4_7"])
        bar_color = get_bar_color(row["l4_7"])
        pct_val = row["l4_7"].replace("%", "").strip()

        html += f"""        <tr{row_class}>
          <td style="{indent}"><span class="chain-arrow">↳</span>{row['name']}</td>
          <td>{row['pillar']}</td>
          <td>{row['func']}</td>
          <td>{row['allocArea']}</td>
          <td>{row['teamGroup']}</td>
          <td>
            <span class="usage-pill {pill}">{row['l4_7']}</span>
            <span class="progress-bar-bg"><span class="progress-bar-fill" style="width:{pct_val}%;background:{bar_color};"></span></span>
          </td>
          <td>{row['empCount']}</td>
        </tr>\n"""
    return html


def build_kpi_cards(rows: list[dict]) -> dict:
    """Compute KPI values from the scraped rows."""
    org_row = next((r for r in rows if r["name"] == "Chuanqi Li"), None)
    pdm_rows = [r for r in rows if r["name"] != "Chuanqi Li"]

    org_pct = org_row["l4_7"] if org_row else "N/A"
    org_count = org_row["empCount"] if org_row else "N/A"

    if pdm_rows:
        def pct_val(r):
            try: return int(r["l4_7"].replace("%","").strip())
            except: return 0
        highest = max(pdm_rows, key=pct_val)
        lowest  = min(pdm_rows, key=pct_val)
    else:
        highest = lowest = None

    return {
        "org_pct": org_pct,
        "org_count": org_count,
        "highest_pct": highest["l4_7"] if highest else "N/A",
        "highest_name": highest["name"] if highest else "N/A",
        "highest_count": highest["empCount"] if highest else "N/A",
        "lowest_pct": lowest["l4_7"] if lowest else "N/A",
        "lowest_name": lowest["name"] if lowest else "N/A",
        "lowest_count": lowest["empCount"] if lowest else "N/A",
    }


def build_chart_data(rows: list[dict]) -> tuple[str, str, str]:
    """Build JS arrays for the bar chart."""
    labels = json.dumps([r["name"].replace(" (Ads)", "\n(Ads)") for r in rows])
    data   = json.dumps([int(r["l4_7"].replace("%","").strip()) for r in rows])
    colors = json.dumps([get_bar_chart_color(r["l4_7"]) for r in rows])
    return labels, data, colors


def build_doughnut_data(rows: list[dict]) -> tuple[str, str]:
    pdm_rows = [r for r in rows if r["name"] != "Chuanqi Li"]
    labels = json.dumps([f"{r['name']} ({r['empCount']})" for r in pdm_rows])
    data   = json.dumps([int(r["empCount"]) if r["empCount"].isdigit() else 0 for r in pdm_rows])
    return labels, data


def generate_html(rows: list[dict], retrieved_at: str, data_as_of: str) -> str:
    kpi = build_kpi_cards(rows)
    table_rows = build_table_rows(rows)
    bar_labels, bar_data, bar_colors = build_chart_data(rows)
    doughnut_labels, doughnut_data = build_doughnut_data(rows)

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AI4P Tool Usage Dashboard – Chuanqi Li's Org</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.2/dist/chart.umd.min.js"></script>
  <style>
    *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #f0f2f5;
      color: #1c1e21;
      min-height: 100vh;
    }}
    header {{
      background: linear-gradient(135deg, #0866ff 0%, #0052cc 100%);
      color: #fff;
      padding: 28px 40px 24px;
    }}
    header .badge {{
      display: inline-block;
      background: rgba(255,255,255,0.2);
      border-radius: 20px;
      padding: 3px 12px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.8px;
      text-transform: uppercase;
      margin-bottom: 10px;
    }}
    header h1 {{ font-size: 26px; font-weight: 700; line-height: 1.3; }}
    header p {{ margin-top: 6px; font-size: 13px; opacity: 0.85; }}
    .header-meta {{ display: flex; gap: 24px; margin-top: 14px; flex-wrap: wrap; }}
    .header-meta span {{ font-size: 12px; opacity: 0.8; }}
    .header-meta strong {{ opacity: 1; font-weight: 600; }}
    .data-source {{
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(255,255,255,0.15);
      border-radius: 6px;
      padding: 5px 12px;
      font-size: 11px;
      margin-top: 12px;
    }}
    .data-source a {{ color: #fff; text-decoration: underline; opacity: 0.9; }}
    main {{ max-width: 1200px; margin: 0 auto; padding: 32px 24px 48px; }}
    .section-title {{
      font-size: 13px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.7px;
      color: #65676b;
      margin-bottom: 14px;
    }}
    .kpi-grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 32px;
    }}
    .kpi-card {{
      background: #fff;
      border-radius: 12px;
      padding: 20px 22px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.08);
      border-top: 4px solid #0866ff;
      transition: box-shadow 0.2s;
    }}
    .kpi-card:hover {{ box-shadow: 0 4px 16px rgba(0,0,0,0.12); }}
    .kpi-card.warn  {{ border-top-color: #f5a623; }}
    .kpi-card.good  {{ border-top-color: #36b37e; }}
    .kpi-label {{
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: #65676b;
      margin-bottom: 8px;
    }}
    .kpi-value {{ font-size: 34px; font-weight: 700; color: #1c1e21; line-height: 1; }}
    .kpi-sub {{ font-size: 12px; color: #65676b; margin-top: 6px; }}
    .charts-row {{
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 32px;
    }}
    @media (max-width: 720px) {{ .charts-row {{ grid-template-columns: 1fr; }} }}
    .chart-card {{
      background: #fff;
      border-radius: 12px;
      padding: 22px 24px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.08);
    }}
    .chart-card h3 {{ font-size: 14px; font-weight: 600; color: #1c1e21; margin-bottom: 16px; }}
    .chart-wrap {{ position: relative; height: 240px; }}
    .table-card {{
      background: #fff;
      border-radius: 12px;
      padding: 22px 24px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.08);
      margin-bottom: 32px;
      overflow-x: auto;
    }}
    .table-card h3 {{ font-size: 14px; font-weight: 600; color: #1c1e21; margin-bottom: 4px; }}
    .table-note {{ font-size: 11px; color: #65676b; font-style: italic; margin-bottom: 16px; }}
    table {{ width: 100%; border-collapse: collapse; font-size: 13px; }}
    thead tr {{ background: #f0f2f5; }}
    thead th {{
      text-align: left;
      padding: 10px 14px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #65676b;
      border-bottom: 2px solid #e4e6eb;
      white-space: nowrap;
    }}
    tbody tr {{ border-bottom: 1px solid #e4e6eb; transition: background 0.15s; }}
    tbody tr:last-child {{ border-bottom: none; }}
    tbody tr:hover {{ background: #f7f8fa; }}
    tbody td {{ padding: 12px 14px; vertical-align: middle; }}
    tbody tr.manager-row td {{ font-weight: 700; background: #eef3ff; }}
    tbody tr.manager-row:hover {{ background: #e4ecff; }}
    .chain-arrow {{ color: #65676b; margin-right: 4px; font-size: 12px; }}
    .usage-pill {{
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border-radius: 20px;
      padding: 4px 10px;
      font-size: 12px;
      font-weight: 700;
    }}
    .usage-pill.low    {{ background: #fde8e8; color: #b91c1c; }}
    .usage-pill.yellow {{ background: #fef9c3; color: #92400e; }}
    .usage-pill.green  {{ background: #dcfce7; color: #166534; }}
    .progress-bar-bg {{
      background: #e4e6eb;
      border-radius: 4px;
      height: 6px;
      width: 80px;
      display: inline-block;
      vertical-align: middle;
      margin-left: 8px;
    }}
    .progress-bar-fill {{ height: 100%; border-radius: 4px; }}
    .scope-note {{
      background: #fff;
      border-radius: 12px;
      padding: 16px 22px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.08);
      margin-bottom: 32px;
      font-size: 12px;
      color: #444;
      border-left: 4px solid #0866ff;
    }}
    .scope-note strong {{ color: #1c1e21; }}
    footer {{ text-align: center; font-size: 11px; color: #65676b; padding-bottom: 24px; }}
    footer a {{ color: #0866ff; text-decoration: none; }}
    .refresh-badge {{
      display: inline-block;
      background: rgba(255,255,255,0.25);
      border-radius: 6px;
      padding: 4px 10px;
      font-size: 11px;
      margin-top: 8px;
    }}
  </style>
</head>
<body>

<header>
  <div class="badge">AI4P · Product Design · Auto-Refreshed 3×/Day</div>
  <h1>AI4P Tool Usage Dashboard</h1>
  <p>Manager &amp; Recursive Reports — Chuanqi Li's Org</p>
  <div class="header-meta">
    <span><strong>Data as of:</strong> {data_as_of}</span>
  </div>
  <div class="data-source">
    &#128279; Data sourced live from
    <a href="https://www.internalfb.com/unidash/dashboard/ai_usage_at_meta/ai4p_by_pillar/overall_one_pager" target="_blank">UniDash · AI4P by Pillar</a>
    &nbsp;· Last refreshed: {retrieved_at}
  </div>
  <div class="refresh-badge">&#128260; Auto-refreshes 3× daily (8 AM, 12 PM, 6 PM PT)</div>
</header>

<main>

  <div class="scope-note">
    <strong>Dashboard Scope:</strong> This dashboard shows AI4P tool usage for <strong>Chuanqi Li</strong> and her direct and recursive reports who are Product Design Managers (PDM):
    Bolun Yang, Eleanor Pachaud, and Vivian Wang (Ads). Data is pulled directly from UniDash with Manager Name = "Chuanqi Li".
  </div>

  <p class="section-title">Key Metrics</p>
  <div class="kpi-grid">
    <div class="kpi-card">
      <div class="kpi-label">Org AI Usage (L4+/7)</div>
      <div class="kpi-value">{kpi['org_pct']}</div>
      <div class="kpi-sub">Chuanqi Li's full org · {kpi['org_count']} employees</div>
    </div>
    <div class="kpi-card good">
      <div class="kpi-label">Highest Usage (PDM)</div>
      <div class="kpi-value">{kpi['highest_pct']}</div>
      <div class="kpi-sub">{kpi['highest_name']} · {kpi['highest_count']} employees</div>
    </div>
    <div class="kpi-card warn">
      <div class="kpi-label">Lowest Usage (PDM)</div>
      <div class="kpi-value">{kpi['lowest_pct']}</div>
      <div class="kpi-sub">{kpi['lowest_name']} · {kpi['lowest_count']} employees</div>
    </div>
  </div>

  <p class="section-title">Usage Breakdown</p>
  <div class="charts-row">
    <div class="chart-card">
      <h3>AI Usage Rate (L4+/7) by Manager</h3>
      <div class="chart-wrap">
        <canvas id="barChart"></canvas>
      </div>
    </div>
    <div class="chart-card">
      <h3>Team Size Distribution (PDMs)</h3>
      <div class="chart-wrap">
        <canvas id="doughnutChart"></canvas>
      </div>
    </div>
  </div>

  <p class="section-title">Manager and Recursive Reports</p>
  <div class="table-card">
    <h3>Detailed View — Manager: Chuanqi Li</h3>
    <p class="table-note">
      Note: This table is impacted by the global filters above, except date (which is limited to the latest ds).
      Data sourced directly from UniDash AI4P by Pillar dashboard, Manager Name = "Chuanqi Li". As of {data_as_of}.
    </p>
    <table>
      <thead>
        <tr>
          <th>Mgr + Chain</th>
          <th>Pillar Name</th>
          <th>Function</th>
          <th>Allocation Area Name</th>
          <th>Team Group Name</th>
          <th>L4+/7</th>
          <th>Recursive Employee Count</th>
        </tr>
      </thead>
      <tbody>
{table_rows}      </tbody>
    </table>
  </div>

  <div style="background:#fff;border-radius:12px;padding:18px 24px;box-shadow:0 1px 4px rgba(0,0,0,0.08);margin-bottom:32px;">
    <p class="section-title" style="margin-bottom:10px;">Usage Rate Legend (L4+/7)</p>
    <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:12px;align-items:center;">
      <span><span class="usage-pill low">Under 70%</span> &nbsp;Red — needs attention</span>
      <span><span class="usage-pill yellow">70–84%</span> &nbsp;Yellow — progressing</span>
      <span><span class="usage-pill green">85–100%</span> &nbsp;Green — on track</span>
    </div>
    <p style="margin-top:12px;font-size:11px;color:#65676b;">
      <strong>L4+/7</strong> = Active on 4 or more of the last 7 days. Includes internal AI tools, Gemini, Zoom AI Companion, Figma AI, and other covered surfaces.
    </p>
  </div>

</main>

<footer>
  Data sourced live from <a href="https://www.internalfb.com/unidash/dashboard/ai_usage_at_meta/ai4p_by_pillar/overall_one_pager" target="_blank">UniDash · AI4P by Pillar</a>
  &nbsp;|&nbsp; Manager: Chuanqi Li &nbsp;|&nbsp; Function: PD &nbsp;|&nbsp; Data as of {data_as_of} &nbsp;|&nbsp; Last refreshed: {retrieved_at}
</footer>

<script>
  const barCtx = document.getElementById('barChart').getContext('2d');
  new Chart(barCtx, {{
    type: 'bar',
    data: {{
      labels: {bar_labels},
      datasets: [{{
        label: 'L4+/7 Usage Rate (%)',
        data: {bar_data},
        backgroundColor: {bar_colors},
        borderRadius: 6,
        borderSkipped: false,
      }}]
    }},
    options: {{
      responsive: true,
      maintainAspectRatio: false,
      plugins: {{
        legend: {{ display: false }},
        tooltip: {{
          callbacks: {{
            label: ctx => ` ${{ctx.parsed.y}}% AI usage rate (L4+/7)`
          }}
        }}
      }},
      scales: {{
        y: {{
          beginAtZero: true,
          max: 100,
          ticks: {{ callback: v => v + '%', font: {{ size: 11 }} }},
          grid: {{ color: '#e4e6eb' }}
        }},
        x: {{
          ticks: {{ font: {{ size: 11 }} }},
          grid: {{ display: false }}
        }}
      }}
    }}
  }});

  const dCtx = document.getElementById('doughnutChart').getContext('2d');
  new Chart(dCtx, {{
    type: 'doughnut',
    data: {{
      labels: {doughnut_labels},
      datasets: [{{
        data: {doughnut_data},
        backgroundColor: ['#f5a623', '#6554c0', '#36b37e'],
        borderWidth: 2,
        borderColor: '#fff',
        hoverOffset: 6
      }}]
    }},
    options: {{
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: {{
        legend: {{
          position: 'bottom',
          labels: {{ font: {{ size: 11 }}, padding: 12, boxWidth: 12 }}
        }},
        tooltip: {{
          callbacks: {{
            label: ctx => ` ${{ctx.label}}: ${{ctx.parsed}} employees`
          }}
        }}
      }}
    }}
  }});
</script>
</body>
</html>"""


def upload_to_gdrive():
    """Upload the dashboard HTML to Google Drive."""
    log("Uploading to Google Drive...")
    result = subprocess.run(
        ["rclone", "copyto", str(HTML_OUTPUT),
         f"manus_google_drive:{GDRIVE_PATH}",
         "--config", RCLONE_CONFIG],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        log(f"Upload error: {result.stderr}")
        return False
    log("Upload to Google Drive successful.")
    return True


async def main():
    log("=" * 60)
    log("Starting AI4P dashboard refresh...")

    # Scrape data
    try:
        raw_rows = await scrape_unidash()
    except Exception as e:
        log(f"ERROR during scrape: {e}")
        sys.exit(1)

    # Filter to the 4 people in scope
    rows = filter_rows(raw_rows)
    log(f"Filtered rows: {[r['name'] for r in rows]}")

    if not rows:
        log("ERROR: No matching rows found. Keeping existing dashboard.")
        sys.exit(1)

    # Determine data_as_of from the page or use today
    retrieved_at = datetime.now().strftime("%b %d, %Y at %I:%M %p PT")
    # Try to extract the "As of" date from the scraped page context
    data_as_of = datetime.now().strftime("%Y-%m-%d") + " (latest ds)"

    # Generate HTML
    html = generate_html(rows, retrieved_at, data_as_of)

    # Write to file
    HTML_OUTPUT.write_text(html, encoding="utf-8")
    log(f"Dashboard HTML written to {HTML_OUTPUT}")

    # Upload to Google Drive
    success = upload_to_gdrive()
    if not success:
        log("WARNING: Google Drive upload failed.")

    log("Dashboard refresh complete.")
    log("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
