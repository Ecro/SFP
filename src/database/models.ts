import { Database } from './connection';

export interface TrendRun {
  id?: number;
  timestamp?: string;
  status: 'running' | 'completed' | 'failed';
  total_keywords?: number;
  topics_found?: number;
  selected_topic?: string;
  selected_topic_score?: number;
  execution_time_ms?: number;
  error_message?: string;
}

export interface TrendingTopic {
  id?: number;
  trend_run_id: number;
  keyword: string;
  score: number;
  region: string;
  category: string;
  predicted_views: number;
  volatility: number;
  competitiveness: number;
  related_queries?: string; // JSON array
  rank_position?: number;
}

export interface VideoJob {
  id?: number;
  trend_run_id?: number;
  status: 'pending' | 'script_generation' | 'narration' | 'video_synthesis' | 'completed' | 'failed';
  topic: string;
  script_text?: string;
  script_generation_time_ms?: number;
  narration_file_path?: string;
  narration_generation_time_ms?: number;
  video_file_path?: string;
  video_generation_time_ms?: number;
  video_provider?: 'luma' | 'runway' | 'pika';
  video_task_id?: string;
  video_prompt?: string;
  video_style?: 'cinematic' | 'natural' | 'animated' | 'documentary';
  video_resolution?: string;
  total_duration_seconds?: number;
  created_at?: string;
  completed_at?: string;
  error_message?: string;
}

export interface YouTubeUpload {
  id?: number;
  video_job_id: number;
  video_id?: string;
  title: string;
  description?: string;
  tags?: string; // JSON array
  thumbnail_a_url?: string;
  thumbnail_b_url?: string;
  selected_thumbnail?: 'a' | 'b';
  upload_status: 'uploading' | 'processing' | 'live' | 'failed';
  views?: number;
  likes?: number;
  comments?: number;
  ctr_percentage?: number;
  engagement_percentage?: number;
  uploaded_at?: string;
  metrics_last_updated?: string;
  error_message?: string;
}

export interface SystemLog {
  id?: number;
  timestamp?: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  context: string;
  message: string;
  data?: string; // JSON data
  job_id?: number;
  trend_run_id?: number;
}

export interface DailyMetrics {
  id?: number;
  date: string;
  trend_discoveries?: number;
  videos_generated?: number;
  videos_uploaded?: number;
  total_views?: number;
  total_likes?: number;
  total_comments?: number;
  avg_ctr_percentage?: number;
  avg_engagement_percentage?: number;
  api_costs_usd?: number;
  success_rate_percentage?: number;
}

export class TrendRunModel {
  private db: Database;

  constructor() {
    this.db = Database.getInstance();
  }

  async create(trendRun: TrendRun): Promise<number> {
    const result = await this.db.run(
      `INSERT INTO trend_runs (status, total_keywords, topics_found, selected_topic, selected_topic_score, execution_time_ms, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        trendRun.status,
        trendRun.total_keywords,
        trendRun.topics_found,
        trendRun.selected_topic,
        trendRun.selected_topic_score,
        trendRun.execution_time_ms,
        trendRun.error_message
      ]
    );
    return result.lastID!;
  }

  async update(id: number, updates: Partial<TrendRun>): Promise<void> {
    const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = Object.values(updates);
    
    await this.db.run(
      `UPDATE trend_runs SET ${fields} WHERE id = ?`,
      [...values, id]
    );
  }

  async getById(id: number): Promise<TrendRun | undefined> {
    return await this.db.get<TrendRun>('SELECT * FROM trend_runs WHERE id = ?', [id]);
  }

  async getRecent(limit: number = 10): Promise<TrendRun[]> {
    return await this.db.all<TrendRun>(
      'SELECT * FROM trend_runs ORDER BY timestamp DESC LIMIT ?',
      [limit]
    );
  }

  async getByDateRange(startDate: string, endDate: string): Promise<TrendRun[]> {
    return await this.db.all<TrendRun>(
      'SELECT * FROM trend_runs WHERE DATE(timestamp) BETWEEN ? AND ? ORDER BY timestamp DESC',
      [startDate, endDate]
    );
  }

  async getSuccessRate(days: number = 7): Promise<number> {
    const result = await this.db.get<{ total: number; successful: number }>(
      `SELECT 
         COUNT(*) as total,
         COUNT(CASE WHEN status = 'completed' THEN 1 END) as successful
       FROM trend_runs 
       WHERE timestamp >= datetime('now', '-${days} days')`,
      []
    );
    
    if (!result || result.total === 0) return 0;
    return (result.successful / result.total) * 100;
  }
}

export class TrendingTopicModel {
  private db: Database;

  constructor() {
    this.db = Database.getInstance();
  }

  async create(topic: TrendingTopic): Promise<number> {
    const result = await this.db.run(
      `INSERT INTO trending_topics (trend_run_id, keyword, score, region, category, predicted_views, volatility, competitiveness, related_queries, rank_position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        topic.trend_run_id,
        topic.keyword,
        topic.score,
        topic.region,
        topic.category,
        topic.predicted_views,
        topic.volatility,
        topic.competitiveness,
        topic.related_queries,
        topic.rank_position
      ]
    );
    return result.lastID!;
  }

  async getByTrendRun(trendRunId: number): Promise<TrendingTopic[]> {
    return await this.db.all<TrendingTopic>(
      'SELECT * FROM trending_topics WHERE trend_run_id = ? ORDER BY rank_position ASC',
      [trendRunId]
    );
  }

  async getTopKeywords(days: number = 7, limit: number = 10): Promise<any[]> {
    return await this.db.all(
      `SELECT 
         keyword,
         COUNT(*) as appearances,
         AVG(predicted_views) as avg_predicted_views,
         AVG(score) as avg_score,
         category
       FROM trending_topics tt
       JOIN trend_runs tr ON tt.trend_run_id = tr.id
       WHERE tr.timestamp >= datetime('now', '-${days} days')
       GROUP BY keyword
       ORDER BY appearances DESC, avg_predicted_views DESC
       LIMIT ?`,
      [limit]
    );
  }
}

export class VideoJobModel {
  private db: Database;

  constructor() {
    this.db = Database.getInstance();
  }

  async create(job: VideoJob): Promise<number> {
    const result = await this.db.run(
      `INSERT INTO video_jobs (trend_run_id, status, topic, script_text, script_generation_time_ms, narration_file_path, narration_generation_time_ms, video_file_path, video_generation_time_ms, video_provider, video_task_id, video_prompt, video_style, video_resolution, total_duration_seconds, completed_at, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        job.trend_run_id,
        job.status,
        job.topic,
        job.script_text,
        job.script_generation_time_ms,
        job.narration_file_path,
        job.narration_generation_time_ms,
        job.video_file_path,
        job.video_generation_time_ms,
        job.video_provider,
        job.video_task_id,
        job.video_prompt,
        job.video_style,
        job.video_resolution,
        job.total_duration_seconds,
        job.completed_at,
        job.error_message
      ]
    );
    return result.lastID!;
  }

  async update(id: number, updates: Partial<VideoJob>): Promise<void> {
    const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = Object.values(updates);
    
    await this.db.run(
      `UPDATE video_jobs SET ${fields} WHERE id = ?`,
      [...values, id]
    );
  }

  async getById(id: number): Promise<VideoJob | undefined> {
    return await this.db.get<VideoJob>('SELECT * FROM video_jobs WHERE id = ?', [id]);
  }

  async getRecent(limit: number = 10): Promise<VideoJob[]> {
    return await this.db.all<VideoJob>(
      'SELECT * FROM video_jobs ORDER BY created_at DESC LIMIT ?',
      [limit]
    );
  }

  async getByStatus(status: string): Promise<VideoJob[]> {
    return await this.db.all<VideoJob>(
      'SELECT * FROM video_jobs WHERE status = ? ORDER BY created_at DESC',
      [status]
    );
  }
}

export class SystemLogModel {
  private db: Database;

  constructor() {
    this.db = Database.getInstance();
  }

  async create(log: SystemLog): Promise<number> {
    const result = await this.db.run(
      `INSERT INTO system_logs (level, context, message, data, job_id, trend_run_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        log.level,
        log.context,
        log.message,
        log.data,
        log.job_id,
        log.trend_run_id
      ]
    );
    return result.lastID!;
  }

  async getRecent(limit: number = 100): Promise<SystemLog[]> {
    return await this.db.all<SystemLog>(
      'SELECT * FROM system_logs ORDER BY timestamp DESC LIMIT ?',
      [limit]
    );
  }

  async getByLevel(level: string, limit: number = 50): Promise<SystemLog[]> {
    return await this.db.all<SystemLog>(
      'SELECT * FROM system_logs WHERE level = ? ORDER BY timestamp DESC LIMIT ?',
      [level, limit]
    );
  }

  async getByContext(context: string, limit: number = 50): Promise<SystemLog[]> {
    return await this.db.all<SystemLog>(
      'SELECT * FROM system_logs WHERE context = ? ORDER BY timestamp DESC LIMIT ?',
      [context, limit]
    );
  }
}