# RAG

Ingestion stores chunk vectors in Pinecone and the original PDF with its metadata
in MongoDB's `judgements` collection. Set `MONGODB_URI` in the project `.env`.
PDF uploads are limited to 15 MB to fit MongoDB's BSON document size limit.