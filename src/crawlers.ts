export type AiCrawlerPurpose = "ai-answers" | "indexing" | "training";

// Canonical order is significant: specific user agents must precede broad ones.
export const AI_CRAWLERS: ReadonlyArray<readonly [needle: string, vendor: string, purpose: AiCrawlerPurpose]> = [
  ["oai-searchbot", "OpenAI", "indexing"], ["chatgpt-user", "OpenAI", "ai-answers"], ["gptbot", "OpenAI", "training"],
  ["claude-searchbot", "Anthropic", "indexing"], ["claude-user", "Anthropic", "ai-answers"], ["claude-web", "Anthropic", "ai-answers"], ["claudebot", "Anthropic", "training"],
  ["google-extended", "Google", "training"], ["google-cloudvertexbot", "Google", "training"], ["google-inspectiontool", "Google", "indexing"],
  ["google-notebooklm", "Google", "ai-answers"], ["google-read-aloud", "Google", "ai-answers"], ["google-agent", "Google", "ai-answers"],
  ["googleagent", "Google", "ai-answers"], ["googleother", "Google", "training"], ["googlebot", "Google", "indexing"],
  ["meta-externalagent", "Meta", "training"], ["meta-externalfetcher", "Meta", "ai-answers"], ["meta-webindexer", "Meta", "indexing"], ["facebookbot", "Meta", "training"],
  ["applebot-extended", "Apple", "training"], ["applebot", "Apple", "indexing"],
  ["perplexity-user", "Perplexity", "ai-answers"], ["perplexitybot", "Perplexity", "indexing"],
  ["bingbot", "Microsoft", "indexing"], ["msnbot", "Microsoft", "indexing"], ["copilot", "Microsoft", "ai-answers"],
  ["mistralai-user", "Mistral", "ai-answers"], ["mistralai-index", "Mistral", "indexing"],
  ["amazon-bedrock-agentcore", "Amazon", "ai-answers"], ["amzn-user", "Amazon", "ai-answers"], ["amzn-searchbot", "Amazon", "indexing"], ["amazonbot", "Amazon", "training"],
  ["duckassistbot", "DuckDuckGo", "ai-answers"], ["xai-searchbot", "xAI", "ai-answers"], ["grok-deepsearch", "xAI", "ai-answers"],
  ["kimi-user", "Moonshot", "ai-answers"], ["kimi-searchbot", "Moonshot", "indexing"], ["kimibot", "Moonshot", "training"],
  ["qwen-user", "Alibaba", "ai-answers"], ["qwenbot", "Alibaba", "training"],
  ["tiktokspider", "ByteDance", "indexing"], ["bytespider", "ByteDance", "training"],
  ["baiduspider", "Baidu", "indexing"], ["erniebot", "Baidu", "training"], ["youbot", "You.com", "indexing"],
  ["deepseekbot", "DeepSeek", "training"], ["chatglm-spider", "Zhipu", "training"], ["cohere-training-data-crawler", "Cohere", "training"],
  ["cohere-ai", "Cohere", "training"], ["ai2bot", "AI2", "training"], ["ccbot", "Common Crawl", "training"],
];


export function classifyCrawler(userAgent: string): { vendor: string; purpose: AiCrawlerPurpose } | null {
  const ua = userAgent.toLowerCase();
  const match = AI_CRAWLERS.find(([needle]) => ua.includes(needle));
  return match ? { vendor: match[1], purpose: match[2] } : null;
}
