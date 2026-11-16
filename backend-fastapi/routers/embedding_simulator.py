from typing import List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from utilities.embedding_simulator import simulate_embeddings

router = APIRouter(tags=["embedding-simulator"])


class EmbeddingRequest(BaseModel):
    sentences: List[str] = Field(min_length=3, max_length=3)


@router.post("/embedding-simulate")
def embedding_simulate(request: EmbeddingRequest):
    sentences = [sentence.strip() for sentence in request.sentences]
    if any(not sentence for sentence in sentences):
        raise HTTPException(status_code=422, detail="All three sentences are required")
    if any(len(sentence) > 2000 for sentence in sentences):
        raise HTTPException(status_code=422, detail="Each sentence must be 2000 characters or fewer")
    return simulate_embeddings(sentences)
