declare module 'google-trends-api' {
  interface TrendsOptions {
    trendDate?: Date;
    geo?: string;
    category?: string;
    keyword?: string;
    startTime?: Date;
    endTime?: Date;
  }

  function dailyTrends(options: TrendsOptions): Promise<string>;
  function realTimeTrends(options: TrendsOptions): Promise<string>;
  function relatedQueries(options: TrendsOptions): Promise<string>;
  function interestOverTime(options: TrendsOptions): Promise<string>;

  export = {
    dailyTrends,
    realTimeTrends,
    relatedQueries,
    interestOverTime
  };
}