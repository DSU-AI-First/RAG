# Casebook UI

Run the FastAPI backend on port `8000`, then start the UI:

```bash
npm install
npm run dev
```

Set `BACKEND_URL` if the backend is hosted elsewhere. The Next.js rewrite proxies
`/api/*` requests to FastAPI.
