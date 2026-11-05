from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi import FastAPI
from fastapi import File, HTTPException, UploadFile
from docling.document_converter import DocumentConverter
from routers.chat_response import router as chat_router
from routers.chunking_api import router as chunking_router
from routers.ingest_api import router as ingest_router


app = FastAPI()
app.include_router(chat_router)
app.include_router(chunking_router)
app.include_router(ingest_router)
converter = DocumentConverter()


@app.get("/")
def read_root():
    return {"message": "Hello World"}


@app.post("/extract")
def extract_pdf(file: UploadFile = File(...)):
    contents = file.file.read()
    if not contents.startswith(b"%PDF-"):
        raise HTTPException(status_code=400, detail="Uploaded file is not a PDF")

    with TemporaryDirectory() as temp_dir:
        pdf_path = Path(temp_dir) / "upload.pdf"
        pdf_path.write_bytes(contents)
        document = converter.convert(pdf_path).document

    return {"text": document.export_to_markdown()}
