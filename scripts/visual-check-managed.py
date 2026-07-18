#!/usr/bin/env python3
"""
Self-contained ASPHYXIA visual harness. Starts the prod Next server as a
managed subprocess, waits for it, drives the real UI into a match, screenshots
the hand at rest + hover, checks for structural problems (e.g. a vertical
scrollbar on the hand), then tears the server down. One process = no orphaned
servers, no process-group kill issues.
"""
import argparse
import os
import socket
import subprocess
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright


def log(m):
    print(f"[vcheck] {m}", flush=True)


def wait_http(port, timeout=40):
    for _ in range(timeout):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=2) as r:
                if r.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(1)
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=3210)
    ap.add_argument("--out", default="/tmp/asphyxia-shots")
    ap.add_argument("--vh", type=int, default=900)
    ap.add_argument("--vw", type=int, default=1440)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    env = dict(os.environ, PORT=str(args.port))
    log(f"starting next start on :{args.port}")
    server = subprocess.Popen(
        ["npx", "next", "start"],
        cwd=root, env=env,
        stdout=open("/tmp/serve.log", "w"), stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,

    )
    try:
        if not wait_http(args.port):
            log("SERVER FAILED TO START")
            print(open("/tmp/serve.log").read()[-800:])
            return 1
        log("server up")
        rc = run_checks(args)
        return rc
    finally:
        try:
            server.terminate()
            server.wait(timeout=5)
        except Exception:
            try:
                server.kill()
            except Exception:
                pass
        log("server stopped")


def run_checks(args):
    base = f"http://127.0.0.1:{args.port}/"
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": args.vw, "height": args.vh})
        page.set_default_timeout(15000)
        errors = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))

        log("opening with e2e hook")
        page.goto(base + "?e2e=1", wait_until="domcontentloaded")
        time.sleep(1.5)
        page.screenshot(path=f"{args.out}/01-menu.png")

        # Jump straight into a live match via the exposed store (bypasses the
        # coin-flip / opening-apex UI, which is animation-timed and brittle).
        started = page.evaluate(
            """() => {
                const s = window.__asphyxiaStore;
                if (!s) return 'no-hook';
                const st = s.getState();
                st.startNewGame('Neon Underground', 'Dark White', false, false, false, 'player1', 24);
                // Resolve the opening-apex selection step so the match reaches
                // 'playing' with a live, interactive hand.
                let g = s.getState();
                let guard = 0;
                while (g.status === 'selectingOpeningApex' && guard++ < 4) {
                    const who = g.openingApexSelectionPlayerId;
                    const hand = g.players[who].hand;
                    const apex = hand.find(c => c.type === 'Apex');
                    if (!apex) break;
                    g.selectOpeningApex(who, apex.instanceId);
                    g = s.getState();
                }
                return s.getState().status;
            }"""
        )
        log(f"startNewGame -> status: {started}")
        time.sleep(2.5)
        found = True
        try:
            page.wait_for_selector("[data-hand-track]", timeout=8000)
        except Exception:
            found = False
            log("!! hand-track not found")
        page.screenshot(path=f"{args.out}/04-match.png")

        metrics = None
        if found:
            metrics = page.evaluate(
                """() => {
                    const t = document.querySelector('[data-hand-track]');
                    if (!t) return null;
                    const cs = getComputedStyle(t);
                    return {
                        trackOverflowX: cs.overflowX, trackOverflowY: cs.overflowY,
                        scrollH: t.scrollHeight, clientH: t.clientHeight,
                        scrollW: t.scrollWidth, clientW: t.clientWidth,
                        // A REAL vertical scrollbar only when overflow-y is
                        // auto/scroll AND content exceeds the box. With
                        // overflow:visible, excess content (the lift) shows no
                        // scrollbar and is expected.
                        hasVScroll: (['auto','scroll'].includes(cs.overflowY)) && t.scrollHeight > t.clientHeight + 1,
                        hasHScroll: (['auto','scroll'].includes(cs.overflowX)) && t.scrollWidth > t.clientWidth + 1,
                        // Also flag any actual rendered scrollbar via the
                        // client/offset delta (a scrollbar steals a few px).
                        vScrollbarPx: t.offsetWidth - t.clientWidth,
                        hitboxes: document.querySelectorAll('[data-hand-card-hitbox]').length,
                        visuals: document.querySelectorAll('[data-hand-card-visual]').length,
                    };
                }"""
            )
            track = page.query_selector("[data-hand-track]")
            box = track.bounding_box() if track else None
            if box:
                clip = {
                    "x": max(0, box["x"] - 40),
                    "y": max(0, box["y"] - 170),
                    "width": min(args.vw - max(0, box["x"] - 40), box["width"] + 80),
                    "height": min(args.vh - max(0, box["y"] - 170), box["height"] + 210),
                }
                page.screenshot(path=f"{args.out}/05-hand-rest.png", clip=clip)
                hbs = page.query_selector_all("[data-hand-card-hitbox]")
                if hbs:
                    mid = hbs[len(hbs) // 2].bounding_box()
                    if mid:
                        page.mouse.move(mid["x"] + mid["width"] / 2, mid["y"] + mid["height"] / 2)
                        time.sleep(0.5)
                        page.screenshot(path=f"{args.out}/06-hand-hover.png", clip=clip)
                        page.screenshot(path=f"{args.out}/07-hover-full.png")
        browser.close()

    log("=== REPORT ===")
    problems = []
    if not metrics:
        problems.append("hand metrics unavailable (hand didn't render)")
    else:
        for k, v in metrics.items():
            log(f"  {k}: {v}")
        if metrics["hasVScroll"]:
            problems.append(f"VERTICAL SCROLLBAR on hand (scrollH {metrics['scrollH']} > clientH {metrics['clientH']})")
        if metrics["hitboxes"] == 0:
            problems.append("no hand hitboxes")
    if errors:
        log(f"  console errors: {errors[:4]}")
    if problems:
        for pr in problems:
            log(f"  !! {pr}")
        return 1
    log("OK - no structural hand problems")
    return 0


if __name__ == "__main__":
    sys.exit(main())
