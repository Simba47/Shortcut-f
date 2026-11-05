// Copies clips (their owner, videos, brand kits, transcripts, sections, texts, media, music,
// transitions, caption style) from QA — read only — into a throwaway local database, so the editor
// can open and save them and the worker can export them without touching QA.
//
//   QA_DATABASE_URL=… LOCAL_DATABASE_URL=postgres://postgres:test@127.0.0.1:5545/postgres \
//     node scripts/export-parity/copy-clips.mjs [--schema] <clip id> [<clip id> …]
//
// --schema first makes the throwaway database's tables the same as QA's (read from QA's catalogue).
import postgres from 'postgres'

const args = process.argv.slice(2)
const withSchema = args.includes('--schema')
const clips = args.filter(a => /^[0-9a-f-]{36}$/i.test(a))
if (!process.env.QA_DATABASE_URL || !process.env.LOCAL_DATABASE_URL || (!clips.length && !withSchema)) {
  console.error('Set QA_DATABASE_URL and LOCAL_DATABASE_URL, and give clip ids (and/or --schema)')
  process.exit(1)
}
const local = new URL(process.env.LOCAL_DATABASE_URL)
if (!['localhost', '127.0.0.1', '::1'].includes(local.hostname)) {
  console.error('LOCAL_DATABASE_URL must be a database on this PC (it is overwritten)')
  process.exit(1)
}
const qa = postgres(process.env.QA_DATABASE_URL, { max: 1, connection: { default_transaction_read_only: true } })
const loc = postgres(process.env.LOCAL_DATABASE_URL, { max: 1, onnotice: () => {} })

if (withSchema) {
  const ddl = []
  for (const e of await qa`SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder) labels FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' GROUP BY 1`)
    ddl.push(`CREATE TYPE "${e.typname}" AS ENUM (${e.labels.map(l => `'${l}'`).join(',')})`)
  for (const s of await qa`SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public'`)
    ddl.push(`CREATE SEQUENCE IF NOT EXISTS "${s.sequence_name}"`)
  const tables = await qa`SELECT c.oid, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 2`
  for (const t of tables) {
    const cols = await qa`SELECT a.attname, format_type(a.atttypid, a.atttypmod) typ, a.attnotnull, pg_get_expr(d.adbin, d.adrelid) def, a.attidentity, a.attgenerated
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = ${t.oid} AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`
    const cons = await qa`SELECT conname, pg_get_constraintdef(oid) def FROM pg_constraint WHERE conrelid = ${t.oid} AND contype IN ('p', 'u', 'c')`
    const parts = cols.map(c => `"${c.attname}" ${c.typ}` + (c.attgenerated === 's' ? ` GENERATED ALWAYS AS (${c.def}) STORED` : c.attidentity ? ` GENERATED ${c.attidentity === 'a' ? 'ALWAYS' : 'BY DEFAULT'} AS IDENTITY` : c.def ? ` DEFAULT ${c.def}` : '') + (c.attnotnull ? ' NOT NULL' : ''))
    for (const c of cons) parts.push(`CONSTRAINT "${c.conname}" ${c.def}`)
    ddl.push(`CREATE TABLE "${t.relname}" (\n  ${parts.join(',\n  ')}\n)`)
    for (const i of await qa`SELECT pg_get_indexdef(i.indexrelid) def FROM pg_index i WHERE i.indrelid = ${t.oid} AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid = i.indexrelid)`) ddl.push(i.def)
  }
  await loc.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  for (const q of ddl) await loc.unsafe(q)
  console.log(`schema: ${tables.length} tables as on QA`)
}

if (clips.length) {
  const ids = async q => [...new Set((await q).map(r => r.id).filter(Boolean))]
  const users = await ids(qa`SELECT DISTINCT v.user_id id FROM clips c JOIN videos v ON v.id = c.video_id WHERE c.id = ANY(${clips})`)
  const videos = await ids(qa`SELECT id FROM videos WHERE user_id = ANY(${users})`)
  const segs = await ids(qa`SELECT id FROM segments WHERE clip_id = ANY(${clips})`)
  const boxes = await ids(qa`SELECT id FROM crop_boxes WHERE segment_id = ANY(${segs})`)
  const trs = await ids(qa`SELECT id FROM transcripts WHERE video_id = ANY(${videos})`)
  const kits = await ids(qa`SELECT id FROM brand_kits WHERE user_id = ANY(${users}) UNION SELECT kit_id FROM brand_kit_shares WHERE user_id = ANY(${users})`)
  const jobs = await ids(qa`SELECT ai_edit_job_id id FROM clips WHERE id = ANY(${clips})`)
  // A clip copied before keeps the parts it had then unless they go first (the copy below only
  // replaces the parts QA has now: a part since deleted on QA stayed, and the export here differed)
  const oldSegs = (await loc`SELECT id FROM segments WHERE clip_id::text = ANY(${clips})`).map(r => String(r.id))
  if (oldSegs.length) {
    await loc`DELETE FROM box_keyframes WHERE box_id IN (SELECT id FROM crop_boxes WHERE segment_id::text = ANY(${oldSegs}))`
    await loc`DELETE FROM crop_boxes WHERE segment_id::text = ANY(${oldSegs})`
    await loc`DELETE FROM segments WHERE id::text = ANY(${oldSegs})`
  }
  const plan = [
    ['users', 'id', users], ['accounts', '"userId"', users], ['subscriptions', 'user_id', users],
    ['brand_kits', 'id', kits], ['brand_kit_shares', 'kit_id', kits],
    ['videos', 'id', videos], ['transcripts', 'id', trs], ['transcript_words', 'transcript_id', trs],
    ['ai_edit_jobs', 'id', jobs],
    ['clips', 'id', clips], ['segments', 'id', segs], ['crop_boxes', 'id', boxes], ['box_keyframes', 'box_id', boxes],
    ['overlays', 'clip_id', clips], ['text_overlays', 'clip_id', clips], ['caption_styles', 'clip_id', clips],
    ['audio_tracks', 'clip_id', clips], ['transitions', 'clip_id', clips], ['clip_angles', 'clip_id', clips],
    ['clip_subjects', 'clip_id', clips], ['clip_silences', 'clip_id', clips], ['clip_broll_ideas', 'clip_id', clips],
  ]
  for (const [t, col, list] of plan) {
    if (!list.length) continue
    const rows = await qa.unsafe(`SELECT row_to_json(__r)::text j FROM "${t}" __r WHERE ${col}::text = ANY($1)`, [list.map(String)])
    await loc.unsafe(`DELETE FROM "${t}" WHERE ${col}::text = ANY($1)`, [list.map(String)])
    for (let i = 0; i < rows.length; i += 500)
      await loc.unsafe(`INSERT INTO "${t}" SELECT (json_populate_record(null::"${t}", j::json)).* FROM unnest($1::text[]) AS u(j)`, [rows.slice(i, i + 500).map(r => r.j)])
    console.log(`${t}: ${rows.length}`)
  }
}
await qa.end(); await loc.end()
