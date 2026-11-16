# RAG

Ingestion sends rendered PDF pages to NVIDIA Nemotron Parse for text extraction,
stores chunk vectors in Pinecone, and saves the original PDF with metadata in
MongoDB's `judgements` collection. Set `NVIDIA_API_KEY` and `MONGODB_URI` in
the project `.env`. Set `FRONTEND_ORIGINS` to comma-separated frontend origins
without trailing slashes (for example, `https://your-app.vercel.app`).
PDF uploads are limited to 15 MB to fit MongoDB's BSON document size limit.

The `/chunking` visualizer endpoints extract selectable text from PDFs and
generate chunks in memory. They return source offsets for highlighting and do
not use the ingestion, embedding, or vector database pipeline. Scanned PDFs
without selectable text are not supported.

The `/embedding-simulate` endpoint embeds three sentences using the same NVIDIA
embedding model and query configuration as retrieval. It returns full vectors
and cosine similarities without querying or writing to Pinecone.

The `/pipeline-explorer/run` endpoint runs the production query, embedding,
retrieval, optional reranking, context assembly, generation, and citation
validation stages without saving chat history. Its response includes each
stage's inputs, outputs, status, and any execution errors.

After extraction, a Nemotron model assesses text for prompt-injection attempts
and records a `safe`, `unsafe`, or `check_for_review` flag on the ingestion job.
Safe documents continue through ingestion; unsafe documents are discarded and
their PDF is deleted; documents needing review are quarantined and not indexed.
Read the flag and status from `/ingest/status/{document_id}`. Optionally set
`NEMOTRON_DOCUMENT_SAFETY_MODEL` to choose the screening model.

Queries are screened before embedding, and generated answers are screened
before they are returned or saved, using separate Nemotron Safety Guard checks.
Neutral discussion of crimes or violence in legal judgments is allowed. Both
checks use `NVIDIA_API_KEY`; optionally set `NEMOTRON_QUERY_SAFETY_MODEL` or
`NEMOTRON_RESPONSE_SAFETY_MODEL` to configure their models independently. If
safety screening is unavailable or returns an invalid result, the request fails.

Uploads can be tagged for multiple roles in MongoDB and Pinecone. Chat retrieval
filters by the selected role; `default` searches across all roles.

PDF ingestion runs in a Celery worker. Set `RABBITMQ_URL` for the API and
worker, then start the worker from this directory with
`celery -A celery_app:celery_app worker --loglevel=info`.

See [AI_SECURITY_README.md](AI_SECURITY_README.md) for the runtime guardrails
and their limitations.