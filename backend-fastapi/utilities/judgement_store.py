from datetime import datetime, timezone

from database.mongodb import get_collection

MAX_PDF_SIZE = 15 * 1024 * 1024


def save_judgement(pdf_content: bytes, metadata: dict) -> str:
    if len(pdf_content) > MAX_PDF_SIZE:
        raise ValueError("PDF exceeds MongoDB's 15 MB document size limit")

    doc_id = metadata["doc_id"]
    get_collection().replace_one(
        {"_id": doc_id},
        {
            "_id": doc_id,
            "pdf": pdf_content,
            "metadata": {
                **metadata,
                "content_type": "application/pdf",
                "file_size_bytes": len(pdf_content),
                "stored_at": datetime.now(timezone.utc),
            },
        },
        upsert=True,
    )
    return doc_id
