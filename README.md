# CRM Competitive Intelligence v1.2 FINAL
- Bulk capture: Brand + Channel + Journey + full transcript.
- Screenshot/evidence upload stored with the batch.
- Existing records are never cleared on refresh.
- PostgreSQL support for persistent Render storage.
- `/health` reports `database:true` when DATABASE_URL is connected.

## Render
1. Back up current data.
2. Connect Render PostgreSQL to the service.
3. Set DATABASE_URL using the database's internal connection string.
4. Replace repo contents with this package, commit and push.
5. Confirm `/health` shows version 1.2.0 and database:true.
6. Test Bulk Capture with a Duroflex transcript and screenshot.
