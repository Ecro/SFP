import googleTrends from 'google-trends-api';
import { createLogger } from '../utils/logger';

const logger = createLogger('TrendsService');

export interface TrendTopic {
  keyword: string;
  score: number;
  region: string;
  category: string;
  relatedQueries: string[];
  predictedViews: number;
  volatility: number;
  competitiveness: number;
}

export interface TrendDiscoveryResult {
  topics: TrendTopic[];
  selectedTopic: TrendTopic | null;
  timestamp: Date;
}

export class TrendsService {
  private readonly region: string;
  private readonly language: string;

  constructor(region: string = 'KR', language: string = 'ko') {
    this.region = region;
    this.language = language;
  }

  async discoverTrends(): Promise<TrendDiscoveryResult> {
    try {
      logger.info('Starting trend discovery process');
      
      // Use a fallback approach with predefined keywords for Korean market
      const koreanKeywords = [
        'AI', '인공지능', '아이폰', '삼성', '게임', '먹방', '음식', '여행', 
        '드라마', 'K-pop', '축구', '야구', '주식', '부동산', '날씨',
        '코로나', '백신', '영화', '넷플릭스', '유튜브', '틱톡'
      ];
      
      const allTopics = await this.analyzeKeywordTrends(koreanKeywords);
      const rankedTopics = await this.rankTopics(allTopics);
      const top5Topics = rankedTopics.slice(0, 5);
      
      const selectedTopic = this.selectFinalTopic(top5Topics);

      logger.info(`Analyzed ${koreanKeywords.length} keywords, found ${allTopics.length} trending topics, selected: ${selectedTopic?.keyword}`);

      return {
        topics: top5Topics,
        selectedTopic,
        timestamp: new Date()
      };
    } catch (error) {
      logger.error('Error discovering trends:', error);
      throw error;
    }
  }

  private async getDailyTrends(): Promise<TrendTopic[]> {
    try {
      logger.debug('Fetching daily trends...');
      const response = await googleTrends.dailyTrends({
        geo: this.region,
      });

      logger.debug('Daily trends response length:', response.length);
      const data = JSON.parse(response);
      const trends = data.default?.trendingSearchesDays?.[0]?.trendingSearches || [];

      return Promise.all(
        trends.slice(0, 10).map(async (trend: any) => {
          const keyword = trend.title?.query || '';
          const relatedQueries = await this.getRelatedQueries(keyword);
          
          return {
            keyword,
            score: parseInt(trend.formattedTraffic?.replace(/[,+]/g, '') || '0'),
            region: this.region,
            category: trend.articles?.[0]?.source || 'general',
            relatedQueries,
            predictedViews: this.calculatePredictedViews(trend),
            volatility: this.calculateVolatility(trend),
            competitiveness: await this.calculateCompetitiveness(keyword)
          };
        })
      );
    } catch (error) {
      logger.error('Error fetching daily trends:', error);
      return [];
    }
  }

  private async analyzeKeywordTrends(keywords: string[]): Promise<TrendTopic[]> {
    const topics: TrendTopic[] = [];
    
    for (let i = 0; i < keywords.length; i++) {
      const keyword = keywords[i];
      try {
        logger.debug(`Analyzing keyword: ${keyword} (${i + 1}/${keywords.length})`);
        
        const interestResponse = await googleTrends.interestOverTime({
          keyword,
          geo: this.region,
          startTime: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
        });

        if (interestResponse.startsWith('<')) {
          logger.warn(`Skipping ${keyword}: API returned HTML (likely rate limited)`);
          continue;
        }

        const data = JSON.parse(interestResponse);
        const timeline = data.default?.timelineData || [];
        
        if (timeline.length === 0) {
          logger.debug(`No data for keyword: ${keyword}`);
          continue;
        }

        const values = timeline.map((t: any) => t.value?.[0] || 0);
        const avgInterest = values.reduce((a: number, b: number) => a + b, 0) / values.length;
        const maxInterest = Math.max(...values);
        const recentInterest = values.slice(-2).reduce((a: number, b: number) => a + b, 0) / 2;
        
        // Calculate volatility based on recent vs average interest
        const volatility = recentInterest > avgInterest ? (recentInterest - avgInterest) / 100 : 0;
        
        // Only include keywords with decent interest levels
        if (avgInterest > 20 && keyword) {
          const relatedQueries = await this.getRelatedQueries(keyword);
          
          topics.push({
            keyword: keyword,
            score: Math.round(avgInterest),
            region: this.region,
            category: this.categorizeKeyword(keyword),
            relatedQueries,
            predictedViews: Math.round(avgInterest * maxInterest * 100),
            volatility: Math.min(volatility, 1),
            competitiveness: avgInterest / 100
          });
        }

        // Add delay to avoid rate limiting
        if (i < keywords.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        
      } catch (error) {
        logger.warn(`Error analyzing keyword "${keyword}":`, error instanceof Error ? error.message : String(error));
      }
    }
    
    logger.info(`Successfully analyzed ${topics.length} trending keywords`);
    return topics;
  }

  private categorizeKeyword(keyword: string): string {
    const categories: { [key: string]: string[] } = {
      'technology': ['AI', '인공지능', '아이폰', '삼성', '유튜브', '틱톡', '넷플릭스'],
      'entertainment': ['게임', '드라마', 'K-pop', '영화', '먹방'],
      'sports': ['축구', '야구'],
      'finance': ['주식', '부동산'],
      'lifestyle': ['음식', '여행', '날씨'],
      'health': ['코로나', '백신']
    };
    
    for (const [category, keywords] of Object.entries(categories)) {
      if (keywords.includes(keyword)) {
        return category;
      }
    }
    
    return 'general';
  }

  private async getRealTimeTrends(): Promise<TrendTopic[]> {
    try {
      logger.debug('Fetching real-time trends...');
      const response = await googleTrends.realTimeTrends({
        geo: this.region,
        category: 'all',
      });

      logger.debug('Real-time trends response length:', response.length);
      const data = JSON.parse(response);
      const trends = data.storySummaries?.trendingStories || [];

      return Promise.all(
        trends.slice(0, 5).map(async (story: any) => {
          const keyword = story.title || '';
          const relatedQueries = await this.getRelatedQueries(keyword);
          
          return {
            keyword,
            score: story.entityNames?.length || 1,
            region: this.region,
            category: 'real-time',
            relatedQueries,
            predictedViews: this.calculatePredictedViewsFromStory(story),
            volatility: 0.8, // Real-time trends are highly volatile
            competitiveness: await this.calculateCompetitiveness(keyword)
          };
        })
      );
    } catch (error) {
      logger.error('Error fetching real-time trends:', error);
      return [];
    }
  }

  private async getRelatedQueries(keyword: string): Promise<string[]> {
    try {
      const response = await googleTrends.relatedQueries({
        keyword,
        geo: this.region,
        startTime: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
      });

      const data = JSON.parse(response);
      const queries = data.default?.rankedList?.[0]?.rankedKeyword || [];
      
      return queries.slice(0, 5).map((q: any) => q.query || '');
    } catch (error) {
      logger.warn(`Error fetching related queries for "${keyword}":`, error);
      return [];
    }
  }

  private async rankTopics(topics: TrendTopic[]): Promise<TrendTopic[]> {
    return topics
      .filter(topic => topic.keyword && topic.keyword.length > 0)
      .sort((a, b) => b.predictedViews - a.predictedViews);
  }

  private selectFinalTopic(topics: TrendTopic[]): TrendTopic | null {
    if (topics.length === 0) return null;

    // Weighted scoring: 60% predicted views, 25% volatility, 15% inverse competitiveness
    const scoredTopics = topics.map(topic => ({
      ...topic,
      finalScore: 
        (topic.predictedViews * 0.6) + 
        (topic.volatility * 100 * 0.25) + 
        ((1 - topic.competitiveness) * 100 * 0.15)
    }));

    return scoredTopics.sort((a, b) => b.finalScore - a.finalScore)[0] || null;
  }

  private calculatePredictedViews(trend: any): number {
    const traffic = parseInt(trend.formattedTraffic?.replace(/[,+]/g, '') || '0');
    const articles = trend.articles?.length || 1;
    
    // Estimate views based on search traffic and article count
    return Math.round(traffic * articles * 0.1);
  }

  private calculatePredictedViewsFromStory(story: any): number {
    const entities = story.entityNames?.length || 1;
    const shareCount = story.shareCount || 100;
    
    return Math.round(shareCount * entities * 0.05);
  }

  private calculateVolatility(trend: any): number {
    // Higher volatility for trends with more recent articles
    const recentArticles = trend.articles?.filter((article: any) => {
      const articleTime = new Date(article.timeAgo || 0);
      const hoursAgo = (Date.now() - articleTime.getTime()) / (1000 * 60 * 60);
      return hoursAgo <= 24;
    }).length || 0;

    return Math.min(recentArticles / 10, 1);
  }

  private async calculateCompetitiveness(keyword: string): Promise<number> {
    try {
      // Get interest over time to gauge competitiveness
      const response = await googleTrends.interestOverTime({
        keyword,
        geo: this.region,
        startTime: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
      });

      const data = JSON.parse(response);
      const timeline = data.default?.timelineData || [];
      
      if (timeline.length === 0) return 0.5; // Default moderate competitiveness

      const values = timeline.map((t: any) => t.value?.[0] || 0);
      const avgInterest = values.reduce((a: number, b: number) => a + b, 0) / values.length;
      
      // Higher average interest = higher competitiveness
      return Math.min(avgInterest / 100, 1);
    } catch (error) {
      logger.warn(`Error calculating competitiveness for "${keyword}":`, error);
      return 0.5; // Default moderate competitiveness
    }
  }
}