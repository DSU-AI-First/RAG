from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class PDFDocument(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    document_id: str = Field(alias="_id")
    pdf: bytes = Field(max_length=15 * 1024 * 1024)
    filename: str


class IngestionJob(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    document_id: str = Field(alias="_id")
    task_id: str
    status: Literal[
        "QUEUED",
        "CHUNKING",
        "EMBEDDING_AND_UPSERTING",
        "COMPLETED",
        "FAILED",
    ] = "QUEUED"
    chunk_count: Optional[int] = None
    attempt_count: int = 0
    error: Optional[str] = None
