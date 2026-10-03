"""Carve the Plate's engine from Rosse's source, re-applying the Plate's additions and out-of-distribution changes."""
import re, sys
src=open('/tmp/gen/app16.js').read(); e2=open('/tmp/gen/engine2.js').read()
head=src[:src.index("/* ---------- real galaxies")]
def rep(a,b,cnt=1):
    global head
    assert head.count(a)==cnt,(a[:90],head.count(a)); head=head.replace(a,b)
rep("var cv = $('gl'), gl = cv.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: true, preserveDrawingBuffer: true });",
    "var cv = document.createElement('canvas'); cv.width = cv.height = 192; var gl = cv.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: true, preserveDrawingBuffer: true });")
rep("if (!gl) { $('fallback').hidden = false; return; }","if (!gl) { window.FOUNDRY = null; return; }")
rep("""  var t0 = performance.now(), dpr = Math.min(2, window.devicePixelRatio || 1), sz = cv.clientWidth;
  cv.width = cv.height = Math.round(sz * dpr); gl.viewport(0, 0, cv.width, cv.height);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);""","""  var t0 = performance.now();
  if (MARK.vp) { gl.viewport(MARK.vp[0], MARK.vp[1], MARK.vp[2], MARK.vp[3]); gl.enable(gl.SCISSOR_TEST); gl.scissor(MARK.vp[0], MARK.vp[1], MARK.vp[2], MARK.vp[3]); }
  else { gl.viewport(0, 0, cv.width, cv.height); gl.disable(gl.SCISSOR_TEST); }
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);""")
for ln in ["  $('stats').textContent = STATS.dots.toLocaleString('en-GB') + ' dots · ' + STATS.knots + ' knots · ' + STATS.stars + ' stars · drawn in ' + STATS.ms + ' ms';\n",
           "  $('used').textContent = STATS.used + ' of your ' + TOTAL_DRAWINGS + ' drawings are in this galaxy';\n",
           "  var un = document.getElementById('unwrapnote'); if (un) un.style.display = P.unwrap ? 'flex' : 'none';\n",
           "  var pb = document.getElementById('play'); if (pb) pb.style.display = (P.merger || (P.lensOn && P.lensSource === 'quasar')) ? '' : 'none';\n",
           "  if (typeof tlUpdate === 'function') tlUpdate();\n"]:
    rep(ln,"")
rep("applyTheme(THEME);","")
rep("var AT = window.__ATLASES, REAL = window.__REAL,","var AT = window.__ATLASES, REAL = [],")
m=re.search(r"TEX\[name\] = t; if \(--pending === 0\) render\(\); \};", head); assert m
head=head.replace(m.group(0),"TEX[name] = t; if (--pending === 0) { READY.forEach(function (f) { f(); }); READY = []; } };")
rep("  var ds = Math.max(4, AT.dots.size[t]), want = clamp(1.9 + 0.045 * ds, 1.9, 3.4) * PEN.dot * (k || 1);",
    "  var ds = Math.max(4, AT.dots.size[t]), want = clamp(1.9 + 0.045 * ds, 1.9, 3.4) * PEN.dot * (k || 1) * (P.markDot || 1);")
rep("clamp(PEN.line * c.w * AT.strokes.h / AT.strokes.thick[c.k], 6, 90)","clamp(PEN.line * c.w * AT.strokes.h / AT.strokes.thick[c.k], 6, 90 * Math.max(1, PEN.line / 2.4))")
rep("nb = Math.round(1500 * S.M[g] * (1 + 3.5 * BUL[g]))","nb = Math.round(1500 * S.M[g] * (1 + 3.5 * BUL[g]) * Math.min(1, P.mStars / 11000))")
i=e2.index("/* ---------- iconic markers:"); j=e2.index("function parts(r) {",i)
rep("function parts(r) {", e2[i:j]+"function parts(r) {")
rep("  if (P.subject === 'star' || P.subject === 'artefact') {","  if (P.iconic) {\n    S = { old: [], disc: [], young: [], knots: [], stars: [], rstars: [] }; C = []; buildCurves(C, V, PIE); L = iconParts(mulberry32(P.seed * 57 + 3));\n  } else if (P.subject === 'star' || P.subject === 'artefact') {")
api=e2[e2.index("var raf = 0; function req() {}"):e2.rindex("})();")]
rep("var raf = 0; function req() { if (!raf) raf = requestAnimationFrame(function () { raf = 0; render(); }); }\nnew ResizeObserver(req).observe(cv);\n", api)
rep("Math.tan(clamp(pitch, 4, 60) * Math.PI / 180);","Math.tan((P.ood ? clamp(pitch, 0.5, 89.5) : clamp(pitch, 4, 60)) * Math.PI / 180);")
rep("clamp(P.pitch * sp.pk, 10, 70)","(P.ood ? clamp(P.pitch * sp.pk, 0.5, 89.5) : clamp(P.pitch * sp.pk, 10, 70))",2)
assert not re.search(r"\$\('", head), 'page references left'
open('/tmp/gen/engine4.js','w').write(head+'\n})();\n'); print('engine3 carved:', len(head)//1024,'KB')
