import { createLogger } from '../utils/logger';
import { TrendTopic } from './trendsService';
import { NaverTrendsService, NaverTrendTopic } from './naverTrendsService';
import { YouTubeTrendsService, YouTubeTrendTopic } from './youtubeTrendsService';

const logger = createLogger('TrendAggregationService');

export interface AggregatedTrendResult {
  keyword: string;
  aggregatedScore: number;
  sources: ('google' | 'naver' | 'youtube')[];
  sourceData: {
    google?: TrendTopic;
    naver?: NaverTrendTopic;
    youtube?: YouTubeTrendTopic;
  };
  category: string;
  predictedViews: number;
  confidence: number;
  crossPlatformValidation: boolean;
  trendVelocity: number; // How fast the trend is growing
}

export interface TrendAnalytics {
  totalTopics: number;
  sourceDistribution: { [source: string]: number };
  categoryDistribution: { [category: string]: number };
  averageConfidence: number;
  crossValidatedTopics: number;
  trendingCategories: string[];
  emergingKeywords: string[];
  decliningKeywords: string[];
}

export class TrendAggregationService {
  private naverService: NaverTrendsService;
  private youtubeService: YouTubeTrendsService;

  constructor() {
    this.naverService = new NaverTrendsService();
    this.youtubeService = new YouTubeTrendsService();
  }

  async aggregateMultiSourceTrends(
    googleTrends: TrendTopic[],
    naverTrends: NaverTrendTopic[],
    youtubeTrends: YouTubeTrendTopic[]
  ): Promise<AggregatedTrendResult[]> {
    try {
      logger.info('Starting multi-source trend aggregation');
      
      // Create keyword map to group related trends
      const keywordMap = new Map<string, AggregatedTrendResult>();

      // Process Google Trends
      for (const trend of googleTrends) {
        const normalizedKeyword = this.normalizeKeyword(trend.keyword);
        if (!keywordMap.has(normalizedKeyword)) {
          keywordMap.set(normalizedKeyword, this.createAggregatedTrend(trend.keyword));
        }
        const aggregated = keywordMap.get(normalizedKeyword)!;
        aggregated.sourceData.google = trend;
        aggregated.sources.push('google');
      }

      // Process Naver Trends
      for (const trend of naverTrends) {
        const normalizedKeyword = this.normalizeKeyword(trend.keyword);
        let aggregated = keywordMap.get(normalizedKeyword);
        
        if (!aggregated) {
          // Check for similar keywords
          const similarKeyword = this.findSimilarKeyword(normalizedKeyword, Array.from(keywordMap.keys()));
          if (similarKeyword) {
            aggregated = keywordMap.get(similarKeyword)!;
          } else {
            aggregated = this.createAggregatedTrend(trend.keyword);
            keywordMap.set(normalizedKeyword, aggregated);
          }
        }
        
        aggregated.sourceData.naver = trend;
        if (!aggregated.sources.includes('naver')) {
          aggregated.sources.push('naver');
        }
      }

      // Process YouTube Trends
      for (const trend of youtubeTrends) {
        const normalizedKeyword = this.normalizeKeyword(trend.keyword);
        let aggregated = keywordMap.get(normalizedKeyword);
        
        if (!aggregated) {
          const similarKeyword = this.findSimilarKeyword(normalizedKeyword, Array.from(keywordMap.keys()));
          if (similarKeyword) {
            aggregated = keywordMap.get(similarKeyword)!;
          } else {
            aggregated = this.createAggregatedTrend(trend.keyword);
            keywordMap.set(normalizedKeyword, aggregated);
          }
        }
        
        aggregated.sourceData.youtube = trend;
        if (!aggregated.sources.includes('youtube')) {
          aggregated.sources.push('youtube');
        }
      }

      // Calculate aggregated scores and metrics
      const aggregatedTrends: AggregatedTrendResult[] = [];
      for (const trend of keywordMap.values()) {
        this.calculateAggregatedMetrics(trend);
        aggregatedTrends.push(trend);
      }

      // Sort by aggregated score
      aggregatedTrends.sort((a, b) => b.aggregatedScore - a.aggregatedScore);

      logger.info(`Aggregated ${aggregatedTrends.length} unique trends from ${googleTrends.length + naverTrends.length + youtubeTrends.length} total trends`);
      return aggregatedTrends;

    } catch (error) {
      logger.error('Error aggregating multi-source trends:', error);
      return [];
    }
  }

  async analyzeRealTimeTrends(): Promise<TrendAnalytics> {
    try {
      logger.info('Analyzing real-time trend patterns');
      
      // Get fresh data from all sources
      const [naverTrends, youtubeTrends] = await Promise.all([
        this.naverService.discoverTrendingKeywords(),
        this.youtubeService.getTrendingVideos('KR', undefined, 30)
      ]);

      // Analyze trends
      const totalTopics = naverTrends.length + youtubeTrends.length;
      
      const sourceDistribution = {
        naver: naverTrends.length,
        youtube: youtubeTrends.length,
        google: 0 // Would need Google trends data
      };

      const categoryDistribution: { [category: string]: number } = {};
      const allCategories = [
        ...naverTrends.map(t => t.category),
        ...youtubeTrends.map(t => this.mapYouTubeCategoryToGeneral(t.categoryId))
      ];

      for (const category of allCategories) {
        categoryDistribution[category] = (categoryDistribution[category] || 0) + 1;
      }

      // Find trending categories (categories with most topics)
      const trendingCategories = Object.entries(categoryDistribution)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([category]) => category);

      // Identify emerging keywords (high growth from Naver)
      const emergingKeywords = naverTrends
        .filter(trend => trend.growth > 50) // High growth rate
        .sort((a, b) => b.growth - a.growth)
        .slice(0, 10)
        .map(trend => trend.keyword);

      // For declining keywords, we'd need historical data
      const decliningKeywords: string[] = [];

      const analytics: TrendAnalytics = {
        totalTopics,
        sourceDistribution,
        categoryDistribution,
        averageConfidence: this.calculateAverageConfidence(naverTrends, youtubeTrends),
        crossValidatedTopics: this.countCrossValidatedTopics(naverTrends, youtubeTrends),
        trendingCategories,
        emergingKeywords,
        decliningKeywords
      };

      logger.info(`Real-time trend analysis completed: ${totalTopics} topics across ${Object.keys(categoryDistribution).length} categories`);
      return analytics;

    } catch (error) {
      logger.error('Error analyzing real-time trends:', error);
      return {
        totalTopics: 0,
        sourceDistribution: {},
        categoryDistribution: {},
        averageConfidence: 0,
        crossValidatedTopics: 0,
        trendingCategories: [],
        emergingKeywords: [],
        decliningKeywords: []
      };
    }
  }

  findConflictingTrends(trends: AggregatedTrendResult[]): AggregatedTrendResult[] {
    // Find trends where different sources show conflicting data
    return trends.filter(trend => {
      if (trend.sources.length < 2) return false;
      
      const scores: number[] = [];
      if (trend.sourceData.google) scores.push(trend.sourceData.google.score);
      if (trend.sourceData.naver) scores.push(trend.sourceData.naver.searchVolume);
      if (trend.sourceData.youtube) scores.push(Math.round(trend.sourceData.youtube.viewCount / 10000));
      
      if (scores.length < 2) return false;
      
      const maxScore = Math.max(...scores);
      const minScore = Math.min(...scores);
      
      // Consider conflicting if there's more than 50% difference
      return (maxScore - minScore) / maxScore > 0.5;
    });
  }

  private createAggregatedTrend(keyword: string): AggregatedTrendResult {
    return {
      keyword,
      aggregatedScore: 0,
      sources: [],
      sourceData: {},
      category: 'general',
      predictedViews: 0,
      confidence: 0,
      crossPlatformValidation: false,
      trendVelocity: 0
    };
  }

  private calculateAggregatedMetrics(trend: AggregatedTrendResult): void {
    const { sourceData, sources } = trend;
    
    // Calculate weighted aggregated score
    let totalScore = 0;
    let totalWeight = 0;
    
    if (sourceData.google) {
      const weight = 1.0; // Base weight for Google
      totalScore += sourceData.google.score * weight;
      totalWeight += weight;
    }
    
    if (sourceData.naver) {
      const weight = 1.5; // Higher weight for Naver (Korean market)
      totalScore += sourceData.naver.searchVolume * weight;
      totalWeight += weight;
    }
    
    if (sourceData.youtube) {
      const weight = 1.2; // Moderate weight for YouTube
      const normalizedScore = Math.round(sourceData.youtube.viewCount / 10000);
      totalScore += normalizedScore * weight;
      totalWeight += weight;
    }
    
    trend.aggregatedScore = totalWeight > 0 ? totalScore / totalWeight : 0;
    
    // Calculate predicted views
    let maxPredictedViews = 0;
    if (sourceData.google?.predictedViews) maxPredictedViews = Math.max(maxPredictedViews, sourceData.google.predictedViews);
    if (sourceData.naver?.searchVolume) maxPredictedViews = Math.max(maxPredictedViews, sourceData.naver.searchVolume * 100);
    if (sourceData.youtube?.viewCount) maxPredictedViews = Math.max(maxPredictedViews, sourceData.youtube.viewCount);
    
    trend.predictedViews = maxPredictedViews;
    
    // Set category (prefer specific categories over general)
    if (sourceData.naver?.category && sourceData.naver.category !== 'general') {
      trend.category = sourceData.naver.category;
    } else if (sourceData.google?.category && sourceData.google.category !== 'general') {
      trend.category = sourceData.google.category;
    } else if (sourceData.youtube?.categoryId) {
      trend.category = this.mapYouTubeCategoryToGeneral(sourceData.youtube.categoryId);
    }
    
    // Calculate confidence based on cross-platform validation
    trend.crossPlatformValidation = sources.length > 1;
    trend.confidence = this.calculateConfidence(trend);
    
    // Calculate trend velocity
    trend.trendVelocity = this.calculateTrendVelocity(trend);
  }

  private calculateConfidence(trend: AggregatedTrendResult): number {
    let confidence = 0.5; // Base confidence
    
    // Boost confidence for cross-platform validation
    if (trend.sources.length > 1) {
      confidence += 0.3;
    }
    
    // Boost confidence for Korean-specific sources
    if (trend.sources.includes('naver')) {
      confidence += 0.2;
    }
    
    // Boost confidence for high engagement (YouTube)
    if (trend.sourceData.youtube && trend.sourceData.youtube.trendScore > 1000000) {
      confidence += 0.1;
    }
    
    // Boost confidence for high growth (Naver)
    if (trend.sourceData.naver && trend.sourceData.naver.growth > 100) {
      confidence += 0.1;
    }
    
    return Math.min(confidence, 1.0);
  }

  private calculateTrendVelocity(trend: AggregatedTrendResult): number {
    // Calculate how fast the trend is growing
    if (trend.sourceData.naver?.growth) {
      return trend.sourceData.naver.growth / 100; // Convert percentage to velocity score
    }
    
    if (trend.sourceData.youtube) {
      // Estimate velocity based on engagement and recency
      const publishedAt = new Date(trend.sourceData.youtube.publishedAt);
      const daysSincePublished = (Date.now() - publishedAt.getTime()) / (1000 * 60 * 60 * 24);
      const recencyFactor = Math.max(0, (7 - daysSincePublished) / 7); // More recent = higher velocity
      
      const engagementRate = trend.sourceData.youtube.viewCount > 0 ? 
        (trend.sourceData.youtube.likeCount + trend.sourceData.youtube.commentCount) / trend.sourceData.youtube.viewCount : 0;
      
      return recencyFactor * engagementRate * 10;
    }
    
    return 0.5; // Default moderate velocity
  }

  private normalizeKeyword(keyword: string): string {
    return keyword.toLowerCase().replace(/[^\w\sㄱ-힣]/g, '').trim();
  }

  private findSimilarKeyword(keyword: string, existingKeywords: string[]): string | null {
    const normalized = this.normalizeKeyword(keyword);
    
    for (const existing of existingKeywords) {
      const existingNormalized = this.normalizeKeyword(existing);
      
      // Check for exact match
      if (normalized === existingNormalized) {
        return existing;
      }
      
      // Check for partial match (70% similarity)
      const similarity = this.calculateSimilarity(normalized, existingNormalized);
      if (similarity > 0.7) {
        return existing;
      }
    }
    
    return null;
  }

  private calculateSimilarity(str1: string, str2: string): number {
    // Simple Levenshtein distance-based similarity
    const len1 = str1.length;
    const len2 = str2.length;
    
    if (len1 === 0) return len2 === 0 ? 1 : 0;
    if (len2 === 0) return 0;
    
    const matrix = Array(len2 + 1).fill(null).map(() => Array(len1 + 1).fill(0));
    
    for (let i = 0; i <= len1; i++) matrix[0]![i] = i;
    for (let j = 0; j <= len2; j++) matrix[j]![0] = j;
    
    for (let j = 1; j <= len2; j++) {
      for (let i = 1; i <= len1; i++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j]![i] = Math.min(
          matrix[j - 1]![i] + 1,     // deletion
          matrix[j]![i - 1] + 1,     // insertion
          matrix[j - 1]![i - 1] + cost // substitution
        );
      }
    }
    
    const distance = matrix[len2]![len1];
    const maxLength = Math.max(len1, len2);
    return (maxLength - distance) / maxLength;
  }

  private mapYouTubeCategoryToGeneral(categoryId: string): string {
    const categoryMap: { [key: string]: string } = {
      '1': 'entertainment',
      '2': 'entertainment',
      '10': 'lifestyle',
      '15': 'lifestyle',
      '17': 'lifestyle',
      '19': 'lifestyle',
      '20': 'entertainment',
      '22': 'lifestyle',
      '23': 'entertainment',
      '24': 'entertainment',
      '25': 'lifestyle',
      '26': 'lifestyle',
      '27': 'lifestyle',
      '28': 'technology'
    };
    
    return categoryMap[categoryId] || 'general';
  }

  private calculateAverageConfidence(naverTrends: NaverTrendTopic[], youtubeTrends: YouTubeTrendTopic[]): number {
    let totalConfidence = 0;
    let count = 0;
    
    // For Naver trends, confidence is based on growth rate and search volume
    for (const trend of naverTrends) {
      const confidence = Math.min((trend.growth / 100) + (trend.searchVolume / 1000), 1);
      totalConfidence += confidence;
      count++;
    }
    
    // For YouTube trends, confidence is based on engagement
    for (const trend of youtubeTrends) {
      const engagementRate = trend.viewCount > 0 ? 
        (trend.likeCount + trend.commentCount) / trend.viewCount : 0;
      const confidence = Math.min(engagementRate * 10, 1);
      totalConfidence += confidence;
      count++;
    }
    
    return count > 0 ? totalConfidence / count : 0;
  }

  private countCrossValidatedTopics(naverTrends: NaverTrendTopic[], youtubeTrends: YouTubeTrendTopic[]): number {
    const naverKeywords = new Set(naverTrends.map(t => this.normalizeKeyword(t.keyword)));
    const youtubeKeywords = youtubeTrends.map(t => this.normalizeKeyword(t.keyword));
    
    let crossValidated = 0;
    for (const keyword of youtubeKeywords) {
      if (naverKeywords.has(keyword)) {
        crossValidated++;
      }
    }
    
    return crossValidated;
  }
}