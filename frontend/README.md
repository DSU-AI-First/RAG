# Casebook UI

Run the FastAPI backend on port `8000`, then start the UI:

```bash
npm install
npm run dev
```

Set `NEXT_PUBLIC_BACKEND_URL` to the FastAPI base URL for browser uploads and
chat requests. Set the backend's `FRONTEND_ORIGINS` to comma-separated
frontend origins (without trailing slashes) allowed to call the API.
