from typing import Any, Literal
from uuid import uuid4

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from routers.chat_response import (
    GenerationOutputError,
    QUERY_REFUSAL,
    SAFETY_REFUSAL,
    build_generation_messages,
    citation_validation,
    format_sources,
    generate_from_messages,
)
from routers.retrieval_research import rerank_candidates, retrieve_strategies
from schemas.ingestion import ChatRole
from utilities.embed_upsert import EMBEDDING_MODEL, embed_query
from utilities.safety import check_query_safety, check_response_safety

router = APIRouter(prefix="/pipeline-explorer", tags=["pipeline-explorer"])
STRATEGIES = ("dense", "sparse", "hybrid", "rrf")
STAGES = ("query", "embedding", "retrieval", "reranking", "context_assembly", "generation")


class PipelineRunRequest(BaseModel):
    query: str = Field(min_length=1, max_length=4000)
    alpha: float = Field(default=0.5, ge=0, le=1)
    retrieval_strategy: Literal["dense", "sparse", "hybrid", "rrf"] = "hybrid"
    rerank: bool = False


def _passage(match: Any, score: float, rank: int) -> dict[str, Any]:
    return {
        "rank": rank,
        "chunk_id": match.id,
        "score": float(score),
        "metadata": match.metadata or {},
    }


def _fail(
    execution_id: str,
    stages: dict[str, dict[str, Any]],
    stage_name: str,
    error: Exception,
) -> dict[str, Any]:
    message = str(error.detail) if isinstance(error, HTTPException) else str(error)
    error_data = {"stage": stage_name, "type": type(error).__name__, "message": message}
    stages[stage_name]["status"] = "failed"
    stages[stage_name]["error"] = error_data
    for later_stage in STAGES[STAGES.index(stage_name) + 1 :]:
        stages[later_stage]["reason"] = f"Skipped because {stage_name} failed"
    return {
        "execution_id": execution_id,
        "status": "failed",
        "stages": stages,
        "errors": [error_data],
        "final_answer": None,
        "citations": [],
    }


@router.post("/run")
def run_pipeline(
    request: PipelineRunRequest,
    role: ChatRole = Header(alias="X-User-Role"),
):
    if not request.query.strip():
        raise HTTPException(status_code=422, detail="Question must not be blank")

    execution_id = str(uuid4())
    stages: dict[str, dict[str, Any]] = {
        name: {
            "status": "skipped",
            "input": None,
            "output": None,
            "reason": "Not reached",
        }
        for name in STAGES
    }

    stages["query"]["status"] = "running"
    stages["query"]["input"] = {"question": request.query}
    try:
        query_is_safe = check_query_safety(request.query)
    except Exception as error:
        return _fail(execution_id, stages, "query", error)

    stages["query"]["output"] = {
        "question": request.query,
        "preprocessing": "None; the original question is used as-is",
        "safety_check_passed": query_is_safe,
    }
    if not query_is_safe:
        stages["query"]["status"] = "blocked"
        for later_stage in STAGES[1:]:
            stages[later_stage]["reason"] = "Skipped because the query was blocked by safety screening"
        return {
            "execution_id": execution_id,
            "status": "blocked",
            "stages": stages,
            "errors": [],
            "final_answer": QUERY_REFUSAL,
            "citations": [],
        }
    stages["query"]["status"] = "completed"

    stages["embedding"]["status"] = "running"
    stages["embedding"]["input"] = {"question": request.query}
    try:
        sparse_vector, dense_vector = embed_query(request.query)
    except Exception as error:
        return _fail(execution_id, stages, "embedding", error)
    stages["embedding"]["status"] = "completed"
    stages["embedding"]["output"] = {
        "model": EMBEDDING_MODEL,
        "input_type": "query",
        "dimensions": len(dense_vector),
        "dense_vector_preview": dense_vector[:10],
        "sparse_vector_preview": {
            "indices": sparse_vector["indices"][:10],
            "values": sparse_vector["values"][:10],
        },
    }

    stages["retrieval"]["status"] = "running"
    stages["retrieval"]["input"] = {
        "alpha": request.alpha,
        "role": role,
        "top_k": 20,
        "strategies": list(STRATEGIES),
    }
    try:
        retrievals = retrieve_strategies(sparse_vector, dense_vector, request.alpha, role)
    except Exception as error:
        return _fail(execution_id, stages, "retrieval", error)
    stages["retrieval"]["status"] = "completed"
    stages["retrieval"]["output"] = {
        strategy: [
            _passage(match, score, rank)
            for rank, (match, score) in enumerate(retrievals[strategy], start=1)
        ]
        for strategy in STRATEGIES
    }

    selected_matches = retrievals[request.retrieval_strategy]
    context_matches = selected_matches[:5]
    if not request.rerank:
        stages["reranking"] = {
            "status": "skipped",
            "input": {"enabled": False},
            "output": None,
            "reason": "Reranking was not requested",
        }
    elif not selected_matches:
        stages["reranking"] = {
            "status": "skipped",
            "input": {"enabled": True, "retrieval_strategy": request.retrieval_strategy},
            "output": None,
            "reason": "No retrieval candidates were available",
        }
    else:
        candidates = [
            _passage(match, score, rank)
            for rank, (match, score) in enumerate(selected_matches, start=1)
        ]
        rerank_candidates_input = [
            {
                "chunk_id": candidate["chunk_id"],
                "score": candidate["score"],
                "metadata": candidate["metadata"],
            }
            for candidate in candidates
        ]
        stages["reranking"]["status"] = "running"
        stages["reranking"]["input"] = {
            "retrieval_strategy": request.retrieval_strategy,
            "candidate_count": len(rerank_candidates_input),
            "candidates": rerank_candidates_input,
        }
        try:
            reranked_results = rerank_candidates(request.query, rerank_candidates_input, top_n=5)
            from utilities.reranker import RERANKER_MODEL
        except Exception as error:
            return _fail(execution_id, stages, "reranking", error)

        original_ranks = {candidate["chunk_id"]: candidate["rank"] for candidate in candidates}
        original_matches = {match.id: match for match, _ in selected_matches}
        stages["reranking"]["status"] = "completed"
        stages["reranking"]["output"] = {
            "model": RERANKER_MODEL,
            "results": [
                {
                    "reranked_rank": rank,
                    "original_rank": original_ranks[result["chunk_id"]],
                    "chunk_id": result["chunk_id"],
                    "original_score": result["score"],
                    "rerank_score": result["rerank_score"],
                    "metadata": result["metadata"],
                }
                for rank, result in enumerate(reranked_results, start=1)
            ],
        }
        context_matches = [
            (original_matches[result["chunk_id"]], result["score"])
            for result in reranked_results
        ]

    stages["context_assembly"]["status"] = "running"
    stages["context_assembly"]["input"] = {
        "question": request.query,
        "retrieval_strategy": request.retrieval_strategy,
        "reranking_enabled": request.rerank,
        "passages": [
            _passage(match, score, rank)
            for rank, (match, score) in enumerate(context_matches, start=1)
        ],
    }
    try:
        messages = build_generation_messages(
            request.query,
            [match for match, _ in context_matches],
        )
    except Exception as error:
        return _fail(execution_id, stages, "context_assembly", error)
    stages["context_assembly"]["status"] = "completed"
    stages["context_assembly"]["output"] = {"messages": messages}

    stages["generation"]["status"] = "running"
    stages["generation"]["input"] = {"messages": messages}
    try:
        generated = generate_from_messages(messages)
        stages["generation"]["output"] = {
            "model": generated["model"],
            "raw_response": generated["raw_response"],
            "answer": generated["answer"],
            "model_source_ids": generated["source_ids"],
        }
        response_is_safe = check_response_safety(request.query, generated["answer"])
        if response_is_safe:
            citation_result, matches = citation_validation(
                generated["source_ids"],
                [match for match, _ in context_matches],
            )
            stages["generation"]["output"]["citation_validation"] = citation_result
            if not citation_result["valid"]:
                raise HTTPException(
                    status_code=502,
                    detail="The model cited a chunk that was not retrieved",
                )
            citations = format_sources(generated["source_ids"], matches)
            final_answer = generated["answer"]
        else:
            stages["generation"]["output"]["response_safety_passed"] = False
            stages["generation"]["output"]["citation_validation"] = {
                "valid": True,
                "checked_source_ids": [],
                "invalid_source_ids": [],
                "reason": "Citations are omitted for an unsafe response",
            }
            citations = []
            final_answer = SAFETY_REFUSAL
    except Exception as error:
        if isinstance(error, GenerationOutputError):
            stages["generation"]["output"] = {
                "model": error.model,
                "raw_response": error.raw_response,
            }
        return _fail(execution_id, stages, "generation", error)

    stages["generation"]["status"] = "completed"
    stages["generation"]["output"]["response_safety_passed"] = response_is_safe
    stages["generation"]["output"]["citations"] = citations
    return {
        "execution_id": execution_id,
        "status": "completed" if response_is_safe else "blocked",
        "stages": stages,
        "errors": [],
        "final_answer": final_answer,
        "citations": citations,
    }
