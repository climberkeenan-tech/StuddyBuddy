<div align="center">

# 🎓 StuddyBuddy

**Your AI lecture companion — turn live lectures into an organized, interactive knowledge base.**

StuddyBuddy listens to your lectures, transcribes them in real time, understands what the
professor is actually teaching, and automatically builds notes, summaries, flashcards, quizzes,
slides, concept maps, and study guides — then helps you *learn* the material through interactive,
visual study modes.

_Local‑first • Offline‑capable • Multi‑provider AI • Extensible via plugins_

</div>

---

## ✨ Highlights

| | |
|---|---|
| 🎙️ **Live recording & transcription** | One big red button captures your laptop mic and transcribes speech in real time, detecting pauses, paragraphs, section headings, and the questions your teacher asks. |
| 🧠 **AI lecture understanding** | Extracts concepts, definitions, formulas, examples, analogies, emphasis cues, likely exam material, and topics students usually struggle with. |
| 📝 **Automatic study materials** | Beautiful notes, concise & detailed summaries, study guides, flashcards, MCQ / short‑answer quizzes, practice tests, review sheets, cheat sheets, vocabulary & glossaries — at Easy / Medium / Hard difficulty. |
| 💡 **Explain anything** | Click any concept for a simple, analogy‑driven, step‑by‑step, or visual (diagram) explanation. Not clicking? Hit **“I still don’t understand”** and it re‑explains a different way. |
| 🖼️ **AI slideshow generator** | Auto‑builds presentation decks (titles, diagrams, timelines, charts, speaker notes) and exports to **PDF, PowerPoint, Markdown, and NotebookLM**. |
| 🎮 **Interactive learning** | Concept‑match, memory games, quiz rush, and interactive concept maps / timelines — with XP, levels, streaks, badges, and achievements. |
| 🔎 **Ask your lectures** | ChatGPT‑style Q&A grounded in *your* lectures: “What did my biology professor say about DNA replication?” — answered with citations across the whole semester. |
| 📈 **Smart Review** | Before exams: cumulative review, likely questions, weak areas, and a recommended study order. |
| 🗂️ **Organized by class** | A sidebar of color‑coded courses, each holding its lectures, transcripts, notes, quizzes, and slides. |
| 🔐 **Local‑first & private** | Everything is stored on your machine. API keys are encrypted in an OS‑keychain‑backed vault and never leave your device except to the AI provider you choose. |

> **Works with zero setup.** StuddyBuddy ships with an offline demo voice and fully offline
> study‑material generation, so every feature is usable before you add a single API key. Add a key
> in **Settings → AI Providers** (Anthropic, OpenAI, Gemini, or a local Ollama model) to unlock
> higher‑quality AI output.

---

## 🚀 Quick start

```bash
# Requires Node >= 22.13 (built‑in SQLite) and pnpm
git clone <your-fork-url> StuddyBuddy
cd StuddyBuddy
pnpm setup      # checks your toolchain and installs dependencies
pnpm dev        # launches the app in development mode
```

Then, inside the app:

1. Click **＋ Add class** and create a course (e.g. *Biology*).
2. Open the course and hit **Import demo lecture** to watch the full pipeline run end‑to‑end —
   transcript → analysis → notes → flashcards → quiz → slides — with no microphone or API key needed.
3. Or press **Record** and start a real lecture.

See **[docs/INSTALLATION.md](docs/INSTALLATION.md)** for detailed setup and
**[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)** to start hacking.

---

## 🏗️ Architecture at a glance

StuddyBuddy is a **pnpm monorepo** with a clean separation between contracts, headless domain
logic, and the desktop shell:

```
StuddyBuddy/
├── packages/
│   ├── shared/     Domain types + the typed IPC contract (single source of truth)
│   └── core/       Headless services — NO Electron imports, fully unit‑tested under Node
│       ├── storage/         SQLite / JSON adapters, repositories, backup
│       ├── ai/              Anthropic · OpenAI · Gemini · Ollama · mock + embeddings
│       ├── transcription/   Live pipeline, providers, recording service
│       ├── analysis/        AI lecture understanding + explanations
│       ├── materials/       Study‑material generators (AI + offline heuristics)
│       ├── memory/          Embeddings, vector store, RAG knowledge base
│       ├── slides/          Slide deck generation
│       ├── export/          PPTX · PDF · Markdown · NotebookLM exporters
│       ├── review/          SM‑2 scheduling, weak areas, exam prep
│       └── gamification/    XP, streaks, achievements
└── apps/
    └── desktop/    Electron main + typed preload bridge + React renderer
        └── src/renderer/    Design system, app shell, and feature pages
```

**Everything major is a plugin.** AI providers, transcription engines, embedding providers,
material generators, and exporters all register through a typed extension‑point registry — the
built‑in features use the exact same API a third‑party plugin would. See
**[docs/PLUGINS.md](docs/PLUGINS.md)** and **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

---

## 🧰 Tech stack

- **Desktop shell:** Electron + electron‑vite, context‑isolated typed IPC
- **Frontend:** React 18 · TypeScript · Tailwind CSS · Framer Motion · Zustand · React Router
- **Visualization:** Mermaid · Chart.js · React Flow
- **AI:** pluggable LLM providers (Anthropic / OpenAI / Gemini / Ollama) + a fully offline mode
- **Transcription:** OpenAI Whisper API, local whisper.cpp, or the built‑in demo voice
- **Storage:** local‑first via Node’s built‑in SQLite (JSON‑file fallback) + a local vector store for RAG
- **Testing:** Vitest (Node + jsdom projects), Testing Library

---

## 📜 Scripts

| Command | Description |
|---|---|
| `pnpm setup` | Verify toolchain + install dependencies |
| `pnpm dev` | Run the app in development (hot reload) |
| `pnpm build` | Production build of all targets |
| `pnpm package` | Build platform installers (electron‑builder) |
| `pnpm test` | Run the full test suite |
| `pnpm typecheck` | Typecheck every package |
| `pnpm lint` / `pnpm format` | Lint / format the codebase |

---

## 📚 Documentation

- [Architecture](docs/ARCHITECTURE.md) — design, data flow, and extension points
- [Installation guide](docs/INSTALLATION.md)
- [Development guide](docs/DEVELOPMENT.md)
- [Deployment guide](docs/DEPLOYMENT.md)
- [Plugin guide](docs/PLUGINS.md)

## 🔒 Privacy

StuddyBuddy is local‑first. Your recordings, transcripts, and generated materials live in a
data directory on your machine. When you choose a cloud AI provider, only the text needed for a
given request is sent to that provider; keys are stored encrypted and are never written to logs or
backups. Choose the offline provider and local whisper.cpp to keep everything fully on‑device.

## 📄 License

[MIT](LICENSE) © 2026 StuddyBuddy contributors
