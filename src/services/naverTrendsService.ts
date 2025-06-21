import axios, { AxiosResponse } from 'axios';
import { createLogger } from '../utils/logger';

const logger = createLogger('NaverTrendsService');

export interface NaverKeywordData {
  period: string;
  ratio: number;
}

export interface NaverTrendResult {
  keyword: string;
  data: NaverKeywordData[];
}

export interface NaverSearchTrendData {
  startDate: string;
  endDate: string;
  timeUnit: string;
  results: NaverTrendResult[];
}

export interface NaverTrendTopic {
  keyword: string;
  searchVolume: number;
  growth: number;
  category: string;
  source: 'naver';
  relatedKeywords: string[];
}

export class NaverTrendsService {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly baseUrl = 'https://openapi.naver.com/v1/datalab';

  constructor() {
    this.clientId = process.env.NAVER_CLIENT_ID || '';
    this.clientSecret = process.env.NAVER_CLIENT_SECRET || '';
    
    if (!this.clientId || !this.clientSecret) {
      logger.warn('Naver API credentials not found in environment variables');
    }
  }

  async getSearchTrends(keywords: string[], startDate?: string, endDate?: string): Promise<NaverSearchTrendData | null> {
    try {
      if (!this.clientId || !this.clientSecret) {
        logger.warn('Naver API credentials not configured');
        return null;
      }

      const endDateStr = endDate || new Date().toISOString().split('T')[0];
      const startDateStr = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const requestBody = {
        startDate: startDateStr,
        endDate: endDateStr,
        timeUnit: 'date',
        keywordGroups: keywords.map(keyword => ({
          groupName: keyword,
          keywords: [keyword]
        }))
      };

      const response: AxiosResponse<NaverSearchTrendData> = await axios.post(
        `${this.baseUrl}/v1/search`,
        requestBody,
        {
          headers: {
            'X-Naver-Client-Id': this.clientId,
            'X-Naver-Client-Secret': this.clientSecret,
            'Content-Type': 'application/json'
          }
        }
      );

      logger.info(`Successfully fetched Naver search trends for ${keywords.length} keywords`);
      return response.data;

    } catch (error) {
      logger.error('Error fetching Naver search trends:', error);
      return null;
    }
  }

  async getShoppingTrends(categories: string[], startDate?: string, endDate?: string): Promise<any> {
    try {
      if (!this.clientId || !this.clientSecret) {
        logger.warn('Naver API credentials not configured');
        return null;
      }

      const endDateStr = endDate || new Date().toISOString().split('T')[0];
      const startDateStr = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const requestBody = {
        startDate: startDateStr,
        endDate: endDateStr,
        timeUnit: 'date',
        category: categories
      };

      const response = await axios.post(
        `${this.baseUrl}/v1/shopping/categories`,
        requestBody,
        {
          headers: {
            'X-Naver-Client-Id': this.clientId,
            'X-Naver-Client-Secret': this.clientSecret,
            'Content-Type': 'application/json'
          }
        }
      );

      logger.info(`Successfully fetched Naver shopping trends for categories: ${categories.join(', ')}`);
      return response.data;

    } catch (error) {
      logger.error('Error fetching Naver shopping trends:', error);
      return null;
    }
  }

  async discoverTrendingKeywords(): Promise<NaverTrendTopic[]> {
    try {
      logger.info('Starting Naver trending keywords discovery');

      // Get a diverse set of Korean keywords across different categories
      const technologyKeywords = ['AI', '인공지능', '챗GPT', '스마트폰', '애플', '삼성', '메타버스', '블록체인'];
      const entertainmentKeywords = ['드라마', 'K-pop', 'BTS', '블랙핑크', '넷플릭스', '유튜브', '게임', 'LOL'];
      const lifestyleKeywords = ['여행', '맛집', '다이어트', '운동', '요리', '패션', '뷰티', '인테리어'];
      const financeKeywords = ['주식', '부동산', '투자', '비트코인', '경제', '금리', '환율', '저축'];
      const healthKeywords = ['건강', '병원', '약국', '백신', '다이어트', '영양제', '운동', '요가'];

      const allKeywords = [
        ...technologyKeywords,
        ...entertainmentKeywords,
        ...lifestyleKeywords,
        ...financeKeywords,
        ...healthKeywords
      ];

      // Split keywords into smaller batches to avoid API limits
      const batchSize = 5;
      const trendTopics: NaverTrendTopic[] = [];

      for (let i = 0; i < allKeywords.length; i += batchSize) {
        const batch = allKeywords.slice(i, i + batchSize);
        const trendData = await this.getSearchTrends(batch);

        if (trendData && trendData.results) {
          for (const result of trendData.results) {
            const topic = this.processKeywordData(result);
            if (topic) {
              trendTopics.push(topic);
            }
          }
        }

        // Add delay between batches to respect rate limits
        if (i + batchSize < allKeywords.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      // Sort by growth rate and search volume
      const sortedTopics = trendTopics
        .filter(topic => topic.searchVolume > 0 && topic.growth > 0)
        .sort((a, b) => (b.growth * b.searchVolume) - (a.growth * a.searchVolume))
        .slice(0, 10);

      logger.info(`Discovered ${sortedTopics.length} trending keywords from Naver`);
      return sortedTopics;

    } catch (error) {
      logger.error('Error discovering Naver trending keywords:', error);
      return [];
    }
  }

  private processKeywordData(result: NaverTrendResult): NaverTrendTopic | null {
    try {
      if (!result.data || result.data.length === 0) {
        return null;
      }

      // Calculate search volume (average ratio)
      const avgRatio = result.data.reduce((sum, item) => sum + item.ratio, 0) / result.data.length;
      
      // Calculate growth rate (comparing recent vs older data)
      const recentData = result.data.slice(-7); // Last 7 days
      const olderData = result.data.slice(0, 7); // First 7 days
      
      const recentAvg = recentData.reduce((sum, item) => sum + item.ratio, 0) / recentData.length;
      const olderAvg = olderData.reduce((sum, item) => sum + item.ratio, 0) / olderData.length;
      
      const growthRate = olderAvg > 0 ? ((recentAvg - olderAvg) / olderAvg) * 100 : 0;

      return {
        keyword: result.keyword,
        searchVolume: Math.round(avgRatio),
        growth: Math.round(growthRate * 100) / 100, // Round to 2 decimal places
        category: this.categorizeKeyword(result.keyword),
        source: 'naver',
        relatedKeywords: this.generateRelatedKeywords(result.keyword)
      };

    } catch (error) {
      logger.error(`Error processing keyword data for ${result.keyword}:`, error);
      return null;
    }
  }

  private categorizeKeyword(keyword: string): string {
    const categories: { [key: string]: string[] } = {
      'technology': ['AI', '인공지능', '챗GPT', '스마트폰', '애플', '삼성', '메타버스', '블록체인'],
      'entertainment': ['드라마', 'K-pop', 'BTS', '블랙핑크', '넷플릭스', '유튜브', '게임', 'LOL'],
      'lifestyle': ['여행', '맛집', '다이어트', '운동', '요리', '패션', '뷰티', '인테리어'],
      'finance': ['주식', '부동산', '투자', '비트코인', '경제', '금리', '환율', '저축'],
      'health': ['건강', '병원', '약국', '백신', '다이어트', '영양제', '운동', '요가']
    };

    for (const [category, keywords] of Object.entries(categories)) {
      if (keywords.includes(keyword)) {
        return category;
      }
    }

    return 'general';
  }

  private generateRelatedKeywords(keyword: string): string[] {
    // Generate related keywords based on Korean language patterns
    const relatedPatterns = [
      `${keyword} 트렌드`,
      `${keyword} 정보`,
      `${keyword} 뉴스`,
      `${keyword} 추천`,
      `${keyword} 리뷰`
    ];

    return relatedPatterns.slice(0, 3); // Return top 3 related keywords
  }

  async getPopularKeywords(category?: string, limit: number = 20): Promise<string[]> {
    try {
      // This would ideally use Naver's search keyword API
      // For now, return category-specific popular keywords
      const popularKeywords: { [key: string]: string[] } = {
        'technology': [
          '인공지능', 'AI 기술', '챗GPT 사용법', '스마트폰 추천', '삼성 갤럭시',
          '아이폰 15', '메타버스 게임', '블록체인 투자', '가상현실', '자율주행'
        ],
        'entertainment': [
          'K-pop 신곡', 'BTS 소식', '드라마 추천', '넷플릭스 인기작',
          '유튜브 인기', '게임 신작', 'LOL 업데이트', '영화 개봉',
          '아이돌 컴백', '음악 차트'
        ],
        'lifestyle': [
          '여행지 추천', '맛집 리스트', '다이어트 방법', '홈트레이닝',
          '요리 레시피', '패션 트렌드', '뷰티 팁', '인테리어 아이디어',
          '카페 추천', '데이트 코스'
        ],
        'finance': [
          '주식 추천', '부동산 전망', '투자 방법', '비트코인 시세',
          '경제 뉴스', '금리 인상', '환율 전망', '적금 추천',
          '펀드 투자', '재테크 방법'
        ],
        'health': [
          '건강 관리', '병원 추천', '영양제 효과', '운동 루틴',
          '다이어트 식단', '요가 동작', '수면 관리', '스트레스 해소',
          '면역력 강화', '건강검진'
        ]
      };

      if (category && popularKeywords[category]) {
        return popularKeywords[category].slice(0, limit);
      }

      // Return mixed popular keywords if no category specified
      const allKeywords = Object.values(popularKeywords).flat();
      return allKeywords.slice(0, limit);

    } catch (error) {
      logger.error('Error getting popular keywords:', error);
      return [];
    }
  }

  isConfigured(): boolean {
    return !!(this.clientId && this.clientSecret);
  }

  async testConnection(): Promise<boolean> {
    try {
      if (!this.isConfigured()) {
        return false;
      }

      // Test with a simple search trend request
      const testResult = await this.getSearchTrends(['AI'], 
        new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        new Date().toISOString().split('T')[0]
      );

      return testResult !== null;
    } catch (error) {
      logger.error('Naver API connection test failed:', error);
      return false;
    }
  }
}