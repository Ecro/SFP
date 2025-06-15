# Short‑Form Auto Publisher

## 1. One‑Sentence Overview

> Build an AI‑driven pipeline that **every day** discovers a trending topic → auto‑generates a < 60 s short‑form video → uploads it to **YouTube Shorts** → analyzes comments to decide whether to create the next episode, achieving **full end‑to‑end automation**.

---

## 2. Goals & KPIs

|Metric|Definition|Initial Target|
|---|---|---|
|**Daily upload success**|≥ 1 video posted between 00:00‑24:00 KST|≥ 95 %|
|**CTR**|Clicks ÷ Shorts impressions|≥ 5 %|
|**Series engagement**|% of comments requesting a follow‑up ("next part")|≥ 10 %|

---

## 3. Functional Requirements (FR)

### FR‑1 · Trend / Topic Discovery

1. **Data sources**  
    • Google Trends API (pytrends)  
    • TikTok Trending  
    • X (Twitter) hashtags  
    • All fetched via **n8n** workflows
    
2. **Selection logic**  
    • Rank TOP‑5 topics by predicted views  
    • Choose final topic by volatility + competitiveness
    

### FR‑2 · Auto Video Generation

1. **Script** — ~200‑word script via **GPT‑4o** (hook ≤ 5 s)
    
2. **Video synthesis** — Text→Video with **Luma AI / Runway / Pika**
    
3. **Narration & captions** — **ElevenLabs TTS** + auto SRT
    
4. **Format** — 1080×1920 MP4, **58 ± 5 s** length
    

### FR‑3 · Auto Upload & Thumbnail A/B Test

1. Upload using **YouTube Data API v3**
    
2. **Thumbnail generation** — Midjourney / StableDiffusion image → title overlay via **Canva API**
    
3. **A/B test** — Upload 2 thumbnails; let YouTube run 24 h experiment; lock higher‑CTR thumbnail
    
4. Auto‑generate tags & description with GPT
    

### FR‑4 · Comment‑Driven Sequel Logic

1. At **D+1 06:00 KST**, fetch comments on the previous video
    
2. If ≥ **5** comments contain “next part”, “part 2”, or a question → flag sequel
    
3. When flagged, rerun **FR‑2** with continuity recap
    

---

## 4. Non‑Functional Requirements (NFR)

- **Budget cap** — ≤ **USD 100 / month** (models, APIs, storage)
    
- **Model usage** — Single high‑quality model; **no fallback / cheap tier**
    
- **Error alerts** — Slack Webhook
    
- **Scalability** — Architecture must support future TikTok / Instagram Reels
    

---

## 5. Tech Stack & Architecture

|Layer|Technology|Rationale|
|---|---|---|
|Workflow orchestration|**n8n** (Docker)|Visual editing, JS function nodes|
|Backend|**Node 20.x + TypeScript**|Custom n8n nodes, YouTube API friendly|
|AI calls|**OpenAI GPT‑4o**, **Luma API**, **ElevenLabs TTS**|Quality ↔ latency balance|
|Data|**SQLite** (storage) + **Redis** (cache / queue)|Lightweight, serverless‑ready|
|Deployment|**Fly.io** or **AWS Lightsail**|Low‑cost, simple ops|

---

## 6. Suggested Folder Structure

```text
/flow                # n8n workflow JSON
/src
  /jobs              # cron jobs & trend collection
  /services          # API wrappers
  /video             # video synthesis pipeline
  /upload            # upload logic
  /utils
/config
  default.yaml
```

---

## 7. Development Roadmap (Claude Task Order)

1. **Step 0** — Scaffold folders + `tsconfig.json`, `Dockerfile`
    
2. **Step 1** — Implement FR‑1 (trend collector) + unit tests
    
3. **Step 2** — Build script & narration pipeline
    
4. **Step 3** — Create video synthesis module + sample output
    
5. **Step 4** — Implement YouTube upload + thumbnail A/B logic
    
6. **Step 5** — Integrate with n8n + Slack alerts
    
7. **Step 6** — Add comment analysis → sequel loop
    

---

## 8. Decisions Recap

- **No fallback model** — Use only one high‑quality model
    
- **Thumbnail A/B test** — Must be implemented
    
- **Comment threshold** — **N = 5**, fixed
