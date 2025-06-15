import { createLogger } from '../utils/logger';
import { TrendsService, TrendTopic } from './trendsService';
import { ScriptGenerationService, GeneratedScript } from './scriptGenerationService';
import { TextToSpeechService, TTSResult } from './textToSpeechService';
import { VideoSynthesisService, VideoGenerationResult } from './videoSynthesisService';
import { VideoJobModel, TrendRunModel, SystemLogModel } from '../database/models';

const logger = createLogger('VideoJobOrchestrator');

export interface VideoJobConfig {
  targetDuration?: number;
  contentStyle?: 'educational' | 'entertainment' | 'news' | 'lifestyle';
  language?: 'ko' | 'en';
  customTopic?: string;
  customCategory?: string;
  videoStyle?: 'cinematic' | 'natural' | 'animated' | 'documentary';
  skipVideoGeneration?: boolean; // For testing narration only
}

export interface VideoJobResult {
  jobId: number;
  trendRunId?: number;
  topic: TrendTopic;
  script: GeneratedScript;
  audio: TTSResult;
  video?: VideoGenerationResult;
  status: 'completed' | 'failed';
  totalProcessingTime: number;
  error?: string;
}

export interface JobProgress {
  jobId: number;
  currentStep: 'trend_discovery' | 'script_generation' | 'narration' | 'video_synthesis' | 'completed' | 'failed';
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
  private videoJobModel: VideoJobModel;
  private trendRunModel: TrendRunModel;
  private systemLogModel: SystemLogModel;
  private activeJobs: Map<number, JobProgress> = new Map();

  constructor() {
    this.trendsService = new TrendsService();
    this.scriptService = new ScriptGenerationService();
    this.ttsService = new TextToSpeechService();
    this.videoSynthesisService = new VideoSynthesisService();
    this.videoJobModel = new VideoJobModel();
    this.trendRunModel = new TrendRunModel();
    this.systemLogModel = new SystemLogModel();
    
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
      this.updateJobProgress(jobId, 'script_generation', 20, 'Generating script...');

      // Step 3: Generate script
      const script = await this.generateScript(topic, config);
      
      // Update job with script
      await this.videoJobModel.update(jobId, {
        script_text: script.fullScript,
        script_generation_time_ms: script.generationTime
      });

      this.updateJobProgress(jobId, 'narration', 40, 'Generating narration...');

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
        this.updateJobProgress(jobId, 'video_synthesis', 70, 'Generating video...');
        
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
      
      // Clear old job progress data
      const now = Date.now();
      const maxAge = 60 * 60 * 1000; // 1 hour
      
      for (const [jobId, progress] of this.activeJobs.entries()) {
        if (now - progress.startTime.getTime() > maxAge) {
          this.activeJobs.delete(jobId);
        }
      }

      logger.info(`Housekeeping completed: ${deletedAudioFiles} audio files deleted, ${deletedVideoFiles} video files deleted, ${this.activeJobs.size} active jobs remaining`);
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
}