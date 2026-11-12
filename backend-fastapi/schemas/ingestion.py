from datetime import datetime, timezone
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class PDFDocument(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    document_id: str = Field(alias="_id")
    pdf: bytes = Field(max_length=15 * 1024 * 1024)
    filename: str
    extracted_text: Optional[str] = None


class IngestionJob(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    document_id: str = Field(alias="_id")
    task_id: str
    status: Literal[
        "QUEUED",
        "EXTRACTING_TEXT",
        "CHUNKING",
        "EMBEDDING_AND_UPSERTING",
        "COMPLETED",
        "FAILED",
    ] = "QUEUED"
    checkpoint: Literal["QUEUED", "TEXT_EXTRACTED", "COMPLETED"] = "QUEUED"
    chunk_count: Optional[int] = None
    upserted_chunks: int = 0
    attempt_count: int = 0
    error: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
