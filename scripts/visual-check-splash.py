#!/usr/bin/env python3
"""
Commit 54 - splash-art verification. Run from the repo root AFTER dropping
real art into static2/splash/ (and rebuilding, so sync-static copies it):
plays an Apex for player1 through the real store and confirms the left-lane
splash mounts at the screen edge with its art genuinely loaded.
"""
import os, socket, subprocess, time, urllib.request, sys
from playwright.sync_api import sync_playwright
def wait_http(port, timeout=60):
    for _ in range(timeout):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=2) as r:
                if r.status == 200: return True
        except Exception: pass
        time.sleep(1)
    return False
s = socket.socket(); s.bind(("127.0.0.1",0)); port = s.getsockname()[1]; s.close()
server = subprocess.Popen(["npx","next","start","-p",str(port)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=".")
try:
    assert wait_http(port)
    with sync_playwright() as pw:
        b = pw.chromium.launch(); page = b.new_page(viewport={"width":1600,"height":900})
        page.goto(f"http://127.0.0.1:{port}/?e2e=1"); page.wait_for_timeout(1200)
        page.evaluate("""() => {
            const s = window.__asphyxiaStore; s.getState().startNewGame('Neon Underground','Dark White', false, false, false, 'player1', 24);
            let g = s.getState(); let guard = 0;
            while (g.status === 'selectingOpeningApex' && guard++ < 4) {
                const who = g.openingApexSelectionPlayerId;
                const apex = g.players[who].hand.find(c => c.type === 'Apex');
                if (!apex) break; g.selectOpeningApex(who, apex.instanceId); g = s.getState();
            }
        }""")
        page.wait_for_timeout(1200)
        # play an Apex from hand through the REAL store action; P1 => left lane.
        # Hands may hold no Apex after opening selection - cycle end-turns (real
        # draws) until player1 holds one, then play it.
        played = page.evaluate("""() => {
            const s = window.__asphyxiaStore;
            for (let turns = 0; turns < 20; turns++) {
                let g = s.getState();
                if (g.status !== 'playing') return 'status:' + g.status;
                if (g.phase === 'Start' && g.startPhasePending) { g.advancePhase('Start'); g = s.getState(); }
                if (g.phase === 'Start') { g.advancePhase('Main'); g = s.getState(); }
                if (g.activePlayerId === 'player1') {
                    const apex = g.players.player1.hand.find(c => c.type === 'Apex');
                    const slotFree = g.players.player1.apexSlots.some(a => a === null);
                    if (apex && slotFree) { g.playApexCard(apex.instanceId); return apex.defId; }
                }
                g.endTurn();
            }
            const g2 = window.__asphyxiaStore.getState();
            return JSON.stringify({ fail: true, phase: g2.phase, active: g2.activePlayerId,
                pend: g2.startPhasePending, queue: g2.pendingResponseQueue.length,
                hand: g2.players.player1.hand.map(c => c.type),
                slots: g2.players.player1.apexSlots.map(a => !!a) });
        }""")
        print(f"[splash] played: {played}")
        found = None
        for _ in range(20):
            page.wait_for_timeout(60)
            found = page.evaluate("""() => {
                const lane = document.querySelector('.vfx-splash-lane');
                if (!lane) return null;
                const img = lane.querySelector('img.vfx-splash-art');
                const r = lane.getBoundingClientRect();
                return { side: lane.className.includes('vfx-splash-left') ? 'left' : 'right',
                         left: r.left, hasArt: !!img, artLoaded: img ? img.naturalWidth > 0 : false };
            }""")
            if found and found.get('artLoaded'): break
        print(f"[splash] lane: {found}")
        ok = found and found['side'] == 'left' and found['left'] == 0 and found['artLoaded']
        print("[splash] PASS" if ok else "[splash] FAIL")
        b.close()
        sys.exit(0 if ok else 1)
finally:
    server.terminate()
