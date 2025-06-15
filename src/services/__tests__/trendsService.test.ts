import { TrendsService, TrendTopic } from '../trendsService';

// Mock google-trends-api
jest.mock('google-trends-api', () => ({
  dailyTrends: jest.fn(),
  realTimeTrends: jest.fn(),
  relatedQueries: jest.fn(),
  interestOverTime: jest.fn(),
}));

import googleTrends from 'google-trends-api';

describe('TrendsService', () => {
  let trendsService: TrendsService;
  
  beforeEach(() => {
    trendsService = new TrendsService('KR', 'ko');
    jest.clearAllMocks();
  });

  describe('discoverTrends', () => {
    it('should discover and rank trends successfully', async () => {
      // Mock daily trends response
      const mockDailyTrends = {
        default: {
          trendingSearchesDays: [{
            trendingSearches: [{
              title: { query: 'AI Technology' },
              formattedTraffic: '500,000+',
              articles: [{ source: 'tech' }]
            }]
          }]
        }
      };

      // Mock real-time trends response
      const mockRealTimeTrends = {
        storySummaries: {
          trendingStories: [{
            title: 'Breaking News Story',
            entityNames: ['entity1', 'entity2'],
            shareCount: 1000
          }]
        }
      };

      // Mock related queries response
      const mockRelatedQueries = {
        default: {
          rankedList: [{
            rankedKeyword: [
              { query: 'related query 1' },
              { query: 'related query 2' }
            ]
          }]
        }
      };

      // Mock interest over time response
      const mockInterestOverTime = {
        default: {
          timelineData: [
            { value: [50] },
            { value: [60] },
            { value: [70] }
          ]
        }
      };

      (googleTrends.dailyTrends as jest.Mock).mockResolvedValue(JSON.stringify(mockDailyTrends));
      (googleTrends.realTimeTrends as jest.Mock).mockResolvedValue(JSON.stringify(mockRealTimeTrends));
      (googleTrends.relatedQueries as jest.Mock).mockResolvedValue(JSON.stringify(mockRelatedQueries));
      (googleTrends.interestOverTime as jest.Mock).mockResolvedValue(JSON.stringify(mockInterestOverTime));

      const result = await trendsService.discoverTrends();

      expect(result).toBeDefined();
      expect(result.topics).toHaveLength(2);
      expect(result.selectedTopic).toBeDefined();
      expect(result.timestamp).toBeInstanceOf(Date);
      expect(result.topics[0]).toHaveProperty('keyword');
      expect(result.topics[0]).toHaveProperty('score');
      expect(result.topics[0]).toHaveProperty('predictedViews');
    });

    it('should handle API errors gracefully', async () => {
      (googleTrends.dailyTrends as jest.Mock).mockRejectedValue(new Error('API Error'));
      (googleTrends.realTimeTrends as jest.Mock).mockRejectedValue(new Error('API Error'));

      await expect(trendsService.discoverTrends()).rejects.toThrow('API Error');
    });

    it('should return empty result when no trends found', async () => {
      const emptyResponse = { default: {} };
      
      (googleTrends.dailyTrends as jest.Mock).mockResolvedValue(JSON.stringify(emptyResponse));
      (googleTrends.realTimeTrends as jest.Mock).mockResolvedValue(JSON.stringify(emptyResponse));

      const result = await trendsService.discoverTrends();

      expect(result.topics).toHaveLength(0);
      expect(result.selectedTopic).toBeNull();
    });
  });

  describe('topic selection logic', () => {
    it('should select topic with highest weighted score', async () => {
      const mockTopics: TrendTopic[] = [
        {
          keyword: 'Low Views',
          score: 100,
          region: 'KR',
          category: 'general',
          relatedQueries: [],
          predictedViews: 1000,
          volatility: 0.2,
          competitiveness: 0.8
        },
        {
          keyword: 'High Views',
          score: 200,
          region: 'KR',
          category: 'general',
          relatedQueries: [],
          predictedViews: 5000,
          volatility: 0.6,
          competitiveness: 0.3
        }
      ];

      // Mock methods to return our test topics
      const mockDailyTrends = {
        default: {
          trendingSearchesDays: [{
            trendingSearches: mockTopics.map(topic => ({
              title: { query: topic.keyword },
              formattedTraffic: `${topic.score}+`,
              articles: [{ source: topic.category }]
            }))
          }]
        }
      };

      (googleTrends.dailyTrends as jest.Mock).mockResolvedValue(JSON.stringify(mockDailyTrends));
      (googleTrends.realTimeTrends as jest.Mock).mockResolvedValue(JSON.stringify({ storySummaries: {} }));
      (googleTrends.relatedQueries as jest.Mock).mockResolvedValue(JSON.stringify({ default: {} }));
      (googleTrends.interestOverTime as jest.Mock).mockResolvedValue(JSON.stringify({ 
        default: { timelineData: [{ value: [50] }] }
      }));

      const result = await trendsService.discoverTrends();

      expect(result.selectedTopic?.keyword).toBe('High Views');
    });
  });

  describe('error handling', () => {
    it('should log warnings for failed related queries', async () => {
      const mockDailyTrends = {
        default: {
          trendingSearchesDays: [{
            trendingSearches: [{
              title: { query: 'Test Topic' },
              formattedTraffic: '1000+',
              articles: [{ source: 'test' }]
            }]
          }]
        }
      };

      (googleTrends.dailyTrends as jest.Mock).mockResolvedValue(JSON.stringify(mockDailyTrends));
      (googleTrends.realTimeTrends as jest.Mock).mockResolvedValue(JSON.stringify({ storySummaries: {} }));
      (googleTrends.relatedQueries as jest.Mock).mockRejectedValue(new Error('Related queries failed'));
      (googleTrends.interestOverTime as jest.Mock).mockResolvedValue(JSON.stringify({ 
        default: { timelineData: [{ value: [50] }] }
      }));

      const result = await trendsService.discoverTrends();

      expect(result.topics).toHaveLength(1);
      expect(result.topics[0].relatedQueries).toHaveLength(0);
    });
  });
});