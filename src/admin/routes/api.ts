import { Router } from 'express';
import { TrendRunModel, TrendingTopicModel, VideoJobModel, SystemLogModel } from '../../database/models';
import { TrendCollector } from '../../jobs/trendCollector';
import { VideoJobOrchestrator } from '../../services/videoJobOrchestrator';
import { createLogger } from '../../utils/logger';

const router = Router();
const logger = createLogger('ApiRoutes');

// Initialize models
const trendRunModel = new TrendRunModel();
const trendingTopicModel = new TrendingTopicModel();
const videoJobModel = new VideoJobModel();
const systemLogModel = new SystemLogModel();

// Initialize trend collector and video job orchestrator
const trendCollector = new TrendCollector();
const videoOrchestrator = new VideoJobOrchestrator();

// Manual trigger for trend discovery
router.post('/trigger/trends', async (req, res) => {
  try {
    logger.info('Manual trend discovery triggered via API');
    
    const result = await trendCollector.runOnce();
    
    if (result) {
      res.json({
        success: true,
        message: 'Trend discovery completed successfully',
        data: {
          selectedTopic: result.selectedTopic?.keyword,
          topicsFound: result.topics.length,
          timestamp: result.timestamp
        }
      });
    } else {
      res.json({
        success: false,
        message: 'Trend discovery failed or returned no results'
      });
    }
  } catch (error) {
    logger.error('API trend trigger error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to trigger trend discovery',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get current system status
router.get('/status', async (req, res) => {
  try {
    const [
      recentTrend,
      pendingJobs,
      runningJobs,
      errorLogs
    ] = await Promise.all([
      trendRunModel.getRecent(1),
      videoJobModel.getByStatus('pending'),
      videoJobModel.getByStatus('script_generation'),
      systemLogModel.getByLevel('error', 5)
    ]);

    res.json({
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      lastTrendRun: recentTrend[0] || null,
      pipeline: {
        pendingJobs: pendingJobs.length,
        runningJobs: runningJobs.length
      },
      recentErrors: errorLogs.length,
      status: 'healthy'
    });
  } catch (error) {
    logger.error('API status error:', error);
    res.status(500).json({
      timestamp: new Date().toISOString(),
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get trend statistics
router.get('/stats/trends', async (req, res) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    
    const [
      successRate,
      topKeywords,
      recentTrends
    ] = await Promise.all([
      trendRunModel.getSuccessRate(days),
      trendingTopicModel.getTopKeywords(days, 10),
      trendRunModel.getRecent(days * 2) // Get more data for chart
    ]);

    // Prepare chart data
    const chartData = recentTrends.slice(0, days).reverse().map(trend => ({
      date: trend.timestamp?.split('T')[0],
      success: trend.status === 'completed' ? 1 : 0,
      topicsFound: trend.topics_found || 0,
      executionTime: trend.execution_time_ms || 0
    }));

    res.json({
      successRate,
      topKeywords,
      chartData,
      summary: {
        totalRuns: recentTrends.length,
        successfulRuns: recentTrends.filter(t => t.status === 'completed').length,
        averageTopics: recentTrends.reduce((sum, t) => sum + (t.topics_found || 0), 0) / recentTrends.length
      }
    });
  } catch (error) {
    logger.error('API trend stats error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to get trend statistics'
    });
  }
});

// Get recent logs with filtering
router.get('/logs', async (req, res) => {
  try {
    const level = req.query.level as string;
    const context = req.query.context as string;
    const limit = parseInt(req.query.limit as string) || 50;
    const since = req.query.since as string; // ISO timestamp

    let logs;
    if (level && level !== 'all') {
      logs = await systemLogModel.getByLevel(level, limit);
    } else if (context && context !== 'all') {
      logs = await systemLogModel.getByContext(context, limit);
    } else {
      logs = await systemLogModel.getRecent(limit);
    }

    // Filter by timestamp if provided
    if (since) {
      const sinceDate = new Date(since);
      logs = logs.filter(log => new Date(log.timestamp || 0) > sinceDate);
    }

    res.json({
      logs,
      total: logs.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('API logs error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to get logs'
    });
  }
});

// Get pipeline status details
router.get('/pipeline', async (req, res) => {
  try {
    const [
      pendingJobs,
      runningJobs,
      completedJobs,
      failedJobs
    ] = await Promise.all([
      videoJobModel.getByStatus('pending'),
      videoJobModel.getByStatus('script_generation'),
      videoJobModel.getByStatus('completed'),
      videoJobModel.getByStatus('failed')
    ]);

    const allJobs = [...runningJobs, ...pendingJobs, ...completedJobs.slice(0, 5), ...failedJobs.slice(0, 5)];

    res.json({
      stats: {
        pending: pendingJobs.length,
        running: runningJobs.length,
        completed: completedJobs.length,
        failed: failedJobs.length
      },
      jobs: allJobs,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('API pipeline error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to get pipeline status'
    });
  }
});

// Test API endpoints
router.post('/test/database', async (req, res) => {
  try {
    const { Database } = await import('../../database/connection');
    const db = Database.getInstance();
    const healthy = await db.healthCheck();
    
    res.json({
      success: healthy,
      message: healthy ? 'Database connection healthy' : 'Database connection failed',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Database test failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

router.post('/test/trends-api', async (req, res) => {
  try {
    const googleTrends = require('google-trends-api');
    
    const testResponse = await googleTrends.interestOverTime({
      keyword: 'test',
      geo: 'KR',
      startTime: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });

    const isWorking = !testResponse.startsWith('<');
    
    res.json({
      success: isWorking,
      message: isWorking ? 'Google Trends API is working' : 'Google Trends API returned HTML (blocked)',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Google Trends API test failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Create a test log entry
router.post('/test/log', async (req, res) => {
  try {
    const { level, message } = req.body;
    
    await systemLogModel.create({
      level: level || 'info',
      context: 'API-Test',
      message: message || 'Test log entry from admin dashboard',
      data: JSON.stringify({ source: 'admin_dashboard', timestamp: new Date().toISOString() })
    });

    res.json({
      success: true,
      message: 'Test log entry created successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to create test log entry',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Manual topic addition for fallback
router.post('/topics/manual', async (req, res) => {
  try {
    const { keyword, category } = req.body;
    
    if (!keyword) {
      res.status(400).json({
        success: false,
        message: 'Keyword is required'
      });
      return;
    }

    // Import TrendsService to create manual topic
    const { TrendsService } = await import('../../services/trendsService');
    const trendsService = new TrendsService();
    const topic = trendsService.addManualTopic(keyword, category);

    // Create a trend run for this manual topic
    const trendRunId = await trendRunModel.create({
      status: 'completed',
      total_keywords: 1,
      topics_found: 1,
      selected_topic: topic.keyword,
      selected_topic_score: topic.predictedViews,
      execution_time_ms: 50 // Instant for manual
    });

    // Store the manual topic
    await trendingTopicModel.create({
      trend_run_id: trendRunId,
      keyword: topic.keyword,
      score: topic.score,
      region: topic.region,
      category: topic.category,
      predicted_views: topic.predictedViews,
      volatility: topic.volatility,
      competitiveness: topic.competitiveness,
      related_queries: JSON.stringify(topic.relatedQueries),
      rank_position: 1
    });

    // Log the manual addition
    await systemLogModel.create({
      level: 'info',
      context: 'Manual-Topic',
      message: `Manual topic added: ${keyword}`,
      data: JSON.stringify({
        keyword,
        category,
        predictedViews: topic.predictedViews,
        addedBy: 'admin'
      }),
      trend_run_id: trendRunId
    });

    res.json({
      success: true,
      message: 'Manual topic added successfully',
      topic,
      trendRunId
    });
  } catch (error) {
    logger.error('Manual topic addition error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add manual topic',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Video job management endpoints

// Create a new video job
router.post('/jobs/create', async (req, res) => {
  try {
    const { customTopic, customCategory, contentStyle, targetDuration, language } = req.body;
    
    logger.info('Manual video job creation triggered via API', req.body);
    
    const config = {
      customTopic,
      customCategory,
      contentStyle: contentStyle || 'educational',
      targetDuration: targetDuration || 58,
      language: language || 'ko'
    };
    
    const result = await videoOrchestrator.createVideoJob(config);
    
    res.json({
      success: true,
      message: 'Video job created successfully',
      data: {
        jobId: result.jobId,
        topic: result.topic.keyword,
        status: result.status,
        processingTime: result.totalProcessingTime
      }
    });
  } catch (error) {
    logger.error('API video job creation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create video job',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get job progress
router.get('/jobs/:id/progress', async (req, res) => {
  try {
    const jobId = parseInt(req.params.id);
    const progress = videoOrchestrator.getJobProgress(jobId);
    
    if (!progress) {
      return res.status(404).json({
        success: false,
        message: 'Job progress not found'
      });
    }
    
    res.json({
      success: true,
      data: progress
    });
  } catch (error) {
    logger.error('API job progress error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get job progress',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get job details
router.get('/jobs/:id', async (req, res) => {
  try {
    const jobId = parseInt(req.params.id);
    const job = await videoOrchestrator.getJobDetails(jobId);
    
    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }
    
    res.json({
      success: true,
      data: job
    });
  } catch (error) {
    logger.error('API job details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get job details',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get all active jobs
router.get('/jobs/active', async (req, res) => {
  try {
    const activeJobs = videoOrchestrator.getAllActiveJobs();
    
    res.json({
      success: true,
      data: activeJobs
    });
  } catch (error) {
    logger.error('API active jobs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get active jobs',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Retry a failed job
router.post('/jobs/:id/retry', async (req, res) => {
  try {
    const jobId = parseInt(req.params.id);
    
    logger.info(`Retrying job ${jobId} via API`);
    
    const result = await videoOrchestrator.retryJob(jobId);
    
    res.json({
      success: true,
      message: 'Job retry initiated successfully',
      data: {
        newJobId: result.jobId,
        topic: result.topic.keyword,
        status: result.status
      }
    });
  } catch (error) {
    logger.error('API job retry error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retry job',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Test script generation
router.post('/test/script', async (req, res) => {
  try {
    const { topic, category, style, duration } = req.body;
    
    if (!topic) {
      return res.status(400).json({
        success: false,
        message: 'Topic is required'
      });
    }
    
    const result = await videoOrchestrator.createJobWithManualTopic(
      topic,
      category || 'general',
      {
        contentStyle: style || 'educational',
        targetDuration: duration || 58
      }
    );
    
    res.json({
      success: true,
      message: 'Script generation test completed',
      data: {
        jobId: result.jobId,
        script: result.script,
        audio: {
          filePath: result.audio.audioFilePath,
          duration: result.audio.duration
        }
      }
    });
  } catch (error) {
    logger.error('API script test error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to test script generation',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Video synthesis endpoints

// Get video synthesis provider status
router.get('/video/providers', async (req, res) => {
  try {
    const providers = await videoOrchestrator.getVideoProviderStatus();
    
    res.json({
      success: true,
      data: providers
    });
  } catch (error) {
    logger.error('API video providers error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get video provider status',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Create video-only job (for existing audio)
router.post('/video/create', async (req, res) => {
  try {
    const { scriptText, audioFilePath, videoStyle, targetDuration } = req.body;
    
    if (!scriptText || !audioFilePath) {
      return res.status(400).json({
        success: false,
        message: 'Script text and audio file path are required'
      });
    }
    
    logger.info('Creating video-only job via API', { scriptText: scriptText.substring(0, 100), audioFilePath });
    
    const result = await videoOrchestrator.createVideoOnlyJob(
      scriptText,
      audioFilePath,
      {
        videoStyle: videoStyle || 'cinematic',
        targetDuration: targetDuration || 58
      }
    );
    
    res.json({
      success: true,
      message: 'Video generation completed successfully',
      data: {
        videoFilePath: result.videoFilePath,
        duration: result.duration,
        provider: result.provider,
        generationTime: result.generationTime
      }
    });
  } catch (error) {
    logger.error('API video creation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create video',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Test video generation with sample content
router.post('/test/video', async (req, res) => {
  try {
    const { topic, style, duration } = req.body;
    
    if (!topic) {
      return res.status(400).json({
        success: false,
        message: 'Topic is required'
      });
    }
    
    logger.info('Testing video generation via API', { topic, style });
    
    // Create a complete video job including video synthesis
    const result = await videoOrchestrator.createJobWithManualTopic(
      topic,
      'general',
      {
        videoStyle: style || 'cinematic',
        targetDuration: duration || 58,
        skipVideoGeneration: false // Ensure video is generated
      }
    );
    
    res.json({
      success: true,
      message: 'Video generation test completed',
      data: {
        jobId: result.jobId,
        script: result.script,
        audio: {
          filePath: result.audio.audioFilePath,
          duration: result.audio.duration
        },
        video: result.video ? {
          filePath: result.video.videoFilePath,
          duration: result.video.duration,
          provider: result.video.provider,
          generationTime: result.video.generationTime
        } : null
      }
    });
  } catch (error) {
    logger.error('API video test error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to test video generation',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export { router as apiRoutes };