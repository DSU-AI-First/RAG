from datetime import datetime, timezone

from bson import BSON

from celery_app import celery_app
from database.mongodb import get_collection
from utilities.chunker import chunker
from utilities.embed_upsert import EMBEDDING_BATCH_SIZE, embed, upsert
from utilities.extractor import extractor


@celery_app.task(bind=True, name="tasks.process_pdf_ingestion", max_retries=3)
def process_pdf_ingestion(self, document_id: str):
    jobs = None
    try:
        jobs = get_collection("ingestion_jobs")
        job = jobs.find_one({"_id": document_id})
        if job is None:
            raise ValueError(f"Ingestion job not found: {document_id}")
        if job.get("status") == "COMPLETED":
            return

        pdfs = get_collection()
        document = pdfs.find_one({"_id": document_id})
        if document is None:
            raise ValueError(f"PDF document not found: {document_id}")

        def set_status(status: str, **fields):
            jobs.update_one(
                {"_id": document_id},
                {"$set": {"status": status, "updated_at": datetime.now(timezone.utc), **fields}},
            )

        markdown = document.get("extracted_text")
        if markdown is None:
            set_status("EXTRACTING_TEXT")
            markdown = extractor(bytes(document["pdf"]))
            if len(BSON.encode({**document, "extracted_text": markdown})) > 16 * 1024 * 1024:
                raise ValueError("PDF and extracted text exceed MongoDB's 16 MiB document limit")
            pdfs.update_one({"_id": document_id}, {"$set": {"extracted_text": markdown}})
            set_status("EXTRACTING_TEXT", checkpoint="TEXT_EXTRACTED")

        set_status("CHUNKING")
        chunks = chunker(markdown, document["filename"])
        set_status("CHUNKING", chunk_count=len(chunks))
        for index, chunk in enumerate(chunks):
            chunk["chunk_id"] = f"{document_id}_chunk_{index}"

        set_status("EMBEDDING_AND_UPSERTING")
        upserted_chunks = job.get("upserted_chunks", 0)
        if not 0 <= upserted_chunks <= len(chunks):
            raise ValueError("Saved upsert progress is outside the chunk range")
        for start in range(upserted_chunks, len(chunks), EMBEDDING_BATCH_SIZE):
            batch = chunks[start : start + EMBEDDING_BATCH_SIZE]
            sparse_vectors, dense_vectors = embed(batch)
            upsert(batch, sparse_vectors, dense_vectors)
            upserted_chunks = start + len(batch)
            set_status(
                "EMBEDDING_AND_UPSERTING",
                chunk_count=len(chunks),
                upserted_chunks=upserted_chunks,
            )
        set_status(
            "COMPLETED",
            checkpoint="COMPLETED",
            chunk_count=len(chunks),
            upserted_chunks=len(chunks),
            error=None,
        )
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
