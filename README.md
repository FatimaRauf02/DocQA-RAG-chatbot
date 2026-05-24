<div align="center">

# ◈ DocQA

### RAG-Powered Intelligent Document Analysis

*Upload documents. Ask questions. Get answers with sources.*



</div>

---

## Overview

DocQA is a full-stack AI chatbot that lets you have real conversations with your documents. Upload PDFs or images, ask questions in plain English and get comprehensive answers that cite exactly which page they came from — no hallucinations, no guessing.

When your documents don't have the answer, DocQA automatically falls back to a live web search and tells you it did so. Every answer is grounded, transparent, and traceable.

---

## Screenshots

<img width="277" height="336" alt="1" src="https://github.com/user-attachments/assets/fc75cfc0-17cf-4089-a7d5-87eca93d16e6" />
<img width="958" height="439" alt="2" src="https://github.com/user-attachments/assets/3932219d-9061-4437-a907-af2851eeb313" />
<img width="622" height="312" alt="3" src="https://github.com/user-attachments/assets/0bed461f-d0fe-4a11-9f9e-b5dd49f37db7" />


---

## Features

### Core RAG Pipeline
- **Multi-document retrieval** — upload PDFs across completely different topics. Ask anything and DocQA figures out which document to pull from, citing the exact page
- **Image understanding** — extracts and describes images embedded in PDFs using a vision model. Upload standalone images too and ask questions about them
- **Web search fallback** — if your documents don't contain the answer, it searches the web via DuckDuckGo and clearly labels the answer as coming from the web
- **Source citations** — every answer includes collapsible source chips showing filename, page number, and a text snippet
- **Confidence scoring** — each answer shows a confidence percentage based on how much relevant source material was found
- **Self-RAG** — before returning an answer, the system evaluates whether it actually answers the question. If not, it rewrites the query and retries

### Agentic Behavior
- **Query rewriting** — vague or follow-up questions are automatically rewritten into clear standalone queries using conversation history
- **Reflection loop** — the LLM evaluates its own answer quality before returning it. Poor answers trigger a web search retry
- **Smart image matching** — images are only shown when the question explicitly asks about visuals, preventing irrelevant image spam

### User Experience
- **Persistent chat sessions** — all conversations saved to localStorage per user account, survive page refresh
- **Chat history** — searchable, pinnable, renameable sessions grouped under Recent
- **Dark / light mode** — persists across sessions
- **Export chats** — download any conversation as a formatted `.txt` file with sources and confidence
- **Collapsible sidebar** — collapse to icon-only mode for more reading space
- **Copy answers** — one-click copy on every response

### Auth
- **Local username/password login** — stored in browser localStorage, no backend auth server needed
- **Unique username enforcement** — real-time availability check during signup
- **Per-user chat history** — each account has its own isolated conversation store

---

## Tech Stack

### Backend
| Technology | Purpose |
|---|---|
| Python + FastAPI | REST API server |
| Groq API (`llama-3.1-8b-instant`) | Text generation and reasoning |
| Groq API (`meta-llama/llama-4-scout-17b-16e-instruct`) | Vision — image description |
| ChromaDB | Local vector database for semantic search |
| LangChain | Document loading, chunking, vectorstore integration |
| HuggingFace `all-MiniLM-L6-v2` | Local sentence embeddings (runs on CPU) |
| PyMuPDF (fitz) | PDF parsing and image extraction |
| DuckDuckGo Search (`ddgs`) | Web search fallback |

### Frontend
| Technology | Purpose |
|---|---|
| Next.js 15 + React | Frontend framework |
| TypeScript | Type safety across all components |
| Plain CSS with CSS variables | Theming — no Tailwind dependency |

---

## Project Structure

```
RAG/
├── backend/
│   ├── main.py              # FastAPI routes — /upload, /chat, /documents, /history
│   ├── rag_engine.py        # Core RAG logic — ingestion, retrieval, generation
│   ├── .env                 # GROQ_API_KEY goes here
│   ├── chroma_db/           # Local vector store (auto-created)
│   └── requirements.txt
│
└── frontend/
    ├── app/
    │   ├── page.tsx          # Root — session management, auth gate, upload handling
    │   ├── layout.tsx        # HTML shell
    │   └── globals.css       # All styles — orange/black theme, dark mode variables
    ├── components/
    │   ├── AuthPage.tsx      # Login / signup UI
    │   ├── Sidebar.tsx       # Chat history, documents, model selector
    │   └── ChatWindow.tsx    # Message thread, sources, images, copy
    └── lib/
        └── api.ts            # API client helpers
```

---

## Getting Started

### Prerequisites
- Python 3.10+
- Node.js 18+
- A free [Groq API key](https://console.groq.com)

### 1. Clone the repo

```bash
git clone https://github.com/yourusername/docqa.git
cd docqa
```

### 2. Backend setup

```bash
cd backend

# Create and activate virtual environment
python -m venv venv_new
venv_new\Scripts\activate        # Windows
# source venv_new/bin/activate   # Mac/Linux

# Install dependencies
pip install -r requirements.txt

# Create .env file
echo GROQ_API_KEY=your_key_here > .env

# Start the server
uvicorn main:app --reload
```

Backend runs at `http://localhost:8000`

### 3. Frontend setup

```bash
cd frontend
npm install
npm run dev
```

Frontend runs at `http://localhost:3000`

### 4. Open the app

Go to `http://localhost:3000`, create an account, upload a PDF or image, and start asking questions.

---

## How It Works

```
User Question
      │
      ▼
Query Rewriting (Self-RAG)
  — rewrites vague follow-ups into standalone queries
      │
      ▼
Vector Search (ChromaDB)
  — finds top-k relevant chunks from uploaded documents
      │
      ▼
Answer Generation (Llama 3.1 via Groq)
  — synthesizes a comprehensive answer, cites sources
      │
      ▼
Reflection Check (Self-RAG)
  — did the answer actually address the question?
      │
   ┌──┴──┐
  Yes    No
   │      │
   │   Web Search Fallback (DuckDuckGo)
   │      │
   └──────┘
      │
      ▼
Response: Answer + Sources + Images (if relevant) + Confidence Score
```

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/upload` | Upload PDF or image files |
| `POST` | `/chat` | Send a question, get an answer |
| `GET` | `/documents` | List all indexed documents |
| `DELETE` | `/documents/{doc_id}` | Remove a document |
| `GET` | `/history/{session_id}` | Get conversation history |
| `DELETE` | `/history/{session_id}` | Clear a session |
| `GET` | `/export/{session_id}` | Export chat as text |

---

## Environment Variables

```env
# backend/.env
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxxxxxx
```

Get a free key at [console.groq.com](https://console.groq.com) — no credit card required.

---

## Supported File Types

| Type | Extension | How it's processed |
|------|-----------|-------------------|
| PDF (text-based) | `.pdf` | Text extracted + images described by vision model |
| JPEG / JPG | `.jpg` `.jpeg` | Described by vision model, indexed as searchable text |
| PNG | `.png` | Described by vision model, indexed as searchable text |
| WebP | `.webp` | Described by vision model, indexed as searchable text |

> **Note:** Scanned PDFs (image-only, no embedded text) are not supported for text extraction. Upload the scanned pages as images instead.

---

## Known Limitations

- Runs on CPU — embedding generation is slow on first upload for large PDFs
- Auth is browser-local — no cross-device sync
- Scanned PDFs cannot have text extracted (images within them still work)
- Groq free tier has rate limits — very large documents or rapid querying may hit limits

---

## License

MIT 

---

<div align="center">
Built with FastAPI · Next.js · Groq · ChromaDB
</div>
