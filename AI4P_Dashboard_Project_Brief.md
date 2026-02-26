# Project Brief: AI4P Tool Usage Dashboard

**Date:** February 25, 2026

**Author:** Manus AI

**Status:** Completed & Live

---

### Executive Summary

This dashboard eliminates ~50 minutes of manual reporting per week across the team, reclaiming nearly **43 hours per year** by automating data pulls from UniDash and delivering a live, always-current view to any stakeholder with a single link.

---

### 1. Problem Statement

Leadership required a clear, at-a-glance, and consistently updated view of AI4P (AI for People) tool adoption within Chuanqi Li's Product Design Manager (PDM) organization. The existing data source, UniDash, is powerful but dense, making it difficult to quickly assess team performance against adoption goals without manual filtering and interpretation. There was a need for a simplified, executive-friendly dashboard that could be easily shared and understood by all stakeholders.

### 2. Solution

A live, auto-updating web dashboard was developed to provide a clean, intuitive, and immediately readable summary of AI4P usage metrics (L4+/7) for Chuanqi Li and her direct PDM reports. The solution automates the entire data-to-dashboard pipeline, from scraping the official data source to publishing the updated view to a permanent, public URL.

**Live Dashboard URL:** [https://shawn1122334455.github.io/ai4p-dashboard/](https://shawn1122334455.github.io/ai4p-dashboard/)

### 3. Key Features & Implementation

The final deliverable is a zero-maintenance, highly reliable dashboard with the following key features:

| Feature | Description |
| :--- | :--- |
| **Executive-Friendly UI** | A clean, minimalist design focused on immediate data comprehension. It replaces complex charts with simple, color-coded progress-bar cards for each PDM, allowing for quick status checks. |
| **Automated Data Refresh** | A scheduled script runs 3 times per day (8 AM, 12 PM, 6 PM PT) to automatically pull the latest data from the official UniDash source, ensuring the dashboard is always current. |
| **Permanent & Shareable URL** | The dashboard is hosted on GitHub Pages, providing a stable, permanent, and 24/7-available URL that can be bookmarked and shared with any colleague. No logins are required to view the page. |
| **Data Integrity & Transparency** | The dashboard includes a clear "About" section detailing the data source (UniDash), the refresh mechanism, and the potential for data lag due to session expiration, ensuring viewers understand the context of the data. |
| **Resilient Backup** | In addition to the live site, a copy of the dashboard's HTML file is automatically saved to the user's Google Drive on every refresh, providing a resilient backup of the latest version. |

### 4. Impact & Time Savings

The automation of this dashboard provides significant and recurring time savings across the organization, freeing up valuable time for high-impact work. By eliminating the need for manual data pulls and reporting, the dashboard streamlines the performance review process and provides immediate, on-demand insights.

| Role | Manual Task Eliminated | Estimated Time Saved (Weekly) |
| :--- | :--- | :--- |
| **DPM / Report Owner** | Manually navigating UniDash, setting filters, capturing screenshots, and compiling a weekly status email/report. | **20 minutes** |
| **Product Design Managers** | Individually logging into UniDash, filtering for their respective teams, and interpreting the raw data. | **20 minutes** (5 mins × 4 PDMs) |
| **Chuanqi Li (Org Lead)** | Sifting through manual reports or navigating UniDash to get a high-level overview of team performance. | **10 minutes** |
| **Total** | **—** | **~50 minutes per week** |

**Annualized Impact:** This automation reclaims approximately **43 hours per year** of valuable team time, previously spent on repetitive, low-value reporting tasks. This allows the team to focus on strategic design initiatives and core product work.

### 5. Outcome

The project successfully delivered a reliable, automated, and user-friendly dashboard that solves the initial problem of data visibility. Leadership and team members can now track AI4P adoption progress effortlessly via a single, permanent link, enabling better-informed conversations and data-driven decisions without any manual reporting overhead.
