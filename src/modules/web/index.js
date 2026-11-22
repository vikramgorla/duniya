// @ts-check
// Web search (2.58): agents look things up on the web with the search their AI provider runs itself (Anthropic's and
// ChatGPT's built-in web search). Nothing runs on this server: the module only declares a native tool, so the usual
// per-role ticks and the agent's Tools page decide who may search; providers without built-in search never get it.
// Queries go to the provider, never message text by Duniya; the provider's search price shows under Usage.
export const manifest = {
  id: 'web',
  tools: [{
    name: 'search', native: 'web_search', roles: ['organizer', 'participant'], participantDefault: true,
    annotations: { readOnlyHint: true },
    description: 'Search the web for current facts (opening hours, prices, news, weather, schedules), with the AI provider\'s built-in search.',
  }],
};
