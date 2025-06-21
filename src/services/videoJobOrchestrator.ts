import { createLogger } from '../utils/logger';
import { TrendsService, TrendTopic } from './trendsService';
import { ScriptGenerationService, GeneratedScript } from './scriptGenerationService';
import { TextToSpeechService, TTSResult } from './textToSpeechService';
import { VideoSynthesisService, VideoGenerationResult } from './videoSynthesisService';
import { YouTubeUploadService, YouTubeUploadResult } from './youtubeUploadService';
import { ThumbnailGenerationService, ThumbnailVariants } from './thumbnailGenerationService';
import { VideoJobModel, TrendRunModel, SystemLogModel, YouTubeUploadModel } from '../database/models';

const logger = createLogger('VideoJobOrchestrator');

export interface VideoJobConfig {
  targetDuration?: number;
  contentStyle?: 'educational' | 'entertainment' | 'news' | 'lifestyle';
  language?: 'ko' | 'en';
  customTopic?: string;
  customCategory?: string;
  videoStyle?: 'cinematic' | 'natural' | 'animated' | 'documentary';
  skipVideoGeneration?: boolean; // For testing narration only
  skipUpload?: boolean; // For testing video generation only
  thumbnailStyle?: 'vibrant' | 'minimalist' | 'bold' | 'educational' | 'entertainment';
  privacy?: 'private' | 'public' | 'unlisted';
}

export interface VideoJobResult {
  jobId: number;
  trendRunId?: number;
  topic: TrendTopic;
  script: GeneratedScript;
  audio: TTSResult;
  video?: VideoGenerationResult;
  thumbnails?: ThumbnailVariants;
  upload?: YouTubeUploadResult;
  status: 'completed' | 'failed';
  totalProcessingTime: number;
  error?: string;
}

export interface JobProgress {
  jobId: number;
  currentStep: 'trend_discovery' | 'script_generation' | 'narration' | 'video_synthesis' | 'thumbnail_generation' | 'youtube_upload' | 'completed' | 'failed';
  progress: number; // 0-100
  message: string;
  startTime: Date;
  estimatedCompletion?: Date;
}

export class VideoJobOrchestrator {
  private trendsService: TrendsService;
  private scriptService: ScriptGenerationService;
  private ttsService: TextToSpeechService;
  private videoSynthesisService: VideoSynthesisService;
  private youtubeUploadService: YouTubeUploadService;
  private thumbnailService: ThumbnailGenerationService;
  private videoJobModel: VideoJobModel;
  private trendRunModel: TrendRunModel;
  private systemLogModel: SystemLogModel;
  private youtubeUploadModel: YouTubeUploadModel;
  private activeJobs: Map<number, JobProgress> = new Map();

  constructor() {
    this.trendsService = new TrendsService();
    this.scriptService = new ScriptGenerationService();
    this.ttsService = new TextToSpeechService();
    this.videoSynthesisService = new VideoSynthesisService();
    this.youtubeUploadService = new YouTubeUploadService();
    this.thumbnailService = new ThumbnailGenerationService();
    this.videoJobModel = new VideoJobModel();
    this.trendRunModel = new TrendRunModel();
    this.systemLogModel = new SystemLogModel();
    this.youtubeUploadModel = new YouTubeUploadModel();
    
    logger.info('VideoJobOrchestrator initialized');
  }

  async createVideoJob(config: VideoJobConfig = {}): Promise<VideoJobResult> {
    const startTime = Date.now();
    let jobId: number | null = null;
    let trendRunId: number | null = null;

    try {
      logger.info('Starting new video job creation', config);

      // Step 1: Discover or use provided topic
      const { topic, trendRunId: discoveredTrendRunId } = await this.discoverTopic(config);
      trendRunId = discoveredTrendRunId;

      // Step 2: Create video job record
      jobId = await this.videoJobModel.create({
        trend_run_id: trendRunId || undefined,
        status: 'script_generation',
        topic: topic.keyword,
        created_at: new Date().toISOString()
      });

      // Initialize job progress tracking
      this.updateJobProgress(jobId, 'script_generation', 15, 'Generating script...');

      // Step 3: Generate script
      const script = await this.generateScript(topic, config);
      
      // Update job with script
      await this.videoJobModel.update(jobId, {
        script_text: script.fullScript,
        script_generation_time_ms: script.generationTime
      });

      this.updateJobProgress(jobId, 'narration', 30, 'Generating narration...');

      // Step 4: Generate narration
      const audio = await this.generateNarration(script, config);
      
      // Update job with audio details
      await this.videoJobModel.update(jobId, {
        narration_file_path: audio.audioFilePath,
        narration_generation_time_ms: audio.generationTime,
        total_duration_seconds: audio.duration,
        status: 'narration'
      });

      // Step 5: Generate video (if not skipped)
      let video: VideoGenerationResult | undefined;
      if (!config.skipVideoGeneration) {
        this.updateJobProgress(jobId, 'video_synthesis', 50, 'Generating video...');
        
        video = await this.generateVideo(script, config);
        
        // Update job with video details
        await this.videoJobModel.update(jobId, {
          video_file_path: video.videoFilePath,
          video_generation_time_ms: video.generationTime,
          video_provider: video.provider,
          video_task_id: video.taskId,
          video_prompt: video.prompt,
          video_style: config.videoStyle || 'cinematic',
          video_resolution: video.resolution,
          status: 'video_synthesis'
        });
      }

      // Step 6: Generate thumbnails
      let thumbnails: ThumbnailVariants | undefined;
      if (video && !config.skipUpload) {
        this.updateJobProgress(jobId, 'thumbnail_generation', 70, 'Generating thumbnails...');
        
        thumbnails = await this.generateThumbnails(script, topic, config);
      }

      // Step 7: Upload to YouTube (if not skipped)
      let upload: YouTubeUploadResult | undefined;
      if (video && !config.skipUpload) {
        this.updateJobProgress(jobId, 'youtube_upload', 85, 'Uploading to YouTube...');
        
        upload = await this.uploadToYouTube(video, script, topic, thumbnails, config);
      }

      // Mark as completed
      await this.videoJobModel.update(jobId, {
        status: 'completed',
        completed_at: new Date().toISOString()
      });

      const totalProcessingTime = Date.now() - startTime;
      
      this.updateJobProgress(jobId, 'completed', 100, 'Video job completed successfully');

      // Log success
      await this.logJobEvent(jobId, 'info' as const, 'Video job completed successfully', {
        topic: topic.keyword,
        scriptLength: script.fullScript.length,
        audioDuration: audio.duration,
        videoGenerated: !!video,
        videoPath: video?.videoFilePath,
        totalTime: totalProcessingTime
      });

      logger.info(`Video job ${jobId} completed successfully in ${totalProcessingTime}ms`);

      return {
        jobId,
        trendRunId: trendRunId || undefined,
        topic,
        script,
        audio,
        video,
        thumbnails,
        upload,
        status: 'completed',
        totalProcessingTime
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Video job failed:`, error);

      // Update job status to failed if we have a job ID
      if (jobId) {
        await this.videoJobModel.update(jobId, {
          status: 'failed',
          error_message: errorMessage,
          completed_at: new Date().toISOString()
        });

        this.updateJobProgress(jobId, 'failed', 0, `Job failed: ${errorMessage}`);

        // Log error
        await this.logJobEvent(jobId, 'error' as const, `Video job failed: ${errorMessage}`, {
          error: errorMessage,
          config
        });
      }

      throw error;
    } finally {
      // Clean up job progress tracking
      if (jobId !== null) {
        setTimeout(() => {
          this.activeJobs.delete(jobId!);
        }, 60000); // Keep for 1 minute after completion
      }
    }
  }

  private async discoverTopic(config: VideoJobConfig): Promise<{ topic: TrendTopic; trendRunId: number | null }> {
    // If custom topic is provided, create a manual topic
    if (config.customTopic) {
      const manualTopic = this.trendsService.addManualTopic(
        config.customTopic, 
        config.customCategory || 'general'
      );

      // Create a trend run for the manual topic
      const trendRunId = await this.trendRunModel.create({
        status: 'completed',
        total_keywords: 1,
        topics_found: 1,
        selected_topic: manualTopic.keyword,
        selected_topic_score: manualTopic.predictedViews,
        execution_time_ms: 10 // Instant for manual
      });

      return { topic: manualTopic, trendRunId };
    }

    // Otherwise, discover trends normally
    const trendResult = await this.trendsService.discoverTrends();
    
    if (!trendResult.selectedTopic) {
      throw new Error('No trending topic could be discovered');
    }

    // Create trend run record
    const trendRunId = await this.trendRunModel.create({
      status: 'completed',
      total_keywords: 21, // Default keyword count
      topics_found: trendResult.topics.length,
      selected_topic: trendResult.selectedTopic.keyword,
      selected_topic_score: trendResult.selectedTopic.predictedViews,
      execution_time_ms: 2000 // Approximate
    });

    return { topic: trendResult.selectedTopic, trendRunId };
  }

  private async generateScript(topic: TrendTopic, config: VideoJobConfig): Promise<GeneratedScript> {
    const scriptOptions = {
      topic,
      style: config.contentStyle || 'educational',
      targetDuration: config.targetDuration || 58,
      includeHook: true,
      language: config.language || 'ko'
    };

    return await this.scriptService.generateScript(scriptOptions);
  }

  private async generateNarration(script: GeneratedScript, config: VideoJobConfig): Promise<TTSResult> {
    const ttsOptions = {
      text: script.fullScript,
      language: config.language || 'ko'
    };

    return await this.ttsService.generateSpeech(ttsOptions);
  }

  private async generateVideo(script: GeneratedScript, config: VideoJobConfig): Promise<VideoGenerationResult> {
    // Generate video prompt from script content
    const videoPrompt = this.videoSynthesisService.generateVideoPrompt(
      script.fullScript, 
      config.videoStyle || 'cinematic'
    );
    
    const videoOptions = {
      prompt: videoPrompt,
      aspectRatio: '9:16' as const,
      duration: config.targetDuration || 58,
      style: config.videoStyle || 'cinematic',
      quality: 'high' as const
    };

    return await this.videoSynthesisService.generateVideo(videoOptions);
  }

  private async generateThumbnails(script: GeneratedScript, topic: TrendTopic, config: VideoJobConfig): Promise<ThumbnailVariants> {
    const thumbnailOptions = {
      title: script.hook || topic.keyword,
      topic: topic.keyword,
      style: config.thumbnailStyle || this.mapContentStyleToThumbnailStyle(config.contentStyle),
      language: config.language || 'ko',
      backgroundType: 'gradient' as const,
      includeEmoji: true
    };

    return await this.thumbnailService.generateThumbnailVariants(thumbnailOptions);
  }

  private async uploadToYouTube(
    video: VideoGenerationResult, 
    script: GeneratedScript, 
    topic: TrendTopic, 
    thumbnails: ThumbnailVariants | undefined,
    config: VideoJobConfig
  ): Promise<YouTubeUploadResult> {
    // Generate optimized metadata
    const metadata = await this.youtubeUploadService.generateVideoMetadata(
      topic.keyword,
      script.fullScript,
      config.language || 'ko'
    );

    const uploadOptions = {
      videoFilePath: video.videoFilePath,
      title: metadata.title,
      description: metadata.description,
      tags: metadata.tags,
      thumbnailAPath: thumbnails?.thumbnailA.filePath,
      thumbnailBPath: thumbnails?.thumbnailB.filePath,
      categoryId: this.getCategoryId(topic.category),
      privacy: config.privacy || 'public',
      language: config.language || 'ko'
    };

    return await this.youtubeUploadService.uploadVideo(uploadOptions);
  }

  private mapContentStyleToThumbnailStyle(contentStyle?: string): 'vibrant' | 'minimalist' | 'bold' | 'educational' | 'entertainment' {
    switch (contentStyle) {
      case 'educational': return 'educational';
      case 'entertainment': return 'entertainment';
      case 'news': return 'bold';
      case 'lifestyle': return 'minimalist';
      default: return 'vibrant';
    }
  }

  private getCategoryId(category: string): string {
    const categoryMap = {
      'technology': '28', // Science & Technology
      'education': '27', // Education
      'entertainment': '24', // Entertainment
      'news': '25', // News & Politics
      'lifestyle': '26', // Howto & Style
      'health': '26', // Howto & Style
      'food': '26', // Howto & Style
      'travel': '19', // Travel & Events
      'music': '10', // Music
      'sports': '17', // Sports
      'gaming': '20', // Gaming
      'general': '22' // People & Blogs
    };

    return categoryMap[category as keyof typeof categoryMap] || '22'; // Default to People & Blogs
  }

  private updateJobProgress(jobId: number, step: JobProgress['currentStep'], progress: number, message: string): void {
    const existingJob = this.activeJobs.get(jobId);
    const startTime = existingJob?.startTime || new Date();
    
    this.activeJobs.set(jobId, {
      jobId,
      currentStep: step,
      progress,
      message,
      startTime,
      estimatedCompletion: this.estimateCompletion(step, progress, startTime)
    });

    logger.debug(`Job ${jobId} progress: ${step} (${progress}%) - ${message}`);
  }

  private estimateCompletion(step: string, progress: number, startTime: Date): Date | undefined {
    if (progress === 0) return undefined;

    const elapsed = Date.now() - startTime.getTime();
    const estimated = (elapsed / progress) * 100;
    return new Date(startTime.getTime() + estimated);
  }

  private async logJobEvent(jobId: number, level: 'info' | 'warn' | 'error' | 'debug', message: string, data?: any): Promise<void> {
    try {
      await this.systemLogModel.create({
        level,
        context: 'VideoJobOrchestrator',
        message,
        data: data ? JSON.stringify(data) : undefined,
        job_id: jobId
      });
    } catch (error) {
      logger.warn('Failed to log job event:', error);
    }
  }

  // Public methods for monitoring and management

  getJobProgress(jobId: number): JobProgress | null {
    return this.activeJobs.get(jobId) || null;
  }

  getAllActiveJobs(): JobProgress[] {
    return Array.from(this.activeJobs.values());
  }

  async getJobDetails(jobId: number): Promise<any> {
    try {
      const job = await this.videoJobModel.getById(jobId);
      const progress = this.getJobProgress(jobId);
      
      return {
        ...job,
        progress
      };
    } catch (error) {
      logger.error(`Error getting job details for ${jobId}:`, error);
      return null;
    }
  }

  async getRecentJobs(limit: number = 10): Promise<any[]> {
    try {
      return await this.videoJobModel.getRecent(limit);
    } catch (error) {
      logger.error('Error getting recent jobs:', error);
      return [];
    }
  }

  async getJobsByStatus(status: string): Promise<any[]> {
    try {
      return await this.videoJobModel.getByStatus(status);
    } catch (error) {
      logger.error(`Error getting jobs by status ${status}:`, error);
      return [];
    }
  }

  // Utility method to create a job with manual topic
  async createJobWithManualTopic(
    keyword: string, 
    category: string = 'general',
    config: Omit<VideoJobConfig, 'customTopic' | 'customCategory'> = {}
  ): Promise<VideoJobResult> {
    return this.createVideoJob({
      ...config,
      customTopic: keyword,
      customCategory: category
    });
  }

  // Method to retry a failed job
  async retryJob(jobId: number): Promise<VideoJobResult> {
    const job = await this.videoJobModel.getById(jobId);
    
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    if (job.status !== 'failed') {
      throw new Error(`Job ${jobId} is not in failed status`);
    }

    logger.info(`Retrying failed job ${jobId} with topic: ${job.topic}`);

    // Create a new job with the same topic
    return this.createVideoJob({
      customTopic: job.topic,
      customCategory: 'general'
    });
  }

  // Cleanup method for housekeeping
  async performHousekeeping(): Promise<void> {
    logger.info('Performing video job housekeeping...');
    
    try {
      // Clean up old TTS files
      const deletedAudioFiles = await this.ttsService.cleanupOldFiles(24);
      
      // Clean up old video files
      const deletedVideoFiles = await this.videoSynthesisService.cleanupOldVideos(48);
      
      // Clean up old thumbnail files
      const deletedThumbnailFiles = await this.thumbnailService.cleanupOldThumbnails(48);
      
      // Clear old job progress data
      const now = Date.now();
      const maxAge = 60 * 60 * 1000; // 1 hour
      
      for (const [jobId, progress] of this.activeJobs.entries()) {
        if (now - progress.startTime.getTime() > maxAge) {
          this.activeJobs.delete(jobId);
        }
      }

      logger.info(`Housekeeping completed: ${deletedAudioFiles} audio files, ${deletedVideoFiles} video files, ${deletedThumbnailFiles} thumbnail files deleted, ${this.activeJobs.size} active jobs remaining`);
    } catch (error) {
      logger.error('Error during housekeeping:', error);
    }
  }

  // Method to get video synthesis provider status
  async getVideoProviderStatus(): Promise<any> {
    try {
      return await this.videoSynthesisService.getProviderStatus();
    } catch (error) {
      logger.error('Error getting video provider status:', error);
      return [];
    }
  }

  // Method to get YouTube service status
  async getYouTubeServiceStatus(): Promise<{ configured: boolean; healthy: boolean; channel?: any }> {
    try {
      const healthy = await this.youtubeUploadService.healthCheck();
      let channel = null;
      
      if (healthy) {
        try {
          channel = await this.youtubeUploadService.getChannelInfo();
        } catch (error) {
          logger.debug('Could not get channel info:', error);
        }
      }
      
      return {
        configured: healthy,
        healthy,
        channel
      };
    } catch (error) {
      logger.error('Error checking YouTube service status:', error);
      return { configured: false, healthy: false };
    }
  }

  // Method to create video-only job (for existing audio)
  async createVideoOnlyJob(
    scriptText: string,
    audioFilePath: string,
    config: Omit<VideoJobConfig, 'customTopic'> = {}
  ): Promise<VideoGenerationResult> {
    try {
      logger.info('Creating video-only job for existing audio');
      
      const videoPrompt = this.videoSynthesisService.generateVideoPrompt(
        scriptText,
        config.videoStyle || 'cinematic'
      );
      
      const videoOptions = {
        prompt: videoPrompt,
        aspectRatio: '9:16' as const,
        duration: config.targetDuration || 58,
        style: config.videoStyle || 'cinematic',
        quality: 'high' as const,
        audioFilePath
      };

      return await this.videoSynthesisService.generateVideo(videoOptions);
    } catch (error) {
      logger.error('Error creating video-only job:', error);
      throw error;
    }
  }

  // Method to upload existing video to YouTube
  async uploadExistingVideo(
    videoFilePath: string,
    title: string,
    description: string,
    tags: string[],
    config: Partial<VideoJobConfig> = {}
  ): Promise<YouTubeUploadResult> {
    try {
      logger.info('Uploading existing video to YouTube');
      
      const uploadOptions = {
        videoFilePath,
        title,
        description,
        tags,
        categoryId: '22', // People & Blogs
        privacy: config.privacy || 'public',
        language: config.language || 'ko'
      };

      const uploadResult = await this.youtubeUploadService.uploadVideo(uploadOptions);
      
      // Save upload data to database
      await this.youtubeUploadModel.create({
        video_job_id: 0, // Standalone upload, not part of a video job
        video_id: uploadResult.videoId,
        title: uploadResult.title,
        description: uploadResult.description,
        tags: JSON.stringify(uploadOptions.tags),
        upload_status: uploadResult.status === 'uploaded' ? 'live' : uploadResult.status,
        privacy_status: uploadOptions.privacy,
        category_id: uploadOptions.categoryId,
        language: uploadOptions.language,
        upload_time_ms: uploadResult.uploadTime
      });
      
      return uploadResult;
    } catch (error) {
      logger.error('Error uploading existing video:', error);
      throw error;
    }
  }

  // Method to get video metrics from YouTube
  async getVideoMetrics(videoId: string): Promise<any> {
    try {
      return await this.youtubeUploadService.getVideoMetrics(videoId);
    } catch (error) {
      logger.error(`Error getting metrics for video ${videoId}:`, error);
      throw error;
    }
  }

  // Method to create thumbnails only
  async createThumbnailsOnly(
    title: string,
    topic: string,
    config: Partial<VideoJobConfig> = {}
  ): Promise<ThumbnailVariants> {
    try {
      logger.info('Creating thumbnails only');
      
      const thumbnailOptions = {
        title,
        topic,
        style: config.thumbnailStyle || 'vibrant',
        language: config.language || 'ko',
        backgroundType: 'gradient' as const,
        includeEmoji: true
      };

      return await this.thumbnailService.generateThumbnailVariants(thumbnailOptions);
    } catch (error) {
      logger.error('Error creating thumbnails:', error);
      throw error;
    }
  }

  // Method to create video job with pre-generated script (for content ideas)
  async createVideoJobWithScript(
    topic: TrendTopic,
    script: GeneratedScript,
    config: Partial<VideoJobConfig> = {}
  ): Promise<VideoJobResult> {
    const startTime = Date.now();
    let jobId: number | null = null;

    try {
      logger.info(`Creating video job with pre-generated script: ${script.title}`);

      // Create video job record
      jobId = await this.videoJobModel.create({
        trend_run_id: undefined, // No trend run for pre-generated content
        status: 'script_generation',
        topic: topic.keyword,
        script_text: script.fullScript,
        script_generation_time_ms: script.generationTime,
        video_provider: 'pika', // Default provider
        video_style: config.videoStyle || 'cinematic',
        video_resolution: '1080x1920',
        total_duration_seconds: script.estimatedDuration
      });

      logger.info(`Created video job ${jobId} with pre-generated script`);

      // Set up progress tracking
      this.updateJobProgress(jobId, 'narration', 20, 'Generating narration...');

      // Generate narration
      const audio = await this.generateNarration(script, config as VideoJobConfig);
      await this.videoJobModel.update(jobId, {
        narration_file_path: audio.audioFilePath,
        narration_generation_time_ms: audio.generationTime,
        status: 'video_synthesis'
      });

      this.updateJobProgress(jobId, 'video_synthesis', 50, 'Generating video...');

      // Generate video (if not skipped)
      let video: VideoGenerationResult | undefined;
      if (!config.skipVideoGeneration) {
        video = await this.generateVideo(script, config as VideoJobConfig);
        await this.videoJobModel.update(jobId, {
          video_file_path: video.videoFilePath,
          video_generation_time_ms: video.generationTime,
          video_task_id: video.taskId,
          video_prompt: video.prompt,
          status: 'completed'
        });
      }

      this.updateJobProgress(jobId, 'thumbnail_generation', 75, 'Generating thumbnails...');

      // Generate thumbnails
      let thumbnails: ThumbnailVariants | undefined;
      try {
        thumbnails = await this.thumbnailService.generateThumbnailVariants({
          title: script.title,
          topic: topic.keyword,
          style: config.thumbnailStyle || 'vibrant',
          language: config.language || 'ko',
          backgroundType: 'gradient',
          includeEmoji: true
        });
      } catch (error) {
        logger.warn('Thumbnail generation failed:', error);
      }

      // Upload to YouTube (if not skipped and video was generated)
      let upload: YouTubeUploadResult | undefined;
      if (!config.skipUpload && video && video.videoFilePath) {
        this.updateJobProgress(jobId, 'youtube_upload', 90, 'Uploading to YouTube...');

        try {
          const uploadOptions = {
            videoFilePath: video.videoFilePath,
            title: script.title,
            description: `${script.mainContent}\n\n${script.keywords.map(k => `#${k}`).join(' ')}`,
            tags: script.keywords,
            thumbnailAPath: thumbnails?.thumbnailA.filePath,
            thumbnailBPath: thumbnails?.thumbnailB.filePath,
            categoryId: this.getCategoryIdFromTopic(topic),
            privacy: config.privacy || 'public',
            language: config.language || 'ko'
          };

          upload = await this.youtubeUploadService.uploadVideo(uploadOptions);

          // Save upload data
          await this.youtubeUploadModel.create({
            video_job_id: jobId,
            video_id: upload.videoId,
            title: upload.title,
            description: upload.description,
            tags: JSON.stringify(uploadOptions.tags),
            thumbnail_a_path: uploadOptions.thumbnailAPath,
            thumbnail_b_path: uploadOptions.thumbnailBPath,
            thumbnail_test_id: thumbnails?.testConfiguration.testId,
            upload_status: upload.status === 'uploaded' ? 'live' : upload.status,
            privacy_status: uploadOptions.privacy,
            category_id: uploadOptions.categoryId,
            language: uploadOptions.language,
            upload_time_ms: upload.uploadTime
          });
        } catch (error) {
          logger.warn('YouTube upload failed:', error);
        }
      }

      const totalTime = Date.now() - startTime;
      this.updateJobProgress(jobId, 'completed', 100, 'Video job completed successfully');

      // Final status update
      await this.videoJobModel.update(jobId, {
        status: 'completed',
        completed_at: new Date().toISOString()
      });

      // Log success
      await this.logJobEvent(jobId, 'info', 'Video job completed successfully with pre-generated script', {
        totalTime,
        hasVideo: !!video,
        hasUpload: !!upload,
        scriptTitle: script.title
      });

      logger.info(`Video job ${jobId} completed successfully in ${totalTime}ms`);

      return {
        jobId,
        topic,
        script,
        audio,
        video,
        thumbnails,
        upload,
        status: 'completed',
        totalProcessingTime: totalTime
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      logger.error(`Video job failed: ${errorMessage}`, error);

      if (jobId !== null) {
        await this.videoJobModel.update(jobId, {
          status: 'failed',
          error_message: errorMessage,
          completed_at: new Date().toISOString()
        });

        this.updateJobProgress(jobId, 'failed', 0, `Job failed: ${errorMessage}`);

        await this.logJobEvent(jobId, 'error' as const, `Video job with script failed: ${errorMessage}`, {
          error: errorMessage,
          scriptTitle: script.title
        });
      }

      throw error;
    } finally {
      if (jobId !== null) {
        setTimeout(() => {
          this.activeJobs.delete(jobId!);
        }, 60000);
      }
    }
  }

  private getCategoryIdFromTopic(topic: TrendTopic): string {
    const categoryMap: { [key: string]: string } = {
      'technology': '28', // Science & Technology
      'entertainment': '24', // Entertainment
      'sports': '17', // Sports
      'lifestyle': '22', // People & Blogs
      'news': '25', // News & Politics
      'education': '27', // Education
      'music': '10', // Music
      'gaming': '20', // Gaming
      'health': '22', // People & Blogs
      'finance': '25' // News & Politics
    };

    return categoryMap[topic.category] || '22'; // Default to People & Blogs
  }
}