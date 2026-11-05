from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field


class Chat(BaseModel):
    chatid: str
    summary: str = ""


class Message(BaseModel):
    role: Literal["user", "assistant"]
    text: str
    time: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    chatid: str
