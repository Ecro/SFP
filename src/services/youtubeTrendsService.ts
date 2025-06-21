import { google, youtube_v3 } from 'googleapis';
import { createLogger } from '../utils/logger';

const logger = createLogger('YouTubeTrendsService');

export interface YouTubeTrendTopic {
  keyword: string;
  title: string;
  channelTitle: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  publishedAt: string;
  categoryId: string;
  tags: string[];
  source: 'youtube';
  trendScore: number;
  thumbnail: string;
  videoId: string;
}

export interface YouTubeSearchResult {
  query: string;
  totalResults: number;
  averageViews: number;
  competitiveness: number;
  trendingTopics: YouTubeTrendTopic[];
}

export class YouTubeTrendsService {
  private youtube: youtube_v3.Youtube;
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.YOUTUBE_API_KEY || process.env.GOOGLE_API_KEY || '';
    
    if (!this.apiKey) {
      logger.warn('YouTube API key not found in environment variables');
    }

    this.youtube = google.youtube({
      version: 'v3',
      auth: this.apiKey
    });
  }

  async getTrendingVideos(regionCode: string = 'KR', categoryId?: string, maxResults: number = 50): Promise<YouTubeTrendTopic[]> {
    try {
      if (!this.apiKey) {
        logger.warn('YouTube API key not configured');
        return [];
      }

      const response = await this.youtube.videos.list({
        part: ['snippet', 'statistics', 'contentDetails'],
        chart: 'mostPopular',
        regionCode,
        ...(categoryId && { categoryId }),
        maxResults,
        hl: 'ko' // Korean language
      });

      if (!response.data.items) {
        logger.warn('No trending videos found');
        return [];
      }

      const trendingTopics: YouTubeTrendTopic[] = [];

      for (const video of response.data.items) {
        const topic = this.processVideoData(video);
        if (topic) {
          trendingTopics.push(topic);
        }
      }

      // Sort by trend score (combination of views, likes, and recency)
      const sortedTopics = trendingTopics.sort((a, b) => b.trendScore - a.trendScore);

      logger.info(`Successfully fetched ${sortedTopics.length} trending videos from YouTube`);
      return sortedTopics;

    } catch (error) {
      logger.error('Error fetching YouTube trending videos:', error);
      return [];
    }
  }

  async searchTrendingKeywords(keywords: string[], regionCode: string = 'KR'): Promise<YouTubeSearchResult[]> {
    try {
      if (!this.apiKey) {
        logger.warn('YouTube API key not configured');
        return [];
      }

      const results: YouTubeSearchResult[] = [];

      for (const keyword of keywords) {
        try {
          // Search for videos related to the keyword
          const searchResponse = await this.youtube.search.list({
            part: ['snippet'],
            q: keyword,
            type: ['video'],
            regionCode,
            maxResults: 25,
            order: 'relevance',
            publishedAfter: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // Last 30 days
            relevanceLanguage: 'ko'
          });

          if (!searchResponse.data.items || searchResponse.data.items.length === 0) {
            continue;
          }

          // Get detailed video information
          const videoIds = searchResponse.data.items
            .map(item => item.id?.videoId)
            .filter((id): id is string => Boolean(id));
          
          if (videoIds.length === 0) {
            continue;
          }

          const videosResponse = await this.youtube.videos.list({
            part: ['snippet', 'statistics'],
            id: videoIds,
            maxResults: 25
          });

          if (!videosResponse.data.items) {
            continue;
          }

          const trendingTopics: YouTubeTrendTopic[] = [];
          let totalViews = 0;
          let totalResults = 0;

          for (const video of videosResponse.data.items) {
            const topic = this.processVideoData(video, keyword);
            if (topic) {
              trendingTopics.push(topic);
              totalViews += topic.viewCount;
              totalResults++;
            }
          }

          const averageViews = totalResults > 0 ? totalViews / totalResults : 0;
          const competitiveness = this.calculateCompetitiveness(trendingTopics);

          results.push({
            query: keyword,
            totalResults,
            averageViews,
            competitiveness,
            trendingTopics: trendingTopics.slice(0, 10) // Top 10 videos per keyword
          });

          // Add delay to respect rate limits
          await new Promise(resolve => setTimeout(resolve, 200));

        } catch (error) {
          logger.warn(`Error searching for keyword "${keyword}":`, error);
        }
      }

      logger.info(`Successfully analyzed ${results.length} keywords on YouTube`);
      return results;

    } catch (error) {
      logger.error('Error searching YouTube trending keywords:', error);
      return [];
    }
  }

  async getPopularSearchTerms(categoryId?: string, regionCode: string = 'KR'): Promise<string[]> {
    try {
      // Get trending videos and extract common terms from titles
      const trendingVideos = await this.getTrendingVideos(regionCode, categoryId, 100);
      
      if (trendingVideos.length === 0) {
        return [];
      }

      // Extract keywords from video titles
      const titleWords: { [key: string]: number } = {};
      
      for (const video of trendingVideos) {
        const title = video.title.toLowerCase();
        const words = title.split(/[\s,.!?()[\]{}\"']+/).filter(word => 
          word.length > 1 && 
          !this.isStopWord(word) &&
          this.isKoreanOrEnglish(word)
        );

        for (const word of words) {
          titleWords[word] = (titleWords[word] || 0) + 1;
        }
      }

      // Sort by frequency and return top terms
      const popularTerms = Object.entries(titleWords)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 50)
        .map(([term]) => term);

      logger.info(`Extracted ${popularTerms.length} popular search terms from YouTube`);
      return popularTerms;

    } catch (error) {
      logger.error('Error getting popular search terms:', error);
      return [];
    }
  }

  async getVideoCategoryTrends(): Promise<{ [categoryId: string]: number }> {
    try {
      if (!this.apiKey) {
        return {};
      }

      // Get video categories
      const categoriesResponse = await this.youtube.videoCategories.list({
        part: ['snippet'],
        regionCode: 'KR',
        hl: 'ko'
      });

      if (!categoriesResponse.data.items) {
        return {};
      }

      const categoryTrends: { [categoryId: string]: number } = {};

      // Analyze trending videos per category
      for (const category of categoriesResponse.data.items) {
        if (!category.id || !category.snippet?.title) {
          continue;
        }

        try {
          const trendingVideos = await this.getTrendingVideos('KR', category.id, 20);
          const totalViews = trendingVideos.reduce((sum, video) => sum + video.viewCount, 0);
          categoryTrends[category.snippet.title] = totalViews;

          // Add delay between category requests
          await new Promise(resolve => setTimeout(resolve, 300));

        } catch (error) {
          logger.warn(`Error getting trends for category ${category.snippet.title}:`, error);
        }
      }

      logger.info(`Analyzed trends for ${Object.keys(categoryTrends).length} YouTube categories`);
      return categoryTrends;

    } catch (error) {
      logger.error('Error getting video category trends:', error);
      return {};
    }
  }

  private processVideoData(video: youtube_v3.Schema$Video, searchKeyword?: string): YouTubeTrendTopic | null {
    try {
      if (!video.snippet || !video.statistics || !video.id) {
        return null;
      }

      const viewCount = parseInt(video.statistics.viewCount || '0');
      const likeCount = parseInt(video.statistics.likeCount || '0');
      const commentCount = parseInt(video.statistics.commentCount || '0');
      
      // Calculate trend score based on engagement and recency
      const publishedAt = new Date(video.snippet.publishedAt || '');
      const daysSincePublished = (Date.now() - publishedAt.getTime()) / (1000 * 60 * 60 * 24);
      const recencyFactor = Math.max(0, (30 - daysSincePublished) / 30); // More recent = higher score
      
      const engagementRate = viewCount > 0 ? (likeCount + commentCount) / viewCount : 0;
      const trendScore = viewCount * engagementRate * recencyFactor;

      // Extract keyword from title if search keyword not provided
      const keyword = searchKeyword || this.extractMainKeyword(video.snippet.title || '');

      return {
        keyword,
        title: video.snippet.title || '',
        channelTitle: video.snippet.channelTitle || '',
        viewCount,
        likeCount,
        commentCount,
        publishedAt: video.snippet.publishedAt || '',
        categoryId: video.snippet.categoryId || '',
        tags: video.snippet.tags || [],
        source: 'youtube',
        trendScore: Math.round(trendScore),
        thumbnail: video.snippet.thumbnails?.high?.url || video.snippet.thumbnails?.default?.url || '',
        videoId: video.id
      };

    } catch (error) {
      logger.error('Error processing video data:', error);
      return null;
    }
  }

  private extractMainKeyword(title: string): string {
    // Extract the most likely main keyword from a video title
    const words = title.split(/[\s,.!?()[\]{}\"']+/)
      .filter(word => word.length > 1 && !this.isStopWord(word.toLowerCase()))
      .slice(0, 3); // Take first 3 meaningful words

    return words.join(' ').substring(0, 50); // Limit length
  }

  private calculateCompetitiveness(topics: YouTubeTrendTopic[]): number {
    if (topics.length === 0) return 0;

    // Calculate competitiveness based on average views and number of videos
    const avgViews = topics.reduce((sum, topic) => sum + topic.viewCount, 0) / topics.length;
    const normalized = Math.min(avgViews / 1000000, 1); // Normalize to 0-1 scale

    return Math.round(normalized * 100) / 100;
  }

  private isStopWord(word: string): boolean {
    const stopWords = [
      // Korean stop words
      '그', '그리고', '하지만', '그런데', '또한', '이', '저', '것', '수', '때문에', '위해',
      '이런', '저런', '같은', '다른', '새로운', '좋은', '나쁜', '큰', '작은',
      
      // English stop words
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
      'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
      'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those'
    ];

    return stopWords.includes(word);
  }

  private isKoreanOrEnglish(word: string): boolean {
    // Check if word contains Korean characters or English letters
    const koreanRegex = /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/;
    const englishRegex = /[a-zA-Z]/;
    
    return koreanRegex.test(word) || englishRegex.test(word);
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  async testConnection(): Promise<boolean> {
    try {
      if (!this.isConfigured()) {
        return false;
      }

      // Test with a simple video categories request
      const response = await this.youtube.videoCategories.list({
        part: ['snippet'],
        regionCode: 'KR',
        hl: 'ko'
      });

      return !!(response.data.items && response.data.items.length > 0);
    } catch (error) {
      logger.error('YouTube API connection test failed:', error);
      return false;
    }
  }
}