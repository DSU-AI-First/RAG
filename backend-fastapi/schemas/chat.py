from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field


class Chat(BaseModel):
    chatid: str
    title: str = ""
    summary: str = ""
    time: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Message(BaseModel):
    role: Literal["user", "assistant"]
    text: str
    sources: list[dict] = Field(default_factory=list)
    time: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    chatid: str
