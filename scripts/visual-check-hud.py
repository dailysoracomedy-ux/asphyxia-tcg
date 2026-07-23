#!/usr/bin/env python3
"""
Commit 54.1 - O2 HUD tower verification. Run from the repo root against a
production build: boots the server, drives real matches, and checks tower
placement/height beside each mat, the momentum frame swap, full-O2 fill
ratio, live drain during AI combat, and the portaled giant popups.
"""
import socket, subprocess, time, urllib.request, sys
from playwright.sync_api import sync_playwright
def wait_http(port, timeout=60):
    for _ in range(timeout):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=2) as r:
                if r.status == 200: return True
        except Exception: pass
        time.sleep(1)
s = socket.socket(); s.bind(("127.0.0.1",0)); port = s.getsockname()[1]; s.close()
server = subprocess.Popen(["npx","next","start","-p",str(port)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=".")
fails = []
def start(page, o2=24, ai="false"):
    page.evaluate(f"""() => {{
        const s = window.__asphyxiaStore; s.getState().startNewGame('Neon Underground','Dark White', false, {ai}, false, 'player1', {o2});
        let g = s.getState(); let guard = 0;
        while (g.status === 'selectingOpeningApex' && guard++ < 4) {{
            const who = g.openingApexSelectionPlayerId;
            const apex = g.players[who].hand.find(c => c.type === 'Apex');
            if (!apex) break; g.selectOpeningApex(who, apex.instanceId); g = s.getState();
        }}
    }}""")
try:
    assert wait_http(port)
    with sync_playwright() as pw:
        b = pw.chromium.launch(); page = b.new_page(viewport={"width":1600,"height":900})
        page.goto(f"http://127.0.0.1:{port}/?e2e=1"); page.wait_for_timeout(1200)
        start(page); page.wait_for_timeout(1800)
        geo = page.evaluate("""() => {
            const towers = [...document.querySelectorAll('[data-vfx-o2]')];
            const rows = [...document.querySelectorAll('[data-board-row]')];
            const out = towers.map(t => {
                const row = t.closest('[data-board-row]');
                const mat = row.querySelector('.scanlines');
                const tr = t.getBoundingClientRect(), mr = mat.getBoundingClientRect();
                const frames = [...t.querySelectorAll('img')].map(i => ({src: i.src.split('/').pop(), op: getComputedStyle(i).opacity}));
                return { pid: t.getAttribute('data-vfx-o2'), /* attached design: tower deliberately overlaps the mat edge (bolted-on), and the shared 3D tilt skews both rects - require it to START left of the mat with bounded overlap */ leftOfMat: tr.left < mr.left && (tr.right - mr.left) < 80,
                         hRatio: tr.height / mr.height, bottomGap: Math.round(Math.abs(tr.bottom - mr.bottom)), w: Math.round(tr.width),
                         visibleFrame: frames.find(f => f.op === '1')?.src };
            });
            return { towers: out, rows: rows.length, scale: document.querySelector('[data-board-scale]').getAttribute('data-board-scale') };
        }""")
        print(f"[hud] {geo}")
        if len(geo['towers']) != 2: fails.append(f"expected 2 towers, got {len(geo['towers'])}")
        for t in geo['towers']:
            if not t['leftOfMat']: fails.append(f"{t['pid']} tower not left of its mat")
            # tuned design: tower is ~72% of mat height, docked to the mat's
            # bottom edge (3D tilt skews projected rects a few px)
            if not (0.60 <= t['hRatio'] <= 0.82): fails.append(f"{t['pid']} tower/mat height ratio off: {t['hRatio']:.2f}")
            if t['bottomGap'] > 16: fails.append(f"{t['pid']} tower not bottom-docked: {t['bottomGap']}px gap")
            if t['visibleFrame'] != 'momentum-0.webp': fails.append(f"{t['pid']} wrong frame at 0 momentum: {t['visibleFrame']}")
        # fill ratio at full o2
        fillH = page.evaluate("""() => {
            const t = document.querySelector('[data-vfx-o2="player1"]');
            const cols = [...t.querySelectorAll('div')].filter(d => d.className.includes('hud-liquid-drain') && !d.style.filter);
            const col = cols.find(d => d.style.height);
            return col ? col.style.height : null;
        }""")
        print(f"[hud] full fill height: {fillH}")
        if fillH != '100%': fails.append(f"full-O2 fill not 100%: {fillH}")
        # momentum frame swap via a real momentum change: run low-o2 AI match and watch for frame changes + fill drain + number
        start(page, o2=6, ai="true")
        seen_frames, drained, popup = set(), False, False
        for _ in range(200):
            page.wait_for_timeout(250)
            snap = page.evaluate("""() => {
                const out = [];
                for (const pid of ['player1','player2']) {
                    const t = document.querySelector(`[data-vfx-o2="${pid}"]`);
                    if (!t) continue;
                    const img = [...t.querySelectorAll('img')].find(i => getComputedStyle(i).opacity === '1');
                    const col = [...t.querySelectorAll('div')].find(d => d.className.includes('hud-liquid-drain') && d.style.height && !d.style.filter);
                    const num = t.textContent.trim();
                    out.push({ pid, frame: img ? img.src.split('/').pop() : null, h: col ? col.style.height : null, num });
                }
                return { out, popup: !!document.querySelector('.vfx-o2-popup-big, .vfx-o2-popup-huge') };
            }""")
            for o in snap['out']:
                seen_frames.add(o['frame'])
                if o['h'] and o['h'] != '100%': drained = True
            if snap['popup']: popup = True
            if len(seen_frames) >= 2 and drained and popup: break
            if page.evaluate("window.__asphyxiaStore.getState().status") == 'gameOver': break
        print(f"[hud] frames seen: {sorted(seen_frames)}, drained: {drained}, popup: {popup}")
        if len(seen_frames) < 2: fails.append("momentum frame never swapped during AI match")
        if not drained: fails.append("O2 fill never drained")
        if not popup: fails.append("giant popup missing from tower anchor")
        page.screenshot(path="/mnt/user-data/outputs/commit54-hud-tower.png")
        b.close()
finally:
    server.terminate()
if fails:
    print("[hud] FAILURES:"); [print("  ", f) for f in fails]; sys.exit(1)
print("[hud] ALL HUD CHECKS PASSED")
