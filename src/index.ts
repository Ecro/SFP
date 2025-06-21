import dotenv from 'dotenv';
dotenv.config();

import { TrendCollector } from './jobs/trendCollector';
import { AdminServer } from './admin/server';
import { Database } from './database/connection';
import { createLogger } from './utils/logger';

const logger = createLogger('App');

async function main() {
  try {
    logger.info('Starting Short-Form Auto Publisher with Admin Dashboard');
    
    // Initialize database
    const db = Database.getInstance();
    await db.connect();
    logger.info('Database connection established');
    
    // Start admin server
    const adminServer = new AdminServer(parseInt(process.env.PORT || '3000'));
    await adminServer.start();
    
    // Get trend collector from admin server (it's already initialized there)
    const trendCollector = adminServer.getTrendCollector();
    
    // Start the cron job for daily trend collection
    trendCollector.start();
    
    logger.info('Application started successfully');
    logger.info('Trend collection scheduled for daily execution at 6:00 AM KST');
    logger.info(`Admin dashboard available at http://localhost:${process.env.PORT || 3000}/admin`);
    
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
    
    // Graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down gracefully...');
      try {
        await adminServer.stop();
        await db.close();
        logger.info('Shutdown completed');
        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown:', error);
        process.exit(1);
      }
    };
    
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    
  } catch (error) {
    logger.error('Failed to start application:', error);
    process.exit(1);
  }
}

// Start the application
if (require.main === module) {
  main();
}