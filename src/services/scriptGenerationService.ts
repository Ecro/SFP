import Anthropic from '@anthropic-ai/sdk';
import { createLogger } from '../utils/logger';
import { TrendTopic } from './trendsService';

const logger = createLogger('ScriptGenerationService');

export interface ScriptGenerationOptions {
  topic: TrendTopic;
  style?: 'educational' | 'entertainment' | 'news' | 'lifestyle';
  targetDuration?: number; // in seconds
  includeHook?: boolean;
  language?: 'ko' | 'en';
}

export interface GeneratedScript {
  title: string;
  hook: string;
  mainContent: string;
  callToAction: string;
  fullScript: string;
  estimatedDuration: number;
  keywords: string[];
  tone: string;
  generationTime: number;
}

export class ScriptGenerationService {
  private anthropic: Anthropic;
  private readonly maxRetries: number = 3;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable is required');
    }

    this.anthropic = new Anthropic({ apiKey });
    logger.info('ScriptGenerationService initialized');
  }

  async generateScript(options: ScriptGenerationOptions): Promise<GeneratedScript> {
    const startTime = Date.now();
    
    try {
      logger.info(`Starting script generation for topic: ${options.topic.keyword}`);
      
      const prompt = this.buildPrompt(options);
      const response = await this.callAnthropicAPI(prompt);
      
      const script = this.parseScriptResponse(response);
      const generationTime = Date.now() - startTime;
      
      logger.info(`Script generated successfully in ${generationTime}ms for topic: ${options.topic.keyword}`);
      
      return {
        ...script,
        generationTime
      };
    } catch (error) {
      logger.error('Error generating script:', error);
      throw error;
    }
  }

  private buildPrompt(options: ScriptGenerationOptions): string {
    const {
      topic,
      style = 'educational',
      targetDuration = 58,
      includeHook = true,
      language = 'ko'
    } = options;

    const wordCount = Math.floor(targetDuration * 2.5); // ~2.5 words per second for Korean
    const languageInstructions = language === 'ko' ? 
      '한국어로 작성하고, 자연스러운 한국어 표현을 사용하세요.' : 
      'Write in English with natural expressions.';

    return `
You are an expert short-form video script writer specializing in ${language === 'ko' ? 'Korean' : 'English'} YouTube Shorts content. 
Create an engaging ${targetDuration}-second video script about: "${topic.keyword}"

CONTEXT:
- Topic Category: ${topic.category}
- Trend Score: ${topic.score}/100
- Predicted Views: ${topic.predictedViews.toLocaleString()}
- Related Queries: ${topic.relatedQueries.join(', ')}
- Content Style: ${style}
- Target Duration: ${targetDuration} seconds (~${wordCount} words)

REQUIREMENTS:
1. ${languageInstructions}
2. ${includeHook ? 'Start with a powerful 3-5 second hook that grabs attention immediately' : 'Begin directly with the main content'}
3. Structure: Hook → Main Content → Call-to-Action
4. Use short, punchy sentences suitable for vertical video format
5. Include natural pauses for visual transitions
6. End with an engaging call-to-action that encourages engagement
7. Make it conversational and authentic
8. Include trending keywords naturally

TONE GUIDELINES:
- ${style === 'educational' ? 'Informative yet accessible, like a knowledgeable friend explaining something interesting' : ''}
- ${style === 'entertainment' ? 'Fun, energetic, and engaging with a touch of humor' : ''}
- ${style === 'news' ? 'Professional but conversational, focusing on the most important facts' : ''}
- ${style === 'lifestyle' ? 'Relatable, practical, and inspiring for everyday life' : ''}

Please provide your response in the following JSON format:
{
  "title": "Catchy video title (under 60 characters)",
  "hook": "Opening hook (3-5 seconds worth of content)",
  "mainContent": "Main body of the script",
  "callToAction": "Engaging ending that encourages interaction",
  "fullScript": "Complete script with natural flow",
  "estimatedDuration": ${targetDuration},
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "tone": "Brief description of the tone used"
}

Generate a script that will perform well on YouTube Shorts and capture audience attention from the first second.
`;
  }

  private async callAnthropicAPI(prompt: string): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        logger.debug(`Attempt ${attempt}/${this.maxRetries} - Calling Anthropic API`);
        
        const response = await this.anthropic.messages.create({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 2000,
          temperature: 0.7,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ]
        });

        if (response.content && response.content.length > 0) {
          const textContent = response.content[0];
          if (textContent && textContent.type === 'text') {
            return (textContent as any).text;
          }
        }

        throw new Error('Invalid response format from Anthropic API');
      } catch (error) {
        lastError = error as Error;
        logger.warn(`Attempt ${attempt} failed:`, error);
        
        if (attempt < this.maxRetries) {
          const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
          logger.info(`Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError || new Error('Failed to generate script after all retries');
  }

  private parseScriptResponse(response: string): Omit<GeneratedScript, 'generationTime'> {
    try {
      // Try to extract JSON from the response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      
      // Validate required fields
      const required = ['title', 'hook', 'mainContent', 'callToAction', 'fullScript'];
      for (const field of required) {
        if (!parsed[field]) {
          throw new Error(`Missing required field: ${field}`);
        }
      }

      return {
        title: parsed.title || 'Untitled',
        hook: parsed.hook || '',
        mainContent: parsed.mainContent || '',
        callToAction: parsed.callToAction || '',
        fullScript: parsed.fullScript || '',
        estimatedDuration: parsed.estimatedDuration || 58,
        keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
        tone: parsed.tone || 'neutral'
      };
    } catch (error) {
      logger.error('Error parsing script response:', error);
      
      // Fallback: try to extract content manually
      const lines = response.split('\n').filter(line => line.trim());
      
      return {
        title: `${lines[0]?.substring(0, 60) || 'Generated Video'}`,
        hook: lines[1] || 'Check this out...',
        mainContent: lines.slice(2, -1).join(' ') || response.substring(0, 200),
        callToAction: lines[lines.length - 1] || 'What do you think? Let me know in the comments!',
        fullScript: response,
        estimatedDuration: 58,
        keywords: [],
        tone: 'conversational'
      };
    }
  }

  // Utility method to estimate script duration based on word count
  private estimateScriptDuration(script: string, language: 'ko' | 'en' = 'ko'): number {
    const words = script.split(/\s+/).length;
    const wordsPerSecond = language === 'ko' ? 2.5 : 3; // Korean is typically slower
    return Math.round(words / wordsPerSecond);
  }

  // Method to optimize script for specific duration
  async optimizeScriptForDuration(
    script: GeneratedScript, 
    targetDuration: number
  ): Promise<GeneratedScript> {
    const currentDuration = this.estimateScriptDuration(script.fullScript);
    
    if (Math.abs(currentDuration - targetDuration) <= 3) {
      return script; // Already within acceptable range
    }

    logger.info(`Optimizing script duration from ${currentDuration}s to ${targetDuration}s`);
    
    const optimizationPrompt = `
Please adjust this script to be exactly ${targetDuration} seconds long:

CURRENT SCRIPT:
${script.fullScript}

CURRENT DURATION: ~${currentDuration} seconds
TARGET DURATION: ${targetDuration} seconds

${currentDuration > targetDuration ? 
  'The script is too long. Please shorten it while maintaining the key message and engagement.' :
  'The script is too short. Please expand it with more detail or examples while maintaining flow.'
}

Return the optimized script in the same JSON format as before.
`;

    const response = await this.callAnthropicAPI(optimizationPrompt);
    const optimizedScript = this.parseScriptResponse(response);
    
    return {
      ...optimizedScript,
      generationTime: script.generationTime
    };
  }

  // Method to generate multiple storyline variations from topics
  async generateMultipleStorylines(
    topics: any[], 
    options: {
      count?: number;
      style?: 'educational' | 'entertainment' | 'news' | 'lifestyle';
      targetDuration?: number;
      language?: 'ko' | 'en';
    } = {}
  ): Promise<GeneratedScript[]> {
    const {
      count = 10,
      style = 'educational',
      targetDuration = 58,
      language = 'ko'
    } = options;

    logger.info(`Generating ${count} storyline variations from ${topics.length} topics`);

    const styles = ['educational', 'entertainment', 'news', 'lifestyle'] as const;
    const scripts: GeneratedScript[] = [];

    // Generate scripts in batches to avoid overwhelming the API
    const batchSize = 3;
    for (let i = 0; i < Math.min(topics.length, count); i += batchSize) {
      const batch = topics.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (topic, index) => {
        const scriptStyle = style || styles[(i + index) % styles.length];
        
        try {
          return await this.generateScript({
            topic,
            style: scriptStyle,
            targetDuration,
            includeHook: true,
            language
          });
        } catch (error) {
          logger.warn(`Failed to generate script for topic: ${topic.keyword}`, error);
          return null;
        }
      });

      const batchResults = await Promise.allSettled(batchPromises);
      
      batchResults.forEach(result => {
        if (result.status === 'fulfilled' && result.value) {
          scripts.push(result.value);
        }
      });

      // Add small delay between batches to be respectful to the API
      if (i + batchSize < Math.min(topics.length, count)) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    logger.info(`Successfully generated ${scripts.length} storyline scripts`);
    return scripts.slice(0, count);
  }

  // Method to generate a creative variation of an existing script
  async generateScriptVariation(
    originalScript: GeneratedScript,
    variationType: 'hook' | 'tone' | 'style' | 'angle'
  ): Promise<GeneratedScript> {
    logger.info(`Generating ${variationType} variation for script: ${originalScript.title}`);

    const variationPrompts = {
      hook: 'Create a completely different hook that grabs attention in a new way',
      tone: 'Change the tone while keeping the same core message',
      style: 'Rewrite in a different content style while maintaining the key points',
      angle: 'Approach the same topic from a completely different angle or perspective'
    };

    const prompt = `
Based on this existing script, ${variationPrompts[variationType]}:

ORIGINAL SCRIPT:
Title: ${originalScript.title}
Hook: ${originalScript.hook}
Main Content: ${originalScript.mainContent}
Call to Action: ${originalScript.callToAction}

REQUIREMENTS:
1. Keep the same target duration (~${originalScript.estimatedDuration} seconds)
2. ${variationPrompts[variationType]}
3. Maintain the same language and format
4. Ensure the new version is distinctly different but equally engaging

Return the variation in the same JSON format as the original.
`;

    const response = await this.callAnthropicAPI(prompt);
    const variation = this.parseScriptResponse(response);
    
    return {
      ...variation,
      generationTime: Date.now() - Date.now() // Will be set by calling function
    };
  }

  // Method to create storyline summaries for testing interface
  generateStorylineSummary(script: GeneratedScript, topic: any): string {
    const hookPreview = script.hook.length > 40 ? 
      script.hook.substring(0, 37) + '...' : script.hook;
    
    const topicInfo = topic ? ` about ${topic.keyword}` : '';
    const toneInfo = script.tone ? ` in a ${script.tone} tone` : '';
    
    return `${hookPreview} A ${script.estimatedDuration}-second video${topicInfo}${toneInfo} targeting ${script.keywords.slice(0, 3).join(', ')} keywords.`;
  }
}