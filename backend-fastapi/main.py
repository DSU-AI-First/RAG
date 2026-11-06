from fastapi import FastAPI
from routers.chat_response import router as chat_router
from routers.chunking_api import router as chunking_router
from routers.ingest_api import router as ingest_router


app = FastAPI()
app.include_router(chat_router)
app.include_router(chunking_router)
app.include_router(ingest_router)


@app.get("/")
def read_root():
    return {"message": "Hello World"}
