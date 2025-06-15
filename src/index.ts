import { TrendCollector } from './jobs/trendCollector';
import { createLogger } from './utils/logger';

const logger = createLogger('App');

async function main() {
  try {
    logger.info('Starting Short-Form Auto Publisher');
    
    const trendCollector = new TrendCollector();
    
    // Start the cron job for daily trend collection
    trendCollector.start();
    
    logger.info('Application started successfully');
    logger.info('Trend collection scheduled for daily execution at 6:00 AM KST');
    
    // For development/testing, you can run trend collection once
    if (process.env.NODE_ENV === 'development' && process.env.RUN_ONCE === 'true') {
      logger.info('Running trend collection once for development...');
      const result = await trendCollector.runOnce();
      
      if (result?.selectedTopic) {
        logger.info('Development run completed successfully');
        logger.info(`Selected topic: ${result.selectedTopic.keyword}`);
      } else {
        logger.warn('Development run completed but no topic was selected');
      }
    }
    
    // Keep the process running
    process.on('SIGINT', () => {
      logger.info('Received SIGINT, shutting down gracefully...');
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      logger.info('Received SIGTERM, shutting down gracefully...');
      process.exit(0);
    });
    
  } catch (error) {
    logger.error('Failed to start application:', error);
    process.exit(1);
  }
}

// Start the application
if (require.main === module) {
  main();
}