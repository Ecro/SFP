# Short-Form Auto Publisher - Claude Context

## Project Overview

**Short-Form Auto Publisher** is an AI-driven pipeline that automatically discovers trending topics, generates short-form videos, and uploads them to YouTube Shorts daily. The system focuses on the Korean market and uses modern AI services for content generation.

## Key Information for Claude

### Project Structure
```
/home/noel/SFP/
├── src/
│   ├── admin/                 # Web-based admin dashboard
│   │   ├── server.ts         # Express server with WebSocket support
│   │   ├── routes/           # Dashboard and API routes
│   │   ├── views/            # EJS templates for admin UI
│   │   └── public/           # Static assets (CSS, JS)
│   ├── database/
│   │   ├── connection.ts     # SQLite database singleton
│   │   ├── models.ts         # TypeScript interfaces for data models
│   │   └── schema.sql        # Database schema
│   ├── services/             # Core business logic services
│   │   ├── trendsService.ts        # Main trend discovery orchestrator
│   │   ├── naverTrendsService.ts   # Korean market trends (Naver API)
│   │   ├── youtubeTrendsService.ts # YouTube trend analysis
│   │   ├── scriptGenerationService.ts # AI script generation (Claude)
│   │   ├── videoJobOrchestrator.ts # Video production pipeline
│   │   ├── textToSpeechService.ts  # ElevenLabs TTS integration
│   │   ├── thumbnailGenerationService.ts
│   │   ├── videoSynthesisService.ts
│   │   └── youtubeUploadService.ts
│   ├── jobs/
│   │   └── trendCollector.ts # Cron job for daily trend collection
│   ├── utils/
│   │   └── logger.ts         # Centralized logging utility
│   └── index.ts              # Application entry point
├── config/
│   └── default.yaml          # Configuration file with API settings
├── data/                     # Runtime data storage
│   ├── sfp.db               # SQLite database
│   ├── videos/              # Generated videos
│   ├── audio/               # Generated audio files
│   └── thumbnails/          # Generated thumbnails
└── dist/                    # Compiled TypeScript output
```

### Core Architecture

#### 1. Trend Discovery System
- **Multi-source aggregation**: Google Trends, Naver DataLab, YouTube Trending
- **Korean market focus**: Specialized Naver integration for Korean trends
- **Intelligent ranking**: Weighted scoring algorithm (60% predicted views, 25% volatility, 15% competitiveness)
- **Daily automation**: Cron job runs at 6:00 AM KST

#### 2. Video Production Pipeline
- **AI Script Generation**: Uses Anthropic Claude 3.5 Sonnet for ~200-word scripts
- **Text-to-Speech**: ElevenLabs TTS for narration
- **Video Synthesis**: Luma AI/Runway/Pika integration (planned)
- **Thumbnail Generation**: AI-generated with title overlay
- **Format**: 1080x1920 MP4, 53-63 seconds duration

#### 3. Admin Dashboard
- **Express.js** server with **EJS** templates
- **WebSocket** support for real-time updates
- **Basic Auth** protection (admin:password by default)
- **Analytics pages**: Overview, Pipeline, Trends, Logs, Settings
- **Manual trigger** capability for testing

### Technology Stack

#### Backend & Core
- **Node.js 20.x** with **TypeScript**
- **Express.js** for web server
- **SQLite** for data persistence
- **Redis** for caching/queue (configured but optional)
- **WebSocket** for real-time communication

#### AI & APIs
- **Anthropic Claude 3.5 Sonnet** - Script generation
- **ElevenLabs** - Text-to-speech
- **Google Trends API** - Global trend data
- **YouTube Data API v3** - Video upload and trending analysis
- **Naver DataLab API** - Korean market trends
- **Luma AI** - Video synthesis (configured)

#### Development & Testing
- **Jest** - Testing framework with ts-jest
- **ESLint** - TypeScript linting
- **Docker** support available

### Important Commands

```bash
# Development
npm run dev              # Start with ts-node
npm run build           # Compile TypeScript + copy assets
npm start              # Run compiled version
npm test               # Run Jest tests
npm run lint           # ESLint check
npm run typecheck      # TypeScript type checking

# Environment
NODE_ENV=development RUN_ONCE=true npm run dev  # Run trend collection once
```

### Configuration

Configuration is managed through:
1. **config/default.yaml** - Main configuration file
2. **.env** file - Environment variables for API keys
3. **Environment variables** - Runtime overrides

#### Key Environment Variables
```bash
# Required API Keys
ANTHROPIC_API_KEY=          # Claude API for script generation
ELEVENLABS_API_KEY=         # Text-to-speech
YOUTUBE_API_KEY=            # YouTube uploads
LUMA_API_KEY=              # Video synthesis
SLACK_WEBHOOK_URL=         # Error alerts

# Optional
PORT=3000                  # Server port
ADMIN_AUTH=admin:password  # Dashboard authentication
NODE_ENV=development       # Environment mode
```

### Database Schema

**SQLite database** (`data/sfp.db`) with these main tables:
- **trend_runs** - Track trend discovery sessions
- **trending_topics** - Store discovered topics with metrics
- **video_jobs** - Complete video production lifecycle
- **youtube_uploads** - Upload metadata and performance
- **system_logs** - Centralized application logging

### Key Service Patterns

#### 1. TrendsService (Main Orchestrator)
- Aggregates trends from multiple sources
- Implements fallback mechanisms
- Rate limiting and error handling
- Topic ranking with weighted algorithms

#### 2. VideoJobOrchestrator (Pipeline Manager)
- Step-by-step video production workflow
- Progress tracking and job state management
- Retry mechanisms and error recovery
- Database integration for persistence

#### 3. ScriptGenerationService (AI Integration)
- Anthropic Claude integration with retry logic
- Structured prompt engineering for short-form content
- JSON response parsing with fallbacks
- Duration optimization for target video length

### Admin Dashboard Features

**Access**: `http://localhost:3000/admin` (admin:password)

**Pages**:
- **Overview** - System status and recent activity
- **Pipeline** - Video production job monitoring
- **Trends** - Trend discovery results and analytics
- **Analytics** - Performance metrics and insights
- **Logs** - System logs with filtering
- **Settings** - Configuration management

**Features**:
- Real-time updates via WebSocket
- Manual trend discovery trigger
- Job monitoring and control
- System health checks

### Development Guidelines

#### Code Style
- **TypeScript strict mode** enabled
- **ESLint** configuration for consistency
- **Path aliases**: `@/*` maps to `src/*`
- **Comprehensive error handling** throughout

#### Testing
- **Jest** with ts-jest preset
- Tests in `__tests__/` directories or `.test.ts` files
- **Coverage reporting** enabled
- Setup file: `src/setupTests.ts`

#### Architecture Principles
- **Service-oriented architecture** with clear separation
- **Dependency injection** pattern
- **Async/await** for asynchronous operations
- **Centralized logging** with context
- **Configuration-driven** behavior
- **Error-first design** with comprehensive error handling

### Common Tasks

#### Adding New Trend Source
1. Create service in `src/services/`
2. Implement trend discovery interface
3. Add to TrendsService aggregation
4. Update configuration if needed

#### Modifying Video Pipeline
1. Update VideoJobOrchestrator steps
2. Add database tracking if needed
3. Update admin dashboard views
4. Test with development mode

#### Adding New AI Service
1. Create service wrapper in `src/services/`
2. Add configuration to `config/default.yaml`
3. Update environment variables
4. Implement retry and error handling

### Troubleshooting

#### Common Issues
- **Database lock errors**: Check for concurrent operations
- **API rate limits**: Review retry mechanisms and delays
- **Memory issues**: Monitor video file processing
- **WebSocket connections**: Check client-side error handling

#### Health Checks
- `/health` endpoint for system status
- Database health check method
- Service availability monitoring
- Log analysis for error patterns

### Current Status
- **Branch**: `codex/design-dark-mode-admin-dashboard-ui`
- **Dark theme implementation** recently completed
- **Admin dashboard** fully functional
- **Core services** implemented and tested
- **Video synthesis integration** in progress

This system represents a complete automated content creation pipeline with sophisticated trend analysis, AI-powered content generation, and comprehensive monitoring capabilities.