import hashlib

from fastapi import APIRouter, File, HTTPException, UploadFile

from utilities.chunker import chunker
from utilities.extractor import extractor
from utilities.embed_upsert import embed_and_upsert
from utilities.judgement_store import MAX_PDF_SIZE, save_judgement

router = APIRouter(tags=["ingest"])


@router.post("/ingest")
def ingest(file: UploadFile = File(...)):
    pdf_content = file.file.read(MAX_PDF_SIZE + 1)
    if len(pdf_content) > MAX_PDF_SIZE:
        raise HTTPException(status_code=413, detail="PDF exceeds MongoDB's 15 MB document size limit")

    try:
        markdown = extractor(pdf_content)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    chunks = chunker(markdown, file.filename or "")
    doc_id = chunks[0]["doc_id"] if chunks else hashlib.sha1(markdown.encode()).hexdigest()[:10]
    embed_and_upsert(chunks)
    save_judgement(
        pdf_content,
        {
            "doc_id": doc_id,
            "filename": file.filename or "document.pdf",
            "title": chunks[0]["title"] if chunks else "",
            "citation": chunks[0]["citation"] if chunks else "",
            "chunk_count": len(chunks),
        },
    )
    return {"count": len(chunks), "doc_id": doc_id, "chunks": chunks}
