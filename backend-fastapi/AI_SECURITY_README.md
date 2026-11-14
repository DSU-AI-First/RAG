# AI security guardrails

The chat flow uses several defenses against unsafe requests and malicious
instructions embedded in retrieved documents. These reduce risk; they do not
prove that a document is trustworthy or that an answer is correct.

## Runtime protections

- **Query screening:** `check_query_safety` screens the user's request before
  retrieval. If screening is unavailable or returns an invalid result, the
  request fails instead of continuing.
- **Retrieved-content isolation:** Retrieved passages are serialized as JSON
  data and sent separately from the system instructions. The system prompt
  explicitly treats all passage fields as untrusted evidence, not instructions,
  and tells the model to ignore embedded commands, role claims, prompt
  overrides, and requests to reveal hidden instructions or secrets or use tools.
- **Grounding and citations:** The model is told to answer only from the
  retrieved evidence and cite exact chunk IDs. The API rejects citations that
  do not match retrieved chunks.
- **Answer screening:** `check_response_safety` screens the generated answer
  before it is returned or saved. Screening failures stop the request.
- **Limited model capabilities:** The chat completion is not given tools.
  Prompts contain the user's question and retrieved passages; do not add
  credentials, hidden instructions, or other secrets to that content.

## Ingestion assessment

After text extraction, a separate model returns `safe`, `unsafe`, or
`check_for_review` with a brief reason. Safe documents continue through
ingestion; unsafe documents are discarded and their PDF deleted; documents
needing review are marked `QUARANTINED` and are not indexed. The assessment is
recorded on the ingestion job and exposed by the status endpoint.

## Limitations and follow-up

Prompt instructions and safety classifiers are not guaranteed to detect every
prompt injection, evasion, or false claim. These runtime protections do not
prevent a malicious document from being uploaded, extracted, or indexed, and
they do not independently verify the factual accuracy or provenance of a
judgment. The ingestion assessment is a fallible classifier; quarantined
documents require a separate review process before they can be ingested.
