import os
import hashlib
import tempfile
import base64
from typing import List, Dict, Tuple, Optional
from datetime import datetime
from dotenv import load_dotenv

import fitz  # PyMuPDF
from groq import Groq
from ddgs import DDGS
from langchain_community.vectorstores import Chroma
from langchain_community.document_loaders import PyPDFLoader
from langchain_huggingface import HuggingFaceEmbeddings
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_core.documents import Document

load_dotenv()

CHROMA_DIR   = "./chroma_db"
GROQ_MODEL   = "llama-3.1-8b-instant"
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")

groq_client = Groq(api_key=GROQ_API_KEY)

NOT_FOUND_PHRASES = [
    "couldn't find", "could not find", "not in the uploaded",
    "cannot find", "does not contain", "no information",
    "not mentioned", "not provided", "no relevant",
    "i don't have", "i do not have", "not available",
]

SMALL_TALK = [
    "how are you", "how are u", "hello", "hi", "hey",
    "thanks", "thank you", "bye", "goodbye", "good morning",
    "good night", "good afternoon", "what's up", "whats up",
    "i am feeling", "i feel", "i'm feeling", "sup",
]

IMAGE_MATCH_THRESHOLD = 2


class RAGEngine:
    def __init__(self):
        self.embeddings = HuggingFaceEmbeddings(
            model_name="all-MiniLM-L6-v2",
            model_kwargs={"device": "cpu"},
            encode_kwargs={"normalize_embeddings": True},
        )
        self.vectorstore = Chroma(
            collection_name="docqa",
            embedding_function=self.embeddings,
            persist_directory=CHROMA_DIR,
        )
        self.splitter = RecursiveCharacterTextSplitter(
            chunk_size=1500,
            chunk_overlap=200,
        )
        self._histories: Dict[str, List[dict]] = {}
        self._documents: Dict[str, dict]       = {}
        self._load_existing_docs()

    # ── Startup ───────────────────────────────────────────────────────────────

    def _load_existing_docs(self):
        try:
            results = self.vectorstore.get(include=["metadatas"])
            for meta in results["metadatas"]:
                doc_id   = meta.get("doc_id")
                filename = meta.get("filename")
                if doc_id and doc_id not in self._documents:
                    self._documents[doc_id] = {
                        "doc_id":      doc_id,
                        "filename":    filename,
                        "pages":       meta.get("total_pages", 0),
                        "uploaded_at": meta.get("uploaded_at", "unknown"),
                        "file_type":   meta.get("file_type", "pdf"),
                        "_images":     [],
                    }
        except Exception:
            pass

    # ── Vision helper ─────────────────────────────────────────────────────────

    def _describe_image(self, img_b64: str, mime: str, context_hint: str = "") -> str:
        prompt = (
            "Describe this image in detail. "
            "If it contains text, extract and quote the key text. "
            "If it's a chart, graph, or diagram, explain what data or concepts it shows. "
            "If it's a photo or illustration, describe what you see clearly. "
            "Be specific and thorough — your description will be used to answer user questions."
        )
        if context_hint:
            prompt += f" Context hint: {context_hint}"
        try:
            vision = groq_client.chat.completions.create(
                model="meta-llama/llama-4-scout-17b-16e-instruct",
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{img_b64}"}},
                        {"type": "text", "text": prompt}
                    ]
                }],
                max_tokens=500,
            )
            return vision.choices[0].message.content.strip()
        except Exception as e:
            print(f"Vision error: {e}")
            return ""

    # ── Image extraction from PDF ─────────────────────────────────────────────

    def _extract_images_from_pdf(self, pdf_bytes: bytes, filename: str) -> List[dict]:
        images = []
        try:
            doc = fitz.open(stream=pdf_bytes, filetype="pdf")
            for page_num in range(len(doc)):
                page       = doc[page_num]
                image_list = page.get_images(full=True)
                for img_index, img in enumerate(image_list):
                    xref           = img[0]
                    base_image     = doc.extract_image(xref)
                    img_bytes_data = base_image["image"]
                    img_ext        = base_image["ext"]

                    if len(img_bytes_data) < 5000:
                        continue

                    img_b64 = base64.b64encode(img_bytes_data).decode("utf-8")
                    mime    = f"image/{img_ext}" if img_ext != "jpg" else "image/jpeg"

                    description = self._describe_image(
                        img_b64, mime,
                        context_hint=f"from page {page_num + 1} of document '{filename}'"
                    )
                    if not description:
                        description = f"Image on page {page_num + 1} of {filename}"

                    images.append({
                        "filename":    filename,
                        "page":        page_num + 1,
                        "image_index": img_index,
                        "description": description,
                        "b64":         img_b64,
                        "mime":        mime,
                    })
            doc.close()
        except Exception as e:
            print(f"Image extraction error: {e}")
        return images

    # ── Ingest PDF ────────────────────────────────────────────────────────────

    def ingest_pdf(self, content: bytes, filename: str) -> Tuple[str, int]:
        doc_id = hashlib.md5(content).hexdigest()[:12]

        if doc_id in self._documents:
            return doc_id, 0

        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        try:
            loader = PyPDFLoader(tmp_path)
            pages  = loader.load()
        finally:
            os.unlink(tmp_path)

        chunks = self.splitter.split_documents(pages)
        chunks = [c for c in chunks if c.page_content.strip()]

        if not chunks:
            raise ValueError(
                f"No text could be extracted from '{filename}'. "
                "The PDF may be scanned or image-based."
            )

        uploaded_at = datetime.utcnow().isoformat()
        for chunk in chunks:
            chunk.metadata["doc_id"]      = doc_id
            chunk.metadata["filename"]    = filename
            chunk.metadata["total_pages"] = len(pages)
            chunk.metadata["uploaded_at"] = uploaded_at
            chunk.metadata["file_type"]   = "pdf"

        self.vectorstore.add_documents(chunks)

        images = self._extract_images_from_pdf(content, filename)

        # Index image descriptions as searchable chunks
        img_chunks = []
        for img in images:
            if img["description"]:
                img_doc = Document(
                    page_content=f"[Image on page {img['page']}]: {img['description']}",
                    metadata={
                        "doc_id":      doc_id,
                        "filename":    filename,
                        "page":        img["page"] - 1,
                        "total_pages": len(pages),
                        "uploaded_at": uploaded_at,
                        "file_type":   "pdf",
                        "is_image":    True,
                    }
                )
                img_chunks.append(img_doc)

        if img_chunks:
            self.vectorstore.add_documents(img_chunks)

        self._documents[doc_id] = {
            "doc_id":      doc_id,
            "filename":    filename,
            "pages":       len(pages),
            "chunks":      len(chunks) + len(img_chunks),
            "images":      len(images),
            "uploaded_at": uploaded_at,
            "file_type":   "pdf",
            "_images":     images,
        }
        return doc_id, len(chunks) + len(img_chunks)

    # ── Ingest Image file ─────────────────────────────────────────────────────

    def ingest_image(self, content: bytes, filename: str, ext: str) -> Tuple[str, int]:
        doc_id = hashlib.md5(content).hexdigest()[:12]

        if doc_id in self._documents:
            return doc_id, 0

        img_b64 = base64.b64encode(content).decode("utf-8")
        mime    = f"image/{ext}" if ext != "jpg" else "image/jpeg"

        print(f"[Image] Describing uploaded image: {filename}")
        description = self._describe_image(
            img_b64, mime,
            context_hint=f"uploaded image file named '{filename}'"
        )
        if not description:
            description = f"Uploaded image: {filename}"

        uploaded_at = datetime.utcnow().isoformat()

        img_doc = Document(
            page_content=f"[Uploaded Image: {filename}]\n{description}",
            metadata={
                "doc_id":      doc_id,
                "filename":    filename,
                "page":        0,
                "total_pages": 1,
                "uploaded_at": uploaded_at,
                "file_type":   "image",
                "is_image":    True,
            }
        )
        self.vectorstore.add_documents([img_doc])

        image_record = {
            "filename":    filename,
            "page":        1,
            "image_index": 0,
            "description": description,
            "b64":         img_b64,
            "mime":        mime,
        }

        self._documents[doc_id] = {
            "doc_id":      doc_id,
            "filename":    filename,
            "pages":       1,
            "chunks":      1,
            "images":      1,
            "uploaded_at": uploaded_at,
            "file_type":   "image",
            "_images":     [image_record],
        }
        return doc_id, 1

    # ── Document management ───────────────────────────────────────────────────

    def list_documents(self) -> List[dict]:
        return [
            {k: v for k, v in d.items() if k != "_images"}
            for d in self._documents.values()
        ]

    def has_documents(self) -> bool:
        return bool(self._documents)

    def delete_document(self, doc_id: str) -> bool:
        if doc_id not in self._documents:
            return False
        results = self.vectorstore.get(where={"doc_id": doc_id}, include=["metadatas"])
        ids_to_delete = results.get("ids", [])
        if ids_to_delete:
            self.vectorstore.delete(ids=ids_to_delete)
        del self._documents[doc_id]
        return True

    # ── Self-RAG: rewrite query ───────────────────────────────────────────────

    def _rewrite_query(self, question: str, history_text: str) -> str:
        prompt = (
            "You are a query rewriting assistant.\n"
            "If the question is casual small talk (greetings, feelings, thanks), return it exactly as-is.\n"
            "Otherwise rewrite it into a clear standalone search query using conversation context.\n"
            "Return ONLY the rewritten query, nothing else. No quotes, no explanation.\n\n"
            f"Conversation history:\n{history_text}\n\n"
            f"Original question: {question}\n\nRewritten query:"
        )
        try:
            resp = groq_client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
        {"role": "system", "content": system_prompt},
        {"role": "user",   "content": user_msg},
    ],
            max_tokens=2048,
            temperature=0.2,
)
            rewritten = resp.choices[0].message.content.strip().strip('"').strip("'")
            if len(rewritten) > 200 or len(rewritten) < 3:
                return question
            return rewritten
        except Exception:
            return question

    # ── Self-RAG: check answer quality ───────────────────────────────────────

    def _should_retry(self, question: str, answer: str, context: str) -> bool:
        if any(p in answer.lower() for p in NOT_FOUND_PHRASES):
            return True
        if len(answer) > 200:
            return False
        prompt = (
            "Does the answer directly address the question using the context?\n"
            "Reply ONLY 'yes' or 'no'.\n\n"
            f"Question: {question}\n"
            f"Context (first 400 chars): {context[:400]}\n"
            f"Answer: {answer[:250]}\n\nAdequate?"
        )
        try:
            resp = groq_client.chat.completions.create(
                model=GROQ_MODEL,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=3,
                temperature=0,
            )
            return "no" in resp.choices[0].message.content.strip().lower()
        except Exception:
            return False

    # ── Web search ────────────────────────────────────────────────────────────

    def _web_search(self, question: str) -> Optional[str]:
        try:
            with DDGS() as ddgs:
                results = list(ddgs.text(question, max_results=4))
            if not results:
                return None
            web_context = "\n\n".join(f"{r['title']}: {r['body']}" for r in results)
            resp = groq_client.chat.completions.create(
                model=GROQ_MODEL,
                messages=[
                    {"role": "system", "content": "Answer the question clearly and concisely using the web search results. Be direct and helpful."},
                    {"role": "user",   "content": f"Web results:\n{web_context}\n\nQuestion: {question}\n\nAnswer:"},
                ],
                max_tokens=600,
                temperature=0.2,
            )
            return resp.choices[0].message.content.strip()
        except Exception as e:
            print(f"Web search error: {e}")
            return None

    # ── Vector search ─────────────────────────────────────────────────────────

    def _vector_search(self, query: str, system_prompt: str, history_text: str) -> Tuple[str, List, str]:
        docs = self.vectorstore.similarity_search(query, k=8)
        docs = [d for d in docs if d.page_content.strip()]

        if not docs:
            return "", [], ""

        # Deduplicate by (filename, page)
        seen_pages: Dict[Tuple, bool] = {}
        deduped = []
        for d in docs:
            key = (d.metadata.get("filename"), d.metadata.get("page"))
            if key not in seen_pages:
                seen_pages[key] = True
                deduped.append(d)
        docs = deduped[:6]

        context = "\n\n---\n\n".join(
            f"[Source: {d.metadata.get('filename','unknown')}, page {int(d.metadata.get('page',0))+1}]\n{d.page_content}"
            for d in docs
        )
        user_msg = (
            f"Previous conversation:\n{history_text if history_text else '(none)'}\n\n"
            f"Document excerpts:\n{context}\n\n"
            f"Question: {query}\n\nAnswer:"
        )
        resp = groq_client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": user_msg},
            ],
            max_tokens=1024,
            temperature=0.1,
        )
        answer = resp.choices[0].message.content.strip()
        return answer, docs, context

    # ── Main query ────────────────────────────────────────────────────────────

    def query(self, question: str, session_id: str, model_name: str) -> dict:

        # ── Small talk ────────────────────────────────────────────────────────
        q_lower = question.lower().strip()
        if any(q_lower.startswith(s) for s in SMALL_TALK):
            answer = "I'm doing great! Feel free to ask me anything — about your uploaded documents or any general topic. I can also search the web for you!"
            self._histories.setdefault(session_id, [])
            self._histories[session_id].append({"role": "user",      "content": question, "sources": []})
            self._histories[session_id].append({"role": "assistant", "content": answer,   "sources": []})
            return {
                "answer": answer, "sources": [], "images": [],
                "confidence": 1.0, "model_used": GROQ_MODEL,
                "used_web": False, "search_query": question,
            }

        history      = self._histories.get(session_id, [])
        history_text = ""
        for msg in history[-6:]:
            role = "User" if msg["role"] == "user" else "Assistant"
            history_text += f"{role}: {msg['content'][:200]}\n"

        
        system_prompt = (
    "You are a helpful document Q&A assistant.\n"
    "You will be given excerpts from one or more documents.\n"
    "Answer using ONLY the excerpt(s) that are directly relevant to the question.\n"
    "Give a COMPLETE and COMPREHENSIVE answer — do not cut off mid-sentence.\n"
    "If the question asks to summarize or explain, provide a full detailed response.\n"
    "Use ALL relevant information from the excerpts to form a thorough answer.\n"
    "Ignore excerpts that are unrelated to the question entirely.\n"
    "Cite only the specific document and page that contains the answer.\n"
    "If an image description is provided in the excerpts, reference it clearly "
    "by saying 'As shown in the image on page X of [filename]'.\n"
    "If NO excerpt contains the answer, say exactly: "
    "'I could not find this in the uploaded documents.'\n"
    "Do NOT make up information. Do NOT use general knowledge."
)

        used_web   = False
        answer     = ""
        docs       = []
        context    = ""
        sources    = []
        images_out = []

        # ── Step 1: Rewrite query ─────────────────────────────────────────────
        search_query = question
        if history_text:
            search_query = self._rewrite_query(question, history_text)
            if search_query != question:
                print(f"[Self-RAG] Rewritten: '{question}' → '{search_query}'")

        # ── Step 2: Route ─────────────────────────────────────────────────────
        has_docs = bool(self._documents)
        print(f"[Agent] Has docs: {has_docs}, Query: {search_query[:60]}")

        if not has_docs:
            web_answer = self._web_search(search_query)
            if web_answer:
                answer   = "🌐 **Web Search Result:**\n\n" + web_answer
                used_web = True
            else:
                answer = "I couldn't find relevant information on the web."
        else:
            # ── Step 3: Vector search ─────────────────────────────────────────
            answer, docs, context = self._vector_search(search_query, system_prompt, history_text)
            print(f"[Vector] Got {len(docs)} docs, answer length: {len(answer)}")

            # ── Step 4: Self-RAG reflection ───────────────────────────────────
            needs_web = False
            if not answer:
                needs_web = True
            elif self._should_retry(search_query, answer, context):
                needs_web = True
                print("[Self-RAG] Answer insufficient, trying web")

            if needs_web:
                web_answer = self._web_search(search_query)
                if web_answer:
                    answer   = "🌐 **Web Search Result:**\n\n" + web_answer
                    used_web = True
                    docs     = []
                elif not answer:
                    answer = "I couldn't find relevant information in the uploaded documents or on the web."

        # ── Build sources — only relevant ones ───────────────────────────────
        if docs and not used_web:
            seen         = set()
            answer_lower = answer.lower()
            for doc in docs:
                filename = doc.metadata.get("filename", "unknown")
                page     = int(doc.metadata.get("page", 0)) + 1
                key      = (filename, page)
                if key in seen:
                    continue
                seen.add(key)
                snippet       = doc.page_content[:220]
                snippet_words = [
                    w for w in doc.page_content.lower().split()
                    if len(w) > 5
                ]
                word_hits          = sum(1 for w in snippet_words[:30] if w in answer_lower)
                filename_mentioned = filename.lower().replace('.pdf', '').replace('.png', '').replace('.jpg', '') in answer_lower
                if filename_mentioned or word_hits >= 3:
                    sources.append({
                        "filename": filename,
                        "page":     page,
                        "doc_id":   doc.metadata.get("doc_id", ""),
                        "snippet":  snippet + ("…" if len(doc.page_content) > 220 else ""),
                        "is_image": doc.metadata.get("is_image", False),
                    })

        # ── Image matching ────────────────────────────────────────────────────
        if docs and not used_web:
            answering_filenames = {doc.metadata.get("filename") for doc in docs}
            stopwords = {
                "what", "which", "that", "this", "with", "from", "have",
                "does", "used", "been", "they", "their", "about", "show",
                "tell", "explain", "describe",
            }
            question_keywords = [
                w for w in question.lower().split()
                if len(w) >= 4 and w not in stopwords
            ]
            image_chunk_pages = {
                (doc.metadata.get("filename"), int(doc.metadata.get("page", 0)) + 1)
                for doc in docs
                if doc.metadata.get("is_image")
            }
            print(f"[Images] Keywords: {question_keywords}, Files: {answering_filenames}")

            for doc_data in self._documents.values():
                doc_filename = doc_data.get("filename")
                if doc_filename not in answering_filenames:
                    continue
                for img in doc_data.get("_images", []):
                    desc_lower       = img["description"].lower()
                    img_page_key     = (img["filename"], img["page"])
                    keyword_hits     = sum(1 for kw in question_keywords if kw in desc_lower)
                    directly_retrieved = img_page_key in image_chunk_pages
                    if directly_retrieved or keyword_hits >= IMAGE_MATCH_THRESHOLD:
                        images_out.append({
                            "filename":    img["filename"],
                            "page":        img["page"],
                            "description": img["description"],
                            "b64":         img["b64"],
                            "mime":        img["mime"],
                        })
                        print(f"[Images] ✓ {img['filename']} p{img['page']} "
                              f"(direct={directly_retrieved}, hits={keyword_hits})")

        # ── Confidence ────────────────────────────────────────────────────────
        if used_web:
            confidence = 0.5
        elif len(sources) >= 3:
            confidence = 0.9
        elif len(sources) >= 1:
            confidence = round(0.4 + 0.15 * len(sources), 2)
        else:
            confidence = 0.0

        self._histories.setdefault(session_id, [])
        self._histories[session_id].append({"role": "user",      "content": question, "sources": []})
        self._histories[session_id].append({"role": "assistant", "content": answer,   "sources": sources})

        return {
            "answer":       answer,
            "sources":      sources,
            "images":       images_out,
            "confidence":   confidence,
            "model_used":   GROQ_MODEL,
            "used_web":     used_web,
            "search_query": search_query,
        }

    # ── History ───────────────────────────────────────────────────────────────

    def get_history(self, session_id: str) -> List[dict]:
        return self._histories.get(session_id, [])

    def clear_history(self, session_id: str):
        self._histories.pop(session_id, None)