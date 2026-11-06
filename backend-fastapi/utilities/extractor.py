from functools import lru_cache
from pathlib import Path
from tempfile import TemporaryDirectory


@lru_cache(maxsize=1)
def _get_converter():
    from docling.document_converter import DocumentConverter

    return DocumentConverter()


def extractor(pdf_content: bytes) -> str:
    if not pdf_content.startswith(b"%PDF-"):
        raise ValueError("Uploaded file is not a PDF")

    with TemporaryDirectory() as temp_dir:
        pdf_path = Path(temp_dir) / "upload.pdf"
        pdf_path.write_bytes(pdf_content)
        document = _get_converter().convert(pdf_path).document

    return document.export_to_markdown()
