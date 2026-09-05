import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import AiCrawlersCard from "../frontend/src/AiCrawlersCard";
import MiniLineChart from "../frontend/src/MiniLineChart";

test("single-request charts have distinct ticks and an accessible name", () => {
  const html = renderToStaticMarkup(createElement(MiniLineChart, {
    dates: ["00:00", "01:00"],
    series: [{ label: "OpenAI", color: "blue", values: new Map([["01:00", 1]]) }],
  }));
  const ticks = [...html.matchAll(/<text[^>]*text-anchor="end"[^>]*>([^<]+)<\/text>/g)].map((match) => match[1]);
  expect(ticks).toEqual(["0", "1"]);
  expect(html).toContain('aria-label="Crawler requests over time"');
});

test("the crawler card renders vendor series and one documentation link", () => {
  const html = renderToStaticMarkup(createElement(AiCrawlersCard, { data: {
    totals: [{ label: "AI training", hits: 2 }],
    vendors: { "AI training": [{ label: "OpenAI", value: 2 }] },
    dates: ["00:00", "01:00"],
    byBucket: [{ date: "01:00", purpose: "AI training", vendor: "OpenAI", hits: 2 }],
  } }));
  expect(html).toContain('stroke="#565869"');
  expect(html.match(/href="https:\/\/github.com\/CharlesSOo\/AI-Tracker-next#readme"/g)).toHaveLength(1);
});
