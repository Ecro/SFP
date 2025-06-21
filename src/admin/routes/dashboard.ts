import { Router } from 'express';
import { TrendRunModel, TrendingTopicModel, VideoJobModel, SystemLogModel } from '../../database/models';
import { createLogger } from '../../utils/logger';

const router = Router();
const logger = createLogger('DashboardRoutes');

// Initialize models
const trendRunModel = new TrendRunModel();
const trendingTopicModel = new TrendingTopicModel();
const videoJobModel = new VideoJobModel();
const systemLogModel = new SystemLogModel();

// Dashboard overview
router.get('/', async (req, res) => {
  try {
    const [
      recentTrends,
      recentJobs,
      recentLogs,
      successRate,
      topKeywords
    ] = await Promise.all([
      trendRunModel.getRecent(5),
      videoJobModel.getRecent(5),
      systemLogModel.getRecent(10),
      trendRunModel.getSuccessRate(7),
      trendingTopicModel.getTopKeywords(7, 5)
    ]);

    res.render('dashboard/overview', {
      title: 'SFP Admin Dashboard',
      recentTrends,
      recentJobs,
      recentLogs,
      successRate,
      topKeywords,
      currentTime: new Date().toISOString(),
      activeTab: 'overview'
    });
  } catch (error) {
    logger.error('Dashboard overview error:', error);
    res.status(500).render('error', {
      title: 'Dashboard Error',
      message: 'Failed to load dashboard data',
      error
    });
  }
});

// Trend analysis history
router.get('/trends', async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;

    // Get trends with pagination
    const trends = await trendRunModel.getRecent(limit);
    
    // Get topics for each trend run
    const trendsWithTopics = await Promise.all(
      trends.map(async (trend) => {
        const topics = trend.id ? await trendingTopicModel.getByTrendRun(trend.id) : [];
        return { ...trend, topics };
      })
    );

    res.render('dashboard/trends', {
      title: 'Trend Analysis History',
      trends: trendsWithTopics,
      currentPage: page,
      hasNextPage: trends.length === limit,
      activeTab: 'trends'
    });
  } catch (error) {
    logger.error('Trends page error:', error);
    res.status(500).render('error', {
      title: 'Trends Error',
      message: 'Failed to load trends data',
      error
    });
  }
});

// Individual trend run details
router.get('/trends/:id', async (req, res) => {
  try {
    const trendId = parseInt(req.params.id);
    const trend = await trendRunModel.getById(trendId);
    
    if (!trend) {
      return res.status(404).render('error', {
        title: 'Trend Not Found',
        message: 'The requested trend run could not be found',
        error: { status: 404 }
      });
    }

    const topics = await trendingTopicModel.getByTrendRun(trendId);

    res.render('dashboard/trend-details', {
      title: `Trend Run #${trendId}`,
      trend,
      topics,
      activeTab: 'trends'
    });
  } catch (error) {
    logger.error('Trend details error:', error);
    res.status(500).render('error', {
      title: 'Trend Details Error',
      message: 'Failed to load trend details',
      error
    });
  }
});

// Video pipeline status
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

    res.render('dashboard/pipeline', {
      title: 'Video Pipeline Status',
      pendingJobs,
      runningJobs,
      completedJobs,
      failedJobs,
      stats: {
        pending: pendingJobs.length,
        running: runningJobs.length,
        completed: completedJobs.length,
        failed: failedJobs.length
      },
      activeTab: 'pipeline'
    });
  } catch (error) {
    logger.error('Pipeline page error:', error);
    res.status(500).render('error', {
      title: 'Pipeline Error',
      message: 'Failed to load pipeline data',
      error
    });
  }
});

// Analytics and metrics
router.get('/analytics', async (req, res) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    
    // Get success rate for different time periods
    const [
      success7d,
      success30d,
      topKeywords30d,
      recentTrends
    ] = await Promise.all([
      trendRunModel.getSuccessRate(7),
      trendRunModel.getSuccessRate(30),
      trendingTopicModel.getTopKeywords(30, 10),
      trendRunModel.getRecent(30)
    ]);

    // Calculate trend statistics
    const trendStats = {
      totalRuns: recentTrends.length,
      successfulRuns: recentTrends.filter(t => t.status === 'completed').length,
      failedRuns: recentTrends.filter(t => t.status === 'failed').length,
      avgExecutionTime: recentTrends
        .filter(t => t.execution_time_ms)
        .reduce((sum, t) => sum + (t.execution_time_ms || 0), 0) / recentTrends.length || 0
    };

    res.render('dashboard/analytics', {
      title: 'Analytics & Metrics',
      success7d,
      success30d,
      topKeywords30d,
      trendStats,
      selectedDays: days,
      activeTab: 'analytics'
    });
  } catch (error) {
    logger.error('Analytics page error:', error);
    res.status(500).render('error', {
      title: 'Analytics Error',
      message: 'Failed to load analytics data',
      error
    });
  }
});

// System logs
router.get('/logs', async (req, res) => {
  try {
    const level = req.query.level as string || 'all';
    const context = req.query.context as string || 'all';
    const limit = parseInt(req.query.limit as string) || 50;

    let logs;
    if (level !== 'all') {
      logs = await systemLogModel.getByLevel(level, limit);
    } else if (context !== 'all') {
      logs = await systemLogModel.getByContext(context, limit);
    } else {
      logs = await systemLogModel.getRecent(limit);
    }

    res.render('dashboard/logs', {
      title: 'System Logs',
      logs,
      selectedLevel: level,
      selectedContext: context,
      selectedLimit: limit,
      activeTab: 'logs'
    });
  } catch (error) {
    logger.error('Logs page error:', error);
    res.status(500).render('error', {
      title: 'Logs Error',
      message: 'Failed to load system logs',
      error
    });
  }
});

// Settings and configuration
router.get('/settings', async (req, res) => {
  try {
    res.render('dashboard/settings', {
      title: 'Settings & Configuration',
      env: {
        NODE_ENV: process.env.NODE_ENV || 'development',
        LOG_LEVEL: process.env.LOG_LEVEL || 'info',
        DB_PATH: process.env.DB_PATH || './data/sfp.db'
      },
      activeTab: 'settings'
    });
  } catch (error) {
    logger.error('Settings page error:', error);
    res.status(500).render('error', {
      title: 'Settings Error',
      message: 'Failed to load settings',
      error
    });
  }
});

export { router as dashboardRoutes };