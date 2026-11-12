from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, File, HTTPException, UploadFile, status

from celery_app import celery_app
from database.mongodb import get_collection
from schemas.ingestion import IngestionJob, PDFDocument
from utilities.judgement_store import MAX_PDF_SIZE

router = APIRouter(tags=["ingest"])

JOB_FIELDS = {
    "_id": 1,
    "task_id": 1,
    "status": 1,
    "checkpoint": 1,
    "chunk_count": 1,
    "upserted_chunks": 1,
    "attempt_count": 1,
    "error": 1,
    "created_at": 1,
}


def retry_failed_job(document_id: str):
    jobs = get_collection("ingestion_jobs")
    task_id = str(uuid4())
    result = jobs.update_one(
        {"_id": document_id, "status": "FAILED"},
        {
            "$set": {
                "task_id": task_id,
                "status": "QUEUED",
                "attempt_count": 0,
                "error": None,
                "updated_at": datetime.now(timezone.utc),
            }
        },
    )
    if not result.modified_count:
        return None

    try:
        celery_app.send_task(
            "tasks.process_pdf_ingestion",
            args=[document_id],
            task_id=task_id,
        )
    except Exception as error:
        jobs.update_one(
            {"_id": document_id, "task_id": task_id},
            {"$set": {"status": "FAILED", "error": str(error)}},
        )
        raise HTTPException(status_code=503, detail="Could not queue PDF ingestion") from error

    job = jobs.find_one({"_id": document_id})
    job["document_id"] = job.pop("_id")
    job.setdefault("upserted_chunks", 0)
    job.setdefault("checkpoint", "QUEUED")
    return job


@router.post("/ingest", status_code=status.HTTP_202_ACCEPTED)
def ingest(files: list[UploadFile] = File(...)):
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
        uploads.append((str(uuid4()), str(uuid4()), pdf_content, file.filename or "document.pdf"))

    pdfs = get_collection()
    jobs = get_collection("ingestion_jobs")
    accepted = []
    for document_id, task_id, pdf_content, filename in uploads:
        pdf = PDFDocument(document_id=document_id, pdf=pdf_content, filename=filename)
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
        JOB_FIELDS,
    )
    if job is None:
        raise HTTPException(status_code=404, detail="Ingestion job not found")
    job["document_id"] = job.pop("_id")
    job.setdefault("checkpoint", "QUEUED")
    job.setdefault("upserted_chunks", 0)
    return job


@router.get("/ingest/jobs")
def ingestion_jobs():
    jobs = get_collection("ingestion_jobs").find({}, JOB_FIELDS).sort("created_at", -1).limit(100)
    results = []
    for job in jobs:
        job["document_id"] = job.pop("_id")
        job.setdefault("checkpoint", "QUEUED")
        job.setdefault("upserted_chunks", 0)
        results.append(job)
    return {"jobs": results}


@router.post("/ingest/retry/{document_id}", status_code=status.HTTP_202_ACCEPTED)
def retry_ingestion(document_id: str):
    job = retry_failed_job(document_id)
    if job is not None:
        return job
    if get_collection("ingestion_jobs").find_one({"_id": document_id}, {"_id": 1}) is None:
        raise HTTPException(status_code=404, detail="Ingestion job not found")
    raise HTTPException(status_code=409, detail="Only failed ingestion jobs can be retried")


@router.post("/ingest/retry-failed", status_code=status.HTTP_202_ACCEPTED)
def retry_all_failed():
    jobs = get_collection("ingestion_jobs")
    queued, errors = [], []
    for job in jobs.find({"status": "FAILED"}, {"_id": 1}):
        try:
            retried = retry_failed_job(job["_id"])
        except HTTPException as error:
            errors.append({"document_id": job["_id"], "error": error.detail})
            continue
        if retried is not None:
            queued.append(retried)
    return {"jobs": queued, "errors": errors}
