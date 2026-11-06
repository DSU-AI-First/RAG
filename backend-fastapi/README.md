# RAG

Ingestion sends rendered PDF pages to NVIDIA Nemotron Parse for text extraction,
stores chunk vectors in Pinecone, and saves the original PDF with metadata in
MongoDB's `judgements` collection. Set `NVIDIA_API_KEY` and `MONGODB_URI` in
the project `.env`. Set `FRONTEND_ORIGINS` to comma-separated frontend origins
without trailing slashes (for example, `https://your-app.vercel.app`).
PDF uploads are limited to 15 MB to fit MongoDB's BSON document size limit.