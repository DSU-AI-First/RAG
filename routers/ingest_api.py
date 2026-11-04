from fastapi import APIRouter, File, HTTPException, UploadFile

from utilities.chunker import chunker
from utilities.extractor import extractor

router = APIRouter(tags=["ingest"])


@router.post("/ingest")
def ingest(file: UploadFile = File(...)):
    try:
        markdown = extractor(file.file.read())
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    chunks = chunker(markdown, file.filename or "")
    return {"count": len(chunks), "chunks": chunks}
