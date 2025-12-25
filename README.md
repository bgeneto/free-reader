# 📖 FreeReader

> **Reclaim your reading experience.**

FreeReader is a self-hostable web tool designed to declutter the modern web. By stripping away intrusive JavaScript, blocking trackers, and bypassing CSS overlays, FreeReader extracts the core content of any article and presents it in a distraction-free component, featuring a premium newspaper-style interface.

Powered by **Next.js 16**, **Redis**, and **AI**, it goes beyond simple parsing to offer executive summaries, audio narration, and anti-bot bypass capabilities.

---

## ✨ Key Features

### 🧠 AI-Powered Insights
- **Executive Summaries** — Instantly generate concise summaries of long-form content using local or cloud LLMs.
- **Multilingual Support** — Summaries are automatically localized into 14+ languages (English, Portuguese, Spanish, German, French, etc.).
- **Smart Caching** — Generated summaries are cached in Redis to prevent redundant API calls and save costs.

### 🗣️ Audio Narration (TTS)
- **Listen to Articles** — Convert any article into high-quality audio using OpenAI's HD Text-to-Speech models.
- **Seamless Playback** — Integrated audio player with speed controls and background play support.

### 🛡️ Advanced Extraction & Anti-Bot
- **Multi-Source Pipeline** — Fetches content via **Diffbot**, **Jina.ai**, **Wayback Machine**, and **Google Cache** in parallel.
- **Bot Bypass** — Uses headless browser emulation (Puppeteer) with rotating user agents to bypass strict paywalls and bot detection systems (e.g., Reuters, Bloomberg).
- **Archive Fallback** — Automatically retrieves archived versions if the live URL is dead or blocked.

### 📰 Premium Reading Experience
- **Newspaper UI** — A beautiful, typography-centric interface inspired by classic print media.
- **Distraction-Free** — Removes ads, popups, cookie banners, and "Subscribe to Read" overlays.
- **Dark Mode** — Fully responsive design with optimized contrast for night reading.

### 🛠️ Developer Friendly
- **Markdown Export** — Copy content as clean Markdown, optimized for feeding into LLMs (ChatGPT, Claude, etc.).
- **Self-Host Ready** — Dockerized setup for easy deployment on any VPS or home lab.
- **Privacy Focused** — proxies requests to protect your IP address from trackers.

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | Next.js 16 (App Router), React 19, Tailwind CSS 4, Radix UI |
| **Backend** | Node.js API Routes, Server Components |
| **AI / LLM** | Vercel AI SDK, OpenRouter, OpenAI |
| **Extraction** | Diffbot, Jina.ai, Puppeteer (Browserless), Cheerio |
| **Caching** | Upstash Redis, Redis (Docker) |
| **Auth & Payments** | Clerk (Auth), Stripe (Subscriptions) |
| **Logging** | Pino (Structured Logs) |
| **Deployment** | Docker Compose |

---

## 🚀 Quick Start

### Option 1: Prepend the URL
Simply prepend your instance URL before any article link:
```
https://your-domain.com/https://www.nytimes.com/2024/01/01/world/article.html
```

### Option 2: Bookmarklet
Drag this to your bookmarks bar for one-click access:
```javascript
javascript:(function(){window.location='https://your-domain.com/'+window.location.href})()
```

### Option 3: API Proxy
Use the proxy endpoint for integrations:
```
https://your-domain.com/proxy?url=https://example.com/article
```

---

## 📦 Self-Hosting

### Prerequisites
- Docker & Docker Compose
- API Keys (OpenAI, OpenRouter, Upstash/Redis, etc.)

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/bgeneto/free-reader.git
   cd free-reader
   ```

2. **Configure Environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your keys
   ```

3. **Run with Docker:**
   ```bash
   docker-compose up -d --build
   ```

Your instance will be available at `http://localhost:3000`.

---

## ⚙️ Environment Variables

Copy `.env.example` to `.env` and fill in the values:

### Core Configuration
| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_URL` | The public URL of your instance (e.g., `https://reader.example.com`) |
| `NEXT_PUBLIC_SITE_NAME` | Name of your site (default: FreeReader) |
| `LOG_LEVEL` | Logging verbosity (`debug`, `info`, `warn`, `error`) |

### AI & Summarization
| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | Key for OpenAI (or compatible) API |
| `OPENAI_BASE_URL` | Base URL for AI provider (default: `https://openrouter.ai/api/v1`) |
| `SUMMARIZATION_MODEL` | specific model ID (e.g., `openai/gpt-4o-mini`, `meta-llama/llama-3.2-3b-instruct:free`) |
| `SUMMARY_DAILY_LIMIT` | Max summaries per IP per day (default: 30) |

### Text-to-Speech (TTS)
| Variable | Description |
|----------|-------------|
| `TTS_MODEL` | OpenAI TTS model (default: `tts-1-hd`) |
| `TTS_VOICE` | Voice ID (default: `alloy`) |

### Extraction Services
| Variable | Description |
|----------|-------------|
| `DIFFBOT_API_KEY` | (Optional) Token for high-fidelity extraction |
| `JINA_API_KEY` | (Optional) Token for Jina.ai Reader API |

### Caching (Redis)
| Variable | Description |
|----------|-------------|
| `UPSTASH_REDIS_REST_URL` | Redis URL (or Upstash endpoint) |
| `UPSTASH_REDIS_REST_TOKEN` | Redis Token |
| `DISABLE_RATE_LIMIT` | Set `true` to disable rate limiting (dev mode) |

---

## 🔧 How It Works

### Smart Extraction Pipeline
1. **Request:** User requests an article.
2. **Parallel Fetching:** The system simultaneously queries:
   - **Direct Fetch:** Using browser emulation to look like a real user.
   - **Archives:** Wayback Machine & Google Cache.
   - **Extractors:** Jina.ai and Diffbot (if configured).
3. **Selection:** The "heaviest" (most content-rich) successful response is selected.
4. **Sanitization:** Ads, tracking scripts, and paywall modals are stripped aggressively.
5. **Caching:** The clean content is cached in Redis to speed up future requests.

### Bot Detection Bypass
FreeReader employs a sophisticated fetching strategy to avoid 403/429 errors:
- **User-Agent Rotation:** Mimics various browsers and devices.
- **Headers Impersonation:** Sends realistic `Accept-Language`, `Referer`, and `Sec-CH-UA` headers.
- **Browser Automation:** Uses Puppeteer for sites that require JavaScript execution (React/SPA sites).

---

## 🤝 Contributing

Contributions are welcome! Please check the [Issues](https://github.com/bgeneto/free-reader/issues) tab.

### Roadmap
- [ ] Browser Extension (Chrome/Firefox)
- [ ] PDF / eBook (ePub) Export
- [ ] RSS Feed Generation
- [ ] User Accounts (Save for later)

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

<p align="center">
  <sub>Built with ❤️ using Next.js & Open Source AI</sub>
</p>
