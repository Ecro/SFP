import { Router } from 'express';
import { VideoJobModel } from '../../database/models';
import { createLogger } from '../../utils/logger';

const router = Router();
const logger = createLogger('DashboardRoutes');

// Initialize models
const videoJobModel = new VideoJobModel();

// Dashboard overview
router.get('/', async (req, res) => {
  try {
    const [
      recentJobs
    ] = await Promise.all([
      videoJobModel.getRecent(5)
    ]);

    res.render('dashboard/overview', {
      title: 'SFP Admin Dashboard',
      recentJobs,
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




// Storyline page
router.get('/storyline', async (req, res) => {
  try {
    res.render('dashboard/storyline', {
      title: 'Storyline',
      activeTab: 'storyline'
    });
  } catch (error) {
    logger.error('Storyline page error:', error);
    res.status(500).render('error', {
      title: 'Storyline Error',
      message: 'Failed to load storyline page',
      error
    });
  }
});

export { router as dashboardRoutes };