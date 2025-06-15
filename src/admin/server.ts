import express from 'express';
import path from 'path';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { Database } from '../database/connection';
import { createLogger } from '../utils/logger';
import { dashboardRoutes } from './routes/dashboard';
import { apiRoutes } from './routes/api';
import { TrendCollector } from '../jobs/trendCollector';

const logger = createLogger('AdminServer');

export class AdminServer {
  private app: express.Application;
  private server: any;
  private wss: WebSocketServer | null = null;
  private port: number;
  private trendCollector: TrendCollector;

  constructor(port: number = 3000) {
    this.app = express();
    this.port = port;
    this.trendCollector = new TrendCollector();
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    // Basic middleware
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(express.static(path.join(__dirname, 'public')));

    // EJS template engine
    this.app.set('view engine', 'ejs');
    this.app.set('views', path.join(__dirname, 'views'));

    // Basic logging middleware
    this.app.use((req, res, next) => {
      logger.debug(`${req.method} ${req.path}`);
      next();
    });

    // Simple auth middleware (basic protection)
    this.app.use('/admin', (req, res, next) => {
      const authHeader = req.headers.authorization;
      const expectedAuth = process.env.ADMIN_AUTH || 'admin:password';
      
      if (!authHeader || authHeader !== `Basic ${Buffer.from(expectedAuth).toString('base64')}`) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Admin Dashboard"');
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      
      next();
    });
  }

  private setupRoutes(): void {
    // Redirect root to admin dashboard
    this.app.get('/', (req, res) => {
      res.redirect('/admin');
    });

    // Admin dashboard routes
    this.app.use('/admin', dashboardRoutes);
    
    // API routes for AJAX calls
    this.app.use('/api', apiRoutes);

    // Health check endpoint
    this.app.get('/health', async (req, res) => {
      try {
        const db = Database.getInstance();
        const dbHealthy = await db.healthCheck();
        
        res.json({
          status: 'ok',
          timestamp: new Date().toISOString(),
          services: {
            database: dbHealthy ? 'healthy' : 'unhealthy',
            server: 'healthy'
          }
        });
      } catch (error) {
        res.status(500).json({
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    // 404 handler
    this.app.use((req, res) => {
      res.status(404).render('error', {
        title: 'Page Not Found',
        message: 'The requested page could not be found.',
        error: { status: 404, stack: '' }
      });
    });

    // Error handler
    this.app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      logger.error('Express error:', err);
      res.status(err.status || 500).render('error', {
        title: 'Server Error',
        message: err.message || 'Internal Server Error',
        error: process.env.NODE_ENV === 'development' ? err : {}
      });
      // No return needed for Express error middleware
    });
  }

  private setupWebSocket(): void {
    if (!this.server) return;

    this.wss = new WebSocketServer({ server: this.server });
    
    this.wss.on('connection', (ws) => {
      logger.info('New WebSocket connection established');
      
      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message.toString());
          this.handleWebSocketMessage(ws, data);
        } catch (error) {
          logger.error('WebSocket message error:', error);
        }
      });

      ws.on('close', () => {
        logger.debug('WebSocket connection closed');
      });

      // Send initial status
      ws.send(JSON.stringify({
        type: 'status',
        data: { connected: true, timestamp: new Date().toISOString() }
      }));
    });
  }

  private async handleWebSocketMessage(ws: any, data: any): Promise<void> {
    try {
      switch (data.type) {
        case 'trigger_trend_discovery':
          logger.info('Manual trend discovery triggered via WebSocket');
          const result = await this.trendCollector.runOnce();
          ws.send(JSON.stringify({
            type: 'trend_discovery_result',
            data: result
          }));
          break;

        case 'get_system_status':
          const status = await this.getSystemStatus();
          ws.send(JSON.stringify({
            type: 'system_status',
            data: status
          }));
          break;

        default:
          logger.warn('Unknown WebSocket message type:', data.type);
      }
    } catch (error) {
      logger.error('WebSocket handler error:', error);
      ws.send(JSON.stringify({
        type: 'error',
        data: { message: error instanceof Error ? error.message : 'Unknown error' }
      }));
    }
  }

  private async getSystemStatus(): Promise<any> {
    try {
      const db = Database.getInstance();
      
      // Get recent activity
      const recentTrends = await db.all(
        'SELECT * FROM trend_runs ORDER BY timestamp DESC LIMIT 5',
        []
      );
      
      const recentJobs = await db.all(
        'SELECT * FROM video_jobs ORDER BY created_at DESC LIMIT 5',
        []
      );

      return {
        timestamp: new Date().toISOString(),
        database: await db.healthCheck(),
        recentTrends,
        recentJobs,
        uptime: process.uptime()
      };
    } catch (error) {
      logger.error('Error getting system status:', error);
      return {
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  // Broadcast to all connected WebSocket clients
  broadcast(data: any): void {
    if (!this.wss) return;

    const message = JSON.stringify(data);
    this.wss.clients.forEach((client) => {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(message);
      }
    });
  }

  async start(): Promise<void> {
    try {
      // Initialize database connection
      const db = Database.getInstance();
      await db.connect();

      // Create HTTP server
      this.server = createServer(this.app);
      
      // Setup WebSocket
      this.setupWebSocket();

      // Start server
      this.server.listen(this.port, () => {
        logger.info(`Admin dashboard running on http://localhost:${this.port}/admin`);
        logger.info(`Health check available at http://localhost:${this.port}/health`);
      });

    } catch (error) {
      logger.error('Failed to start admin server:', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    try {
      if (this.wss) {
        this.wss.close();
      }
      
      if (this.server) {
        this.server.close();
      }

      const db = Database.getInstance();
      await db.close();
      
      logger.info('Admin server stopped');
    } catch (error) {
      logger.error('Error stopping admin server:', error);
    }
  }

  getTrendCollector(): TrendCollector {
    return this.trendCollector;
  }
}