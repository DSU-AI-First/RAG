from datetime import datetime, timezone

from celery_app import celery_app
from database.mongodb import get_collection
from utilities.chunker import chunker
from utilities.embed_upsert import embed_and_upsert
from utilities.extractor import extractor


@celery_app.task(bind=True, name="tasks.process_pdf_ingestion", max_retries=3)
def process_pdf_ingestion(self, document_id: str):
    jobs = None
    try:
        jobs = get_collection("ingestion_jobs")
        pdfs = get_collection()
        document = pdfs.find_one({"_id": document_id})
        if document is None:
            raise ValueError(f"PDF document not found: {document_id}")

        def set_status(status: str, **fields):
            jobs.update_one(
                {"_id": document_id},
                {"$set": {"status": status, "updated_at": datetime.now(timezone.utc), **fields}},
            )

        set_status("EXTRACTING_TEXT")
        markdown = extractor(bytes(document["pdf"]))

        set_status("CHUNKING")
        chunks = chunker(markdown, document["filename"])
        set_status("CHUNKING", chunk_count=len(chunks))
        for index, chunk in enumerate(chunks):
            chunk["chunk_id"] = f"{document_id}_chunk_{index}"

        set_status("EMBEDDING_AND_UPSERTING")
        embed_and_upsert(chunks)
        set_status("COMPLETED", chunk_count=len(chunks), error=None)
    except Exception as error:
        attempts = self.request.retries + 1
        if self.request.retries < self.max_retries:
            if jobs is not None:
                jobs.update_one({"_id": document_id}, {"$set": {"attempt_count": attempts}})
            raise self.retry(exc=error, countdown=10)
        if jobs is not None:
            jobs.update_one(
                {"_id": document_id},
                {
                    "$set": {
                        "status": "FAILED",
                        "attempt_count": attempts,
                        "error": str(error),
                        "updated_at": datetime.now(timezone.utc),
                    }
                },
            )
        raise
