## Models, fonts, system tools and services

| Item | Used for | License or terms |
|---|---|---|
| BAAI `bge-small-en-v1.5` weights (ONNX export by Xenova) | KB embeddings, at ingest and at query time | MIT |
| BAAI `bge-small-en-v1.5` weights (quantized ONNX export used by `fastembed`) | `kb/retrieval_eval.py` only, the offline retriever comparison; fastembed fetches its default revision, not a pinned one. The app pins its own copy (`web/lib/config.ts`). | MIT |
| Tesseract OCR | Reading the PNG documents in the KB at ingest | Apache-2.0 |
| IBM Plex Sans and Mono | UI fonts | SIL Open Font License 1.1 |
| pgvector | Vector search in Postgres | PostgreSQL License |
| Anthropic API (Claude Haiku 5.5 at runtime; Opus 5.5 and Sonnet 5.5 in the dev model comparison) | Agent replies and the safety check | Anthropic Commercial Terms of Service; API inputs and outputs are not used for training by default |
| Railway | Hosting the app and Postgres | Railway Terms of Service |
| Better Stack Uptime | Polling `/api/health` and emailing the owner | Better Stack Terms of Service |
