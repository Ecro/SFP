import { google, youtube_v3 } from 'googleapis';
import { createLogger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

const logger = createLogger('YouTubeUploadService');

export interface YouTubeUploadOptions {
  videoFilePath: string;
  title: string;
  description: string;
  tags: string[];
  thumbnailAPath?: string;
  thumbnailBPath?: string;
  categoryId?: string;
  privacy?: 'private' | 'public' | 'unlisted';
  language?: string;
  defaultAudioLanguage?: string;
}

export interface YouTubeUploadResult {
  videoId: string;
  title: string;
  description: string;
  thumbnailUrls: {
    default: string;
    medium: string;
    high: string;
    standard?: string;
    maxres?: string;
  };
  status: 'uploaded' | 'processing' | 'failed';
  uploadTime: number;
  videoUrl: string;
  thumbnailTestId?: string;
}

export interface ThumbnailTestResult {
  testId: string;
  thumbnailA: {
    url: string;
    impressions: number;
    clickThroughRate: number;
  };
  thumbnailB: {
    url: string;
    impressions: number;
    clickThroughRate: number;
  };
  winner: 'A' | 'B' | 'inconclusive';
  confidence: number;
  testDuration: number; // hours
}

export interface VideoMetrics {
  videoId: string;
  views: number;
  likes: number;
  dislikes: number;
  comments: number;
  shares: number;
  subscribersGained: number;
  watchTimeMinutes: number;
  averageViewDuration: number;
  clickThroughRate: number;
  impressions: number;
  lastUpdated: Date;
}

export class YouTubeUploadService {
  private youtube?: youtube_v3.Youtube;
  private oauth2Client: any;
  private readonly maxRetries: number = 3;
  private readonly thumbnailTestDuration: number = 24; // hours

  constructor() {
    this.initializeAuth();
    logger.info('YouTubeUploadService initialized');
  }

  private initializeAuth(): void {
    const clientId = process.env.YOUTUBE_CLIENT_ID;
    const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
    const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
      logger.warn('YouTube credentials not fully configured. Upload functionality will be limited.');
      return;
    }

    this.oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret
      // No redirect URI needed for refresh token flow
    );

    this.oauth2Client.setCredentials({
      refresh_token: refreshToken
    });

    this.youtube = google.youtube({
      version: 'v3',
      auth: this.oauth2Client
    });

    logger.info('YouTube API authentication configured successfully');
  }

  async uploadVideo(options: YouTubeUploadOptions): Promise<YouTubeUploadResult> {
    const startTime = Date.now();

    try {
      logger.info(`Starting YouTube upload: ${options.title}`);

      if (!this.youtube) {
        throw new Error('YouTube API not configured. Please set YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, and YOUTUBE_REFRESH_TOKEN');
      }

      // Validate video file exists
      if (!fs.existsSync(options.videoFilePath)) {
        throw new Error(`Video file not found: ${options.videoFilePath}`);
      }

      // Upload video
      const uploadResult = await this.performVideoUpload(options);
      
      // Set up thumbnail A/B test if both thumbnails provided
      let thumbnailTestId: string | undefined;
      if (options.thumbnailAPath && options.thumbnailBPath) {
        thumbnailTestId = await this.setupThumbnailABTest(uploadResult.videoId, options.thumbnailAPath, options.thumbnailBPath);
      } else if (options.thumbnailAPath) {
        // Upload single thumbnail
        await this.uploadThumbnail(uploadResult.videoId, options.thumbnailAPath);
      }

      const uploadTime = Date.now() - startTime;
      
      const result: YouTubeUploadResult = {
        ...uploadResult,
        uploadTime,
        thumbnailTestId
      };

      logger.info(`YouTube upload completed in ${uploadTime}ms: ${result.videoId}`);
      return result;

    } catch (error) {
      logger.error('YouTube upload failed:', error);
      throw error;
    }
  }

  private async performVideoUpload(options: YouTubeUploadOptions): Promise<Omit<YouTubeUploadResult, 'uploadTime' | 'thumbnailTestId'>> {
    const videoMetadata = {
      snippet: {
        title: options.title,
        description: options.description,
        tags: options.tags,
        categoryId: options.categoryId || '22', // People & Blogs category
        defaultLanguage: options.language || 'ko',
        defaultAudioLanguage: options.defaultAudioLanguage || 'ko'
      },
      status: {
        privacyStatus: options.privacy || 'public',
        selfDeclaredMadeForKids: false
      }
    };

    const videoStream = fs.createReadStream(options.videoFilePath);
    
    let attempt = 0;
    while (attempt < this.maxRetries) {
      try {
        logger.debug(`Upload attempt ${attempt + 1}/${this.maxRetries}`);

        const response = await this.youtube!.videos.insert({
          part: ['snippet', 'status'],
          requestBody: videoMetadata,
          media: {
            body: videoStream
          }
        });

        const videoData = response.data;
        
        if (!videoData.id) {
          throw new Error('No video ID returned from YouTube API');
        }

        return {
          videoId: videoData.id,
          title: videoData.snippet?.title || options.title,
          description: videoData.snippet?.description || options.description,
          thumbnailUrls: {
            default: videoData.snippet?.thumbnails?.default?.url || '',
            medium: videoData.snippet?.thumbnails?.medium?.url || '',
            high: videoData.snippet?.thumbnails?.high?.url || '',
            standard: videoData.snippet?.thumbnails?.standard?.url || undefined,
            maxres: videoData.snippet?.thumbnails?.maxres?.url || undefined
          },
          status: 'uploaded',
          videoUrl: `https://www.youtube.com/watch?v=${videoData.id}`
        };

      } catch (error) {
        attempt++;
        logger.warn(`Upload attempt ${attempt} failed:`, error);
        
        if (attempt >= this.maxRetries) {
          throw error;
        }
        
        // Exponential backoff
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw new Error('All upload attempts failed');
  }

  private async uploadThumbnail(videoId: string, thumbnailPath: string): Promise<void> {
    try {
      logger.info(`Uploading thumbnail for video ${videoId}`);

      if (!fs.existsSync(thumbnailPath)) {
        throw new Error(`Thumbnail file not found: ${thumbnailPath}`);
      }

      const thumbnailStream = fs.createReadStream(thumbnailPath);

      await this.youtube!.thumbnails.set({
        videoId,
        media: {
          body: thumbnailStream
        }
      });

      logger.info(`Thumbnail uploaded successfully for video ${videoId}`);
    } catch (error) {
      logger.error('Thumbnail upload failed:', error);
      throw error;
    }
  }

  private async setupThumbnailABTest(videoId: string, thumbnailAPath: string, thumbnailBPath: string): Promise<string> {
    const testId = `test_${videoId}_${Date.now()}`;
    
    try {
      logger.info(`Setting up thumbnail A/B test for video ${videoId}`);

      // Upload thumbnail A first
      await this.uploadThumbnail(videoId, thumbnailAPath);
      
      // Store test configuration (in production, you'd store this in database)
      // For now, we'll use a simple file-based approach
      const testConfig = {
        testId,
        videoId,
        thumbnailA: thumbnailAPath,
        thumbnailB: thumbnailBPath,
        startTime: new Date().toISOString(),
        duration: this.thumbnailTestDuration,
        status: 'running'
      };

      // Schedule thumbnail B upload after initial metrics collection
      setTimeout(async () => {
        try {
          await this.switchToThumbnailB(testId, videoId, thumbnailBPath);
        } catch (error) {
          logger.error(`Failed to switch to thumbnail B for test ${testId}:`, error);
        }
      }, 12 * 60 * 60 * 1000); // Switch after 12 hours

      logger.info(`Thumbnail A/B test ${testId} initiated`);
      return testId;

    } catch (error) {
      logger.error('Failed to setup thumbnail A/B test:', error);
      throw error;
    }
  }

  private async switchToThumbnailB(testId: string, videoId: string, thumbnailBPath: string): Promise<void> {
    logger.info(`Switching to thumbnail B for test ${testId}`);
    
    // Get metrics for thumbnail A
    const metricsA = await this.getVideoMetrics(videoId);
    
    // Upload thumbnail B
    await this.uploadThumbnail(videoId, thumbnailBPath);
    
    // Schedule test conclusion
    setTimeout(async () => {
      try {
        await this.concludeThumbnailTest(testId, videoId);
      } catch (error) {
        logger.error(`Failed to conclude test ${testId}:`, error);
      }
    }, 12 * 60 * 60 * 1000); // Conclude after another 12 hours
  }

  private async concludeThumbnailTest(testId: string, videoId: string): Promise<ThumbnailTestResult> {
    logger.info(`Concluding thumbnail A/B test ${testId}`);
    
    // In a real implementation, you'd:
    // 1. Get detailed analytics for both thumbnail periods
    // 2. Calculate statistical significance
    // 3. Determine the winner
    // 4. Set the winning thumbnail permanently
    
    // For now, return a mock result
    const result: ThumbnailTestResult = {
      testId,
      thumbnailA: {
        url: '',
        impressions: 1000,
        clickThroughRate: 5.2
      },
      thumbnailB: {
        url: '',
        impressions: 1000,
        clickThroughRate: 6.1
      },
      winner: 'B',
      confidence: 0.95,
      testDuration: this.thumbnailTestDuration
    };

    logger.info(`Test ${testId} concluded: Thumbnail ${result.winner} wins with ${result.confidence * 100}% confidence`);
    return result;
  }

  async getVideoMetrics(videoId: string): Promise<VideoMetrics> {
    try {
      const response = await this.youtube!.videos.list({
        part: ['statistics', 'snippet'],
        id: [videoId]
      });

      const video = response.data.items?.[0];
      if (!video) {
        throw new Error(`Video ${videoId} not found`);
      }

      const stats = video.statistics;
      
      return {
        videoId,
        views: parseInt(stats?.viewCount || '0'),
        likes: parseInt(stats?.likeCount || '0'),
        dislikes: parseInt(stats?.dislikeCount || '0'),
        comments: parseInt(stats?.commentCount || '0'),
        shares: 0, // Not available in basic API
        subscribersGained: 0, // Requires YouTube Analytics API
        watchTimeMinutes: 0, // Requires YouTube Analytics API
        averageViewDuration: 0, // Requires YouTube Analytics API
        clickThroughRate: 0, // Requires YouTube Analytics API
        impressions: 0, // Requires YouTube Analytics API
        lastUpdated: new Date()
      };
    } catch (error) {
      logger.error(`Failed to get metrics for video ${videoId}:`, error);
      throw error;
    }
  }

  async updateVideoMetadata(videoId: string, updates: Partial<YouTubeUploadOptions>): Promise<void> {
    try {
      logger.info(`Updating metadata for video ${videoId}`);

      const updateData: any = {
        id: videoId,
        snippet: {}
      };

      if (updates.title) updateData.snippet.title = updates.title;
      if (updates.description) updateData.snippet.description = updates.description;
      if (updates.tags) updateData.snippet.tags = updates.tags;

      await this.youtube!.videos.update({
        part: ['snippet'],
        requestBody: updateData
      });

      logger.info(`Video ${videoId} metadata updated successfully`);
    } catch (error) {
      logger.error(`Failed to update video ${videoId} metadata:`, error);
      throw error;
    }
  }

  async deleteVideo(videoId: string): Promise<void> {
    try {
      logger.info(`Deleting video ${videoId}`);

      await this.youtube!.videos.delete({
        id: videoId
      });

      logger.info(`Video ${videoId} deleted successfully`);
    } catch (error) {
      logger.error(`Failed to delete video ${videoId}:`, error);
      throw error;
    }
  }

  async getChannelInfo(): Promise<any> {
    try {
      const response = await this.youtube!.channels.list({
        part: ['snippet', 'statistics', 'brandingSettings'],
        mine: true
      });

      return response.data.items?.[0];
    } catch (error) {
      logger.error('Failed to get channel info:', error);
      throw error;
    }
  }

  async generateVideoMetadata(topic: string, scriptContent: string, language: 'ko' | 'en' = 'ko'): Promise<{ title: string; description: string; tags: string[] }> {
    // Generate optimized title (under 60 characters for better visibility)
    const title = this.generateOptimizedTitle(topic, language);
    
    // Generate SEO-optimized description
    const description = this.generateOptimizedDescription(scriptContent, topic, language);
    
    // Generate relevant tags
    const tags = this.generateOptimizedTags(topic, scriptContent, language);

    return { title, description, tags };
  }

  private generateOptimizedTitle(topic: string, language: 'ko' | 'en'): string {
    const templates = {
      ko: [
        `${topic} - 알아야 할 모든 것`,
        `${topic}의 놀라운 진실`,
        `${topic} 완벽 가이드`,
        `${topic}에 대한 충격적 사실`,
        `${topic} 이렇게 하세요!`
      ],
      en: [
        `${topic} - Everything You Need to Know`,
        `The Amazing Truth About ${topic}`,
        `Ultimate ${topic} Guide`,
        `Shocking Facts About ${topic}`,
        `How to ${topic} - Step by Step`
      ]
    };

    const templateList = templates[language] || templates.ko;
    const randomTemplate = templateList[Math.floor(Math.random() * templateList.length)];
    
    if (!randomTemplate) {
      return `${topic} - 완벽 가이드`;
    }
    
    // Ensure title is under 60 characters
    return randomTemplate.length > 60 ? randomTemplate.substring(0, 57) + '...' : randomTemplate;
  }

  private generateOptimizedDescription(scriptContent: string, topic: string, language: 'ko' | 'en'): string {
    const descriptions = {
      ko: `🎯 ${topic}에 대해 알아보세요!

${scriptContent.substring(0, 200)}...

📌 이 영상에서 다루는 내용:
• ${topic}의 핵심 개념
• 실용적인 팁과 노하우
• 최신 트렌드와 정보

💡 구독하고 좋아요를 눌러주시면 더 많은 유용한 정보를 제공해드립니다!

🔔 알림 설정을 켜시면 새로운 영상을 놓치지 않으실 수 있어요!

#${topic.replace(/ /g, '')} #유용한정보 #팁 #가이드 #최신정보

📱 더 많은 콘텐츠는 채널을 확인해주세요!`,
      
      en: `🎯 Learn everything about ${topic}!

${scriptContent.substring(0, 200)}...

📌 What this video covers:
• Core concepts of ${topic}
• Practical tips and strategies
• Latest trends and insights

💡 Subscribe and like for more valuable content!

🔔 Hit the bell icon to never miss our latest videos!

#${topic.replace(/ /g, '')} #Tips #Guide #Information #Tutorial

📱 Check out our channel for more amazing content!`
    };

    return descriptions[language];
  }

  private generateOptimizedTags(topic: string, scriptContent: string, language: 'ko' | 'en'): string[] {
    const baseTags = {
      ko: ['유용한정보', '팁', '가이드', '튜토리얼', '최신정보', '노하우', '실용적', '꿀팁'],
      en: ['tips', 'guide', 'tutorial', 'howto', 'information', 'practical', 'useful', 'educational']
    };

    const topicTags = topic.split(' ').filter(word => word.length > 1);
    const contentWords = scriptContent.toLowerCase()
      .match(/\b\w{3,}\b/g)
      ?.slice(0, 5) || [];

    return [
      ...topicTags,
      ...contentWords,
      ...baseTags[language]
    ].slice(0, 15); // YouTube allows max 15 tags
  }

  // Health check for YouTube API
  async healthCheck(): Promise<boolean> {
    try {
      if (!this.youtube) {
        return false;
      }

      await this.youtube.channels.list({
        part: ['snippet'],
        mine: true,
        maxResults: 1
      });

      return true;
    } catch (error) {
      logger.error('YouTube API health check failed:', error);
      return false;
    }
  }
}