import googleTrends from 'google-trends-api';
import { createLogger } from '../utils/logger';
import { NaverTrendsService, NaverTrendTopic } from './naverTrendsService';
import { YouTubeTrendsService, YouTubeTrendTopic } from './youtubeTrendsService';

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
  source?: 'google' | 'naver' | 'youtube';
  growth?: number;
  searchVolume?: number;
  trendScore?: number;
}

export interface TrendDiscoveryResult {
  topics: TrendTopic[];
  selectedTopic: TrendTopic | null;
  timestamp: Date;
  sources: string[];
  totalTopicsDiscovered: number;
}

export class TrendsService {
  private readonly region: string;
  private readonly language: string;
  private readonly naverTrendsService: NaverTrendsService;
  private readonly youtubeTrendsService: YouTubeTrendsService;

  constructor(region: string = 'KR', language: string = 'ko') {
    this.region = region;
    this.language = language;
    this.naverTrendsService = new NaverTrendsService();
    this.youtubeTrendsService = new YouTubeTrendsService();
  }

  async discoverTrends(): Promise<TrendDiscoveryResult> {
    try {
      logger.info('Starting enhanced multi-source trend discovery process');
      
      const allTopics: TrendTopic[] = [];
      const sources: string[] = [];
      let totalTopicsDiscovered = 0;

      // 1. Discover trends from Naver (highest priority for Korean market)
      try {
        logger.info('Fetching trends from Naver...');
        const naverTopics = await this.naverTrendsService.discoverTrendingKeywords();
        const convertedNaverTopics = naverTopics.map(this.convertNaverTopicToTrendTopic);
        allTopics.push(...convertedNaverTopics);
        totalTopicsDiscovered += naverTopics.length;
        sources.push('naver');
        logger.info(`Found ${naverTopics.length} trending topics from Naver`);
      } catch (error) {
        logger.warn('Failed to fetch Naver trends:', error);
      }

      // 2. Discover trends from YouTube
      try {
        logger.info('Fetching trends from YouTube...');
        const youtubeTopics = await this.youtubeTrendsService.getTrendingVideos(this.region, undefined, 20);
        const convertedYouTubeTopics = youtubeTopics.map(this.convertYouTubeTopicToTrendTopic);
        allTopics.push(...convertedYouTubeTopics);
        totalTopicsDiscovered += youtubeTopics.length;
        sources.push('youtube');
        logger.info(`Found ${youtubeTopics.length} trending topics from YouTube`);
      } catch (error) {
        logger.warn('Failed to fetch YouTube trends:', error);
      }

      // 3. Enhanced Google Trends with dynamic keyword discovery
      try {
        logger.info('Fetching trends from Google Trends...');
        const dynamicKeywords = await this.getDynamicKeywords();
        const googleTopics = await this.analyzeKeywordTrends(dynamicKeywords);
        allTopics.push(...googleTopics);
        totalTopicsDiscovered += googleTopics.length;
        sources.push('google');
        logger.info(`Found ${googleTopics.length} trending topics from Google Trends`);
      } catch (error) {
        logger.warn('Failed to fetch Google Trends:', error);
      }

      // 4. Fallback to predefined topics if all sources fail
      if (allTopics.length === 0) {
        logger.warn('All trend sources failed, using fallback trending topics');
        const fallbackTopics = this.getFallbackTrendingTopics();
        allTopics.push(...fallbackTopics);
        totalTopicsDiscovered += fallbackTopics.length;
        sources.push('fallback');
      }

      // Rank and select topics
      const rankedTopics = await this.rankTopics(allTopics);
      const top10Topics = rankedTopics.slice(0, 10);
      const selectedTopic = this.selectFinalTopic(top10Topics);

      logger.info(`Multi-source trend discovery completed: ${totalTopicsDiscovered} total topics from ${sources.length} sources, selected: ${selectedTopic?.keyword}`);

      return {
        topics: top10Topics,
        selectedTopic,
        timestamp: new Date(),
        sources,
        totalTopicsDiscovered
      };
    } catch (error) {
      logger.error('Error in multi-source trend discovery:', error);
      throw error;
    }
  }

  private convertNaverTopicToTrendTopic = (naverTopic: NaverTrendTopic): TrendTopic => {
    return {
      keyword: naverTopic.keyword,
      score: naverTopic.searchVolume,
      region: this.region,
      category: naverTopic.category,
      relatedQueries: naverTopic.relatedKeywords,
      predictedViews: naverTopic.searchVolume * 100, // Estimate based on search volume
      volatility: naverTopic.growth / 100, // Convert percentage to decimal
      competitiveness: Math.min(naverTopic.searchVolume / 100, 1),
      source: 'naver',
      growth: naverTopic.growth,
      searchVolume: naverTopic.searchVolume
    };
  };

  private convertYouTubeTopicToTrendTopic = (youtubeTopic: YouTubeTrendTopic): TrendTopic => {
    return {
      keyword: youtubeTopic.keyword,
      score: Math.round(youtubeTopic.viewCount / 10000), // Scale down view count
      region: this.region,
      category: this.mapYouTubeCategoryToGeneral(youtubeTopic.categoryId),
      relatedQueries: youtubeTopic.tags.slice(0, 5),
      predictedViews: youtubeTopic.viewCount,
      volatility: this.calculateYouTubeVolatility(youtubeTopic),
      competitiveness: Math.min(youtubeTopic.viewCount / 1000000, 1), // Normalize to 0-1
      source: 'youtube',
      trendScore: youtubeTopic.trendScore
    };
  };

  private mapYouTubeCategoryToGeneral(categoryId: string): string {
    const categoryMap: { [key: string]: string } = {
      '1': 'entertainment', // Film & Animation
      '2': 'entertainment', // Autos & Vehicles  
      '10': 'lifestyle', // Music
      '15': 'lifestyle', // Pets & Animals
      '17': 'lifestyle', // Sports
      '19': 'lifestyle', // Travel & Events
      '20': 'entertainment', // Gaming
      '22': 'lifestyle', // People & Blogs
      '23': 'entertainment', // Comedy
      '24': 'entertainment', // Entertainment
      '25': 'lifestyle', // News & Politics
      '26': 'lifestyle', // Howto & Style
      '27': 'lifestyle', // Education
      '28': 'technology' // Science & Technology
    };
    
    return categoryMap[categoryId] || 'general';
  }

  private calculateYouTubeVolatility(topic: YouTubeTrendTopic): number {
    // Calculate volatility based on engagement rate and recency
    const engagementRate = topic.viewCount > 0 ? 
      (topic.likeCount + topic.commentCount) / topic.viewCount : 0;
    
    const publishedAt = new Date(topic.publishedAt);
    const daysSincePublished = (Date.now() - publishedAt.getTime()) / (1000 * 60 * 60 * 24);
    const recencyFactor = Math.max(0, (30 - daysSincePublished) / 30);
    
    return Math.min(engagementRate * 10 * recencyFactor, 1);
  }

  private async getDynamicKeywords(): Promise<string[]> {
    try {
      logger.debug('Generating dynamic keywords from multiple sources');
      
      const keywords: string[] = [];
      
      // Get popular keywords from Naver if available
      if (this.naverTrendsService.isConfigured()) {
        try {
          const naverKeywords = await this.naverTrendsService.getPopularKeywords();
          keywords.push(...naverKeywords.slice(0, 10));
        } catch (error) {
          logger.warn('Failed to get Naver popular keywords:', error);
        }
      }

      // Get popular search terms from YouTube if available
      if (this.youtubeTrendsService.isConfigured()) {
        try {
          const youtubeTerms = await this.youtubeTrendsService.getPopularSearchTerms();
          keywords.push(...youtubeTerms.slice(0, 10));
        } catch (error) {
          logger.warn('Failed to get YouTube popular terms:', error);
        }
      }

      // Add base Korean keywords if we don't have enough
      const baseKeywords = [
        'AI', '인공지능', '아이폰', '삼성', '게임', '먹방', '음식', '여행', 
        '드라마', 'K-pop', '축구', '야구', '주식', '부동산', '날씨',
        '코로나', '백신', '영화', '넷플릭스', '유튜브', '틱톡'
      ];

      if (keywords.length < 15) {
        keywords.push(...baseKeywords);
      }

      // Remove duplicates and limit to 30 keywords
      const uniqueKeywords = [...new Set(keywords)].slice(0, 30);
      
      logger.info(`Generated ${uniqueKeywords.length} dynamic keywords for Google Trends analysis`);
      return uniqueKeywords;
      
    } catch (error) {
      logger.error('Error generating dynamic keywords:', error);
      // Return base keywords as fallback
      return [
        'AI', '인공지능', '아이폰', '삼성', '게임', '먹방', '음식', '여행', 
        '드라마', 'K-pop', '축구', '야구', '주식', '부동산', '날씨',
        '코로나', '백신', '영화', '넷플릭스', '유튜브', '틱톡'
      ];
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
            competitiveness: avgInterest / 100,
            source: 'google'
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

  private getFallbackTrendingTopics(): TrendTopic[] {
    // Predefined trending topics with realistic data for Korean market
    const currentDate = new Date();
    const topics: TrendTopic[] = [
      {
        keyword: 'AI 혁신',
        score: 95,
        region: this.region,
        category: 'technology',
        relatedQueries: ['인공지능', 'ChatGPT', '머신러닝', 'AI 트렌드'],
        predictedViews: 850000,
        volatility: 0.8,
        competitiveness: 0.7,
        source: 'google'
      },
      {
        keyword: '겨울 여행',
        score: 88,
        region: this.region,
        category: 'lifestyle',
        relatedQueries: ['스키장', '온천', '겨울휴가', '국내여행'],
        predictedViews: 720000,
        volatility: 0.6,
        competitiveness: 0.5,
        source: 'google'
      },
      {
        keyword: 'K-pop 신곡',
        score: 92,
        region: this.region,
        category: 'entertainment',
        relatedQueries: ['아이돌', '뮤직비디오', '차트', '컴백'],
        predictedViews: 920000,
        volatility: 0.9,
        competitiveness: 0.8,
        source: 'google'
      },
      {
        keyword: '주식 전망',
        score: 75,
        region: this.region,
        category: 'finance',
        relatedQueries: ['코스피', '투자', '경제', '시장분석'],
        predictedViews: 450000,
        volatility: 0.4,
        competitiveness: 0.6,
        source: 'google'
      },
      {
        keyword: '새해 운세',
        score: 82,
        region: this.region,
        category: 'lifestyle',
        relatedQueries: ['2025년', '신년', '점성술', '토정비결'],
        predictedViews: 680000,
        volatility: 0.7,
        competitiveness: 0.4,
        source: 'google'
      },
      {
        keyword: '건강 다이어트',
        score: 78,
        region: this.region,
        category: 'lifestyle',
        relatedQueries: ['운동', '식단', '헬스', '다이어트 식품'],
        predictedViews: 520000,
        volatility: 0.5,
        competitiveness: 0.5,
        source: 'google'
      },
      {
        keyword: '게임 신작',
        score: 85,
        region: this.region,
        category: 'entertainment',
        relatedQueries: ['모바일게임', 'PC게임', '리뷰', '공략'],
        predictedViews: 630000,
        volatility: 0.6,
        competitiveness: 0.7,
        source: 'google'
      },
      {
        keyword: '요리 레시피',
        score: 70,
        region: this.region,
        category: 'lifestyle',
        relatedQueries: ['집밥', '간단요리', '겨울음식', '홈쿡'],
        predictedViews: 380000,
        volatility: 0.3,
        competitiveness: 0.4,
        source: 'google'
      }
    ];

    // Add some randomization to make it feel more dynamic
    const randomizedTopics = topics.map(topic => ({
      ...topic,
      score: topic.score + Math.floor(Math.random() * 10) - 5, // ±5 variation
      predictedViews: Math.floor(topic.predictedViews * (0.9 + Math.random() * 0.2)), // ±10% variation
      volatility: Math.min(1, Math.max(0, topic.volatility + (Math.random() * 0.2) - 0.1)) // ±0.1 variation
    }));

    logger.info(`Generated ${randomizedTopics.length} fallback trending topics`);
    return randomizedTopics;
  }

  // Method to manually add a trending topic (for admin interface)
  addManualTopic(keyword: string, category: string = 'general'): TrendTopic {
    return {
      keyword,
      score: 80 + Math.floor(Math.random() * 20), // 80-100 score
      region: this.region,
      category,
      relatedQueries: [`${keyword} 트렌드`, `${keyword} 정보`, `${keyword} 뉴스`],
      predictedViews: 400000 + Math.floor(Math.random() * 400000), // 400k-800k views
      volatility: 0.5 + Math.random() * 0.4, // 0.5-0.9 volatility
      competitiveness: 0.3 + Math.random() * 0.5, // 0.3-0.8 competitiveness
      source: 'google'
    };
  }
}