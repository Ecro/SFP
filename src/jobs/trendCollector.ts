import * as cron from 'node-cron';
import { TrendsService, TrendDiscoveryResult } from '../services/trendsService';
import { TrendRunModel, TrendingTopicModel, SystemLogModel } from '../database/models';
import { createLogger } from '../utils/logger';

const logger = createLogger('TrendCollector');

export class TrendCollector {
  private trendsService: TrendsService;
  private isRunning: boolean = false;
  private trendRunModel: TrendRunModel;
  private trendingTopicModel: TrendingTopicModel;
  private systemLogModel: SystemLogModel;

  constructor() {
    this.trendsService = new TrendsService('KR', 'ko');
    this.trendRunModel = new TrendRunModel();
    this.trendingTopicModel = new TrendingTopicModel();
    this.systemLogModel = new SystemLogModel();
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
    const startTime = Date.now();
    let trendRunId: number | null = null;

    logger.info('Starting trend collection...');

    try {
      // Create trend run record
      trendRunId = await this.trendRunModel.create({
        status: 'running',
        total_keywords: 0,
        topics_found: 0
      });

      // Log start of trend collection
      await this.systemLogModel.create({
        level: 'info',
        context: 'TrendCollector',
        message: 'Started trend discovery process',
        trend_run_id: trendRunId || undefined
      });

      const result = await this.trendsService.discoverTrends();
      const executionTime = Date.now() - startTime;
      
      // Update trend run with results
      await this.trendRunModel.update(trendRunId, {
        status: 'completed',
        topics_found: result.topics.length,
        selected_topic: result.selectedTopic?.keyword,
        selected_topic_score: result.selectedTopic?.predictedViews,
        execution_time_ms: executionTime
      });

      // Store all discovered topics
      if (result.topics.length > 0) {
        for (let i = 0; i < result.topics.length; i++) {
          const topic = result.topics[i];
          if (topic) {
            await this.trendingTopicModel.create({
              trend_run_id: trendRunId!,
              keyword: topic.keyword,
              score: topic.score,
              region: topic.region,
              category: topic.category,
              predicted_views: topic.predictedViews,
              volatility: topic.volatility,
              competitiveness: topic.competitiveness,
              related_queries: JSON.stringify(topic.relatedQueries),
              rank_position: i + 1
            });
          }
        }
      }
      
      if (result.selectedTopic) {
        logger.info(`Selected topic: "${result.selectedTopic.keyword}" with score ${result.selectedTopic.predictedViews}`);
        
        // Log successful completion
        await this.systemLogModel.create({
          level: 'info',
          context: 'TrendCollector',
          message: `Trend discovery completed successfully. Selected: ${result.selectedTopic.keyword}`,
          data: JSON.stringify({
            topicsFound: result.topics.length,
            executionTimeMs: executionTime,
            selectedScore: result.selectedTopic.predictedViews
          }),
          trend_run_id: trendRunId || undefined
        });
        
        // Store the result for the video generation pipeline
        await this.storeSelectedTopic(result);
        
        // Trigger next phase of the pipeline (video generation)
        await this.triggerVideoGeneration(result.selectedTopic);
      } else {
        logger.warn('No topic selected from trend discovery');
        
        await this.systemLogModel.create({
          level: 'warn',
          context: 'TrendCollector',
          message: 'No topic selected from trend discovery',
          data: JSON.stringify({ topicsFound: result.topics.length }),
          trend_run_id: trendRunId || undefined
        });
      }

      return result;
    } catch (error) {
      logger.error('Error during trend collection:', error);
      
      // Update trend run as failed
      if (trendRunId) {
        await this.trendRunModel.update(trendRunId, {
          status: 'failed',
          execution_time_ms: Date.now() - startTime,
          error_message: error instanceof Error ? error.message : String(error)
        });
      }

      // Log the error
      await this.systemLogModel.create({
        level: 'error',
        context: 'TrendCollector',
        message: 'Trend collection failed',
        data: JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        }),
        trend_run_id: trendRunId || undefined
      });
      
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