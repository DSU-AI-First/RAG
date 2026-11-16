from sentence_transformers import CrossEncoder

reranker = CrossEncoder(
    "BAAI/bge-reranker-v2-m3"
)

def rerank(query, results, top_n=5):
    pairs = [
        (query, result["metadata"]["text"])
        for result in results
    ]

    scores = reranker.predict(pairs)

    ranked = sorted(
        zip(results, scores),
        key=lambda x: x[1],
        reverse=True
    )

    return [
        {
            **result,
            "rerank_score": float(score)
        }
        for result, score in ranked[:top_n]
    ]