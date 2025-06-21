import { ElevenLabsClient } from 'elevenlabs';
import { createLogger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

const logger = createLogger('TextToSpeechService');

export interface TTSOptions {
  text: string;
  voiceId?: string;
  modelId?: string;
  stability?: number;
  similarityBoost?: number;
  style?: number;
  speakerBoost?: boolean;
  language?: 'ko' | 'en';
}

export interface TTSResult {
  audioFilePath: string;
  duration: number;
  fileSize: number;
  voiceId: string;
  generationTime: number;
  text: string;
}

export class TextToSpeechService {
  private client: ElevenLabsClient;
  private readonly outputDir: string;
  private readonly maxRetries: number = 3;

  // Pre-configured voice options for different content types
  private readonly voiceProfiles = {
    ko: {
      educational: {
        voiceId: 'pNInz6obpgDQGcFmaJgB', // Adam (clear, professional)
        stability: 0.75,
        similarityBoost: 0.75,
        style: 0.2
      },
      entertainment: {
        voiceId: 'EXAVITQu4vr4xnSDxMaL', // Bella (energetic, engaging)
        stability: 0.5,
        similarityBoost: 0.8,
        style: 0.6
      },
      news: {
        voiceId: 'ErXwobaYiN019PkySvjV', // Antoni (authoritative, clear)
        stability: 0.8,
        similarityBoost: 0.7,
        style: 0.1
      },
      lifestyle: {
        voiceId: 'MF3mGyEYCl7XYWbV9V6O', // Elli (warm, friendly)
        stability: 0.6,
        similarityBoost: 0.8,
        style: 0.4
      }
    }
  };

  constructor() {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      throw new Error('ELEVENLABS_API_KEY environment variable is required');
    }

    this.client = new ElevenLabsClient({
      apiKey: apiKey
    });
    this.outputDir = process.env.TTS_OUTPUT_DIR || './data/audio';
    
    // Ensure output directory exists
    this.ensureOutputDirectory();
    
    logger.info('TextToSpeechService initialized');
  }

  async generateSpeech(options: TTSOptions): Promise<TTSResult> {
    const startTime = Date.now();
    
    try {
      logger.info(`Starting TTS generation for ${options.text.length} characters`);
      
      const voiceConfig = this.getVoiceConfiguration(options);
      const audioData = await this.callElevenLabsAPI(options.text, voiceConfig);
      
      const filename = this.generateFilename(options.text);
      const filePath = path.join(this.outputDir, filename);
      
      // Save audio file
      await fs.promises.writeFile(filePath, audioData);
      const stats = await fs.promises.stat(filePath);
      
      const duration = await this.estimateAudioDuration(options.text, options.language);
      const generationTime = Date.now() - startTime;
      
      logger.info(`TTS generated successfully in ${generationTime}ms: ${filename}`);
      
      return {
        audioFilePath: filePath,
        duration,
        fileSize: stats.size,
        voiceId: voiceConfig.voiceId,
        generationTime,
        text: options.text
      };
    } catch (error) {
      logger.error('Error generating TTS:', error);
      throw error;
    }
  }

  private getVoiceConfiguration(options: TTSOptions) {
    const language = options.language || 'ko';
    const style = this.inferContentStyle(options.text);
    
    // Use custom voice settings if provided, otherwise use profile defaults
    const profiles = this.voiceProfiles[language as keyof typeof this.voiceProfiles];
    const profile = profiles?.[style] || this.voiceProfiles.ko.educational;
    
    return {
      voiceId: options.voiceId || profile.voiceId,
      stability: options.stability ?? profile.stability,
      similarityBoost: options.similarityBoost ?? profile.similarityBoost,
      style: options.style ?? profile.style,
      speakerBoost: options.speakerBoost ?? true,
      modelId: options.modelId || 'eleven_multilingual_v2'
    };
  }

  private async callElevenLabsAPI(text: string, config: any): Promise<Buffer> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        logger.debug(`Attempt ${attempt}/${this.maxRetries} - Calling ElevenLabs API`);
        
        const response = await this.client.textToSpeech.convert(config.voiceId, {
          text: text,
          model_id: config.modelId,
          voice_settings: {
            stability: config.stability,
            similarity_boost: config.similarityBoost,
            style: config.style,
            use_speaker_boost: config.speakerBoost
          }
        });

        if (!response) {
          throw new Error('No response from ElevenLabs API');
        }

        // Convert response to Buffer
        const chunks: Buffer[] = [];
        for await (const chunk of response) {
          chunks.push(chunk);
        }
        
        return Buffer.concat(chunks);
      } catch (error) {
        lastError = error as Error;
        logger.warn(`TTS attempt ${attempt} failed:`, error);
        
        if (attempt < this.maxRetries) {
          const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
          logger.info(`Retrying TTS in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError || new Error('Failed to generate TTS after all retries');
  }

  private inferContentStyle(text: string): keyof typeof this.voiceProfiles.ko {
    const lowerText = text.toLowerCase();
    
    // Educational indicators
    if (lowerText.includes('배우') || lowerText.includes('방법') || 
        lowerText.includes('설명') || lowerText.includes('이해')) {
      return 'educational';
    }
    
    // Entertainment indicators
    if (lowerText.includes('재미') || lowerText.includes('웃음') || 
        lowerText.includes('놀라운') || lowerText.includes('신기한')) {
      return 'entertainment';
    }
    
    // News indicators
    if (lowerText.includes('발표') || lowerText.includes('뉴스') || 
        lowerText.includes('최신') || lowerText.includes('속보')) {
      return 'news';
    }
    
    // Default to lifestyle for general content
    return 'lifestyle';
  }

  private generateFilename(text: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const textHash = this.simpleHash(text).toString(36);
    return `tts_${timestamp}_${textHash}.mp3`;
  }

  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  private async estimateAudioDuration(text: string, language: 'ko' | 'en' = 'ko'): Promise<number> {
    // Estimate based on character count and language
    const chars = text.length;
    const charsPerSecond = language === 'ko' ? 12 : 15; // Korean is typically slower
    
    // Add pauses for punctuation
    const sentences = text.split(/[.!?]+/).length;
    const pauseTime = sentences * 0.5; // 0.5 seconds per sentence break
    
    const estimatedDuration = (chars / charsPerSecond) + pauseTime;
    return Math.round(estimatedDuration * 10) / 10; // Round to 1 decimal place
  }

  private ensureOutputDirectory(): void {
    try {
      if (!fs.existsSync(this.outputDir)) {
        fs.mkdirSync(this.outputDir, { recursive: true });
        logger.info(`Created TTS output directory: ${this.outputDir}`);
      }
    } catch (error) {
      logger.error('Failed to create TTS output directory:', error);
      throw error;
    }
  }

  // Utility method to get available voices
  async getAvailableVoices(): Promise<any[]> {
    try {
      const voices = await this.client.voices.getAll();
      return voices.voices || [];
    } catch (error) {
      logger.error('Error fetching available voices:', error);
      return [];
    }
  }

  // Method to validate voice ID
  async isValidVoice(voiceId: string): Promise<boolean> {
    try {
      const voices = await this.getAvailableVoices();
      return voices.some(voice => voice.voice_id === voiceId);
    } catch (error) {
      logger.warn('Error validating voice ID:', error);
      return false;
    }
  }

  // Method to clean up old audio files
  async cleanupOldFiles(maxAgeHours: number = 24): Promise<number> {
    try {
      const files = await fs.promises.readdir(this.outputDir);
      const now = Date.now();
      const maxAge = maxAgeHours * 60 * 60 * 1000;
      let deletedCount = 0;

      for (const file of files) {
        if (file.startsWith('tts_') && file.endsWith('.mp3')) {
          const filePath = path.join(this.outputDir, file);
          const stats = await fs.promises.stat(filePath);
          
          if (now - stats.mtime.getTime() > maxAge) {
            await fs.promises.unlink(filePath);
            deletedCount++;
            logger.debug(`Deleted old TTS file: ${file}`);
          }
        }
      }

      if (deletedCount > 0) {
        logger.info(`Cleaned up ${deletedCount} old TTS files`);
      }

      return deletedCount;
    } catch (error) {
      logger.error('Error cleaning up old TTS files:', error);
      return 0;
    }
  }

  // Method to generate speech with custom voice settings
  async generateWithCustomVoice(
    text: string, 
    voiceId: string, 
    settings: {
      stability?: number;
      similarityBoost?: number;
      style?: number;
      speakerBoost?: boolean;
    }
  ): Promise<TTSResult> {
    const options: TTSOptions = {
      text,
      voiceId,
      stability: settings.stability,
      similarityBoost: settings.similarityBoost,
      style: settings.style,
      speakerBoost: settings.speakerBoost
    };

    return this.generateSpeech(options);
  }
}