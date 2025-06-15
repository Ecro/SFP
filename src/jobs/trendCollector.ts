import * as cron from 'node-cron';
import { TrendsService, TrendDiscoveryResult } from '../services/trendsService';
import { createLogger } from '../utils/logger';

const logger = createLogger('TrendCollector');

export class TrendCollector {
  private trendsService: TrendsService;
  private isRunning: boolean = false;

  constructor() {
    this.trendsService = new TrendsService('KR', 'ko');
  }

  start(): void {
    logger.info('Starting trend collector cron job');
    
    // Run daily at 6:00 AM KST (UTC+9)
    // Cron expression: "0 6 * * *" (minute hour day month weekday)
    cron.schedule('0 6 * * *', async () => {
      if (!this.isRunning) {
        await this.collectTrends();
      } else {
        logger.warn('Trend collection already in progress, skipping...');
      }
    }, {
      scheduled: true,
      timezone: 'Asia/Seoul'
    });

    logger.info('Trend collector scheduled for daily execution at 6:00 AM KST');
  }

  async collectTrends(): Promise<TrendDiscoveryResult | null> {
    if (this.isRunning) {
      logger.warn('Trend collection already in progress');
      return null;
    }

    this.isRunning = true;
    logger.info('Starting trend collection...');

    try {
      const result = await this.trendsService.discoverTrends();
      
      if (result.selectedTopic) {
        logger.info(`Selected topic: "${result.selectedTopic.keyword}" with score ${result.selectedTopic.predictedViews}`);
        
        // Store the result for the video generation pipeline
        await this.storeSelectedTopic(result);
        
        // Trigger next phase of the pipeline (video generation)
        await this.triggerVideoGeneration(result.selectedTopic);
      } else {
        logger.warn('No topic selected from trend discovery');
      }

      return result;
    } catch (error) {
      logger.error('Error during trend collection:', error);
      
      // Send alert notification
      await this.sendErrorAlert(error);
      
      return null;
    } finally {
      this.isRunning = false;
      logger.info('Trend collection completed');
    }
  }

  async runOnce(): Promise<TrendDiscoveryResult | null> {
    logger.info('Running trend collection once (manual trigger)');
    return await this.collectTrends();
  }

  private async storeSelectedTopic(result: TrendDiscoveryResult): Promise<void> {
    try {
      // TODO: Implement database storage
      // For now, just log the result
      logger.info('Storing trend result:', {
        selectedTopic: result.selectedTopic?.keyword,
        topicsCount: result.topics.length,
        timestamp: result.timestamp
      });

      // Store in file system temporarily
      const fs = await import('fs/promises');
      const dataDir = './data';
      
      try {
        await fs.access(dataDir);
      } catch {
        await fs.mkdir(dataDir, { recursive: true });
      }

      const filename = `trend-${result.timestamp.toISOString().split('T')[0]}.json`;
      await fs.writeFile(`${dataDir}/${filename}`, JSON.stringify(result, null, 2));
      
      logger.info(`Trend data saved to ${dataDir}/${filename}`);
    } catch (error) {
      logger.error('Error storing trend data:', error);
    }
  }

  private async triggerVideoGeneration(topic: any): Promise<void> {
    try {
      logger.info(`Triggering video generation for topic: ${topic.keyword}`);
      
      // TODO: Implement video generation pipeline trigger
      // This will be implemented in Step 2
      logger.info('Video generation pipeline trigger - to be implemented in Step 2');
      
    } catch (error) {
      logger.error('Error triggering video generation:', error);
    }
  }

  private async sendErrorAlert(error: any): Promise<void> {
    try {
      logger.info('Sending error alert notification');
      
      // TODO: Implement Slack webhook notification
      // For now, just log the error
      logger.error('Trend collection failed:', {
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      });
      
    } catch (alertError) {
      logger.error('Error sending alert:', alertError);
    }
  }

  stop(): void {
    logger.info('Stopping trend collector');
    // Note: node-cron doesn't provide a direct way to stop specific tasks
    // This would require keeping track of the task reference
  }
}