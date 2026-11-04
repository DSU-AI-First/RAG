import os
import time

import requests
from pinecone import Pinecone
from pinecone_text.sparse import BM25Encoder

INDEX_NAME = "sci-judgments-hybrid"
EMBEDDING_URL = "https://integrate.api.nvidia.com/v1/embeddings"
EMBEDDING_MODEL = "nvidia/nemotron-3.5-embed-8b"
EMBEDDING_BATCH_SIZE = 2
UPSERT_BATCH_SIZE = 100


def _embed_batch(texts: list[str]) -> list[list[float]]:
    for attempt in range(3):
        response = requests.post(
            EMBEDDING_URL,
            headers={"Authorization": f"Bearer {os.environ['NVIDIA_API_KEY']}"},
            json={
                "model": EMBEDDING_MODEL,
                "input": texts,
                "input_type": "passage",
                "encoding_format": "float",
            },
            timeout=60,
        )
        if response.status_code < 500 or len(texts) > 1:
            break
        if attempt < 2:
            time.sleep(2**attempt)

    if response.status_code >= 500 and len(texts) > 1:
        middle = len(texts) // 2
        return _embed_batch(texts[:middle]) + _embed_batch(texts[middle:])

    response.raise_for_status()
    data = sorted(response.json()["data"], key=lambda item: item["index"])
    if len(data) != len(texts):
        raise RuntimeError("Embedding service returned an unexpected number of vectors")
    return [item["embedding"] for item in data]


def embed(chunks: list[dict]) -> tuple[list[dict], list[list[float]]]:
    texts = [chunk["embed_text"] for chunk in chunks]
    dense_vectors = _embed_batch(texts)

    bm25 = BM25Encoder().default()
    sparse_vectors = [bm25.encode_documents(text) for text in texts]
    return sparse_vectors, dense_vectors


def upsert(chunks: list[dict], sparse_vectors: list[dict], dense_vectors: list[list[float]]) -> None:
    if len(chunks) != len(sparse_vectors) or len(chunks) != len(dense_vectors):
        raise ValueError("Each chunk must have one sparse and one dense vector")

    vectors = []
    for chunk, sparse, dense in zip(chunks, sparse_vectors, dense_vectors):
        metadata = {
            key: value
            for key, value in chunk.items()
            if key != "embed_text" and value is not None
        }
        vectors.append(
            {
                "id": chunk["chunk_id"],
                "values": dense,
                "sparse_values": sparse,
                "metadata": metadata,
            }
        )

    index = Pinecone(api_key=os.environ["PINECONE_API_KEY"]).Index(INDEX_NAME)
    for start in range(0, len(vectors), UPSERT_BATCH_SIZE):
        index.upsert(vectors=vectors[start : start + UPSERT_BATCH_SIZE])


def embed_and_upsert(chunks: list[dict]) -> None:
    if not chunks:
        return

    sparse_vectors, dense_vectors = [], []
    for start in range(0, len(chunks), EMBEDDING_BATCH_SIZE):
        batch_sparse, batch_dense = embed(chunks[start : start + EMBEDDING_BATCH_SIZE])
        sparse_vectors.extend(batch_sparse)
        dense_vectors.extend(batch_dense)

    upsert(chunks, sparse_vectors, dense_vectors)
