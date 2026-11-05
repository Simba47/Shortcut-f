# Preview screenshot vs the export's frame at the same moment: a score per moment + a side-by-side sheet
import json, subprocess, sys, os, glob
import numpy as np
from PIL import Image, ImageDraw
d = sys.argv[1]
pv = json.load(open(os.path.join(d, 'pv', 'preview.json')))
mp4 = glob.glob(os.path.join(d, '*.mp4'))[0]
W, H = 360, 640
rows, report = [], []
dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4], capture_output=True, text=True).stdout)
for s in pv['shots']:
    t = s['t'] / 1000
    ex = os.path.join(d, 'pv', f"ex_{s['t']:06d}.png")
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{t:.3f}', '-i', mp4, '-frames:v', '1', ex], check=True)
    # the export's moment that looks most like this preview (a shorter export: where the picture went)
    lo = max(0, t - 5); n = 64 * 114
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-ss', f'{lo:.3f}', '-t', f'{t + 0.3 - lo:.3f}', '-i', mp4, '-vf', 'fps=25,scale=64:114,format=gray', '-f', 'rawvideo', '-'], capture_output=True).stdout
    win = np.frombuffer(raw, np.uint8).reshape(-1, 114, 64).astype(float)
    pg = np.asarray(Image.open(s['file']).convert('L').resize((64, 114), Image.LANCZOS), float)
    scores = np.abs(win - pg).mean(axis=(1, 2)) if len(win) else np.array([999.0])
    best_t = lo + int(scores.argmin()) / 25
    if not os.path.exists(ex):
        report.append(f"{t:7.2f}s  no export frame here (export ends {dur:.2f}s); best match in export {best_t:.2f}s (diff {scores.min():.1f})"); continue
    a = Image.open(s['file']).convert('RGB'); b = Image.open(ex).convert('RGB')
    ar = a.size[0] / a.size[1]
    a = a.resize((W, H), Image.LANCZOS); b = b.resize((W, H), Image.LANCZOS)
    A, B = np.asarray(a, float), np.asarray(b, float)
    diff = np.abs(A - B).mean(axis=2)
    # where it differs: thirds top / middle / bottom
    bands = [diff[i * H // 3:(i + 1) * H // 3].mean() for i in range(3)]
    report.append(f"{s['t']/1000:7.2f}s  pv@{s['now']/1000:7.2f}  diff {diff.mean():5.1f}  (top {bands[0]:5.1f} mid {bands[1]:5.1f} bottom {bands[2]:5.1f})  best match in export {best_t:.2f}s ({best_t - t:+.2f}, diff {scores.min():.1f})")
    heat = Image.fromarray(np.clip(diff * 3, 0, 255).astype('uint8')).convert('RGB')
    row = Image.new('RGB', (W * 3 + 20, H + 24), (30, 30, 30))
    row.paste(a, (0, 24)); row.paste(b, (W + 10, 24)); row.paste(heat, (2 * W + 20, 24))
    ImageDraw.Draw(row).text((4, 4), f"{s['t']/1000:.2f}s  preview | export | difference   diff {diff.mean():.1f}", fill=(255, 255, 255))
    rows.append(row)
for i in range(0, len(rows), 4):
    sheet = Image.new('RGB', (rows[0].size[0] * 2 + 10, (rows[0].size[1] + 10) * 2), (0, 0, 0))
    for k, r in enumerate(rows[i:i + 4]):
        sheet.paste(r, ((k % 2) * (r.size[0] + 10), (k // 2) * (r.size[1] + 10)))
    sheet.save(os.path.join(d, f'sheet_{i // 4}.jpg'), quality=85)
open(os.path.join(d, 'report.txt'), 'w').write('\n'.join(report))
print('\n'.join(report))
