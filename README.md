# CRM Competitive Intelligence v1.3

## Render
- Build command: `npm install`
- Start command: `npm start`
- Node: default is fine
- Required env: `DATABASE_URL` pointing to the Render PostgreSQL database
- Optional env for screenshot/creative AI analysis: `GEMINI_API_KEY`

## What v1.3 adds
- Persistent PostgreSQL storage for all captured batches/messages.
- Message-by-message content classification.
- Product/category pitch detection.
- Journey/stage, CTA, offer, urgency and tone detection.
- Timestamp extraction when timestamps are present in pasted transcripts.
- Original transcript + screenshot stored together as a batch.
- Creative/screenshot analysis using Gemini 2.5 Flash when `GEMINI_API_KEY` is configured.
- Insights tab with journey, cadence, product, channel and message-level analysis.
- Fixed Express 5 wildcard route issue.
- Fixed PostgreSQL import column mismatch.
- Existing database tables are migrated with `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`; existing data is retained.
