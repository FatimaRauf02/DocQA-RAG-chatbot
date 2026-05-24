from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List
import uvicorn
import io

from rag_engine import RAGEngine

app = FastAPI(title="DocQA API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

rag = RAGEngine()

ALLOWED_IMAGE_TYPES = {
    "image/jpeg": "jpg",
    "image/png":  "png",
    "image/webp": "webp",
    "image/gif":  "gif",
}

class ChatRequest(BaseModel):
    question: str
    session_id: str = "default"
    model: str = "llama-3.1-8b-instant"


@app.get("/")
def root():
    return {"status": "DocQA API running"}


@app.post("/upload")
async def upload_documents(files: List[UploadFile] = File(...)):
    results = []
    for file in files:
        content = await file.read()
        filename = file.filename or ""
        content_type = file.content_type or ""

        # ── PDF ───────────────────────────────────────────────────────────────
        if filename.lower().endswith(".pdf"):
            doc_id, chunks = rag.ingest_pdf(content, filename)
            results.append({
                "doc_id":    doc_id,
                "filename":  filename,
                "type":      "pdf",
                "chunks":    chunks,
            })

        # ── Image ─────────────────────────────────────────────────────────────
        elif content_type in ALLOWED_IMAGE_TYPES or any(
            filename.lower().endswith(f".{ext}")
            for ext in ["jpg", "jpeg", "png", "webp", "gif"]
        ):
            ext = ALLOWED_IMAGE_TYPES.get(content_type, filename.rsplit(".", 1)[-1])
            doc_id, chunks = rag.ingest_image(content, filename, ext)
            results.append({
                "doc_id":   doc_id,
                "filename": filename,
                "type":     "image",
                "chunks":   chunks,
            })

        else:
            raise HTTPException(400, f"{filename} is not a supported file (PDF or image)")

    return {"uploaded": results, "total_documents": len(rag.list_documents())}


@app.post("/chat")
def chat(req: ChatRequest):
    if not rag.has_documents():
        raise HTTPException(400, "No documents uploaded yet.")
    result = rag.query(req.question, req.session_id, req.model)
    return result


@app.get("/documents")
def list_documents():
    return {"documents": rag.list_documents()}


@app.delete("/documents/{doc_id}")
def delete_document(doc_id: str):
    success = rag.delete_document(doc_id)
    if not success:
        raise HTTPException(404, "Document not found")
    return {"deleted": doc_id, "remaining": rag.list_documents()}


@app.get("/history/{session_id}")
def get_history(session_id: str):
    return {"history": rag.get_history(session_id)}


@app.delete("/history/{session_id}")
def clear_history(session_id: str):
    rag.clear_history(session_id)
    return {"cleared": session_id}


@app.get("/export/{session_id}")
def export_chat(session_id: str):
    history = rag.get_history(session_id)
    if not history:
        raise HTTPException(404, "No history found for this session")
    lines = []
    for msg in history:
        role = "You" if msg["role"] == "user" else "Assistant"
        lines.append(f"{role}:\n{msg['content']}\n")
        if msg.get("sources"):
            lines.append(
                "Sources: "
                + ", ".join(f"{s['filename']} p.{s['page']}" for s in msg["sources"])
                + "\n"
            )
        lines.append("-" * 60 + "\n")
    content = "\n".join(lines)
    return StreamingResponse(
        io.BytesIO(content.encode()),
        media_type="text/plain",
        headers={"Content-Disposition": f"attachment; filename=chat_{session_id}.txt"},
    )


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)