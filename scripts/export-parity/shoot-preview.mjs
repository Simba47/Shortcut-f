// Opens a clip in the editor (a development server on the throwaway database) and screenshots its
// 9:16 preview at exact moments, the picture settled (photos, frames and fonts loaded). The editor's
// own saves go through (to the throwaway database); any other write is stopped.
//
//   LOCAL_DATABASE_URL=… AUTH_SECRET=… BASE=http://localhost:3210 CLIP=<id> OUT=<folder>/pv \
//     [TIMES=1500,5000,…] [CHROME=…chrome.exe] node scripts/export-parity/shoot-preview.mjs
import { writeFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import postgres from 'postgres'
import { encode } from 'next-auth/jwt'

const { BASE = 'http://localhost:3210', CLIP, OUT } = process.env
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
if (!CLIP || !OUT || !process.env.LOCAL_DATABASE_URL || !process.env.AUTH_SECRET) {
  console.error('Set LOCAL_DATABASE_URL, AUTH_SECRET, CLIP and OUT'); process.exit(1)
}
// (puppeteer-core: npm i --no-save puppeteer-core, or PUPPETEER_CORE=<a folder whose node_modules has it>)
const req = createRequire(process.env.PUPPETEER_CORE ? `${process.env.PUPPETEER_CORE}/package.json` : import.meta.url)
const puppeteer = (await import(pathToFileURL(req.resolve('puppeteer-core')).href)).default
mkdirSync(OUT, { recursive: true })
const sql = postgres(process.env.LOCAL_DATABASE_URL, { max: 1 })
const [u] = await sql`SELECT u.id, u.email, u.name, u.session_id FROM clips c JOIN videos v ON v.id = c.video_id JOIN users u ON u.id = v.user_id WHERE c.id = ${CLIP}`
await sql.end()
const cookie = await encode({ token: { id: u.id, sub: u.id, email: u.email, name: u.name, sid: u.session_id }, secret: process.env.AUTH_SECRET, salt: 'authjs.session-token' })
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 3 } })
const page = await browser.newPage()
await page.setCookie({ name: 'authjs.session-token', value: cookie, domain: new URL(BASE).hostname, path: '/', httpOnly: true })
await page.setRequestInterception(true)
const blocked = []
page.on('request', r => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(r.method())) return r.continue()
  if (r.url().startsWith(BASE) && /\/api\/clips\/[^/]+\/(save|silences)$/.test(r.url())) return r.continue()
  blocked.push(`${r.method()} ${r.url().replace(BASE, '').split('?')[0]}`)
  return r.abort()
})
await page.goto(`${BASE}/editor/${CLIP}`, { waitUntil: 'networkidle2', timeout: 400000 })
await wait(3000)
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => /Skip tour/.test(b.textContent))?.click())
await page.waitForFunction(() => window.__exportParity && window.__exportParity.len() > 0, { timeout: 120000 })
const len = await page.evaluate(() => window.__exportParity.len())
const times = process.env.TIMES ? process.env.TIMES.split(',').map(Number) : Array.from({ length: 14 }, (_, i) => Math.round(400 + (len - 900) * i / 13))
await page.mouse.move(5, 995)
const shots = []
for (const t of times) {
  await page.evaluate(t => { window.__exportParity.pause(); window.__exportParity.seek(t) }, t)
  await page.waitForFunction(() => [...document.querySelectorAll('video')].every(v => !v.seeking && v.readyState >= 2), { timeout: 30000 }).catch(() => {})
  // settled: the same picture in two looks 700 ms apart, at least 1.5 s in
  await wait(1500)
  const card = await page.$('.ed-pv-card-in > .relative')
  let prev = await card.screenshot({ encoding: 'base64' }), settled = false
  for (let k = 0; k < 14 && !settled; k++) { await wait(700); const cur = await card.screenshot({ encoding: 'base64' }); settled = cur === prev; prev = cur }
  const file = `${OUT}/pv_${String(t).padStart(6, '0')}.png`
  await card.screenshot({ path: file })
  shots.push({ t, now: await page.evaluate(() => window.__exportParity.now()), file, settled })
}
writeFileSync(`${OUT}/preview.json`, JSON.stringify({ len, shots, blocked }, null, 1))
console.log(`preview ${len} ms long, ${shots.length} moments shot; writes stopped: ${blocked.length}`)
await browser.close()
