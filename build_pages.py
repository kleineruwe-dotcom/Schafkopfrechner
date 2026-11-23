#!/usr/bin/env python3
"""Baut die öffentliche Variante (z. B. GitHub Pages): statische Dateien, Speicherung nur im Gerät."""
import pathlib, shutil
B = pathlib.Path(__file__).parent
out = B / "_site"
shutil.rmtree(out, ignore_errors=True)
shutil.copytree(B / "web", out)
idx = out / "index.html"
idx.write_text(idx.read_text().replace('<script src="scoring.js"></script>', '<script>window.KARTLBLOCK_NOSYNC = true;</script>\n  <script src="scoring.js"></script>'))
(out / ".nojekyll").write_text("")
print(out)
