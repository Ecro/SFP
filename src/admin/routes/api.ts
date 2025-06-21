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

// YouTube upload and management endpoints

// Get YouTube service status
router.get('/youtube/status', async (req, res) => {
  try {
    const status = await videoOrchestrator.getYouTubeServiceStatus();
    
    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    logger.error('API YouTube status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get YouTube service status',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Upload existing video to YouTube
router.post('/youtube/upload', async (req, res) => {
  try {
    const { videoFilePath, title, description, tags, privacy, language } = req.body;
    
    if (!videoFilePath || !title) {
      return res.status(400).json({
        success: false,
        message: 'Video file path and title are required'
      });
    }
    
    logger.info('Uploading video to YouTube via API', { title, videoFilePath });
    
    const result = await videoOrchestrator.uploadExistingVideo(
      videoFilePath,
      title,
      description || '',
      tags || [],
      {
        privacy: privacy || 'public',
        language: language || 'ko'
      }
    );
    
    res.json({
      success: true,
      message: 'Video uploaded successfully to YouTube',
      data: {
        videoId: result.videoId,
        videoUrl: result.videoUrl,
        title: result.title,
        status: result.status,
        uploadTime: result.uploadTime
      }
    });
  } catch (error) {
    logger.error('API YouTube upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload video to YouTube',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get video metrics from YouTube
router.get('/youtube/metrics/:videoId', async (req, res) => {
  try {
    const { videoId } = req.params;
    
    if (!videoId) {
      return res.status(400).json({
        success: false,
        message: 'Video ID is required'
      });
    }
    
    const metrics = await videoOrchestrator.getVideoMetrics(videoId);
    
    res.json({
      success: true,
      data: metrics
    });
  } catch (error) {
    logger.error('API YouTube metrics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get video metrics',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Generate thumbnails only
router.post('/thumbnails/generate', async (req, res) => {
  try {
    const { title, topic, style, language } = req.body;
    
    if (!title || !topic) {
      return res.status(400).json({
        success: false,
        message: 'Title and topic are required'
      });
    }
    
    logger.info('Generating thumbnails via API', { title, topic, style });
    
    const result = await videoOrchestrator.createThumbnailsOnly(
      title,
      topic,
      {
        thumbnailStyle: style || 'vibrant',
        language: language || 'ko'
      }
    );
    
    res.json({
      success: true,
      message: 'Thumbnails generated successfully',
      data: {
        testId: result.testConfiguration.testId,
        thumbnailA: {
          filePath: result.thumbnailA.filePath,
          style: result.thumbnailA.style,
          fileSize: result.thumbnailA.fileSize
        },
        thumbnailB: {
          filePath: result.thumbnailB.filePath,
          style: result.thumbnailB.style,
          fileSize: result.thumbnailB.fileSize
        },
        testConfiguration: result.testConfiguration
      }
    });
  } catch (error) {
    logger.error('API thumbnail generation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate thumbnails',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Test complete pipeline with upload
router.post('/test/complete-pipeline', async (req, res) => {
  try {
    const { topic, category, style, duration, privacy, skipUpload } = req.body;
    
    if (!topic) {
      return res.status(400).json({
        success: false,
        message: 'Topic is required'
      });
    }
    
    logger.info('Testing complete pipeline with upload via API', { topic, style, privacy });
    
    // Create a complete video job including upload
    const result = await videoOrchestrator.createJobWithManualTopic(
      topic,
      category || 'general',
      {
        contentStyle: style || 'educational',
        targetDuration: duration || 58,
        videoStyle: 'cinematic',
        thumbnailStyle: 'vibrant',
        privacy: privacy || 'unlisted', // Default to unlisted for testing
        language: 'ko',
        skipVideoGeneration: false,
        skipUpload: skipUpload || false
      }
    );
    
    res.json({
      success: true,
      message: 'Complete pipeline test completed',
      data: {
        jobId: result.jobId,
        topic: result.topic.keyword,
        script: {
          length: result.script.fullScript.length,
          hook: result.script.hook
        },
        audio: {
          duration: result.audio.duration,
          filePath: result.audio.audioFilePath
        },
        video: result.video ? {
          filePath: result.video.videoFilePath,
          duration: result.video.duration,
          provider: result.video.provider
        } : null,
        thumbnails: result.thumbnails ? {
          testId: result.thumbnails.testConfiguration.testId,
          thumbnailAPath: result.thumbnails.thumbnailA.filePath,
          thumbnailBPath: result.thumbnails.thumbnailB.filePath
        } : null,
        upload: result.upload ? {
          videoId: result.upload.videoId,
          videoUrl: result.upload.videoUrl,
          status: result.upload.status
        } : null,
        status: result.status,
        totalTime: result.totalProcessingTime
      }
    });
  } catch (error) {
    logger.error('API complete pipeline test error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to test complete pipeline',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Enhanced Multi-Source Trend Discovery Endpoints

// Test Naver API connection
router.post('/test/naver', async (req, res) => {
  try {
    const { NaverTrendsService } = await import('../../services/naverTrendsService');
    const naverService = new NaverTrendsService();
    
    const isConfigured = naverService.isConfigured();
    if (!isConfigured) {
      return res.json({
        success: false,
        message: 'Naver API credentials not configured'
      });
    }
    
    const isConnected = await naverService.testConnection();
    
    res.json({
      success: isConnected,
      message: isConnected ? 'Naver API connection successful' : 'Naver API connection failed',
      configured: isConfigured,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Naver API test failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Test YouTube API connection for trends
router.post('/test/youtube-trends', async (req, res) => {
  try {
    const { YouTubeTrendsService } = await import('../../services/youtubeTrendsService');
    const youtubeService = new YouTubeTrendsService();
    
    const isConfigured = youtubeService.isConfigured();
    if (!isConfigured) {
      return res.json({
        success: false,
        message: 'YouTube API key not configured'
      });
    }
    
    const isConnected = await youtubeService.testConnection();
    
    res.json({
      success: isConnected,
      message: isConnected ? 'YouTube API connection successful' : 'YouTube API connection failed',
      configured: isConfigured,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'YouTube API test failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get multi-source trend discovery results
router.get('/trends/multi-source', async (req, res) => {
  try {
    const { TrendsService } = await import('../../services/trendsService');
    const trendsService = new TrendsService();
    
    logger.info('Multi-source trend discovery requested via API');
    
    const result = await trendsService.discoverTrends();
    
    res.json({
      success: true,
      message: 'Multi-source trend discovery completed',
      data: {
        topics: result.topics,
        selectedTopic: result.selectedTopic,
        sources: result.sources,
        totalTopicsDiscovered: result.totalTopicsDiscovered,
        timestamp: result.timestamp
      }
    });
  } catch (error) {
    logger.error('Multi-source trend discovery error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to discover multi-source trends',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get Naver trending keywords
router.get('/trends/naver', async (req, res) => {
  try {
    const { NaverTrendsService } = await import('../../services/naverTrendsService');
    const naverService = new NaverTrendsService();
    
    if (!naverService.isConfigured()) {
      return res.status(400).json({
        success: false,
        message: 'Naver API not configured'
      });
    }
    
    const trendingKeywords = await naverService.discoverTrendingKeywords();
    
    res.json({
      success: true,
      message: 'Naver trending keywords retrieved successfully',
      data: {
        keywords: trendingKeywords,
        count: trendingKeywords.length,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Naver trends API error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get Naver trending keywords',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get YouTube trending videos/topics
router.get('/trends/youtube', async (req, res) => {
  try {
    const { YouTubeTrendsService } = await import('../../services/youtubeTrendsService');
    const youtubeService = new YouTubeTrendsService();
    
    if (!youtubeService.isConfigured()) {
      return res.status(400).json({
        success: false,
        message: 'YouTube API not configured'
      });
    }
    
    const categoryId = req.query.categoryId as string;
    const maxResults = parseInt(req.query.maxResults as string) || 20;
    
    const trendingVideos = await youtubeService.getTrendingVideos('KR', categoryId, maxResults);
    
    res.json({
      success: true,
      message: 'YouTube trending videos retrieved successfully',
      data: {
        videos: trendingVideos,
        count: trendingVideos.length,
        categoryId: categoryId || 'all',
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('YouTube trends API error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get YouTube trending videos',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get aggregated trend analysis
router.get('/trends/aggregated', async (req, res) => {
  try {
    const { TrendAggregationService } = await import('../../services/trendAggregationService');
    const aggregationService = new TrendAggregationService();
    
    const analytics = await aggregationService.analyzeRealTimeTrends();
    
    res.json({
      success: true,
      message: 'Trend aggregation analysis completed',
      data: analytics
    });
  } catch (error) {
    logger.error('Trend aggregation API error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get aggregated trend analysis',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get trend source performance metrics
router.get('/trends/source-metrics', async (req, res) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const { Database } = await import('../../database/connection');
    const db = Database.getInstance();
    
    const metrics = await db.all(`
      SELECT 
        source,
        AVG(avg_confidence) as avg_confidence,
        SUM(topics_discovered) as total_topics,
        AVG(success_rate) as avg_success_rate,
        AVG(response_time_ms) as avg_response_time,
        COUNT(*) as days_tracked
      FROM trend_source_metrics 
      WHERE date >= date('now', '-${days} days')
      GROUP BY source
      ORDER BY total_topics DESC
    `, []);
    
    res.json({
      success: true,
      message: 'Trend source metrics retrieved successfully',
      data: {
        metrics,
        period: `${days} days`,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Trend source metrics API error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get trend source metrics',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get cross-platform validated trends
router.get('/trends/cross-validated', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const { Database } = await import('../../database/connection');
    const db = Database.getInstance();
    
    const crossValidatedTrends = await db.all(`
      SELECT 
        at.*,
        COUNT(DISTINCT tt.source) as source_count
      FROM aggregated_trends at
      LEFT JOIN trending_topics tt ON tt.keyword = at.keyword
      WHERE at.cross_platform_validation = 1
      GROUP BY at.id
      HAVING source_count > 1
      ORDER BY at.confidence DESC, at.aggregated_score DESC
      LIMIT ?
    `, [limit]);
    
    res.json({
      success: true,
      message: 'Cross-validated trends retrieved successfully',
      data: {
        trends: crossValidatedTrends,
        count: crossValidatedTrends.length,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Cross-validated trends API error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get cross-validated trends',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Search trends by keyword or category
router.get('/trends/search', async (req, res) => {
  try {
    const query = req.query.q as string;
    const category = req.query.category as string;
    const source = req.query.source as string;
    const limit = parseInt(req.query.limit as string) || 50;
    
    if (!query && !category && !source) {
      return res.status(400).json({
        success: false,
        message: 'Query, category, or source parameter required'
      });
    }
    
    const { Database } = await import('../../database/connection');
    const db = Database.getInstance();
    
    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    
    if (query) {
      whereClause += ' AND (keyword LIKE ? OR related_queries LIKE ?)';
      params.push(`%${query}%`, `%${query}%`);
    }
    
    if (category) {
      whereClause += ' AND category = ?';
      params.push(category);
    }
    
    if (source) {
      whereClause += ' AND source = ?';
      params.push(source);
    }
    
    params.push(limit);
    
    const trends = await db.all(`
      SELECT *
      FROM trending_topics
      ${whereClause}
      ORDER BY score DESC, created_at DESC
      LIMIT ?
    `, params);
    
    res.json({
      success: true,
      message: 'Trend search completed',
      data: {
        trends,
        count: trends.length,
        query: { query, category, source },
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Trend search API error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search trends',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Content Ideas Testing Endpoints

// Generate content ideas based on trends
router.post('/test/content-ideas', async (req, res) => {
  try {
    const { category, count } = req.body;
    
    logger.info('Content ideas generation requested via API', { category, count });
    
    const { ContentIdeasService } = await import('../../services/contentIdeasService');
    const contentIdeasService = new ContentIdeasService();
    
    const result = await contentIdeasService.generateContentIdeas({
      category: category || undefined,
      count: count || 10
    });
    
    res.json({
      success: true,
      message: 'Content ideas generated successfully',
      data: {
        ideas: result.ideas,
        trendsDiscovered: result.trendsDiscovered,
        sourcesUsed: result.sourcesUsed,
        generationTime: result.generationTime,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Content ideas generation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate content ideas',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Execute a specific content idea
router.post('/content-ideas/execute', async (req, res) => {
  try {
    const { ideaIndex, idea } = req.body;
    
    if (typeof ideaIndex !== 'number' || !idea) {
      return res.status(400).json({
        success: false,
        message: 'Idea index and idea data are required'
      });
    }
    
    logger.info(`Executing content idea via API: ${idea.title}`);
    
    const { ContentIdeasService } = await import('../../services/contentIdeasService');
    const contentIdeasService = new ContentIdeasService();
    
    // Execute the content idea (create full video job)
    const result = await contentIdeasService.executeContentIdea(ideaIndex, [idea]);
    
    res.json({
      success: true,
      message: 'Content idea execution started successfully',
      data: {
        jobId: result.jobId,
        topic: result.topic.keyword,
        status: result.status,
        totalProcessingTime: result.totalProcessingTime,
        script: {
          title: result.script.title,
          estimatedDuration: result.script.estimatedDuration
        },
        audio: result.audio ? {
          duration: result.audio.duration,
          filePath: result.audio.audioFilePath
        } : null,
        video: result.video ? {
          filePath: result.video.videoFilePath,
          duration: result.video.duration,
          provider: result.video.provider
        } : null,
        upload: result.upload ? {
          videoId: result.upload.videoId,
          videoUrl: result.upload.videoUrl,
          status: result.upload.status
        } : null
      }
    });
  } catch (error) {
    logger.error('Content idea execution error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to execute content idea',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get content idea generation statistics
router.get('/content-ideas/stats', async (req, res) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    
    // Get video jobs that were created from content ideas (those without trend_run_id)
    const videoJobs = await videoJobModel.getAllJobs();
    const contentIdeaJobs = videoJobs.filter((job: any) => !job.trend_run_id);
    
    // Filter by date range
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    
    const recentJobs = contentIdeaJobs.filter((job: any) => 
      new Date(job.created_at || 0) > cutoffDate
    );
    
    const stats = {
      totalContentIdeasGenerated: recentJobs.length,
      successfulExecutions: recentJobs.filter((job: any) => job.status === 'completed').length,
      failedExecutions: recentJobs.filter((job: any) => job.status === 'failed').length,
      averageProcessingTime: recentJobs.length > 0 ? 
        recentJobs
          .filter((job: any) => job.completed_at && job.created_at)
          .reduce((sum: number, job: any) => {
            const start = new Date(job.created_at!).getTime();
            const end = new Date(job.completed_at!).getTime();
            return sum + (end - start);
          }, 0) / recentJobs.length : 0,
      popularCategories: recentJobs.reduce((acc: any, job: any) => {
        // Extract category from job data if available
        const category = 'general'; // Would need to track this in job data
        acc[category] = (acc[category] || 0) + 1;
        return acc;
      }, {}),
      successRate: recentJobs.length > 0 ? 
        (recentJobs.filter((job: any) => job.status === 'completed').length / recentJobs.length) * 100 : 0
    };
    
    res.json({
      success: true,
      message: 'Content ideas statistics retrieved successfully',
      data: {
        ...stats,
        period: `${days} days`,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Content ideas stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get content ideas statistics',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Test individual content generation components
router.post('/test/content-component', async (req, res) => {
  try {
    const { component, topic, category, style, duration } = req.body;
    
    if (!component || !topic) {
      return res.status(400).json({
        success: false,
        message: 'Component type and topic are required'
      });
    }
    
    logger.info(`Testing content component: ${component} for topic: ${topic}`);
    
    let result;
    
    switch (component) {
      case 'script':
        const { ScriptGenerationService } = await import('../../services/scriptGenerationService');
        const scriptService = new ScriptGenerationService();
        
        // Create a mock topic for script generation
        const mockTopic = {
          keyword: topic,
          score: 80,
          region: 'KR',
          category: category || 'general',
          relatedQueries: [`${topic} 정보`, `${topic} 뉴스`],
          predictedViews: 500000,
          volatility: 0.7,
          competitiveness: 0.5
        };
        
        result = await scriptService.generateScript({
          topic: mockTopic,
          style: style || 'educational',
          targetDuration: duration || 58,
          includeHook: true,
          language: 'ko'
        });
        break;
        
      case 'storyline':
        const { ContentIdeasService } = await import('../../services/contentIdeasService');
        const contentService = new ContentIdeasService();
        
        // Generate a single content idea
        const ideas = await contentService.generateContentIdeas({
          category: category || undefined,
          count: 1
        });
        
        result = ideas.ideas[0] || null;
        break;
        
      default:
        return res.status(400).json({
          success: false,
          message: `Unknown component type: ${component}`
        });
    }
    
    res.json({
      success: true,
      message: `${component} component test completed successfully`,
      data: {
        component,
        topic,
        result,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error(`Content component test error (${req.body.component}):`, error);
    res.status(500).json({
      success: false,
      message: `Failed to test ${req.body.component} component`,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export { router as apiRoutes };