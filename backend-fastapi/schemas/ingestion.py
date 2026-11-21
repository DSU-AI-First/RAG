from datetime import datetime, timezone
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

Role = Literal["student", "faculty", "admin"]
ChatRole = Literal["default", "student", "faculty", "admin"]


class PDFDocument(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    document_id: str = Field(alias="_id")
    pdf: bytes = Field(max_length=15 * 1024 * 1024)
    filename: str
    roles: list[Role] = Field(min_length=1)
    uploaded_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class IngestionJob(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    document_id: str = Field(alias="_id")
    task_id: str
    safety_check: bool = False
    status: Literal[
        "QUEUED",
        "EXTRACTING_TEXT",
        "CHUNKING",
        "EMBEDDING_AND_UPSERTING",
        "COMPLETED",
        "DISCARDED",
        "QUARANTINED",
        "FAILED",
    ] = "QUEUED"
    chunk_count: Optional[int] = None
    attempt_count: int = 0
    error: Optional[str] = None
    safety_assessment: Optional[dict[str, str]] = None
