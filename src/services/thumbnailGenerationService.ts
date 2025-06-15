import axios from 'axios';
import { createLogger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

const logger = createLogger('ThumbnailGenerationService');

export interface ThumbnailGenerationOptions {
  title: string;
  topic: string;
  style: 'vibrant' | 'minimalist' | 'bold' | 'educational' | 'entertainment';
  language: 'ko' | 'en';
  backgroundType: 'gradient' | 'pattern' | 'ai-generated' | 'solid';
  includeEmoji?: boolean;
  customText?: string;
}

export interface GeneratedThumbnail {
  filePath: string;
  variant: 'A' | 'B';
  style: string;
  title: string;
  fileSize: number;
  dimensions: { width: number; height: number };
  generationTime: number;
}

export interface ThumbnailVariants {
  thumbnailA: GeneratedThumbnail;
  thumbnailB: GeneratedThumbnail;
  testConfiguration: {
    testId: string;
    differences: string[];
    expectedMetrics: {
      variantA: { expectedCTR: number; reason: string };
      variantB: { expectedCTR: number; reason: string };
    };
  };
}

export class ThumbnailGenerationService {
  private readonly outputDir: string;
  private readonly maxRetries: number = 3;
  
  // Standard YouTube thumbnail dimensions
  private readonly thumbnailWidth = 1280;
  private readonly thumbnailHeight = 720;

  // Color schemes for different styles
  private readonly colorSchemes = {
    vibrant: {
      primary: ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FECA57'],
      secondary: ['#FFFFFF', '#2C2C2C'],
      accent: ['#FFD93D', '#6BCF7F', '#FF8A80']
    },
    minimalist: {
      primary: ['#2C3E50', '#34495E', '#7F8C8D', '#95A5A6'],
      secondary: ['#FFFFFF', '#ECF0F1'],
      accent: ['#3498DB', '#E74C3C', '#F39C12']
    },
    bold: {
      primary: ['#E74C3C', '#9B59B6', '#3498DB', '#1ABC9C', '#F39C12'],
      secondary: ['#FFFFFF', '#2C3E50'],
      accent: ['#FFD700', '#FF1493', '#00BFFF']
    },
    educational: {
      primary: ['#3498DB', '#2ECC71', '#9B59B6', '#E67E22'],
      secondary: ['#FFFFFF', '#34495E'],
      accent: ['#F1C40F', '#E74C3C', '#1ABC9C']
    },
    entertainment: {
      primary: ['#FF6B6B', '#4ECDC4', '#FFD93D', '#6BCF7F', '#FF8A80'],
      secondary: ['#FFFFFF', '#2C2C2C'],
      accent: ['#FF1493', '#00BFFF', '#FFD700']
    }
  };

  // Emoji mappings for different topics
  private readonly topicEmojis = {
    ko: {
      'AI': '🤖', '기술': '💻', '건강': '💪', '음식': '🍽️', '여행': '✈️',
      '교육': '📚', '운동': '🏃', '경제': '💰', '뉴스': '📰', '생활': '🏠',
      '과학': '🔬', '자동차': '🚗', '패션': '👗', '뷰티': '💄', '요리': '👨‍🍳'
    },
    en: {
      'AI': '🤖', 'technology': '💻', 'health': '💪', 'food': '🍽️', 'travel': '✈️',
      'education': '📚', 'fitness': '🏃', 'economy': '💰', 'news': '📰', 'lifestyle': '🏠',
      'science': '🔬', 'cars': '🚗', 'fashion': '👗', 'beauty': '💄', 'cooking': '👨‍🍳'
    }
  };

  constructor() {
    this.outputDir = process.env.THUMBNAIL_OUTPUT_DIR || './data/thumbnails';
    this.ensureOutputDirectory();
    
    // Register Korean font if available
    try {
      // In production, you'd install Korean fonts like Noto Sans KR
      // registerFont('./fonts/NotoSansKR-Bold.ttf', { family: 'Noto Sans KR' });
    } catch (error) {
      logger.debug('Korean font not available, using default fonts');
    }
    
    logger.info('ThumbnailGenerationService initialized');
  }

  async generateThumbnailVariants(options: ThumbnailGenerationOptions): Promise<ThumbnailVariants> {
    const startTime = Date.now();
    
    try {
      logger.info(`Generating thumbnail variants for: ${options.title}`);

      const testId = `thumb_test_${Date.now()}`;
      
      // For now, generate placeholder thumbnails since canvas is not available
      // In production, you would integrate with AI image generation APIs
      const [thumbnailA, thumbnailB] = await Promise.all([
        this.generatePlaceholderThumbnail({ ...options, variant: 'A' }),
        this.generatePlaceholderThumbnail({ ...options, variant: 'B' })
      ]);

      const differences = this.analyzeDifferences(thumbnailA, thumbnailB);
      const expectedMetrics = this.predictPerformance(thumbnailA, thumbnailB, options);

      const totalTime = Date.now() - startTime;
      logger.info(`Thumbnail variants generated in ${totalTime}ms`);

      return {
        thumbnailA,
        thumbnailB,
        testConfiguration: {
          testId,
          differences,
          expectedMetrics
        }
      };

    } catch (error) {
      logger.error('Thumbnail generation failed:', error);
      throw error;
    }
  }

  private async generatePlaceholderThumbnail(options: ThumbnailGenerationOptions & { variant: 'A' | 'B' }): Promise<GeneratedThumbnail> {
    const startTime = Date.now();
    
    try {
      // Generate placeholder thumbnail metadata
      // In production, this would call AI image generation APIs like:
      // - Midjourney API
      // - Stable Diffusion API  
      // - DALL-E API
      // - Or use Canvas/ImageMagick for text overlays
      
      const filename = `thumbnail_${options.variant}_${Date.now()}.png`;
      const filePath = path.join(this.outputDir, filename);
      
      // Create a simple placeholder file for now
      const placeholderContent = this.generatePlaceholderData(options);
      await fs.promises.writeFile(filePath, placeholderContent);
      
      const generationTime = Date.now() - startTime;
      
      return {
        filePath,
        variant: options.variant,
        style: options.style,
        title: options.title,
        fileSize: placeholderContent.length,
        dimensions: { width: this.thumbnailWidth, height: this.thumbnailHeight },
        generationTime
      };

    } catch (error) {
      logger.error(`Failed to generate thumbnail variant ${options.variant}:`, error);
      throw error;
    }
  }

  private generatePlaceholderData(options: ThumbnailGenerationOptions & { variant: 'A' | 'B' }): Buffer {
    // Create a simple JSON placeholder that describes what the thumbnail would contain
    const thumbnailSpec = {
      title: options.title,
      variant: options.variant,
      style: options.style,
      topic: options.topic,
      language: options.language,
      backgroundType: options.backgroundType,
      includeEmoji: options.includeEmoji,
      customText: options.customText,
      dimensions: { width: this.thumbnailWidth, height: this.thumbnailHeight },
      colorScheme: this.getVariantStyling(options.style, options.variant),
      emoji: this.getRelevantEmoji(options.topic, options.language),
      generatedAt: new Date().toISOString(),
      note: 'This is a placeholder. In production, this would be a generated PNG image.'
    };
    
    return Buffer.from(JSON.stringify(thumbnailSpec, null, 2));
  }

  private getVariantStyling(style: string, variant: 'A' | 'B'): any {
    const scheme = this.colorSchemes[style as keyof typeof this.colorSchemes] || this.colorSchemes.vibrant;
    
    if (variant === 'A') {
      return {
        primaryColor: scheme.primary[0],
        secondaryColor: scheme.secondary[0],
        accentColor: scheme.accent[0],
        fontSize: { title: 72, subtitle: 36 },
        fontWeight: 'bold',
        textShadow: true,
        borderRadius: 15
      };
    } else {
      return {
        primaryColor: scheme.primary[1] || scheme.primary[0],
        secondaryColor: scheme.secondary[1] || scheme.secondary[0],
        accentColor: scheme.accent[1] || scheme.accent[0],
        fontSize: { title: 64, subtitle: 32 },
        fontWeight: 'normal',
        textShadow: false,
        borderRadius: 25
      };
    }
  }

  // Canvas methods removed - using placeholder generation instead
  // In production, implement with:
  // - AI image generation APIs (Midjourney, DALL-E, Stable Diffusion)
  // - Canvas/ImageMagick for text overlays
  // - Pre-designed template systems

  private processTextForThumbnail(text: string, language: 'ko' | 'en'): string {
    // Remove common words and optimize for thumbnail
    const maxLength = language === 'ko' ? 20 : 35;
    
    if (text.length <= maxLength) {
      return text;
    }

    // Truncate and add emphasis
    return text.substring(0, maxLength - 3) + '...';
  }

  private wrapText(text: string, fontSize: number): string[] {
    const maxCharsPerLine = Math.floor(this.thumbnailWidth / (fontSize * 0.6));
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine + (currentLine ? ' ' : '') + word;
      if (testLine.length <= maxCharsPerLine) {
        currentLine = testLine;
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      }
    }
    
    if (currentLine) lines.push(currentLine);
    return lines.slice(0, 3); // Max 3 lines
  }

  private getRelevantEmoji(topic: string, language: 'ko' | 'en'): string {
    const emojis = this.topicEmojis[language];
    
    for (const [key, emoji] of Object.entries(emojis)) {
      if (topic.toLowerCase().includes(key.toLowerCase())) {
        return emoji;
      }
    }
    
    return '📺'; // Default video emoji
  }

  private analyzeDifferences(thumbnailA: GeneratedThumbnail, thumbnailB: GeneratedThumbnail): string[] {
    return [
      'Color scheme variation',
      'Font size and weight differences',
      'Background pattern variation',
      'Decorative elements placement',
      'Text shadow and effects'
    ];
  }

  private predictPerformance(thumbnailA: GeneratedThumbnail, thumbnailB: GeneratedThumbnail, options: ThumbnailGenerationOptions): any {
    // Simple heuristic-based performance prediction
    // In production, this would use ML models trained on actual performance data
    
    const baselineCTR = 5.0; // 5% baseline CTR
    
    let scoreA = baselineCTR;
    let scoreB = baselineCTR;

    // Adjust based on style
    if (options.style === 'bold') {
      scoreA += 0.8; // Bold styles tend to perform better
    }
    if (options.style === 'vibrant') {
      scoreB += 0.6;
    }

    // Adjust based on text length
    if (options.title.length < 30) {
      scoreA += 0.5; // Shorter titles are more readable
      scoreB += 0.5;
    }

    // Variant B gets decorative elements bonus
    scoreB += 0.3;

    return {
      variantA: {
        expectedCTR: Math.round(scoreA * 10) / 10,
        reason: 'Bold text and contrasting colors typically drive higher engagement'
      },
      variantB: {
        expectedCTR: Math.round(scoreB * 10) / 10,
        reason: 'Decorative elements and varied layout may appeal to broader audience'
      }
    };
  }

  private ensureOutputDirectory(): void {
    try {
      if (!fs.existsSync(this.outputDir)) {
        fs.mkdirSync(this.outputDir, { recursive: true });
        logger.info(`Created thumbnail output directory: ${this.outputDir}`);
      }
    } catch (error) {
      logger.error('Failed to create thumbnail output directory:', error);
      throw error;
    }
  }

  async cleanupOldThumbnails(maxAgeHours: number = 48): Promise<number> {
    try {
      const files = await fs.promises.readdir(this.outputDir);
      const now = Date.now();
      const maxAge = maxAgeHours * 60 * 60 * 1000;
      let deletedCount = 0;

      for (const file of files) {
        if (file.startsWith('thumbnail_') && file.endsWith('.png')) {
          const filePath = path.join(this.outputDir, file);
          const stats = await fs.promises.stat(filePath);
          
          if (now - stats.mtime.getTime() > maxAge) {
            await fs.promises.unlink(filePath);
            deletedCount++;
            logger.debug(`Deleted old thumbnail: ${file}`);
          }
        }
      }

      if (deletedCount > 0) {
        logger.info(`Cleaned up ${deletedCount} old thumbnail files`);
      }

      return deletedCount;
    } catch (error) {
      logger.error('Error cleaning up old thumbnails:', error);
      return 0;
    }
  }

  // Generate thumbnail from video frame (alternative approach)
  async generateFromVideoFrame(videoPath: string, timestamp: number = 30): Promise<string> {
    // This would require ffmpeg integration
    // For now, return a placeholder implementation
    logger.warn('Video frame thumbnail generation not implemented - using placeholder generation instead');
    
    const options: ThumbnailGenerationOptions = {
      title: 'Video Thumbnail',
      topic: 'video',
      style: 'vibrant',
      language: 'ko',
      backgroundType: 'gradient'
    };
    
    const result = await this.generatePlaceholderThumbnail({ ...options, variant: 'A' });
    return result.filePath;
  }
}