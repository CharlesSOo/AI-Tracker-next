export type AiCrawlers = {
  totals: { label: string; hits: number }[];
  vendors: Record<string, { label: string; value: number; icon?: string }[]>;
  series: { date: string; hits: number }[];
  byBucket: { date: string; purpose: string; vendor: string; hits: number }[];
};
