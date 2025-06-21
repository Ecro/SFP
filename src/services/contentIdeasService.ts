import { TrendsService, TrendTopic } from './trendsService';
import { ScriptGenerationService, GeneratedScript } from './scriptGenerationService';
import { createLogger } from '../utils/logger';

const logger = createLogger('ContentIdeasService');

export interface ContentIdea {
  id: string;
  title: string;
  storyline: string;
  contentType: string;
  hook: string;
  scriptPreview: string;
  fullScript: string;
  estimatedDuration: number;
  estimatedViews: number;
  trendScore: number;
  keywords: string[];
  topic: TrendTopic;
  script: GeneratedScript;
}

export interface ContentIdeasRequest {
  category?: string;
  count?: number;
}

export interface ContentIdeasResult {
  ideas: ContentIdea[];
  trendsDiscovered: number;
  sourcesUsed: string[];
  generationTime: number;
}

export class ContentIdeasService {
  private trendsService: TrendsService;
  private scriptGenerationService: ScriptGenerationService;

  constructor() {
    this.trendsService = new TrendsService();
    this.scriptGenerationService = new ScriptGenerationService();
    logger.info('ContentIdeasService initialized');
  }

  async generateContentIdeas(request: ContentIdeasRequest): Promise<ContentIdeasResult> {
    const startTime = Date.now();
    
    try {
      logger.info('Starting content ideas generation', { category: request.category, count: request.count });

      // Step 1: Discover current trends
      const trendDiscoveryResult = await this.trendsService.discoverTrends();
      logger.info(`Discovered ${trendDiscoveryResult.topics.length} trending topics from ${trendDiscoveryResult.sources.length} sources`);

      // Step 2: Filter trends by category if specified
      let relevantTopics = trendDiscoveryResult.topics;
      if (request.category) {
        const categoryFilter = request.category.toLowerCase();
        relevantTopics = relevantTopics.filter(topic => 
          topic.category.toLowerCase().includes(categoryFilter) ||
          topic.keyword.toLowerCase().includes(categoryFilter)
        );
        logger.info(`Filtered to ${relevantTopics.length} topics matching category: ${request.category}`);
      }

      // Take top topics for idea generation
      const topTopics = relevantTopics.slice(0, Math.min(5, relevantTopics.length));
      
      if (topTopics.length === 0) {
        throw new Error(`No trending topics found${request.category ? ` for category: ${request.category}` : ''}`);
      }

      // Step 3: Generate diverse content ideas
      const ideas: ContentIdea[] = [];
      const targetCount = request.count || 10;
      const contentTypes = this.getContentTypes();

      for (let i = 0; i < targetCount; i++) {
        const topicIndex = i % topTopics.length;
        const contentTypeIndex = i % contentTypes.length;
        const topic = topTopics[topicIndex];
        const contentType = contentTypes[contentTypeIndex];

        if (!topic || !contentType) {
          logger.warn(`Skipping idea generation ${i + 1}: missing topic or content type`);
          continue;
        }

        try {
          const script = await this.generateScriptForContentType(topic, contentType, i);
          
          const idea: ContentIdea = {
            id: `idea-${Date.now()}-${i}`,
            title: script.title,
            storyline: this.generateStoryline(topic, contentType),
            contentType: contentType.name,
            hook: script.hook,
            scriptPreview: script.fullScript.substring(0, 100),
            fullScript: script.fullScript,
            estimatedDuration: script.estimatedDuration,
            estimatedViews: this.calculateEstimatedViews(topic, contentType),
            trendScore: topic.score,
            keywords: script.keywords,
            topic,
            script
          };

          ideas.push(idea);
          logger.debug(`Generated content idea ${i + 1}/${targetCount}: ${idea.title}`);
        } catch (error) {
          logger.warn(`Failed to generate content idea ${i + 1}:`, error);
          // Continue with next idea instead of failing completely
        }
      }

      if (ideas.length === 0) {
        throw new Error('Failed to generate any content ideas');
      }

      const generationTime = Date.now() - startTime;
      logger.info(`Generated ${ideas.length} content ideas in ${generationTime}ms`);

      return {
        ideas,
        trendsDiscovered: trendDiscoveryResult.topics.length,
        sourcesUsed: trendDiscoveryResult.sources,
        generationTime
      };

    } catch (error) {
      logger.error('Error generating content ideas:', error);
      throw error;
    }
  }

  private getContentTypes() {
    return [
      {
        name: 'educational',
        style: 'educational',
        description: 'Informative content that teaches something new'
      },
      {
        name: 'entertainment',
        style: 'entertainment',
        description: 'Fun and engaging content designed to entertain'
      },
      {
        name: 'news',
        style: 'news',
        description: 'Current events and breaking news coverage'
      },
      {
        name: 'lifestyle',
        style: 'lifestyle',
        description: 'Practical tips and lifestyle advice'
      },
      {
        name: 'tutorial',
        style: 'educational',
        description: 'Step-by-step how-to content'
      },
      {
        name: 'opinion',
        style: 'entertainment',
        description: 'Personal take or commentary on trending topics'
      },
      {
        name: 'reaction',
        style: 'entertainment',
        description: 'Reaction to trending news or events'
      },
      {
        name: 'comparison',
        style: 'educational',
        description: 'Comparing different aspects of the trending topic'
      },
      {
        name: 'behind-scenes',
        style: 'lifestyle',
        description: 'Behind-the-scenes look at the trending topic'
      },
      {
        name: 'prediction',
        style: 'news',
        description: 'Future predictions based on current trends'
      }
    ];
  }

  private async generateScriptForContentType(
    topic: TrendTopic, 
    contentType: any, 
    variationIndex: number
  ): Promise<GeneratedScript> {
    // Create variation by adjusting target duration and approach
    const baseDuration = 58;
    const durationVariations = [-8, -5, -2, 0, 2, 5, 8, 12, 15, 20];
    const durationVariation = durationVariations[variationIndex % durationVariations.length] || 0;
    const targetDuration = Math.max(30, Math.min(75, baseDuration + durationVariation));

    const script = await this.scriptGenerationService.generateScript({
      topic,
      style: contentType.style as any,
      targetDuration,
      includeHook: true,
      language: 'ko'
    });

    // Enhance the script title based on content type
    const enhancedTitle = this.enhanceTitleForContentType(script.title, contentType.name, topic);
    
    return {
      ...script,
      title: enhancedTitle
    };
  }

  private enhanceTitleForContentType(originalTitle: string, contentType: string, topic: TrendTopic): string {
    const prefixes: { [key: string]: string[] } = {
      'educational': ['알아보자!', '완벽 정리', '5분 완성', '쉽게 배우는'],
      'entertainment': ['재밌는', '웃긴', '충격적인', '놀라운'],
      'news': ['속보', '긴급', '최신', '화제의'],
      'lifestyle': ['일상', '실용적인', '꿀팁', '생활'],
      'tutorial': ['초보자도', '따라하면', '단계별', '쉬운'],
      'opinion': ['내 생각은', '솔직히', '진짜', '개인적으로'],
      'reaction': ['반응', '리뷰', '체험해봤다', '해봤더니'],
      'comparison': ['비교', '차이점', 'vs', '어떤게 좋을까'],
      'behind-scenes': ['비하인드', '뒷이야기', '내부 정보', '숨겨진'],
      'prediction': ['예측', '미래는', '앞으로', '전망']
    };

    const suffixes: { [key: string]: string[] } = {
      'educational': ['완전 정리', '총정리', '알아보기', '이해하기'],
      'entertainment': ['ㅋㅋㅋ', '대박', '실화?', '믿을 수 없는'],
      'news': ['속보', '현재 상황', '최신 정보', '업데이트'],
      'lifestyle': ['꿀팁', '노하우', '추천', '후기'],
      'tutorial': ['따라하기', '만들기', '방법', '가이드'],
      'opinion': ['내 의견', '생각해보기', '솔직 후기', '진실은'],
      'reaction': ['리뷰', '반응', '해봤다', '체험기'],
      'comparison': ['비교하기', '선택하기', '차이점', '결론은'],
      'behind-scenes': ['진실', '뒷이야기', '비밀', '내막'],
      'prediction': ['전망', '예측', '미래', '가능성']
    };

    const typePrefix = prefixes[contentType] || [''];
    const typeSuffix = suffixes[contentType] || [''];
    
    const prefix = typePrefix[Math.floor(Math.random() * typePrefix.length)];
    const suffix = typeSuffix[Math.floor(Math.random() * typeSuffix.length)];

    // Create enhanced title
    if (prefix && suffix) {
      return `${prefix} ${topic.keyword} ${suffix}`;
    } else if (prefix) {
      return `${prefix} ${originalTitle}`;
    } else if (suffix) {
      return `${originalTitle} ${suffix}`;
    }

    return originalTitle;
  }

  private generateStoryline(topic: TrendTopic, contentType: { name: string; style: string; description: string }): string {
    const storylines: { [key: string]: (topic: TrendTopic) => string } = {
      'educational': (topic) => `${topic.keyword}에 대한 핵심 정보를 쉽고 재미있게 설명하여 시청자들이 완벽히 이해할 수 있도록 구성된 교육적 콘텐츠`,
      'entertainment': (topic) => `${topic.keyword}을 유머러스하고 흥미진진한 방식으로 다뤄 시청자들을 즐겁게 하고 끝까지 몰입하게 만드는 엔터테인먼트 콘텐츠`,
      'news': (topic) => `${topic.keyword}의 최신 동향과 핵심 사실들을 빠르고 정확하게 전달하는 뉴스 스타일 콘텐츠`,
      'lifestyle': (topic) => `${topic.keyword}을 일상 생활에 실용적으로 적용할 수 있는 팁과 조언을 제공하는 라이프스타일 콘텐츠`,
      'tutorial': (topic) => `${topic.keyword}에 대해 단계별로 따라할 수 있는 구체적인 방법을 제시하는 튜토리얼 콘텐츠`,
      'opinion': (topic) => `${topic.keyword}에 대한 개인적인 견해와 분석을 솔직하게 공유하는 오피니언 콘텐츠`,
      'reaction': (topic) => `${topic.keyword}에 대한 실시간 반응과 경험을 생생하게 전달하는 리액션 콘텐츠`,
      'comparison': (topic) => `${topic.keyword}의 다양한 측면을 비교 분석하여 객관적인 정보를 제공하는 비교 콘텐츠`,
      'behind-scenes': (topic) => `${topic.keyword}의 숨겨진 이야기와 뒷면의 진실을 파헤치는 비하인드 콘텐츠`,
      'prediction': (topic) => `${topic.keyword}의 향후 전망과 미래 가능성을 예측하고 분석하는 예측 콘텐츠`
    };

    const generator = storylines[contentType.name];
    if (generator) {
      return generator(topic);
    }
    return storylines['educational']!(topic);
  }

  private calculateEstimatedViews(topic: TrendTopic, contentType: { name: string; style: string; description: string }): number {
    // Base estimate from topic's predicted views
    let baseViews = topic.predictedViews || 100000;

    // Content type multipliers based on typical performance
    const multipliers: { [key: string]: number } = {
      'entertainment': 1.4,
      'tutorial': 1.2,
      'reaction': 1.3,
      'news': 1.1,
      'educational': 1.0,
      'lifestyle': 0.9,
      'opinion': 0.8,
      'comparison': 0.85,
      'behind-scenes': 1.15,
      'prediction': 0.9
    };

    const multiplier = multipliers[contentType.name] || 1.0;
    
    // Add some randomization (±20%)
    const randomFactor = 0.8 + Math.random() * 0.4;
    
    return Math.round(baseViews * multiplier * randomFactor);
  }

  // Method to execute a specific content idea
  async executeContentIdea(ideaIndex: number, ideas: ContentIdea[]): Promise<any> {
    if (ideaIndex < 0 || ideaIndex >= ideas.length) {
      throw new Error('Invalid idea index');
    }

    const idea = ideas[ideaIndex];
    if (!idea) {
      throw new Error('Content idea not found');
    }

    logger.info(`Executing content idea: ${idea.title}`);

    // Import VideoJobOrchestrator dynamically to avoid circular dependencies
    const { VideoJobOrchestrator } = await import('./videoJobOrchestrator');
    const orchestrator = new VideoJobOrchestrator();

    // Create a video job using the pre-generated script
    const result = await orchestrator.createVideoJobWithScript(
      idea.topic,
      idea.script,
      {
        contentStyle: idea.contentType as any,
        targetDuration: idea.estimatedDuration,
        videoStyle: 'cinematic',
        thumbnailStyle: 'vibrant',
        privacy: 'public',
        language: 'ko'
      }
    );

    logger.info(`Content idea execution initiated with job ID: ${result.jobId}`);
    return result;
  }
}