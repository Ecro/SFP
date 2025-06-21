-- Trend analysis runs
CREATE TABLE IF NOT EXISTS trend_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT NOT NULL, -- 'running', 'completed', 'failed'
    total_keywords INTEGER,
    topics_found INTEGER,
    selected_topic TEXT,
    selected_topic_score INTEGER,
    execution_time_ms INTEGER,
    error_message TEXT,
    sources_used TEXT, -- JSON array of sources used in this run
    total_topics_discovered INTEGER DEFAULT 0,
    naver_topics_count INTEGER DEFAULT 0,
    youtube_topics_count INTEGER DEFAULT 0,
    google_topics_count INTEGER DEFAULT 0,
    cross_validated_topics INTEGER DEFAULT 0
);

-- Individual trending topics discovered
CREATE TABLE IF NOT EXISTS trending_topics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trend_run_id INTEGER,
    keyword TEXT NOT NULL,
    score INTEGER NOT NULL,
    region TEXT NOT NULL,
    category TEXT NOT NULL,
    predicted_views INTEGER NOT NULL,
    volatility REAL NOT NULL,
    competitiveness REAL NOT NULL,
    related_queries TEXT, -- JSON array
    rank_position INTEGER,
    source TEXT DEFAULT 'google', -- 'google', 'naver', 'youtube'
    search_volume INTEGER,
    growth_rate REAL,
    trend_score INTEGER,
    confidence REAL DEFAULT 0.5,
    cross_platform_validated BOOLEAN DEFAULT FALSE,
    trend_velocity REAL DEFAULT 0.0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (trend_run_id) REFERENCES trend_runs(id)
);

-- Multi-source trend aggregations
CREATE TABLE IF NOT EXISTS aggregated_trends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    keyword TEXT NOT NULL,
    normalized_keyword TEXT NOT NULL,
    aggregated_score REAL NOT NULL,
    sources TEXT NOT NULL, -- JSON array of sources
    category TEXT NOT NULL,
    predicted_views INTEGER NOT NULL,
    confidence REAL NOT NULL,
    cross_platform_validation BOOLEAN NOT NULL,
    trend_velocity REAL NOT NULL,
    google_topic_id INTEGER,
    naver_data TEXT, -- JSON data from Naver
    youtube_data TEXT, -- JSON data from YouTube
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (google_topic_id) REFERENCES trending_topics(id)
);

-- Trend source performance tracking
CREATE TABLE IF NOT EXISTS trend_source_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL, -- 'google', 'naver', 'youtube'
    date DATE NOT NULL,
    topics_discovered INTEGER DEFAULT 0,
    avg_confidence REAL DEFAULT 0.0,
    api_calls_made INTEGER DEFAULT 0,
    api_errors INTEGER DEFAULT 0,
    response_time_ms INTEGER DEFAULT 0,
    success_rate REAL DEFAULT 0.0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(source, date)
);

-- Video generation jobs
CREATE TABLE IF NOT EXISTS video_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trend_run_id INTEGER,
    status TEXT NOT NULL, -- 'pending', 'script_generation', 'narration', 'video_synthesis', 'completed', 'failed'
    topic TEXT NOT NULL,
    script_text TEXT,
    script_generation_time_ms INTEGER,
    narration_file_path TEXT,
    narration_generation_time_ms INTEGER,
    video_file_path TEXT,
    video_generation_time_ms INTEGER,
    video_provider TEXT, -- 'luma', 'runway', 'pika'
    video_task_id TEXT, -- Provider-specific task ID
    video_prompt TEXT, -- Generated video prompt
    video_style TEXT, -- 'cinematic', 'natural', 'animated', 'documentary'
    video_resolution TEXT, -- '1080x1920'
    total_duration_seconds REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    error_message TEXT,
    FOREIGN KEY (trend_run_id) REFERENCES trend_runs(id)
);

-- YouTube uploads
CREATE TABLE IF NOT EXISTS youtube_uploads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_job_id INTEGER,
    video_id TEXT, -- YouTube video ID
    title TEXT NOT NULL,
    description TEXT,
    tags TEXT, -- JSON array
    thumbnail_a_path TEXT, -- Local path to thumbnail A
    thumbnail_b_path TEXT, -- Local path to thumbnail B
    thumbnail_a_url TEXT, -- YouTube URL for thumbnail A
    thumbnail_b_url TEXT, -- YouTube URL for thumbnail B
    thumbnail_test_id TEXT, -- A/B test identifier
    thumbnail_test_status TEXT, -- 'running', 'completed', 'inconclusive'
    selected_thumbnail TEXT, -- 'a', 'b', or 'inconclusive'
    thumbnail_switch_time DATETIME, -- When thumbnail B was activated
    thumbnail_test_confidence REAL, -- Statistical confidence in result
    upload_status TEXT NOT NULL, -- 'uploading', 'processing', 'live', 'failed'
    privacy_status TEXT, -- 'public', 'unlisted', 'private'
    category_id TEXT, -- YouTube category ID
    language TEXT DEFAULT 'ko',
    upload_time_ms INTEGER, -- Upload duration in milliseconds
    views INTEGER DEFAULT 0,
    likes INTEGER DEFAULT 0,
    dislikes INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    subscribers_gained INTEGER DEFAULT 0,
    watch_time_minutes INTEGER DEFAULT 0,
    average_view_duration REAL DEFAULT 0,
    ctr_percentage REAL DEFAULT 0,
    impressions INTEGER DEFAULT 0,
    engagement_percentage REAL DEFAULT 0,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    metrics_last_updated DATETIME,
    error_message TEXT,
    FOREIGN KEY (video_job_id) REFERENCES video_jobs(id)
);

-- System logs
CREATE TABLE IF NOT EXISTS system_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    level TEXT NOT NULL, -- 'info', 'warn', 'error', 'debug'
    context TEXT NOT NULL, -- service name
    message TEXT NOT NULL,
    data TEXT, -- JSON data
    job_id INTEGER, -- optional reference to video_job
    trend_run_id INTEGER -- optional reference to trend_run
);

-- System metrics for dashboard
CREATE TABLE IF NOT EXISTS daily_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date DATE NOT NULL UNIQUE,
    trend_discoveries INTEGER DEFAULT 0,
    videos_generated INTEGER DEFAULT 0,
    videos_uploaded INTEGER DEFAULT 0,
    total_views INTEGER DEFAULT 0,
    total_likes INTEGER DEFAULT 0,
    total_comments INTEGER DEFAULT 0,
    avg_ctr_percentage REAL DEFAULT 0,
    avg_engagement_percentage REAL DEFAULT 0,
    api_costs_usd REAL DEFAULT 0,
    success_rate_percentage REAL DEFAULT 0
);

-- API usage tracking for cost monitoring
CREATE TABLE IF NOT EXISTS api_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    service TEXT NOT NULL, -- 'anthropic', 'elevenlabs', 'luma', 'youtube'
    operation TEXT NOT NULL, -- 'script_generation', 'tts', 'video_synthesis', 'upload'
    tokens_used INTEGER,
    estimated_cost_usd REAL,
    job_id INTEGER -- reference to video_job
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_trend_runs_timestamp ON trend_runs(timestamp);
CREATE INDEX IF NOT EXISTS idx_trending_topics_trend_run_id ON trending_topics(trend_run_id);
CREATE INDEX IF NOT EXISTS idx_trending_topics_source ON trending_topics(source);
CREATE INDEX IF NOT EXISTS idx_trending_topics_keyword ON trending_topics(keyword);
CREATE INDEX IF NOT EXISTS idx_trending_topics_category ON trending_topics(category);
CREATE INDEX IF NOT EXISTS idx_trending_topics_created_at ON trending_topics(created_at);
CREATE INDEX IF NOT EXISTS idx_aggregated_trends_keyword ON aggregated_trends(keyword);
CREATE INDEX IF NOT EXISTS idx_aggregated_trends_normalized_keyword ON aggregated_trends(normalized_keyword);
CREATE INDEX IF NOT EXISTS idx_aggregated_trends_created_at ON aggregated_trends(created_at);
CREATE INDEX IF NOT EXISTS idx_aggregated_trends_confidence ON aggregated_trends(confidence);
CREATE INDEX IF NOT EXISTS idx_trend_source_metrics_source_date ON trend_source_metrics(source, date);
CREATE INDEX IF NOT EXISTS idx_video_jobs_status ON video_jobs(status);
CREATE INDEX IF NOT EXISTS idx_video_jobs_created_at ON video_jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_youtube_uploads_video_job_id ON youtube_uploads(video_job_id);
CREATE INDEX IF NOT EXISTS idx_system_logs_timestamp ON system_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_system_logs_level ON system_logs(level);
CREATE INDEX IF NOT EXISTS idx_daily_metrics_date ON daily_metrics(date);