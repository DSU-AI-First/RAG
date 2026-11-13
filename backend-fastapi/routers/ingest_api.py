from uuid import uuid4

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status

from celery_app import celery_app
from database.mongodb import get_collection
from schemas.ingestion import IngestionJob, PDFDocument, Role
from utilities.judgement_store import MAX_PDF_SIZE

router = APIRouter(tags=["ingest"])


@router.post("/ingest", status_code=status.HTTP_202_ACCEPTED)
def ingest(files: list[UploadFile] = File(...), roles: list[Role] = Form(...)):
    uploads = []
    for file in files:
        pdf_content = file.file.read(MAX_PDF_SIZE + 1)
        if len(pdf_content) > MAX_PDF_SIZE:
            raise HTTPException(
                status_code=413,
                detail=f"{file.filename or 'PDF'} exceeds MongoDB's 15 MB document size limit",
            )
        if not pdf_content.startswith(b"%PDF-"):
            raise HTTPException(status_code=400, detail=f"{file.filename or 'File'} is not a PDF")
        uploads.append(
            (str(uuid4()), str(uuid4()), pdf_content, file.filename or "document.pdf", roles)
        )

    pdfs = get_collection()
    jobs = get_collection("ingestion_jobs")
    accepted = []
    for document_id, task_id, pdf_content, filename, roles in uploads:
        pdf = PDFDocument(
            document_id=document_id,
            pdf=pdf_content,
            filename=filename,
            roles=roles,
        )
        job = IngestionJob(document_id=document_id, task_id=task_id)

        pdfs.insert_one(pdf.model_dump(by_alias=True))
        try:
            jobs.insert_one(job.model_dump(by_alias=True))
        except Exception:
            pdfs.delete_one({"_id": document_id})
            raise

        try:
            celery_app.send_task(
                "tasks.process_pdf_ingestion",
                args=[document_id],
                task_id=task_id,
            )
        except Exception as error:
            jobs.update_one(
                {"_id": document_id},
                {"$set": {"status": "FAILED", "error": str(error)}},
            )
            raise HTTPException(status_code=503, detail="Could not queue PDF ingestion") from error
        accepted.append({"document_id": document_id, "task_id": task_id, "status": job.status})

    return {"jobs": accepted}


@router.get("/ingest/status/{document_id}")
def ingestion_status(document_id: str):
    job = get_collection("ingestion_jobs").find_one(
        {"_id": document_id},
        {"_id": 1, "task_id": 1, "status": 1, "chunk_count": 1, "attempt_count": 1, "error": 1},
    )
    if job is None:
        raise HTTPException(status_code=404, detail="Ingestion job not found")
    job["document_id"] = job.pop("_id")
    return job
