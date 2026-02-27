// Runner script — calls runPipeline() with data freshly scraped from UniDash
// Data as of: 2026-02-25 | Scraped: Feb 27, 2026

import { runPipeline } from "./browser_scrape.ts";

await runPipeline({
  rows: [
    { name: "Haihong Wang",     pillar: "Ads & Business Messaging Pillar", func: "PD",     allocArea: "ABM - Core Ads Growth",     teamGroup: "Core Ads Growth XFN Team Group",                        l4_7: "79%", empCount: "94" },
    { name: "Chuanqi Li",       pillar: "Ads & Business Messaging Pillar", func: "PD",     allocArea: "ABM - Core Ads Growth",     teamGroup: "Core Ads Growth XFN Team Group",                        l4_7: "71%", empCount: "35" },
    { name: "Bolun Yang",       pillar: "Ads & Business Messaging Pillar", func: "PD",     allocArea: "ABM - Core Ads Growth",     teamGroup: "Core Ads Growth XFN Team Group",                        l4_7: "64%", empCount: "11" },
    { name: "Eleanor Pachaud",  pillar: "Ads & Business Messaging Pillar", func: "PD",     allocArea: "ABM - Core Ads Growth",     teamGroup: "Core Ads Growth XFN Team Group",                        l4_7: "67%", empCount: "12" },
    { name: "Vivian Wang (Ads)",pillar: "Ads & Business Messaging Pillar", func: "PD",     allocArea: "ABM - Core Ads Growth",     teamGroup: "Core Ads Growth XFN Team Group",                        l4_7: "71%", empCount: "7"  },
    { name: "Helen Zhou",       pillar: "Ads & Business Messaging Pillar", func: "PD",     allocArea: "ABM - Core Ads Growth",     teamGroup: "Core Ads Growth ENG Team Group",                        l4_7: "80%", empCount: "5"  },
    { name: "Ilona Parkansky",  pillar: "Ads & Business Messaging Pillar", func: "Design", allocArea: "ABM - Central & Ecosystems",teamGroup: "Monetization PG - Central & Ecosystems XFN Team Group", l4_7: "82%", empCount: "11" },
    { name: "Mirko Mandic",     pillar: "Ads & Business Messaging Pillar", func: "PD",     allocArea: "ABM - Core Ads Growth",     teamGroup: "Core Ads Growth XFN Team Group",                        l4_7: "77%", empCount: "26" },
    { name: "Dan Mortimore",    pillar: "Ads & Business Messaging Pillar", func: "PD",     allocArea: "ABM - Core Ads Growth",     teamGroup: "Core Ads Growth XFN Team Group",                        l4_7: "83%", empCount: "12" },
    { name: "Sunnie Sang",      pillar: "Ads & Business Messaging Pillar", func: "PD",     allocArea: "ABM - Core Ads Growth",     teamGroup: "Core Ads Growth XFN Team Group",                        l4_7: "60%", empCount: "5"  },
    { name: "Iris Ozgur",       pillar: "Ads & Business Messaging Pillar", func: "PD",     allocArea: "ABM - Core Ads Growth",     teamGroup: "Core Ads Growth XFN Team Group",                        l4_7: "80%", empCount: "10" },
    { name: "Nikki Jahangiri",  pillar: "Ads & Business Messaging Pillar", func: "PD",     allocArea: "ABM - Core Ads Growth",     teamGroup: "Core Ads Growth XFN Team Group",                        l4_7: "88%", empCount: "16" },
    { name: "Adam Panasowich",  pillar: "Ads & Business Messaging Pillar", func: "PD",     allocArea: "ABM - Core Ads Growth",     teamGroup: "Core Ads Growth XFN Team Group",                        l4_7: "83%", empCount: "6"  },
    { name: "Ricardo Esteves",  pillar: "Ads & Business Messaging Pillar", func: "PD",     allocArea: "ABM - Core Ads Growth",     teamGroup: "Core Ads Growth XFN Team Group",                        l4_7: "83%", empCount: "6"  },
  ],
  benchmark: {
    toplineRate: 83,
    pdFunctionRate: 77,
    dataAsOf: "2026-02-25",
  },
});
