/**
 * Commit 47.2 - syncs static2/ into public/ before dev and build.
 *
 * WHY THIS EXISTS: GitHub's web uploader rejects folder uploads containing
 * more than 100 files, and public/ crossed 114. Next.js can only serve
 * static assets from public/, so instead of rewriting asset paths, half the
 * assets (art/, images/) live in the top-level static2/ folder and get
 * copied into public/ automatically by the predev/prebuild hooks in
 * package.json. Served URLs are unchanged (/art/..., /images/...).
 *
 * The synced copies inside public/ are gitignored - static2/ is the source
 * of truth. Upload public/ and static2/ as separate folders (each stays
 * under 100 files; when either approaches the limit, add static3/ and a
 * line in SYNC_DIRS below).
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SYNC_DIRS = ['static2'];

for (const src of SYNC_DIRS) {
  const from = join(root, src);
  if (!existsSync(from)) continue;
  const to = join(root, 'public');
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
  console.log(`[sync-static] ${src}/ -> public/`);
}
