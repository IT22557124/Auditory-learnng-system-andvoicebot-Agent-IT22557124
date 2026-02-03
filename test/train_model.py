# # train_model.py
# import pdfplumber
# import re
# import nltk
# import numpy as np
# import pandas as pd
# import joblib

# from sklearn.feature_extraction.text import TfidfVectorizer

# # Make sure NLTK data is available
# try:
#     nltk.data.find("tokenizers/punkt")
# except LookupError:
#     nltk.download("punkt")

# try:
#     nltk.data.find("corpora/stopwords")
# except LookupError:
#     nltk.download("stopwords")

# from nltk.corpus import stopwords

# # -----------------------------
# # 1. PDF paths (adjust if needed)
# # -----------------------------
# pdf_paths = [
#     "data/Grade-07-Science-EM-Paper-NWP-2024-With-Answers-Past-Papers-wiki.pdf",
#     "data/Grade-07-Science-1st-Term-Test-Paper-2019-English-Medium-–-North-Western-Province.pdf",
#     "data/science G-7 P-I E.pdf",
#     "data/science G-7 P-II E.pdf",
#     # add more here if you want
# ]

# # -----------------------------
# # 2. Helper functions (same as notebook)
# # -----------------------------
# def extract_text_from_pdf(pdf_path):
#     text = ""
#     with pdfplumber.open(pdf_path) as pdf:
#         for page in pdf.pages:
#             page_text = page.extract_text()
#             if page_text:
#                 text += page_text + "\n"
#     return text


# def clean_text(text: str) -> str:
#     text = text.replace("\xa0", " ")
#     text = re.sub(r"\s+", " ", text)
#     return text.strip()


# def chunk_text(text, chunk_size=120, overlap=20):
#     words = text.split()
#     chunks = []
#     start = 0
#     while start < len(words):
#         end = start + chunk_size
#         chunk_words = words[start:end]
#         chunk = " ".join(chunk_words)
#         chunks.append(chunk)
#         start = end - overlap
#     return chunks


# # -----------------------------
# # 3. Build corpus and chunks
# # -----------------------------
# print("Extracting text from PDFs...")
# all_texts = []
# for path in pdf_paths:
#     print(f"  -> {path}")
#     t = extract_text_from_pdf(path)
#     print(f"     Characters extracted: {len(t)}")
#     all_texts.append(t)

# raw_text = "\n".join(all_texts)
# print("Total characters in raw_text:", len(raw_text))

# cleaned_text = clean_text(raw_text)
# print("Cleaned text length:", len(cleaned_text))

# chunks = chunk_text(cleaned_text, chunk_size=120, overlap=20)
# print("Number of chunks:", len(chunks))

# df_chunks = pd.DataFrame({
#     "chunk_id": list(range(len(chunks))),
#     "text": chunks
# })

# # -----------------------------
# # 4. TF-IDF vectorization
# # -----------------------------
# stop_words = set(stopwords.words("english"))

# vectorizer = TfidfVectorizer(
#     ngram_range=(1, 2),
#     stop_words="english"
# )

# chunk_vectors = vectorizer.fit_transform(df_chunks["text"])
# print("TF-IDF matrix shape:", chunk_vectors.shape)

# # -----------------------------
# # 5. Save model artifacts to joblib
# # -----------------------------
# model_artifacts = {
#     "vectorizer": vectorizer,
#     "chunk_vectors": chunk_vectors,
#     "df_chunks": df_chunks,
#     "stop_words": stop_words,
# }

# # Note: filename as you requested (typo kept on purpose)
# joblib.dump(model_artifacts, "complted_model.joblib")
# print("Saved model to complted_model.joblib")
