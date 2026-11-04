from fastapi import APIRouter
from pydantic import BaseModel

from utilities.chunker import chunker

router = APIRouter(tags=["chunking"])


class Doc(BaseModel):
    text: str
    source: str = ""


@router.post("/chunk")
def chunk(doc: Doc):
    chunks = chunker(doc.text, doc.source)
    return {"count": len(chunks), "chunks": chunks}
