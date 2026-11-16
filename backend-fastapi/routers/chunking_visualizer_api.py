from typing import Literal

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from utilities.chunking_visualizer import extract_pdf_text, generate_chunks

router = APIRouter(prefix="/chunking", tags=["chunking-visualizer"])
MAX_DOCUMENT_SIZE = 15 * 1024 * 1024


class ChunkRequest(BaseModel):
    text: str = Field(min_length=1)
    strategy: Literal["fixed", "fixed_overlap", "paragraph", "sentence", "recursive"]
    chunk_size: int = Field(default=800, ge=50, le=10000)
    chunk_overlap: int = Field(default=120, ge=0, le=9999)


@router.post("/document")
async def extract_uploaded_pdf(file: UploadFile = File(...)):
    filename = file.filename or ""
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Upload a PDF file")

    content = await file.read(MAX_DOCUMENT_SIZE + 1)
    if len(content) > MAX_DOCUMENT_SIZE:
        raise HTTPException(status_code=413, detail="PDFs must be 15 MB or smaller")

    try:
        text = extract_pdf_text(content)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    if not text.strip():
        raise HTTPException(
            status_code=422,
            detail="No text could be extracted. Scanned PDFs without selectable text are not supported.",
        )
    return {"filename": filename, "text": text, "character_count": len(text)}


@router.post("/chunks")
def chunk_document(request: ChunkRequest):
    if request.strategy in ("fixed_overlap", "recursive") and request.chunk_overlap >= request.chunk_size:
        raise HTTPException(
            status_code=422,
            detail="Chunk overlap must be smaller than the chunk size",
        )
    chunks = generate_chunks(
        request.text,
        request.strategy,
        request.chunk_size,
        request.chunk_overlap,
    )
    return {"count": len(chunks), "chunks": chunks}
