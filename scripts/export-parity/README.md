# Preview vs export check

Shows, moment by moment, whether an exported video looks like the editor's preview. Run it on a
clip that uses the feature you changed (and on a clip with many features) before pushing.

Nothing touches QA: clips are copied **read-only** from QA into a throwaway database on this PC,
the editor saves into that copy, and the export runs with the worker's read-only local export.

## Once

- A throwaway Postgres on this PC: Docker (`docker run -p 5545:5432 -e POSTGRES_PASSWORD=test postgres`),
  the `embedded-postgres` npm package, or any local server.
  `LOCAL_DATABASE_URL=postgres://postgres:test@127.0.0.1:5545/postgres`
- `npm i --no-save puppeteer-core` (or `PUPPETEER_CORE=<folder that has it>`), Chrome installed.
- Python with Pillow and numpy, FFmpeg on PATH.

## Each time

1. Copy the clip(s) from QA (`--schema` the first time: makes the tables the same as QA's):

   ```
   QA_DATABASE_URL=<QA's> LOCAL_DATABASE_URL=<local> node scripts/export-parity/copy-clips.mjs --schema <clip id>
   ```

2. Run this website on the throwaway database (a second dev server is fine):

   ```
   DATABASE_URL=<local> DB_SSL=off DB_POOLER=off AUTH_URL=http://localhost:3210 npx next dev -p 3210
   ```

3. Shoot the preview (saves go into the copy):

   ```
   LOCAL_DATABASE_URL=<local> AUTH_SECRET=<from .env> BASE=http://localhost:3210 CLIP=<id> OUT=out/<id>/pv \
     node scripts/export-parity/shoot-preview.mjs
   ```

4. Export it with the worker's code (in chai-cut-backend, read-only, nothing uploaded):

   ```
   DATABASE_URL=<local> DB_SSL=off npx tsx --env-file=.env src/scripts/local-export.ts <id> 1080p out/<id>
   ```

5. Compare: `python scripts/export-parity/compare.py out/<id>`

## Reading it

For each moment: `diff` (0–255, the mean difference of the two pictures), and the export's moment
that looks most like the preview. Same picture: diff ≈ 2–8 and the best match at +0.00 (±0.08 s is
a frame or two). A larger diff with the best match at the same moment is a real difference: open
the `sheet_*.jpg` (preview | export | difference) to see it. A best match seconds away means the
export runs ahead or behind (removed parts, pauses). Moments in fast motion score higher: check the
sheet before calling it a difference.

Always export at **1080p** (what users get): other sizes draw captions bigger.
