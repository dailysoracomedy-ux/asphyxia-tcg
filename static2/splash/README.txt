Apex summon splash art - Commit 54

One PNG per Apex, named exactly by card definition id. The full set of 12:

  Neon Underground          Dark White                Synth Ascendancy
  nu-street-beast.png       dw-overseer-prime.png     sa-model-00-crown.png
  nu-static-jack.png        dw-enforcer-v4.png        sa-chrome-seraph.png
  nu-alley-wraith.png       dw-glass-warden.png       sa-virex.png
  nu-riot-runner.png        dw-pale-executioner.png   sa-halcyon-maw.png

Spec: transparent background (PNG alpha), tall portrait crop ~5:8
(e.g. 1000x1600). Consistent aspect ratio across all 12 matters more
than exact pixel size. Missing files are fine - that card simply
doesn't splash until its art lands here; drop them in one at a time.

Served at /splash/<id>.png via scripts/sync-static.mjs (static2/ is
the source of truth; the synced copy under public/ is gitignored like
art/ and images/).
