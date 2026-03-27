# Review UI

Nuxt 3 + Nuxt UI application for reviewing Docling outputs.

This app now uses the `nuxt-ui-templates/dashboard` structure as its base.

## Setup

```bash
cp .env.example .env
npm install
```

## Run

```bash
npm run dev
```

Default local dev runs on HTTP and binds `0.0.0.0:3000` (WSL2-friendly).
Open from your browser at `http://localhost:3000`.

Optional HTTPS dev mode:

```bash
npm run dev:https
```

## Build

```bash
npm run build
npm run preview
```

## Environment

- `SKP_DOCS_IN_DIR` defaults to `../data/docs/in`
- `SKP_DOCS_OUT_DIR` defaults to `../data/docs/out`
- `SKP_INGEST_WORKDIR` defaults to `../ai-doc-ingest`
- `SKP_INGEST_API_URL` optional remote ingest service base URL (if set, `/api/convert` proxies there)
- `SKP_CONVERT_TIMEOUT_MS` defaults to `600000`

For Docker Compose, set:

- `SKP_DOCS_IN_DIR=/data/docs/in`
- `SKP_DOCS_OUT_DIR=/data/docs/out`
- `SKP_INGEST_API_URL=http://ingest:8000`

## Implemented API

- `GET /api/tree`: returns the source document tree from `SKP_DOCS_IN_DIR`.
- `POST /api/upload`: uploads source files to root or a target subfolder.
- `POST /api/convert`: triggers ingest processing.
- `GET /api/document`: returns processed markdown + metadata for a selected source file.
- `GET /api/table`: returns parsed CSV table rows.
- `DELETE /api/source`: deletes source file (and matching output directory when present).
