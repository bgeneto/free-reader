# 📖 FreeReader

> **Reclaim your reading experience.**

FreeReader is a self-hostable web tool designed to declutter the modern web. By stripping away intrusive JavaScript, blocking trackers, and bypassing CSS overlays, FreeReader extracts the core content of any article and presents it in a distraction-free, minimalist interface.

Powered by Python and enhanced with lightweight AI for content extraction, it ensures that knowledge remains accessible and readable.

---

## ✨ Key Features

- **Intelligent Extraction** — Uses heuristic analysis and AI-assisted DOM parsing to identify the main article text, ignoring sidebars, ads, and "subscribe" modals.

- **Cache Fallback** — Automatically attempts to retrieve content from public archives (Wayback Machine, Google Cache) if the live source is inaccessible.

- **Self-Host Ready** — Fully containerized with Docker and Docker Compose for easy deployment on your own server.

- **Privacy First** — Acts as a proxy between you and the source—your IP remains private, and no trackers follow you.

- **LLM Summarization (Optional)** — Connects with local LLMs or external APIs to provide one-click summaries of long-form content.

---

## 🛠️ Tech Stack

| Layer       | Technology                                                  |
|-------------|-------------------------------------------------------------|
| Frontend    | Next.js 16 (App Router), React Server Components, TanStack  |
| Styling     | Tailwind CSS, Radix UI                                      |
| Backend     | Node.js API Routes, Zod validation                          |
| AI/LLM      | OpenRouter (300+ models), OpenAI-compatible APIs            |
| Extraction  | Diffbot API, Mozilla Readability, Jina.ai Reader            |
| Caching     | Upstash Redis                                               |
| Logging     | Pino (structured JSON logs)                                 |
| Deployment  | Docker, Docker Compose                                      |

---

## 🚀 Quick Start

### Option 1: Prepend the URL
Simply prepend `https://your-domain.com/` before any article URL:
```
https://your-domain.com/https://www.example.com/article
```

### Option 2: Paste on Homepage
Visit your FreeReader instance and paste any article URL into the input field.

### Option 3: Bookmarklet
Drag this to your bookmarks bar for one-click access:
```javascript
javascript:(function(){window.location='https://your-domain.com/'+window.location.href})()
```

### Option 4: API Proxy Route
For integrations and deep linking:
```
https://your-domain.com/proxy?url=https://example.com/article
```

---

## 📦 Self-Hosting

### Prerequisites
- Docker & Docker Compose
- API keys (see Environment Variables below)

### Using Docker Compose

```bash
# Clone the repository
git clone https://github.com/mrmps/SMRY.git freereader
cd freereader

# Configure environment
cp .env.example .env
# Edit .env with your API keys

# Run with Docker Compose
docker compose up -d
```

### Manual Installation

```bash
# Install dependencies
pnpm install

# Configure environment
cp .env.example .env.local

# Development
pnpm dev

# Production build
pnpm build && pnpm start
```

---

## ⚙️ Environment Variables

### Required
```bash
# OpenRouter API (for AI summaries)
# Get your key: https://openrouter.ai/settings/keys
OPENROUTER_API_KEY=

# Upstash Redis (for caching)
# Get credentials: https://console.upstash.com
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# Site configuration
NEXT_PUBLIC_SITE_URL=https://your-domain.com
```

### Optional
```bash
# Diffbot (enhanced article extraction)
DIFFBOT_API_KEY=

# Logo.dev (company logos in UI)
NEXT_PUBLIC_LOGODEV_TOKEN=

# Custom LLM endpoint (OpenAI-compatible)
OPENAI_BASE_URL=
OPENAI_API_KEY=
SUMMARIZATION_MODEL=
```

---

## 🔧 How It Works

### Multi-Source Extraction
FreeReader fetches content from multiple sources in parallel, returning the first successful response:

```
User enters URL
    ↓
Parallel requests to 3 sources:
├── Direct → Diffbot AI extraction
├── Wayback Machine → Archived content
└── Jina.ai → Pre-parsed markdown
    ↓
First successful response displayed
```

### Content Processing Pipeline
1. **Source Routing** — Routes to optimal extractor based on source type
2. **Multi-Layer Fallback** — Tries Diffbot → Readability → Multiple fields → Re-extraction
3. **Smart Caching** — Keeps longest content version, keyed by `source:url`
4. **Clean Rendering** — Strips overlays, ads, and archive UI artifacts

### AI Summarization
```
User clicks "Generate Summary"
    ↓
Check cache by language:url key
    ↓
If miss → LLM with language-specific prompt
    ↓
Cache and return summary
```

**Supported Languages:** English, Spanish, French, German, Chinese, Japanese, Portuguese, Russian, Hindi, Italian, Korean, Arabic, Dutch, Turkish

**Rate Limits:** 20 summaries/IP/day, 6 per minute

---

## 📁 Project Structure

```
├── app/
│   ├── api/
│   │   ├── article/         # Multi-source article fetching
│   │   └── summary/         # AI summarization endpoint
│   ├── proxy/               # Reader view
│   └── page.tsx             # Landing page
├── lib/
│   ├── api/                 # Diffbot, Jina.ai clients
│   ├── errors/              # Type-safe error handling
│   └── hooks/               # React Query hooks
├── components/              # UI components
├── docker-compose.yaml      # Container orchestration
└── Dockerfile               # Production build
```

---

## 🤝 Contributing

Contributions are welcome! Here are some areas where help is appreciated:

### Feature Requests
- Additional archive sources (Archive.is, Google Cache)
- Browser extension
- PDF export
- Text-to-speech integration

### Technical Improvements
- Streaming AI responses
- Video/podcast content support
- OCR for image-based content
- E2E test coverage

### How to Contribute
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

For major changes, please open an issue first to discuss the approach.

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

## 🔗 Related Projects

- [Jina.ai Reader](https://jina.ai/reader) — Clean article extraction
- [Diffbot](https://diffbot.com) — AI-powered web scraping
- [Archive.org Wayback Machine](https://archive.org) — Web archive

---

## 📬 Support

- **Issues & Feature Requests:** [GitHub Issues](https://github.com/mrmps/SMRY/issues)
- **Discussions:** [GitHub Discussions](https://github.com/mrmps/SMRY/discussions)

---

<p align="center">
  <sub>Built with ❤️ using Next.js, TanStack Query, and OpenRouter</sub>
</p>
