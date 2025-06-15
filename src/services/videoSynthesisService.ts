import axios, { AxiosResponse } from 'axios';
import { createLogger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

const logger = createLogger('VideoSynthesisService');

export interface VideoGenerationOptions {
  prompt: string;
  aspectRatio?: '16:9' | '9:16' | '1:1';
  duration?: number; // seconds
  style?: 'cinematic' | 'natural' | 'animated' | 'documentary';
  quality?: 'standard' | 'high' | 'ultra';
  audioFilePath?: string; // Path to narration audio
}

export interface VideoGenerationResult {
  videoFilePath: string;
  duration: number;
  fileSize: number;
  resolution: string;
  generationTime: number;
  provider: 'luma' | 'runway' | 'pika';
  taskId: string;
  prompt: string;
}

export interface VideoTaskStatus {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number; // 0-100
  estimatedTime?: number;
  videoUrl?: string;
  error?: string;
}

export class VideoSynthesisService {
  private readonly outputDir: string;
  private readonly maxRetries: number = 3;
  private readonly pollInterval: number = 10000; // 10 seconds
  private readonly maxPollTime: number = 600000; // 10 minutes

  // Provider configurations
  private readonly providers = {
    luma: {
      baseUrl: 'https://api.lumalabs.ai/dream-machine/v1',
      apiKey: process.env.LUMA_API_KEY,
      enabled: !!process.env.LUMA_API_KEY
    },
    runway: {
      baseUrl: 'https://api.runwayml.com/v1',
      apiKey: process.env.RUNWAY_API_KEY,
      enabled: !!process.env.RUNWAY_API_KEY
    },
    pika: {
      baseUrl: 'https://api.pika.art/v1',
      apiKey: process.env.PIKA_API_KEY,
      enabled: !!process.env.PIKA_API_KEY
    }
  };

  constructor() {
    this.outputDir = process.env.VIDEO_OUTPUT_DIR || './data/videos';
    this.ensureOutputDirectory();
    
    // Check if at least one provider is configured
    const enabledProviders = Object.entries(this.providers)
      .filter(([_, config]) => config.enabled)
      .map(([name, _]) => name);
    
    if (enabledProviders.length === 0) {
      logger.warn('No video synthesis providers configured. Please set LUMA_API_KEY, RUNWAY_API_KEY, or PIKA_API_KEY');
    } else {
      logger.info(`VideoSynthesisService initialized with providers: ${enabledProviders.join(', ')}`);
    }
  }

  async generateVideo(options: VideoGenerationOptions): Promise<VideoGenerationResult> {
    const startTime = Date.now();
    
    try {
      logger.info(`Starting video generation: ${options.prompt.substring(0, 100)}...`);
      
      // Select best available provider
      const provider = this.selectProvider();
      logger.info(`Using provider: ${provider}`);
      
      // Generate video based on provider
      let result: VideoGenerationResult;
      switch (provider) {
        case 'luma':
          result = await this.generateWithLuma(options);
          break;
        case 'runway':
          result = await this.generateWithRunway(options);
          break;
        case 'pika':
          result = await this.generateWithPika(options);
          break;
        default:
          throw new Error('No available video synthesis provider');
      }
      
      result.generationTime = Date.now() - startTime;
      result.provider = provider;
      
      logger.info(`Video generated successfully in ${result.generationTime}ms: ${path.basename(result.videoFilePath)}`);
      
      return result;
    } catch (error) {
      logger.error('Error generating video:', error);
      throw error;
    }
  }

  private selectProvider(): 'luma' | 'runway' | 'pika' {
    // Priority order: Luma > Runway > Pika (based on quality and short-form suitability)
    if (this.providers.luma.enabled) return 'luma';
    if (this.providers.runway.enabled) return 'runway';
    if (this.providers.pika.enabled) return 'pika';
    
    throw new Error('No video synthesis provider is configured');
  }

  private async generateWithLuma(options: VideoGenerationOptions): Promise<VideoGenerationResult> {
    const { luma } = this.providers;
    
    try {
      // Step 1: Create generation task
      const taskResponse = await axios.post(
        `${luma.baseUrl}/generations`,
        {
          prompt: options.prompt,
          aspect_ratio: options.aspectRatio || '9:16',
          loop: false,
          keyframes: {
            frame0: {
              type: 'generation',
              url: null
            }
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${luma.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const taskId = taskResponse.data.id;
      logger.info(`Luma task created: ${taskId}`);

      // Step 2: Poll for completion
      const completedTask = await this.pollTaskStatus(taskId, 'luma');
      
      if (!completedTask.videoUrl) {
        throw new Error('Video generation completed but no video URL provided');
      }

      // Step 3: Download video
      const videoFilePath = await this.downloadVideo(completedTask.videoUrl, taskId, 'luma');
      
      // Step 4: Get video info
      const videoInfo = await this.getVideoInfo(videoFilePath);
      
      return {
        videoFilePath,
        duration: videoInfo.duration,
        fileSize: videoInfo.fileSize,
        resolution: videoInfo.resolution,
        generationTime: 0, // Will be set by caller
        provider: 'luma',
        taskId,
        prompt: options.prompt
      };
    } catch (error) {
      logger.error('Luma generation failed:', error);
      throw error;
    }
  }

  private async generateWithRunway(options: VideoGenerationOptions): Promise<VideoGenerationResult> {
    const { runway } = this.providers;
    
    try {
      // Step 1: Create generation task
      const taskResponse = await axios.post(
        `${runway.baseUrl}/image_to_video`,
        {
          promptText: options.prompt,
          seed: Math.floor(Math.random() * 1000000),
          interpolate: true,
          upscale: false,
          watermark: false
        },
        {
          headers: {
            'Authorization': `Bearer ${runway.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const taskId = taskResponse.data.id;
      logger.info(`Runway task created: ${taskId}`);

      // Step 2: Poll for completion
      const completedTask = await this.pollTaskStatus(taskId, 'runway');
      
      if (!completedTask.videoUrl) {
        throw new Error('Video generation completed but no video URL provided');
      }

      // Step 3: Download video
      const videoFilePath = await this.downloadVideo(completedTask.videoUrl, taskId, 'runway');
      
      // Step 4: Get video info
      const videoInfo = await this.getVideoInfo(videoFilePath);
      
      return {
        videoFilePath,
        duration: videoInfo.duration,
        fileSize: videoInfo.fileSize,
        resolution: videoInfo.resolution,
        generationTime: 0, // Will be set by caller
        provider: 'runway',
        taskId,
        prompt: options.prompt
      };
    } catch (error) {
      logger.error('Runway generation failed:', error);
      throw error;
    }
  }

  private async generateWithPika(options: VideoGenerationOptions): Promise<VideoGenerationResult> {
    const { pika } = this.providers;
    
    try {
      // Step 1: Create generation task
      const taskResponse = await axios.post(
        `${pika.baseUrl}/generate`,
        {
          prompt: options.prompt,
          options: {
            frameRate: 24,
            aspectRatio: options.aspectRatio || '9:16',
            motion: 1,
            guidance: 12,
            negativePrompt: 'blurry, low quality, distorted'
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${pika.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const taskId = taskResponse.data.job.id;
      logger.info(`Pika task created: ${taskId}`);

      // Step 2: Poll for completion
      const completedTask = await this.pollTaskStatus(taskId, 'pika');
      
      if (!completedTask.videoUrl) {
        throw new Error('Video generation completed but no video URL provided');
      }

      // Step 3: Download video
      const videoFilePath = await this.downloadVideo(completedTask.videoUrl, taskId, 'pika');
      
      // Step 4: Get video info
      const videoInfo = await this.getVideoInfo(videoFilePath);
      
      return {
        videoFilePath,
        duration: videoInfo.duration,
        fileSize: videoInfo.fileSize,
        resolution: videoInfo.resolution,
        generationTime: 0, // Will be set by caller
        provider: 'pika',
        taskId,
        prompt: options.prompt
      };
    } catch (error) {
      logger.error('Pika generation failed:', error);
      throw error;
    }
  }

  private async pollTaskStatus(taskId: string, provider: 'luma' | 'runway' | 'pika'): Promise<VideoTaskStatus> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < this.maxPollTime) {
      try {
        const status = await this.getTaskStatus(taskId, provider);
        
        logger.debug(`Task ${taskId} status: ${status.status} (${status.progress}%)`);
        
        if (status.status === 'completed') {
          return status;
        }
        
        if (status.status === 'failed') {
          throw new Error(`Video generation failed: ${status.error || 'Unknown error'}`);
        }
        
        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, this.pollInterval));
      } catch (error) {
        logger.warn(`Error polling task ${taskId}:`, error);
        await new Promise(resolve => setTimeout(resolve, this.pollInterval));
      }
    }
    
    throw new Error(`Video generation timed out after ${this.maxPollTime}ms`);
  }

  private async getTaskStatus(taskId: string, provider: 'luma' | 'runway' | 'pika'): Promise<VideoTaskStatus> {
    const config = this.providers[provider];
    let endpoint: string;
    
    switch (provider) {
      case 'luma':
        endpoint = `${config.baseUrl}/generations/${taskId}`;
        break;
      case 'runway':
        endpoint = `${config.baseUrl}/tasks/${taskId}`;
        break;
      case 'pika':
        endpoint = `${config.baseUrl}/jobs/${taskId}`;
        break;
    }
    
    const response = await axios.get(endpoint, {
      headers: {
        'Authorization': `Bearer ${config.apiKey}`
      }
    });
    
    return this.parseTaskStatus(response.data, provider);
  }

  private parseTaskStatus(data: any, provider: 'luma' | 'runway' | 'pika'): VideoTaskStatus {
    switch (provider) {
      case 'luma':
        return {
          id: data.id,
          status: data.state === 'completed' ? 'completed' : 
                 data.state === 'failed' ? 'failed' : 
                 data.state === 'processing' ? 'processing' : 'pending',
          progress: data.state === 'completed' ? 100 : 
                   data.state === 'processing' ? 50 : 0,
          videoUrl: data.assets?.video,
          error: data.failure_reason
        };
      
      case 'runway':
        return {
          id: data.id,
          status: data.status === 'SUCCEEDED' ? 'completed' : 
                 data.status === 'FAILED' ? 'failed' : 
                 data.status === 'RUNNING' ? 'processing' : 'pending',
          progress: data.progress || 0,
          videoUrl: data.output?.[0],
          error: data.error
        };
      
      case 'pika':
        return {
          id: data.id,
          status: data.result?.status === 'finished' ? 'completed' : 
                 data.result?.status === 'error' ? 'failed' : 
                 data.result?.status === 'processing' ? 'processing' : 'pending',
          progress: data.result?.progress || 0,
          videoUrl: data.result?.videos?.[0]?.url,
          error: data.result?.error_msg
        };
      
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }

  private async downloadVideo(videoUrl: string, taskId: string, provider: string): Promise<string> {
    const filename = `video_${provider}_${taskId}_${Date.now()}.mp4`;
    const filePath = path.join(this.outputDir, filename);
    
    logger.info(`Downloading video from ${videoUrl} to ${filename}`);
    
    const response = await axios({
      method: 'GET',
      url: videoUrl,
      responseType: 'stream'
    });
    
    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);
    
    return new Promise((resolve, reject) => {
      writer.on('finish', () => resolve(filePath));
      writer.on('error', reject);
    });
  }

  private async getVideoInfo(filePath: string): Promise<{ duration: number; fileSize: number; resolution: string }> {
    try {
      const stats = await fs.promises.stat(filePath);
      
      // For now, return estimated values
      // In production, you'd use ffprobe or similar to get actual video metadata
      return {
        duration: 58, // Target duration for shorts
        fileSize: stats.size,
        resolution: '1080x1920' // Standard shorts resolution
      };
    } catch (error) {
      logger.error('Error getting video info:', error);
      return {
        duration: 58,
        fileSize: 0,
        resolution: '1080x1920'
      };
    }
  }

  private ensureOutputDirectory(): void {
    try {
      if (!fs.existsSync(this.outputDir)) {
        fs.mkdirSync(this.outputDir, { recursive: true });
        logger.info(`Created video output directory: ${this.outputDir}`);
      }
    } catch (error) {
      logger.error('Failed to create video output directory:', error);
      throw error;
    }
  }

  // Utility methods

  async getProviderStatus(): Promise<{ provider: string; enabled: boolean; available: boolean }[]> {
    const results = [];
    
    for (const [name, config] of Object.entries(this.providers)) {
      let available = false;
      
      if (config.enabled) {
        try {
          // Simple health check (you'd implement provider-specific health checks)
          available = true;
        } catch (error) {
          logger.debug(`Provider ${name} health check failed:`, error);
        }
      }
      
      results.push({
        provider: name,
        enabled: config.enabled,
        available
      });
    }
    
    return results;
  }

  async cleanupOldVideos(maxAgeHours: number = 48): Promise<number> {
    try {
      const files = await fs.promises.readdir(this.outputDir);
      const now = Date.now();
      const maxAge = maxAgeHours * 60 * 60 * 1000;
      let deletedCount = 0;

      for (const file of files) {
        if (file.startsWith('video_') && file.endsWith('.mp4')) {
          const filePath = path.join(this.outputDir, file);
          const stats = await fs.promises.stat(filePath);
          
          if (now - stats.mtime.getTime() > maxAge) {
            await fs.promises.unlink(filePath);
            deletedCount++;
            logger.debug(`Deleted old video file: ${file}`);
          }
        }
      }

      if (deletedCount > 0) {
        logger.info(`Cleaned up ${deletedCount} old video files`);
      }

      return deletedCount;
    } catch (error) {
      logger.error('Error cleaning up old video files:', error);
      return 0;
    }
  }

  // Method to generate video prompt from script
  generateVideoPrompt(script: string, style: string = 'cinematic'): string {
    // Extract key visual elements from script
    const scriptLower = script.toLowerCase();
    
    let basePrompt = '';
    let styleModifier = '';
    
    // Determine content type and visual style
    if (scriptLower.includes('기술') || scriptLower.includes('과학')) {
      basePrompt = 'Modern technology concept, clean minimalist design, futuristic elements';
    } else if (scriptLower.includes('음식') || scriptLower.includes('요리')) {
      basePrompt = 'Food preparation, ingredient close-ups, appetizing presentation';
    } else if (scriptLower.includes('여행') || scriptLower.includes('장소')) {
      basePrompt = 'Beautiful landscape, travel destination, scenic views';
    } else if (scriptLower.includes('건강') || scriptLower.includes('운동')) {
      basePrompt = 'Health and fitness, active lifestyle, wellness concept';
    } else {
      basePrompt = 'Modern lifestyle, clean aesthetic, engaging visuals';
    }
    
    // Add style modifier
    switch (style) {
      case 'cinematic':
        styleModifier = ', cinematic lighting, film grain, professional cinematography';
        break;
      case 'natural':
        styleModifier = ', natural lighting, realistic, documentary style';
        break;
      case 'animated':
        styleModifier = ', smooth animation, dynamic motion, colorful';
        break;
      case 'documentary':
        styleModifier = ', documentary style, factual presentation, clear visuals';
        break;
    }
    
    return `${basePrompt}${styleModifier}, vertical 9:16 aspect ratio, high quality, engaging for social media, 60 seconds duration`;
  }
}