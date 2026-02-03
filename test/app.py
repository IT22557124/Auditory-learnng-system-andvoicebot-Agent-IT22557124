import os
import re
import pickle
from pathlib import Path
from typing import List, Dict, Any
from threading import Lock

from flask import Flask, request, jsonify
from flask_cors import CORS

import numpy as np
import pandas as pd

from pypdf import PdfReader
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics.pairwise import cosine_similarity


USE_LLM = True   # Set to False if  NO need

if USE_LLM:
    from transformers import AutoTokenizer, AutoModelForCausalLM
    import torch
    MODEL_NAME = "TinyLlama/TinyLlama-1.1B-Chat-v1.0"
    device = "cuda" if torch.cuda.is_available() else "cpu"
    llm_tokenizer = None
    llm_model = None

# ----------------------------------------------------
# CONFIG
# ----------------------------------------------------

PDF_PATHS = [
    Path("data/science G-7 P-I E.pdf"),
    Path("data/science G-7 P-II E.pdf"),
]

# Labeled Q–A dataset (supervised learning)
QA_CSV_PATH = Path("data/grade7_science_generated_2000_QA.csv")

# Model/data storage directory
INDEX_DIR = Path("model_data")
INDEX_DIR.mkdir(exist_ok=True)

CHUNKS_PATH = INDEX_DIR / "corpus_chunks.pkl"
TFIDF_VECTORIZER_PATH = INDEX_DIR / "tfidf_vectorizer.pkl"
DOC_MATRIX_PATH = INDEX_DIR / "doc_matrix.npy"
RELEVANCE_MODEL_PATH = INDEX_DIR / "relevance_model.pkl"

# Globals (initialized in initialize())
tfidf_vectorizer: TfidfVectorizer | None = None
doc_matrix: np.ndarray | None = None
corpus_chunks: List[Dict[str, Any]] = []
relevance_model: LogisticRegression | None = None

_initialized = False
_init_lock = Lock()

# ====================================================
# 1. DATA PREPROCESSING PIPELINE
# ====================================================

def preprocess_text(raw: str) -> str:
    """Basic text cleanup: remove newlines, collapse spaces."""
    text = raw.replace("\n", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def extract_text_from_pdf(path: Path) -> List[Dict[str, Any]]:
    """Read a PDF and return a list of cleaned pages."""
    if not path.exists():
        raise FileNotFoundError(f"PDF not found: {path}")

    reader = PdfReader(str(path))
    pages = []
    for i, page in enumerate(reader.pages):
        raw_text = page.extract_text() or ""
        text = preprocess_text(raw_text)
        if text:
            pages.append({
                "page_num": i + 1,
                "text": text,
                "source": path.name,
            })
    return pages


def fast_chunk_text(text: str, max_length: int = 900) -> List[str]:
    """
    Split long page text into shorter chunks (~max_length chars).
    This helps retrieval and supervised learning focus on meaningful pieces.
    """
    sentences = re.split(r'(?<=[.!?])\s+', text)
    chunks, current = [], ""

    for s in sentences:
        s = s.strip()
        if not s:
            continue

        if len(current) + len(s) > max_length:
            if current.strip():
                chunks.append(current.strip())
            current = s + " "
        else:
            current += s + " "

    if current.strip():
        chunks.append(current.strip())
    return chunks


def build_corpus_from_pdfs() -> List[Dict[str, Any]]:
    """
    Build the chunk corpus from all PDFs.
    Each item: {id, text, source, page_num}
    """
    all_pages = []
    for pdf_path in PDF_PATHS:
        all_pages.extend(extract_text_from_pdf(pdf_path))

    corpus, cid = [], 0
    for page in all_pages:
        for ch in fast_chunk_text(page["text"], 900):
            corpus.append({
                "id": cid,
                "text": ch,
                "source": page["source"],
                "page_num": page["page_num"],
            })
            cid += 1

    return corpus


def build_or_load_index():
    """
    Load or build:
    - corpus_chunks (PDF-based chunks)
    - TF-IDF vectorizer
    - TF-IDF document matrix for all chunks
    """
    global corpus_chunks, tfidf_vectorizer, doc_matrix

    if (CHUNKS_PATH.exists() and
        TFIDF_VECTORIZER_PATH.exists() and
        DOC_MATRIX_PATH.exists()):
        print("🔹 Loading existing corpus, TF-IDF vectorizer, and matrix...")
        with open(CHUNKS_PATH, "rb") as f:
            corpus_chunks = pickle.load(f)
        with open(TFIDF_VECTORIZER_PATH, "rb") as f:
            tfidf_vectorizer = pickle.load(f)
        doc_matrix = np.load(DOC_MATRIX_PATH, allow_pickle=False)
        print(f"✅ Loaded {len(corpus_chunks)} chunks from disk.")
        return

    print("🔹 Building corpus from PDFs...")
    corpus_chunks = build_corpus_from_pdfs()
    texts = [c["text"] for c in corpus_chunks]

    print("🔹 Fitting TF-IDF vectorizer on corpus chunks...")
    tfidf_vectorizer = TfidfVectorizer(
        max_features=20000,
        ngram_range=(1, 2),
        stop_words="english"
    )
    doc_matrix = tfidf_vectorizer.fit_transform(texts).astype("float32").toarray()

    print("🔹 Saving corpus, TF-IDF vectorizer, and matrix...")
    with open(CHUNKS_PATH, "wb") as f:
        pickle.dump(corpus_chunks, f)
    with open(TFIDF_VECTORIZER_PATH, "wb") as f:
        pickle.dump(tfidf_vectorizer, f)
    np.save(DOC_MATRIX_PATH, doc_matrix)
    print("✅ Index data saved.")


def vectorize_text(texts: List[str]) -> np.ndarray:
    """Convert a list of texts to TF-IDF vectors."""
    if tfidf_vectorizer is None:
        raise RuntimeError("TF-IDF vectorizer not initialized.")
    X = tfidf_vectorizer.transform(texts).astype("float32").toarray()
    return X

# ====================================================
# 2. SUPERVISED LEARNING: LOGISTIC REGRESSION
# ====================================================

def build_features_for_pairs(questions: List[str], chunks: List[str]) -> np.ndarray:
    """
    Build feature vectors for (question, chunk) pairs using TF-IDF.
    We use the absolute difference between question and chunk vectors.
    """
    q_vecs = vectorize_text(questions)
    c_vecs = vectorize_text(chunks)
    feats = np.abs(q_vecs - c_vecs)
    return feats


def map_answers_to_pdf_chunks(answers: List[str]) -> List[str]:
    """
    For each answer text from the CSV, find the most similar PDF chunk
    (using TF-IDF + cosine similarity), and return the list of chunk texts.

    This makes supervised learning explicitly use the PDF content as well.
    """
    if doc_matrix is None or tfidf_vectorizer is None or not corpus_chunks:
        raise RuntimeError("Index (PDF corpus) must be built before mapping answers.")

    # Vectorize all answers
    ans_vecs = vectorize_text(answers)  # shape: (n_answers, vocab)
    # Compute similarity between each answer and all corpus chunks
    sims = cosine_similarity(ans_vecs, doc_matrix)  # shape: (n_answers, n_chunks)

    mapped_chunk_texts: List[str] = []
    for i in range(sims.shape[0]):
        best_idx = int(np.argmax(sims[i]))
        mapped_chunk_texts.append(corpus_chunks[best_idx]["text"])

    return mapped_chunk_texts


def load_or_train_relevance_model():
    """
    Load or train the supervised logistic regression relevance model.

    IMPORTANT: Here we explicitly align CSV answers with PDF chunks,
    so supervised learning uses both:
    - labeled Q–A pairs from CSV
    - the actual PDF chunk texts
    """
    global relevance_model

    if RELEVANCE_MODEL_PATH.exists():
        print("🔹 Loading existing relevance model...")
        with open(RELEVANCE_MODEL_PATH, "rb") as f:
            relevance_model = pickle.load(f)
        print("✅ Relevance model loaded from disk.")
        return

    if not QA_CSV_PATH.exists():
        print("⚠ QA CSV not found, supervised relevance model.")
        relevance_model = None
        return

    print(f"🔹 Training relevance model from {QA_CSV_PATH}...")
    df = pd.read_csv(QA_CSV_PATH)

    if "question" not in df.columns or "answer" not in df.columns:
        print("⚠ CSV must have 'question' and 'answer' columns. Skipping supervised model.")
        relevance_model = None
        return

    df = df.dropna(subset=["question", "answer"])
    if len(df) == 0:
        print("⚠ No valid Q–A rows in CSV. Skipping supervised model.")
        relevance_model = None
        return

    # Limit to 2000 rows max for speed
    df = df.sample(min(len(df), 2000), random_state=42)

    questions_pos = df["question"].tolist()
    raw_answers = df["answer"].tolist()

    # 🔥 Map each CSV answer to the most similar PDF chunk
    # This step makes the supervised model learn on PDF-based text.
    print("🔹 Aligning CSV answers with PDF chunks for supervision...")
    chunks_pos = map_answers_to_pdf_chunks(raw_answers)

    y_pos = [1] * len(df)

    # Negative pairs: use shuffled PDF-chunk matches
    chunks_neg = chunks_pos.copy()
    rng = np.random.default_rng(1)
    rng.shuffle(chunks_neg)
    questions_neg = questions_pos
    y_neg = [0] * len(df)

    questions_all = questions_pos + questions_neg
    chunks_all = chunks_pos + chunks_neg
    y_all = np.array(y_pos + y_neg)

    print("🔹 Building features for supervised pairs...")
    X_all = build_features_for_pairs(questions_all, chunks_all)

    print("🔹 Fitting logistic regression (supervised relevance model)...")
    clf = LogisticRegression(max_iter=1000)
    clf.fit(X_all, y_all)

    relevance_model = clf
    with open(RELEVANCE_MODEL_PATH, "wb") as f:
        pickle.dump(relevance_model, f)
    print("✅ Relevance model trained and saved.")


def rerank_with_supervised(question: str, candidates: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Use the supervised model to re-rank candidate chunks."""
    if relevance_model is None:
        return candidates

    chunk_texts = [c["text"] for c in candidates]
    X = build_features_for_pairs([question] * len(chunk_texts), chunk_texts)
    scores = relevance_model.predict_proba(X)[:, 1]

    for c, s in zip(candidates, scores):
        c["supervised_score"] = float(s)

    candidates.sort(key=lambda x: x["supervised_score"], reverse=True)
    return candidates

# ====================================================
# 3. RETRIEVAL
# ====================================================

def retrieve_chunks(question: str, k: int = 5, initial_k: int = 20) -> List[Dict[str, Any]]:
    """
    1. Use TF-IDF + cosine similarity to get initial_k PDF chunks.
    2. Re-rank them with the supervised logistic regression model.
    3. Return top k chunks.
    """
    if doc_matrix is None or tfidf_vectorizer is None:
        raise RuntimeError("Index not initialized.")

    q_vec = vectorize_text([question])  # shape (1, vocab_size)
    sims = cosine_similarity(q_vec, doc_matrix)[0]

    idxs = np.argsort(sims)[::-1][:initial_k]

    candidates = []
    for idx in idxs:
        c = corpus_chunks[int(idx)]
        candidates.append({
            "text": c["text"],
            "source": c["source"],
            "page_num": c["page_num"],
            "similarity": float(sims[idx]),
        })

    candidates = rerank_with_supervised(question, candidates)
    return candidates[:k]

# ====================================================
# 4. OPTIONAL SMALL LLM (ONLY FOR ANSWER WORDING)
# ====================================================

def load_llm_if_needed():
    if not USE_LLM:
        return
    global llm_tokenizer, llm_model

    if llm_model is not None:
        return

    print(f"🔹 Loading small LLM {MODEL_NAME} on device...")
    llm_tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
    llm_model = AutoModelForCausalLM.from_pretrained(
        MODEL_NAME,
        torch_dtype=torch.float16 if device == "cuda" else torch.float32,
        device_map="auto" if device == "cuda" else None,
    )
    llm_model.to(device)
    print("✅ Small LLM loaded.")


def build_prompt(question: str, contexts: List[Dict[str, Any]]) -> str:
    joined = "\n\n".join(
        f"[Source: {c['source']} page {c['page_num']}]\n{c['text']}"
        for c in contexts
    )
    return (
        "You are a Grade 7 science tutor.\n"
        "Use ONLY the information in the context from the textbook to answer.\n"
        "If the answer is not in the context, say: 'I cannot find this in the book.'\n"
        "Give a short, clear answer.\n\n"
        f"### Context:\n{joined}\n\n"
        f"### Question:\n{question}\n\n"
        "### Answer:\n"
    )


def generate_llm_answer(prompt: str, max_new_tokens: int = 128) -> str:
    inputs = llm_tokenizer(prompt, return_tensors="pt").to(device)
    with torch.no_grad():
        out = llm_model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            do_sample=False,
            temperature=0.0,
        )
    full = llm_tokenizer.decode(out[0], skip_special_tokens=True)
    raw = full[len(prompt):].strip()

    for marker in ["### Question", "### Context", "### Answer"]:
        pos = raw.find(marker)
        if pos != -1:
            raw = raw[:pos].strip()

    sentences = [s.strip() for s in raw.split(".") if s.strip()]
    cleaned = ". ".join(sentences[:3])
    if cleaned and not cleaned.endswith("."):
        cleaned += "."
    return cleaned if cleaned else raw

# ====================================================
# 5. EXTRACTIVE ANSWER (FALLBACK / NO LLM)
# ====================================================

def extract_answer_from_chunk(chunk_text: str, max_sentences: int = 2) -> str:
    sentences = re.split(r'(?<=[.!?])\s+', chunk_text)
    cleaned = [s.strip() for s in sentences if s.strip()]
    ans = " ".join(cleaned[:max_sentences])
    return ans if ans else chunk_text

# ====================================================
# 6. MAIN ANSWER FUNCTION
# ====================================================

def answer_question(q: str) -> str:
    q = q.strip()
    if not q:
        return "Please type a question."

    ctx = retrieve_chunks(q, k=3, initial_k=20)
    if not ctx:
        return "I cannot find this in the book."

    if USE_LLM:
        load_llm_if_needed()
        prompt = build_prompt(q, ctx)
        return generate_llm_answer(prompt)
    else:
        # classical extractive answer
        best_chunk = ctx[0]
        return extract_answer_from_chunk(best_chunk["text"], max_sentences=2)

# ====================================================
# 7. INITIALIZATION WRAPPER
# ====================================================

def initialize():
    global _initialized
    with _init_lock:
        if _initialized:
            return
        print("🔧 Initializing pipeline (this runs once per worker)...")
        build_or_load_index()          # PDF → cleaning → chunking → TF-IDF index
        load_or_train_relevance_model()# CSV + PDF → supervised logistic regression
        # LLM is loaded lazily, only if USE_LLM is True
        _initialized = True
        print("✅ Initialization done.")

# ====================================================
# 8. FLASK APP
# ====================================================

app = Flask(__name__)
CORS(app)

@app.route("/api/ask", methods=["POST"])
def ask():
    data = request.get_json() or {}
    question = data.get("question", "")

    try:
        answer = answer_question(question)
        return jsonify({"answer": answer})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

initialize()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
