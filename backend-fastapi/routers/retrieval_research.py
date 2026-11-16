import os
from typing import Any, Literal

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field
from pinecone import Pinecone

from schemas.ingestion import ChatRole
from utilities.embed_upsert import INDEX_NAME, embed_query

router = APIRouter(tags=["research"])


class RerankCandidate(BaseModel):
    chunk_id: str
    score: float
    metadata: dict[str, Any]


class RerankRequest(BaseModel):
    query: str = Field(min_length=1)
    strategy: Literal["dense", "sparse", "hybrid", "rrf"]
    candidates: list[RerankCandidate] = Field(min_length=1, max_length=20)


def _format_matches(matches):
    return [
        {
            "chunk_id": match.id,
            "score": match.score,
            "metadata": match.metadata or {},
        }
        for match in matches
    ]


@router.post("/retrieval-research")
def retrieval_research(
    query: str,
    alpha: float = Query(default=0.5, ge=0, le=1),
    role: ChatRole = Header(alias="X-User-Role"),
):
    sparse_vector, dense_vector = embed_query(query)
    index = Pinecone(api_key=os.environ["PINECONE_API_KEY"]).Index(INDEX_NAME)
    query_options = {
        "top_k": 20,
        "include_metadata": True,
        "namespace": "rag-security-testing" if os.getenv("TESTING") == "true" else "",
        "filter": {"roles": {"$in": [role]}} if role != "default" else None,
    }

    dense_matches = index.query(vector=dense_vector, **query_options).matches
    sparse_matches = index.query(
        vector=[0.0] * len(dense_vector),
        sparse_vector=sparse_vector,
        **query_options,
    ).matches

    if alpha == 1:
        hybrid_matches = dense_matches
    elif alpha == 0:
        hybrid_matches = sparse_matches
    else:
        weighted_sparse_vector = {
            **sparse_vector,
            "values": [value * (1 - alpha) for value in sparse_vector["values"]],
        }
        hybrid_matches = index.query(
            vector=[value * alpha for value in dense_vector],
            sparse_vector=weighted_sparse_vector,
            **query_options,
        ).matches

    rrf_results = {}
    for matches in (dense_matches, sparse_matches):
        for rank, match in enumerate(matches, start=1):
            result = rrf_results.setdefault(
                match.id,
                {
                    "chunk_id": match.id,
                    "score": 0.0,
                    "metadata": match.metadata or {},
                },
            )
            result["score"] += 1 / (60 + rank)

    rrf_candidates = sorted(
        rrf_results.values(),
        key=lambda result: result["score"],
        reverse=True,
    )[:20]

    return {
        "query": query,
        "alpha": alpha,
        "results": {
            "dense": _format_matches(dense_matches),
            "sparse": _format_matches(sparse_matches),
            "hybrid": _format_matches(hybrid_matches),
            "rrf": rrf_candidates,
        },
    }


@router.post("/retrieval-rerank")
def retrieval_rerank(request: RerankRequest):
    candidates = [candidate.model_dump() for candidate in request.candidates]
    if any(not isinstance(candidate["metadata"].get("text"), str) for candidate in candidates):
        raise HTTPException(status_code=422, detail="Each candidate must include judgment text")

    from utilities.reranker import rerank

    results = rerank(request.query, candidates, top_n=5)
    return {"strategy": request.strategy, "results": results}
