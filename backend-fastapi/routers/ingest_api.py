from typing import Any
from uuid import uuid4

from fastapi import APIRouter, File, Form, Header, HTTPException, Query, Response, UploadFile, status

from celery_app import celery_app
from database.mongodb import get_collection
from schemas.ingestion import ChatRole, IngestionJob, PDFDocument, Role
from utilities.judgement_store import MAX_PDF_SIZE

router = APIRouter(tags=["ingest"])


@router.get("/documents")
def list_documents(role: ChatRole = Header(alias="X-User-Role")):
    document_query: dict[str, Any] = {}
    if role != "default":
        document_query["roles"] = {"$in": [role]}

    documents = list(
        get_collection().find(
            document_query,
            {"_id": 1, "filename": 1, "roles": 1, "uploaded_at": 1},
        ).sort("uploaded_at", -1)
    )
    if not documents:
        return {"documents": []}

    jobs = get_collection("ingestion_jobs").find(
        {"_id": {"$in": [document["_id"] for document in documents]}},
        {"_id": 1, "status": 1, "chunk_count": 1},
    )
    jobs_by_document = {job["_id"]: job for job in jobs}

    return {
        "documents": [
            {
                "document_id": document["_id"],
                "filename": document.get("filename", "Untitled PDF"),
                "roles": document.get("roles", []),
                "uploaded_at": document.get("uploaded_at"),
                "status": jobs_by_document.get(document["_id"], {}).get("status", "UNKNOWN"),
                "chunk_count": jobs_by_document.get(document["_id"], {}).get("chunk_count"),
            }
            for document in documents
        ]
    }


@router.get("/documents/{document_id}/pdf")
def document_pdf(document_id: str, role: ChatRole = Query(default="default")):
    document_query: dict[str, Any] = {"_id": document_id}
    if role != "default":
        document_query["roles"] = {"$in": [role]}

    document = get_collection().find_one(document_query, {"pdf": 1})
    if document is None or document.get("pdf") is None:
        raise HTTPException(status_code=404, detail="Document not found")

    return Response(
        content=bytes(document["pdf"]),
        media_type="application/pdf",
        headers={
            "Content-Disposition": "inline",
            "Cache-Control": "private, no-store",
        },
    )


@router.post("/ingest", status_code=status.HTTP_202_ACCEPTED)
def ingest(
    files: list[UploadFile] = File(...),
    roles: list[Role] = Form(...),
    safety_check: bool = Form(False),
):
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
        job = IngestionJob(
            document_id=document_id,
            task_id=task_id,
            safety_check=safety_check,
        )

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
        accepted.append({
            "document_id": document_id,
            "task_id": task_id,
            "status": job.status,
            "safety_check": job.safety_check,
        })

    return {"jobs": accepted}


@router.get("/ingest/status/{document_id}")
def ingestion_status(document_id: str):
    job = get_collection("ingestion_jobs").find_one(
        {"_id": document_id},
        {
            "_id": 1,
            "task_id": 1,
            "status": 1,
            "chunk_count": 1,
            "attempt_count": 1,
            "error": 1,
            "safety_check": 1,
            "safety_assessment": 1,
        },
    )
    if job is None:
        raise HTTPException(status_code=404, detail="Ingestion job not found")
    job["document_id"] = job.pop("_id")
    return job


@router.get("/judgment-source/{chunk_id}")
def judgment_source(chunk_id: str, role: ChatRole = Header(alias="X-User-Role")):
    document_id, separator, chunk_index = chunk_id.rpartition("_chunk_")
    if not separator or not document_id or not chunk_index.isdecimal():
        raise HTTPException(status_code=404, detail="Source judgment not found")

    document_query: dict[str, Any] = {"_id": document_id}
    if role != "default":
        document_query["roles"] = {"$in": [role]}

    document = get_collection().find_one(document_query, {"pdf": 1})
    if document is None or document.get("pdf") is None:
        raise HTTPException(status_code=404, detail="Source judgment not found")

    return Response(
        content=bytes(document["pdf"]),
        media_type="application/pdf",
        headers={
            "Content-Disposition": "inline",
            "Cache-Control": "private, no-store",
        },
    )
