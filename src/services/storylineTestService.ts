import { TrendsService, TrendTopic } from './trendsService';
import { ScriptGenerationService, GeneratedScript } from './scriptGenerationService';
import { createLogger } from '../utils/logger';

const logger = createLogger('StorylineTestService');

export interface StorylineTestOptions {
  category?: string;
  limit?: number;
  contentStyle?: 'educational' | 'entertainment' | 'news' | 'lifestyle';
  language?: 'ko' | 'en';
}

export interface StorylineSuggestion {
  id: string;
  topic: TrendTopic;
  script: GeneratedScript;
  summary: string;
  engagementPrediction: {
    score: number;
    factors: string[];
    audienceAppeal: string;
  };
  estimatedViews: number;
  difficulty: 'easy' | 'medium' | 'hard';
  tags: string[];
  finalScore?: number;
}

export interface StorylineTestResult {
  testId: string;
  timestamp: string;
  category?: string;
  storylines: StorylineSuggestion[];
  totalTopicsAnalyzed: number;
  executionTime: number;
  trendsSource: {
    google: number;
    naver: number;
    youtube: number;
  };
}

export class StorylineTestService {
  private trendsService: TrendsService;
  private scriptGenerationService: ScriptGenerationService;

  constructor() {
    this.trendsService = new TrendsService();
    this.scriptGenerationService = new ScriptGenerationService();
    logger.info('StorylineTestService initialized');
  }

  async generateStorylineSuggestions(options: StorylineTestOptions = {}): Promise<StorylineTestResult> {
    const startTime = Date.now();
    const testId = `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      logger.info(`Starting storyline test generation with options:`, options);
      
      // Step 1: Discover trending topics
      const trendResult = await this.trendsService.discoverTrends();
      let topics = trendResult.topics;
      
      // Step 2: Filter by category if specified
      if (options.category) {
        topics = topics.filter(topic => 
          topic.category.toLowerCase().includes(options.category!.toLowerCase()) ||
          topic.keyword.toLowerCase().includes(options.category!.toLowerCase()) ||
          topic.relatedQueries.some(query => 
            query.toLowerCase().includes(options.category!.toLowerCase())
          )
        );
        logger.info(`Filtered ${topics.length} topics for category: ${options.category}`);
      }

      // Step 3: Select diverse topics for storylines (up to 15 for variety)
      const selectedTopics = this.selectDiverseTopics(topics, 15);
      
      // Step 4: Generate scripts and storylines in parallel
      const storylinePromises = selectedTopics.map((topic, index) => 
        this.createStorylineSuggestion(topic, index, options)
      );
      
      const allStorylines = await Promise.allSettled(storylinePromises);
      
      // Step 5: Filter successful storylines and select best 10
      const successfulStorylines = allStorylines
        .filter(result => result.status === 'fulfilled')
        .map(result => (result as PromiseFulfilledResult<StorylineSuggestion>).value);
      
      const topStorylines = this.selectTopStorylines(successfulStorylines, options.limit || 10);
      
      const executionTime = Date.now() - startTime;
      
      const result: StorylineTestResult = {
        testId,
        timestamp: new Date().toISOString(),
        category: options.category,
        storylines: topStorylines,
        totalTopicsAnalyzed: topics.length,
        executionTime,
        trendsSource: {
          google: trendResult.sources?.includes('google') ? 1 : 0,
          naver: trendResult.sources?.includes('naver') ? 1 : 0,
          youtube: trendResult.sources?.includes('youtube') ? 1 : 0
        }
      };
      
      logger.info(`Generated ${topStorylines.length} storylines in ${executionTime}ms`);
      return result;
      
    } catch (error) {
      logger.error('Error generating storyline suggestions:', error);
      throw error;
    }
  }

  private selectDiverseTopics(topics: TrendTopic[], limit: number): TrendTopic[] {
    if (topics.length <= limit) return topics;
    
    // Sort by score first
    const sortedTopics = [...topics].sort((a, b) => b.score - a.score);
    
    // Select diverse topics across categories and score ranges
    const selected: TrendTopic[] = [];
    const categoriesSeen = new Set<string>();
    
    // First pass: Take top topics from different categories
    for (const topic of sortedTopics) {
      if (selected.length >= limit) break;
      
      if (!categoriesSeen.has(topic.category) || categoriesSeen.size < 3) {
        selected.push(topic);
        categoriesSeen.add(topic.category);
      }
    }
    
    // Second pass: Fill remaining slots with highest scoring topics
    for (const topic of sortedTopics) {
      if (selected.length >= limit) break;
      
      if (!selected.includes(topic)) {
        selected.push(topic);
      }
    }
    
    return selected.slice(0, limit);
  }

  private async createStorylineSuggestion(
    topic: TrendTopic, 
    index: number, 
    options: StorylineTestOptions
  ): Promise<StorylineSuggestion> {
    try {
      // Generate script with varied styles
      const styles = ['educational', 'entertainment', 'news', 'lifestyle'] as const;
      const style = options.contentStyle || styles[index % styles.length];
      
      const script = await this.scriptGenerationService.generateScript({
        topic,
        style,
        targetDuration: 58,
        includeHook: true,
        language: options.language || 'ko'
      });

      // Generate summary and engagement prediction
      const summary = this.generateStorylineSummary(script, topic);
      const engagementPrediction = this.predictEngagement(script, topic);
      const estimatedViews = this.estimateViews(topic, engagementPrediction.score);
      const difficulty = this.assessDifficulty(topic, script);
      const tags = this.generateTags(topic, script);

      return {
        id: `storyline_${Date.now()}_${index}`,
        topic,
        script,
        summary,
        engagementPrediction,
        estimatedViews,
        difficulty,
        tags
      };
    } catch (error) {
      logger.warn(`Failed to create storyline for topic: ${topic.keyword}`, error);
      throw error;
    }
  }

  private generateStorylineSummary(script: GeneratedScript, topic: TrendTopic): string {
    const hookSummary = script.hook.length > 50 ? 
      script.hook.substring(0, 47) + '...' : script.hook;
    
    const mainPoints = script.mainContent.split('.').slice(0, 2).join('.') + '.';
    
    return `${hookSummary} ${mainPoints} Perfect for ${topic.category} content with ${script.tone} tone.`;
  }

  private predictEngagement(script: GeneratedScript, topic: TrendTopic): {
    score: number;
    factors: string[];
    audienceAppeal: string;
  } {
    const factors: string[] = [];
    let score = 50; // Base score
    
    // Hook strength
    if (script.hook.includes('?') || script.hook.includes('!')) {
      score += 15;
      factors.push('Strong hook with engaging punctuation');
    }
    
    // Trending topic relevance
    if (topic.score > 80) {
      score += 20;
      factors.push('High-trending topic');
    } else if (topic.score > 60) {
      score += 10;
      factors.push('Moderately trending topic');
    }
    
    // Script engagement elements
    if (script.fullScript.includes('당신') || script.fullScript.includes('여러분')) {
      score += 10;
      factors.push('Direct audience engagement');
    }
    
    if (script.keywords.length >= 3) {
      score += 10;
      factors.push('Rich keyword integration');
    }
    
    // Call to action strength
    if (script.callToAction.includes('댓글') || script.callToAction.includes('좋아요')) {
      score += 10;
      factors.push('Strong call-to-action');
    }
    
    // Predicted views impact
    if (topic.predictedViews > 100000) {
      score += 15;
      factors.push('High view potential');
    }
    
    // Cap the score
    score = Math.min(score, 100);
    
    const audienceAppeal = score >= 80 ? 'Very High' : 
                          score >= 65 ? 'High' : 
                          score >= 50 ? 'Medium' : 'Low';
    
    return { score, factors, audienceAppeal };
  }

  private estimateViews(topic: TrendTopic, engagementScore: number): number {
    const baseViews = topic.predictedViews;
    const engagementMultiplier = engagementScore / 100;
    const randomFactor = 0.8 + (Math.random() * 0.4); // 0.8 to 1.2
    
    return Math.round(baseViews * engagementMultiplier * randomFactor);
  }

  private assessDifficulty(topic: TrendTopic, script: GeneratedScript): 'easy' | 'medium' | 'hard' {
    let complexity = 0;
    
    // Topic complexity
    if (topic.category === 'technology' || topic.category === 'science') complexity += 2;
    if (topic.category === 'entertainment' || topic.category === 'lifestyle') complexity -= 1;
    
    // Script complexity
    if (script.fullScript.length > 400) complexity += 1;
    if (script.keywords.length > 5) complexity += 1;
    
    // Trend volatility
    if (topic.volatility > 70) complexity += 1;
    
    if (complexity <= 1) return 'easy';
    if (complexity <= 3) return 'medium';
    return 'hard';
  }

  private generateTags(topic: TrendTopic, script: GeneratedScript): string[] {
    const tags = new Set<string>();
    
    // Add category-based tags
    tags.add(topic.category);
    tags.add(script.tone);
    
    // Add content style tags
    if (script.fullScript.includes('팁') || script.fullScript.includes('방법')) {
      tags.add('tips');
    }
    if (script.fullScript.includes('?')) {
      tags.add('interactive');
    }
    if (script.hook.length < 30) {
      tags.add('quick-hook');
    }
    
    // Add trend-based tags
    if (topic.score > 80) tags.add('viral-potential');
    if (topic.volatility > 60) tags.add('trending-now');
    
    return Array.from(tags).slice(0, 6);
  }

  private selectTopStorylines(storylines: StorylineSuggestion[], limit: number): StorylineSuggestion[] {
    // Score storylines based on multiple factors and add finalScore
    const scoredStorylines = storylines.map(storyline => {
      const finalScore = this.calculateFinalScore(storyline);
      return {
        ...storyline,
        finalScore
      };
    });
    
    // Sort by final score and select top ones
    return scoredStorylines
      .sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0))
      .slice(0, limit);
  }

  private calculateFinalScore(storyline: StorylineSuggestion): number {
    const topicScore = storyline.topic.score * 0.3;
    const engagementScore = storyline.engagementPrediction.score * 0.4;
    const viewsScore = Math.log(storyline.estimatedViews) * 0.2;
    const difficultyScore = storyline.difficulty === 'easy' ? 10 : 
                           storyline.difficulty === 'medium' ? 7 : 5;
    
    return topicScore + engagementScore + viewsScore + difficultyScore;
  }

  // Method to get a single storyline by ID (for the "Go" action)
  async getStorylineById(testId: string, storylineId: string): Promise<StorylineSuggestion | null> {
    // In a production system, this would fetch from database
    // For now, we'll return null as storylines are generated on-demand
    logger.warn(`Storyline retrieval not implemented yet for ID: ${storylineId}`);
    return null;
  }
}