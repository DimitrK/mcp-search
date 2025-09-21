// Placeholder for Google Search Client
// Implementation will be added in Milestone 2

export interface GoogleSearchResult {
  queries: Array<{
    query: string;
    result: unknown;
  }>;
}

export class GoogleClient {
  constructor(
    private _apiKey: string,
    private _searchEngineId: string
  ) {
    // Placeholder constructor
  }

  async search(
    _query: string | string[],
    _options?: {
      resultsPerQuery?: number;
    }
  ): Promise<GoogleSearchResult> {
    // TODO: Implement in Milestone 2
    throw new Error('GoogleClient.search not yet implemented');
  }
}
