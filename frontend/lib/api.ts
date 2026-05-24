const BASE = "http://localhost:8000";

export interface Source {
  filename: string;
  page: number;
  doc_id: string;
  relevance: number;
  snippet: string;
}

export interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
}

export interface Document {
  doc_id: string;
  filename: string;
  pages: number;
  chunks?: number;
  uploaded_at: string;
}

export interface ChatResponse {
  answer: string;
  sources: Source[];
  confidence: number;
  model_used: string;
}

export async function uploadFiles(files: File[]): Promise<{ uploaded: { doc_id: string; filename: string; chunks: number }[]; total_documents: number }> {
  const form = new FormData();
  files.forEach(f => form.append("files", f));
  const res = await fetch(`${BASE}/upload`, { method: "POST", body: form });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function sendChat(question: string, session_id: string, model: string): Promise<ChatResponse> {
  const res = await fetch(`${BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, session_id, model }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listDocuments(): Promise<{ documents: Document[] }> {
  const res = await fetch(`${BASE}/documents`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteDocument(doc_id: string): Promise<void> {
  const res = await fetch(`${BASE}/documents/${doc_id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
}

export async function clearHistory(session_id: string): Promise<void> {
  await fetch(`${BASE}/history/${session_id}`, { method: "DELETE" });
}

export async function exportChat(session_id: string): Promise<void> {
  const res = await fetch(`${BASE}/export/${session_id}`);
  if (!res.ok) throw new Error("Nothing to export");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `chat_${session_id}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}