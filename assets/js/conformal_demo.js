/**
 * Hierarchical Conformal Prediction interactive demo (JSX, compiled in-browser by Babel).
 * Edit this file under assets/js/ — original lived at synthetic_experiment/conformal_demo.jsx.
 * Loaded on sect-fasttrip-psps tab "Hierarchical Conformal" via type="text/babel".
 */
/* global React, ReactDOM — loaded via UMD on the sect-fasttrip-psps page before Babel compiles this file */
const { useState, useCallback, useEffect, useRef } = React;

// ── KaTeX loader + Tex component ─────────────────────────────────────────────
function useKatex() {
  const [ready, setReady] = useState(typeof window !== "undefined" && !!window.katex);
  useEffect(() => {
    if (window.katex) { setReady(true); return; }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.css";
    document.head.appendChild(link);
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.js";
    script.onload = () => setReady(true);
    document.head.appendChild(script);
  }, []);
  return ready;
}

// Inline or display LaTeX. Falls back to plain text while KaTeX loads.
function Tex({ children, display = false, color, size }) {
  const ref = useRef(null);
  const ready = useKatex();
  useEffect(() => {
    if (!ready || !ref.current) return;
    try {
      window.katex.render(children, ref.current, {
        displayMode: display,
        throwOnError: false,
        trust: true,
      });
    } catch(e) {}
  }, [children, display, ready]);
  const style = {
    display: display ? "block" : "inline-block",
    overflowX: display ? "auto" : undefined,
    padding: display ? "2px 0" : undefined,
    color: color || "inherit",
    fontSize: size || "inherit",
    lineHeight: 1.4,
  };
  return <span ref={ref} style={style}>{!ready ? children : null}</span>;
}

// ── Seeded RNG ────────────────────────────────────────────────────────────────
function mulberry32(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function randNormal(rng) {
  const u = 1 - rng(), v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ── Simulation — score-level surrogate with experiment-matched method logic ──
// n circuit scores + G derived group-sum scores → J = n + G total
// Max-Score calibrates on all J constraints; baselines use only the n circuits.
// Individual scores: S_i ~ AR(1) Gaussian with within-group equicorrelation γ.
// Group-sum scores:  T_g = sum_{i in group g} S_i / sqrt(|g|)
// Score matrix rows: [S_1…S_n | T_1…T_G]
function simulate({ rhoAR, gamma, n, G, m, alpha, seed }) {
  const J = n + G;
  const rng = mulberry32(seed);

  // build equal-sized groups  (last group gets the remainder)
  const baseSize = Math.floor(n / G);
  const groups = Array.from({ length: G }, (_, g) => {
    const start = g * baseSize;
    const end   = g === G - 1 ? n : start + baseSize;
    return Array.from({ length: end - start }, (_, i) => start + i);
  });

  // draw one AR(1) row of n individual scores
  // within-group equicorrelation via per-group shared factor (matching group_noise γ in Python DGP)
  const a = Math.sqrt(Math.max(gamma, 0));
  const b = Math.sqrt(Math.max(1 - gamma, 1e-9));
  const circuitGroup = new Array(n);
  groups.forEach((grp, g) => grp.forEach(i => { circuitGroup[i] = g; }));
  function drawIndiv(prev) {
    const groupFactors = groups.map(() => randNormal(rng));
    const innov = Array.from({ length: n }, (_, i) => a * groupFactors[circuitGroup[i]] + b * randNormal(rng));
    if (!prev) return innov;
    return innov.map((v, i) => rhoAR * prev[i] + Math.sqrt(1 - rhoAR * rhoAR) * v);
  }

  // group-sum score for a row of individual scores (normalised by sqrt(groupSize))
  function groupScores(row) {
    return groups.map(g => g.reduce((s, i) => s + row[i], 0) / Math.sqrt(g.length));
  }

  // full score row: [S_1…S_n | T_1…T_G]
  function fullRow(indivRow) {
    return [...indivRow, ...groupScores(indivRow)];
  }

  // calibration set
  const S_cal = [];
  const S_circ_cal = [];
  let prevIndiv = null;
  for (let t = 0; t < m; t++) {
    const indiv = drawIndiv(prevIndiv);
    S_circ_cal.push(indiv);
    S_cal.push(fullRow(indiv));
    prevIndiv = indiv;
  }
  // test point (iid draw, no AR carry-over)
  const S_test_circ = drawIndiv(null);
  const S_test = fullRow(S_test_circ);

  function quantile(arr, q) {
    const s = [...arr].sort((a, b) => a - b);
    const idx = Math.min(Math.max(Math.ceil((arr.length + 1) * q) - 1, 0), arr.length - 1);
    return s[idx];
  }

  // Max-Score: envelope over all J columns
  const E_cal        = S_cal.map(row => Math.max(...row));
  const E_cal_sorted = [...E_cal].sort((a, b) => a - b);
  const tauMS        = quantile(E_cal, 1 - alpha);

  // Circuit-only Bonferroni: per-column quantile at 1 - alpha/n
  const colsSorted = Array.from({ length: n }, (_, j) =>
    S_circ_cal.map(r => r[j]).sort((a, b) => a - b)
  );
  const tauBonf = Array.from({ length: n }, (_, j) =>
    quantile(colsSorted[j], 1 - alpha / n)
  );

  // Circuit-only Max-Rank — compute ranks on the n circuit columns only
  const ranks = (() => {
    const colRanks = Array.from({ length: n }, (_, j) => {
      const col = S_circ_cal.map((r, t) => ({ v: r[j], t }));
      col.sort((a, b) => a.v - b.v);
      const rank = new Array(m);
      col.forEach((item, rank0) => { rank[item.t] = rank0 + 1; });
      return rank;
    });
    return S_circ_cal.map((_, t) => colRanks.map(colRank => colRank[t]));
  })();
  const rMaxVec    = ranks.map(r => Math.max(...r));
  const rMaxSorted = [...rMaxVec].sort((a, b) => a - b);
  const rStar      = quantile(rMaxVec, 1 - alpha);
  const rIdx       = Math.min(Math.max(Math.round(rStar) - 1, 0), m - 1);
  const tauMR      = Array.from({ length: n }, (_, j) => colsSorted[j][rIdx]);

  return {
    S_cal, S_test, E_cal, E_cal_sorted, tauMS, tauBonf, tauMR,
    rMaxVec, rMaxSorted, rStar, rIdx, colsSorted,
    S_circ_cal, S_test_circ,
    covMS:   S_test.every((s, j) => s <= tauMS),
    covBonf: S_test_circ.every((s, j) => s <= tauBonf[j]),
    covMR:   S_test_circ.every((s, j) => s <= tauMR[j]),
    widthMS:   tauMS,
    widthBonf: tauBonf.reduce((a, b) => a + b, 0) / n,
    widthMR:   tauMR.reduce((a, b) => a + b, 0) / n,
    n, G, J, m, alpha, groups,
  };
}

function runMC(rhoAR, gamma, n, G, m, alpha, reps) {
  let ms = 0, bonf = 0, mr = 0;
  let wMS = 0, wBonf = 0, wMR = 0;
  for (let s = 0; s < reps; s++) {
    const r = simulate({ rhoAR, gamma, n, G, m, alpha, seed: s * 13 + 3 });
    if (r.covMS)   ms++;
    if (r.covBonf) bonf++;
    if (r.covMR)   mr++;
    wMS   += r.widthMS;
    wBonf += r.widthBonf;
    wMR   += r.widthMR;
  }
  return {
    ms: ms / reps, bonf: bonf / reps, mr: mr / reps,
    widthMS: wMS / reps, widthBonf: wBonf / reps, widthMR: wMR / reps,
  };
}

// ── Palette — light / clean ───────────────────────────────────────────────────
const C = {
  ours:"#0a7c5c", bonf:"#c0440e", mr:"#8b2fa8",
  test:"#b07d00", nominal:"#1565c0",
  bg:"#ffffff", surface:"#f8f9fa", surface2:"#eef0f2",
  border:"#d0d5dd", text:"#1a1f2e", muted:"#6b7280",
  good:"#1a7f3c", bad:"#c0392b",
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function Slider({ label, value, min, max, step, onChange, color, fmt }) {
  return (
    <div style={{ marginBottom:10 }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
        <span style={{ fontSize:12, color:C.muted, fontFamily:"system-ui,sans-serif" }}>{label}</span>
        <span style={{ fontSize:12, color:color||C.text, fontWeight:600, fontFamily:"monospace",
          minWidth:42, textAlign:"right", display:"inline-block" }}>
          {fmt ? fmt(value) : value.toFixed(2)}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width:"100%", accentColor:color||C.ours, cursor:"pointer" }} />
    </div>
  );
}

function CovBar({ value, color, label, target }) {
  const pct = Math.round(value * 100);
  const ok  = value >= target;
  const tpct = Math.round(target * 100);
  return (
    <div style={{ marginBottom:10 }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
        <span style={{ color:C.muted, fontSize:12, fontFamily:"system-ui,sans-serif" }}>{label}</span>
        <span style={{ color:ok?color:C.bad, fontSize:13, fontWeight:700, fontFamily:"monospace" }}>{pct}%</span>
      </div>
      <div style={{ position:"relative", background:C.surface2, borderRadius:4, height:10 }}>
        <div style={{ width:`${pct}%`, height:"100%", borderRadius:4, background:ok?color:C.bad, transition:"width 0.5s ease" }} />
        <div style={{ position:"absolute", top:-3, bottom:-3, left:`${tpct}%`, width:2, background:C.nominal, borderRadius:1 }} />
      </div>
    </div>
  );
}

// ── HowItWorksDiagram ─────────────────────────────────────────────────────────
function HowItWorksDiagram({ sim, method }) {
  const { S_cal, S_test, S_test_circ, E_cal_sorted, tauMS, tauBonf, tauMR,
          rMaxSorted, rStar, colsSorted, J, n, G, m, alpha } = sim;
  const color = method==="ours" ? C.ours : method==="bonf" ? C.bonf : C.mr;

  const W = 260, NR = 12, CW = W / J, CH = 13;
  const matH = NR * CH;
  const rowStep = Math.max(1, Math.floor(m / NR));
  const allVals = S_cal.flat();
  const vMin = Math.min(...allVals), vMax = Math.max(...allVals);
  const heat = v => {
    const t = Math.max(0, Math.min(1, (v - vMin) / (vMax - vMin)));
    return `rgb(${Math.round(210-t*150)},${Math.round(225-t*120)},${Math.round(240-t*100)})`;
  };
  // group-sum columns get a warmer tint
  const heatGroup = v => {
    const t = Math.max(0, Math.min(1, (v - vMin) / (vMax - vMin)));
    return `rgb(${Math.round(240-t*100)},${Math.round(210-t*120)},${Math.round(190-t*80)})`;
  };

  // Circuit-only Bonferroni quantile index — used to mark the threshold dot on the series plot
  const bonfQIdx = Math.min(Math.max(Math.ceil((m+1)*(1-alpha/n))-1, 0), m-1);

  // Highlight cells that exceed each method's actual threshold — changes with alpha.
  // ours:  any cell >= tauMS  (single flat threshold)
  // bonf:  cell j >= tauBonf[j]  (per-column threshold at 1-alpha/n)
  // mr:    cell j >= tauMR[j]    (per-column threshold at rank r★)
  const isHitCell = (ri, j) => {
    const v = S_cal[ri][j];
    if (method === "ours") return v >= tauMS;
    const jc = Math.min(j, n-1);
    if (method === "bonf") return j < n && v >= tauBonf[jc];
    return j < n && v >= tauMR[jc];
  };

  let series, seriesLabel, seriesTau, seriesQIdx;
  if (method === "ours") {
    series = E_cal_sorted; seriesLabel = "Envelope  E_t = max_j S_j  (sorted)";
    seriesTau = tauMS; seriesQIdx = Math.min(Math.max(Math.ceil((m+1)*(1-alpha))-1,0),m-1);
  } else if (method === "bonf") {
    series = colsSorted[0]; seriesLabel = "Circuit scores  S_{j,t}  (j=0 example; group bounds ignored)";
    seriesTau = tauBonf[0]; seriesQIdx = bonfQIdx;
  } else {
    series = rMaxSorted; seriesLabel = "Circuit-only row-max rank  r_max[t] = max_{j <= n} rank(S_{j,t})";
    seriesTau = rStar; seriesQIdx = Math.min(Math.max(Math.ceil((m+1)*(1-alpha))-1,0),m-1);
  }

  // Vertical layout — both arrows exactly ARROW_LEN px, bar starts ARROW_GAP below tip
  const SERIES_H  = 54;
  const ARROW_LEN = 22;   // both arrows same length
  const ARROW_GAP = 18;   // gap between arrowhead tip and top of number-line bar

  const serTop    = matH + 38;
  const serBot    = serTop + SERIES_H;
  const serCapY   = serBot + 36;          // caption below series

  // Arrow 2 runs from serCapY+6 (tail) down ARROW_LEN px to arrowhead tip
  const arrow2Tip = serCapY + 6 + ARROW_LEN;
  // Number-line bar spans nlAxisY±10; top of bar = nlAxisY-10
  // We need nlAxisY-10 = arrow2Tip + ARROW_GAP  →  nlAxisY = arrow2Tip + ARROW_GAP + 10
  const nlAxisY   = arrow2Tip + ARROW_GAP + 10;
  const SVG_H     = nlAxisY + 44;

  // Downsample series to ≤200 display points to keep SVG lightweight
  const MAX_PTS = 200;
  const displaySeries = series.length <= MAX_PTS ? series :
    Array.from({length: MAX_PTS}, (_, i) => series[Math.round(i * (series.length-1) / (MAX_PTS-1))]);
  const displayQIdx = Math.round(seriesQIdx * (MAX_PTS-1) / (series.length-1));

  const sMin = Math.min(...displaySeries)*0.95, sMax = Math.max(...displaySeries)*1.05;
  const sx = i => (i/(displaySeries.length-1))*W;
  const sy = v => serBot - ((v-sMin)/(sMax-sMin))*SERIES_H;
  const nlMin = 0;
  const activeTest = method==="ours" ? Math.max(...S_test) : S_test_circ[0];
  const nlMax = method==="mr" ? Math.max(...rMaxSorted)*1.08 : Math.max(tauMS,...tauBonf,...tauMR,...S_test)*1.12;
  const nlX = v => (v-nlMin)/(nlMax-nlMin)*W;
  const finalTau = method==="ours" ? tauMS : method==="bonf" ? tauBonf[0] : tauMR[0];
  const covLocal = method==="ours" ? sim.covMS : method==="bonf" ? sim.covBonf : sim.covMR;

  const topMargin = 10;  // space for "indiv / group-sum" labels above matrix

  return (
    <svg viewBox={`0 -${topMargin} ${W} ${SVG_H + topMargin}`} width="100%" style={{ display:"block" }} preserveAspectRatio="xMidYMid meet">

      {/* Matrix */}
      {Array.from({ length: NR }, (_, yi) => {
        const ri = Math.min(yi*rowStep, m-1);
        return Array.from({ length: J }, (_, j) => {
          const v = S_cal[ri][j];
          const isHit = isHitCell(ri, j);
          const isGrp = j >= n;
          const fillColor = isGrp ? heatGroup(v) : heat(v);
          return (
            <g key={`${yi}-${j}`}>
              <rect x={j*CW} y={yi*CH} width={CW-0.8} height={CH-0.8} fill={fillColor} rx={1} opacity={isHit?1:(isGrp && method!=="ours" ? 0.16 : 0.4)}/>
              {isHit && method!=="bonf" && <rect x={j*CW} y={yi*CH} width={CW-0.8} height={CH-0.8} fill="none" stroke={color} strokeWidth={1.5} rx={1}/>}
              {isHit && method==="bonf" && <rect x={j*CW} y={yi*CH} width={CW-0.8} height={CH-0.8} fill={`${color}25`} stroke={color} strokeWidth={0.8} rx={1}/>}
            </g>
          );
        });
      })}

      {/* Divider between individual and group-sum columns */}
      <line x1={n*CW} y1={0} x2={n*CW} y2={matH} stroke={C.text} strokeWidth={1.5} opacity={0.5}/>
      {/* Section labels above matrix */}
      <text x={n*CW/2} y={-3} textAnchor="middle" fill={C.muted} fontSize={6.5} fontFamily="monospace">circuits (n={n})</text>
      <text x={n*CW + G*CW/2} y={-3} textAnchor="middle" fill="#8b5e2a" fontSize={6.5} fontFamily="monospace">group-sum (G={G}, ours only)</text>

      {/* Threshold cutoff lines — one horizontal mark per column at the first row that exceeds the threshold */}
      {method==="bonf" && Array.from({length:J},(_,j) => {
        for (let yi=0; yi<NR; yi++) {
          const ri = Math.min(yi*rowStep, m-1);
          if (isHitCell(ri, j)) return <line key={j} x1={j*CW} x2={(j+1)*CW-0.8} y1={yi*CH} y2={yi*CH} stroke={color} strokeWidth={2} opacity={0.9}/>;
        }
        return null;
      })}

      {/* Col labels */}
      {Array.from({length:J},(_,j) => (
        <text key={j} x={j*CW+CW/2} y={matH+10} textAnchor="middle" fill={C.muted} fontSize={7} fontFamily="monospace">{j}</text>
      ))}

      {/* Arrow 1: matrix → series — length = ARROW_LEN */}
      <line x1={W/2} y1={serTop-ARROW_LEN-5} x2={W/2} y2={serTop-5} stroke={color} strokeWidth={1} strokeDasharray="3,2" opacity={0.5}/>
      <polygon points={`${W/2-3},${serTop-5} ${W/2+3},${serTop-5} ${W/2},${serTop}`} fill={color} opacity={0.6}/>

      {/* Series plot */}
      <line x1={0} y1={serBot} x2={W} y2={serBot} stroke={C.border} strokeWidth={1}/>
      <polyline points={displaySeries.map((v,i)=>`${sx(i)},${sy(v)}`).join(" ")} fill="none" stroke={`${color}88`} strokeWidth={1.2}/>
      {displaySeries.map((v,i) => (
        <circle key={i} cx={sx(i)} cy={sy(v)} r={i===displayQIdx?4.5:1.5}
          fill={i===displayQIdx?color:`${color}66`}
          stroke={i===displayQIdx?"white":"none"} strokeWidth={i===displayQIdx?1:0}/>
      ))}
      <line x1={0} y1={sy(seriesTau)} x2={W} y2={sy(seriesTau)} stroke={color} strokeWidth={1.5} strokeDasharray="5,3" opacity={0.85}/>
      <line x1={sx(displayQIdx)} y1={sy(seriesTau)} x2={sx(displayQIdx)} y2={serBot} stroke={color} strokeWidth={1} strokeDasharray="2,2" opacity={0.5}/>
      <text x={Math.min(sx(displayQIdx)+3,W-56)} y={sy(seriesTau)-4} fill={color} fontSize={8} fontFamily="monospace" fontWeight="bold">
        {method==="mr" ? `r★=${Math.round(seriesTau)}` : `τ̂=${seriesTau.toFixed(2)}`}
      </text>

      {/* Series caption */}
      <text x={W/2} y={serCapY} textAnchor="middle" fill={color} fontSize={8} fontFamily="monospace">{seriesLabel}</text>

      {/* Arrow 2: caption → number line — same length as Arrow 1, gap before bar */}
      <line x1={W/2} y1={serCapY+6} x2={W/2} y2={arrow2Tip} stroke={color} strokeWidth={1} strokeDasharray="3,2" opacity={0.5}/>
      <polygon points={`${W/2-3},${arrow2Tip} ${W/2+3},${arrow2Tip} ${W/2},${arrow2Tip+5}`} fill={color} opacity={0.6}/>

      {/* Section label — sits in the ARROW_GAP between tip and bar */}
      <text x={0} y={arrow2Tip+10} fill={C.muted} fontSize={7.5} fontFamily="monospace">
        {method==="mr" ? "→ lookup circuit score at r★ per column:" : method==="ours" ? "→ envelope threshold vs max test score:" : "→ example circuit j=0 threshold vs test:"}
      </text>

      {/* Number line */}
      <line x1={0} y1={nlAxisY} x2={W} y2={nlAxisY} stroke={C.border} strokeWidth={1}/>
      {method !== "mr" && (() => {
        const tauX = nlX(finalTau), testX = nlX(activeTest);
        return (
          <g>
            <rect x={0} y={nlAxisY-8} width={Math.max(0,tauX)} height={16} fill={`${color}12`} rx={2}/>
            <line x1={tauX} y1={nlAxisY-12} x2={tauX} y2={nlAxisY+12} stroke={color} strokeWidth={2.5}/>
            <text x={Math.min(tauX,W-48)} y={nlAxisY-15} textAnchor="middle" fill={color} fontSize={8} fontFamily="monospace" fontWeight="bold">τ̂={finalTau.toFixed(2)}</text>
            <line x1={testX} y1={nlAxisY-10} x2={testX} y2={nlAxisY+10} stroke={C.test} strokeWidth={2} strokeDasharray="3,2"/>
            <text x={testX} y={nlAxisY+22} textAnchor="middle" fill={C.test} fontSize={8} fontFamily="monospace">{method==="ours" ? "max test" : "test j=0"}</text>
            <rect x={W-48} y={nlAxisY-10} width={46} height={17} rx={3} fill={covLocal?`${C.good}15`:`${C.bad}15`} stroke={covLocal?C.good:C.bad} strokeWidth={1}/>
            <text x={W-25} y={nlAxisY+3} textAnchor="middle" fill={covLocal?C.good:C.bad} fontSize={9} fontFamily="monospace" fontWeight="bold">{covLocal?"✓ PASS":"✗ FAIL"}</text>
          </g>
        );
      })()}
      {method === "mr" && (() => {
        const rStarX = nlX(rStar);
        return (
          <g>
            <rect x={0} y={nlAxisY-8} width={Math.max(0,rStarX)} height={16} fill={`${color}12`} rx={2}/>
            <line x1={rStarX} y1={nlAxisY-12} x2={rStarX} y2={nlAxisY+12} stroke={color} strokeWidth={2.5}/>
            <text x={Math.min(rStarX,W-52)} y={nlAxisY-15} textAnchor="middle" fill={color} fontSize={8} fontFamily="monospace" fontWeight="bold">r★={Math.round(rStar)}</text>
            <text x={0} y={nlAxisY+22} fill={C.muted} fontSize={8} fontFamily="monospace">score at rank {Math.round(rStar)} per col</text>
            <rect x={W-48} y={nlAxisY-10} width={46} height={17} rx={3} fill={covLocal?`${C.good}15`:`${C.bad}15`} stroke={covLocal?C.good:C.bad} strokeWidth={1}/>
            <text x={W-25} y={nlAxisY+3} textAnchor="middle" fill={covLocal?C.good:C.bad} fontSize={9} fontFamily="monospace" fontWeight="bold">{covLocal?"✓ PASS":"✗ FAIL"}</text>
          </g>
        );
      })()}
    </svg>
  );
}

// ── PerConstraintView ─────────────────────────────────────────────────────────
function PerConstraintView({ sim, width }) {
  const { S_test, tauMS, tauBonf, tauMR, J, n, G } = sim;
  const maxV = Math.max(tauMS,...tauBonf,...tauMR,...S_test)*1.08;
  const colW = (width-48)/J, H=110, padL=32, padT=28, padB=24;
  const sy = v => padT + H*(1-Math.max(0,v)/maxV);
  const svgH = H+padT+padB;
  const ticks = [0,maxV*0.25,maxV*0.5,maxV*0.75,maxV].map(v=>({v,y:sy(v),label:v.toFixed(1)}));
  return (
    <svg width={width} height={svgH} style={{display:"block"}}>
      {/* section background bands */}
      <rect x={padL} y={padT} width={n*colW} height={H} fill="#e8f4ff" opacity={0.4}/>
      <rect x={padL+n*colW} y={padT} width={G*colW} height={H} fill="#fff3e8" opacity={0.5}/>

      {ticks.map((tk,i)=>(
        <g key={i}>
          <line x1={padL} y1={tk.y} x2={width} y2={tk.y} stroke={C.border} strokeWidth={0.5} strokeDasharray="3,4"/>
          <text x={padL-3} y={tk.y+3} textAnchor="end" fill={C.muted} fontSize={7.5} fontFamily="monospace">{tk.label}</text>
        </g>
      ))}
      {Array.from({length:J},(_,j)=>{
        const x=padL+j*colW+colW/2, st=S_test[j], bw=colW*0.55;
        const jc=Math.min(j,n-1);
        const failMS=st>tauMS, failBonf=j<n&&st>tauBonf[jc], failMR=j<n&&st>tauMR[jc], anyFail=failMS||failBonf||failMR;
        const isGrp = j >= n;
        return (
          <g key={j}>
            <rect x={padL+j*colW} y={padT} width={colW} height={H} fill={j%2===0?"#00000008":"none"}/>
            <rect x={x-bw/2} y={sy(st)} width={bw} height={H-(sy(st)-padT)}
              fill={anyFail?"#ff000015":"#00000010"} stroke={anyFail?`${C.bad}88`:"#00000030"} strokeWidth={0.8} rx={1}/>
            <line x1={padL+j*colW+1} x2={padL+(j+1)*colW-1} y1={sy(tauMS)} y2={sy(tauMS)} stroke={C.ours} strokeWidth={2.5} opacity={0.9}/>
            {j<n && <line x1={x-bw*0.9} x2={x+bw*0.9} y1={sy(tauBonf[jc])} y2={sy(tauBonf[jc])} stroke={C.bonf} strokeWidth={2} strokeDasharray="4,2" opacity={0.9}/>}
            {j<n && <line x1={x-bw*0.75} x2={x+bw*0.75} y1={sy(tauMR[jc])} y2={sy(tauMR[jc])} stroke={C.mr} strokeWidth={2} strokeDasharray="1.5,3" opacity={0.9}/>}
            {failMS   && <polygon points={`${x-4},${padT} ${x+4},${padT} ${x},${padT+7}`} fill={C.ours} opacity={0.7}/>}
            {failBonf && j<n && <polygon points={`${x-4},${padT+9} ${x+4},${padT+9} ${x},${padT+16}`} fill={C.bonf} opacity={0.7}/>}
            {failMR   && j<n && <polygon points={`${x-4},${padT+18} ${x+4},${padT+18} ${x},${padT+25}`} fill={C.mr} opacity={0.7}/>}
            <text x={x} y={svgH-4} textAnchor="middle" fill={isGrp?"#8b5e2a":C.muted} fontSize={7.5} fontFamily="monospace">
              {isGrp ? `g${j-n}` : `${j}`}
            </text>
          </g>
        );
      })}

      {/* Divider between individual and group-sum */}
      <line x1={padL+n*colW} y1={padT-8} x2={padL+n*colW} y2={padT+H} stroke={C.text} strokeWidth={1.5} opacity={0.4} strokeDasharray="4,3"/>

      {/* Section headers */}
      <text x={padL+n*colW/2} y={padT-2} textAnchor="middle" fill={C.muted} fontSize={8} fontFamily="monospace">circuit constraints (n={n})</text>
      <text x={padL+n*colW+G*colW/2} y={padT-2} textAnchor="middle" fill="#8b5e2a" fontSize={8} fontFamily="monospace">group-sum constraints (G={G}, Max-Score only)</text>

      <line x1={padL} y1={padT} x2={padL} y2={padT+H} stroke={C.border} strokeWidth={1}/>
      <text x={padL+(width-padL)/2} y={svgH} textAnchor="middle" fill={C.muted} fontSize={9} fontFamily="monospace">constraint index j  (0–{n-1}: circuits for all methods · g0–g{G-1}: group-sum for Max-Score only)</text>
      <text x={padL+2} y={11} fill={C.ours} fontSize={8.5} fontFamily="monospace">── Ours</text>
      <text x={padL+52} y={11} fill={C.bonf} fontSize={8.5} fontFamily="monospace">╌╌ Bonferroni</text>
      <text x={padL+138} y={11} fill={C.mr} fontSize={8.5} fontFamily="monospace">·· Max-Rank</text>
      <text x={padL+220} y={11} fill={C.test} fontSize={8.5} fontFamily="monospace">▌ test score</text>
      <text x={padL+295} y={11} fill={C.bad} fontSize={8.5} fontFamily="monospace">▲ fail</text>
    </svg>
  );
}

// ── Shared UI components (defined outside App to avoid remount on every render) ─
const MC_BTN = {
  width: 220,
  minHeight: 42,
  padding: "10px 12px",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  fontFamily: "system-ui,sans-serif",
  cursor: "pointer",
  boxSizing: "border-box",
};

function Controls({ rhoAR, setRhoAR, gamma, setGamma, alpha, setAlpha, seed, setSeed }) {
  const card = { background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:16 };
  return (
    <div style={{ ...card, display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:16, marginTop:24 }}>
      <Slider label="ρ_AR — temporal dependence" value={rhoAR} min={0} max={0.95} step={0.05} onChange={setRhoAR} color={C.bonf}/>
      <Slider label="γ — within-group noise corr." value={gamma} min={0} max={0.95} step={0.05} onChange={setGamma} color={C.nominal}/>
      <Slider label="α — miscoverage target" value={alpha} min={0.03} max={0.30} step={0.01} onChange={setAlpha} color={C.text}/>
      <div>
        <Slider label="Seed" value={seed} min={1} max={200} step={1} onChange={setSeed} color={C.muted} fmt={v => String(Math.round(v))}/>
        <button onClick={() => setSeed(s => (s%200)+1)} style={{
          width:"100%", padding:"5px 0", background:"white",
          border:`1px solid ${C.border}`, borderRadius:6,
          color:C.muted, cursor:"pointer", fontSize:12, fontFamily:"system-ui,sans-serif",
        }}>↺ New sample</button>
      </div>
    </div>
  );
}

/** Monte Carlo tab: same 4 sliders as Controls, then Replications (1 col width) + Run MC + New sample (matched size). */
function MonteCarloControls({
  rhoAR, setRhoAR, gamma, setGamma, alpha, setAlpha, seed, setSeed,
  mcReps, setMcReps, doMC, mcBusy,
}) {
  const card = { background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:16 };
  return (
    <div style={{ ...card, display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:16, marginTop:0, marginBottom:24 }}>
      <Slider label="ρ_AR — temporal dependence" value={rhoAR} min={0} max={0.95} step={0.05} onChange={setRhoAR} color={C.bonf}/>
      <Slider label="γ — within-group noise corr." value={gamma} min={0} max={0.95} step={0.05} onChange={setGamma} color={C.nominal}/>
      <Slider label="α — miscoverage target" value={alpha} min={0.03} max={0.30} step={0.01} onChange={setAlpha} color={C.text}/>
      <Slider label="Seed" value={seed} min={1} max={200} step={1} onChange={setSeed} color={C.muted} fmt={v => String(Math.round(v))}/>

      <div style={{ gridColumn:"1 / 2" }}>
        <Slider label="Replications" value={mcReps} min={100} max={2000} step={100}
          onChange={v => { setMcReps(Math.round(v)); }}
          color={C.nominal} fmt={v => String(Math.round(v))}/>
      </div>
      <div style={{ gridColumn:"2 / 3", display:"flex", flexDirection:"column", justifyContent:"flex-end", paddingBottom:2 }}>
        <button type="button" onClick={doMC} disabled={mcBusy} style={{
          ...MC_BTN,
          cursor: mcBusy ? "default" : "pointer",
          background: mcBusy ? C.surface2 : "white",
          border: `1.5px solid ${mcBusy ? C.border : C.ours}`,
          color: mcBusy ? C.muted : C.ours,
          transition: "color 0.2s, border-color 0.2s, background 0.2s",
        }}>
          {mcBusy ? `⟳  Running…` : `▶  Run Monte Carlo`}
        </button>
      </div>
      <div style={{ gridColumn:"3 / 4", display:"flex", flexDirection:"column", justifyContent:"flex-end", paddingBottom:2 }}>
        <button type="button" onClick={() => setSeed(s => (s % 200) + 1)} style={{
          ...MC_BTN,
          background: "white",
          border: `1.5px solid ${C.border}`,
          color: C.muted,
        }}>↺ New sample</button>
      </div>
    </div>
  );
}

function CoverageStrip({ methodsMeta, mt=0, mb=20 }) {
  const card = (extra={}) => ({ background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:16, ...extra });
  return (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(3,minmax(0,1fr))", gap:16, marginTop:mt, marginBottom:mb }}>
      {methodsMeta.map(mth => (
        <div key={mth.key} style={{ ...card({ padding:"12px 16px" }), borderTopWidth:3, borderTopColor: mth.color }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
            <span style={{ fontSize:13, fontWeight:600, color:C.text }}>{mth.name}</span>
            <span style={{
              fontSize:12, fontWeight:700, fontFamily:"monospace",
              color: mth.cov ? C.good : C.bad,
              background: mth.cov ? `${C.good}15` : `${C.bad}12`,
              padding:"2px 10px", borderRadius:4,
              border:`1px solid ${mth.cov ? C.good : C.bad}44`,
            }}>{mth.cov ? "✓ COVERED" : "✗ MISS"}</span>
          </div>
          <span style={{ fontSize:12, color:C.muted, display:"flex", alignItems:"center", gap:4 }}>
            <Tex>{`\\bar{\\hat{\\tau}}`}</Tex> = <span style={{ color:mth.color, fontWeight:600, fontFamily:"monospace" }}>{mth.tau.toFixed(3)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
function App() {
  const [rhoAR,  setRhoAR]  = useState(0.40);  // matches the synthetic-study baseline rho
  const [gamma,  setGamma]  = useState(0.00);  // matches the baseline group-noise setting
  const [alpha,    setAlpha]    = useState(0.10);
  const [seed,     setSeed]     = useState(19);
  const [tab,      setTab]      = useState("howit");
  const [mcRes,    setMcRes]    = useState(null);
  const [mcBusy,   setMcBusy]   = useState(false);
  const [mcReps,   setMcReps]   = useState(400);

  // Sliders: do not clear MC results until the user runs Monte Carlo again
  const setP = (setter) => (v) => { setter(v); };

  const n = 25, G = 5, m = 300;  // matches the baseline synthetic configuration
  const sim = simulate({ rhoAR, gamma, n, G, m, alpha, seed });
  const { J } = sim;

  const doMC = useCallback(() => {
    setMcBusy(true);
    setTimeout(() => { setMcRes(runMC(rhoAR, gamma, n, G, m, alpha, mcReps)); setMcBusy(false); }, 20);
  }, [rhoAR, gamma, alpha, mcReps]);

  const TABS = [
    ["howit",   "① How Each Method Picks Its Boundary"],
    ["compare", "② All Methods Side-by-Side"],
    ["mc",      "③ Monte Carlo Coverage"],
  ];

  // Shared styles
  const card = (extra={}) => ({
    background: C.surface, border:`1px solid ${C.border}`, borderRadius:8,
    padding:16, ...extra,
  });
  const sectionGap = { marginBottom:20 };
  const label = (extra={}) => ({ fontSize:12, color:C.muted, fontFamily:"system-ui,sans-serif", ...extra });
  const heading = (extra={}) => ({ fontSize:13, fontWeight:600, color:C.text, fontFamily:"system-ui,sans-serif", marginBottom:8, ...extra });

  const methodsMeta = [
    {
      key:"ours", color:C.ours, name:"Max-Score (Ours)", cov:sim.covMS, tau:sim.widthMS,
      tagline:"One τ̂ on the joint envelope of all n+G constraints",
      formula:`\\hat{\\tau} = Q_{1-\\alpha}\\bigl(\\max_{j} S_{j,t}\\bigr), \\quad j \\in \\{1,\\ldots,J\\}`,
      step1:`Compute E_t = max score across all J=${J} constraints (${n} circuits + ${G} group-sum) for each calibration row.`,
      step2:`Sort {E_t} and take the (1−α) = ${(1-alpha).toFixed(2)} quantile → τ̂ = ${sim.tauMS.toFixed(3)}. One value covers ALL constraints simultaneously.`,
      step3:`At test time: covered if all J test scores ≤ τ̂ (single flat threshold).`,
      why:`This is the only method here that gets to use the extra group-sum bounds. The envelope automatically blends circuit and group information into one threshold.`,
      strength:"Multiscale: circuits + groups",
      weakness:"Slightly wide when J is small and constraints are independent",
    },
    {
      key:"bonf", color:C.bonf, name:"Bonferroni", cov:sim.covBonf, tau:sim.widthBonf,
      tagline:`Circuit-only union bound — n=${n} separate thresholds at level α/n`,
      formula:`\\hat{\\tau}_j = Q_{1-\\alpha/n}\\bigl(S_{j,t}\\bigr), \\quad j \\in \\{1,\\ldots,n\\}, \\; \\alpha/n = ${(alpha/n).toFixed(4)}`,
      step1:`Only the n=${n} circuit columns are calibrated. The extra G=${G} group-sum bounds are not used by this baseline.`,
      step2:`For each circuit j: sort its m=${m} scores, take the (1−α/n) = ${(1-alpha/n).toFixed(4)} quantile → τ̂_j. Example circuit 0: ${sim.tauBonf[0].toFixed(3)}.`,
      step3:`Covered if each circuit test score is ≤ τ̂_j. Group-sum constraints are ignored.`,
      why:`Classical union bound over circuit constraints only. It is simple, but it never gets the extra hierarchical information that Max-Score uses.`,
      strength:"Simple circuit-level baseline",
      weakness:"No group-level protection",
    },
    {
      key:"mr", color:C.mr, name:"Max-Rank (Timans 2025)", cov:sim.covMR, tau:sim.widthMR,
      tagline:"Circuit-only rank correction over the n circuit columns",
      formula:`r^\\star = Q_{1-\\alpha}\\bigl(\\max_{j \\le n} \\mathrm{rank}(S_{j,t})\\bigr) = ${Math.round(sim.rStar)}, \\quad \\hat{\\tau}_j = \\mathrm{col}_j[r^\\star]`,
      step1:`Compute within-column ranks using only the n=${n} circuit columns. The G=${G} group-sum bounds are ignored.`,
      step2:`Take row-max-rank r_max[t] = max_j rank. Find the (1−α) = ${(1-alpha).toFixed(2)} quantile → r★ = ${Math.round(sim.rStar)} (out of m=${m}).`,
      step3:`τ̂_j = score at rank r★ in sorted circuit column j. Coverage is checked on circuits only; group-sum constraints are ignored.`,
      why:`This can be less conservative than Bonferroni on circuit scores, but it still does not enforce the extra group-level bounds, and temporal dependence can miscalibrate r★.`,
      strength:"Less conservative circuit-only baseline",
      weakness:"No group-level protection; fragile under AR dependence",
    },
  ];

  const tabSty = k => ({
    padding:"9px 20px", border:"none", cursor:"pointer",
    fontFamily:"system-ui,sans-serif", fontSize:13,
    fontWeight: tab===k ? 600 : 400,
    background: "transparent",
    color: tab===k ? C.ours : C.muted,
    borderBottom: tab===k ? `2px solid ${C.ours}` : "2px solid transparent",
    transition:"all 0.15s",
  });

  return (
    <div style={{ background:C.bg, minHeight:"100vh", color:C.text, fontFamily:"system-ui,sans-serif", padding:"24px 28px", boxSizing:"border-box", maxWidth:"100%", overflowX:"hidden" }}>

      {/* Header */}
      <div style={{ marginBottom:24 }}>
        <h1 style={{ margin:"0 0 4px", fontSize:20, fontWeight:700, color:C.text, fontFamily:"system-ui,sans-serif", letterSpacing:"-0.3px" }}>
          Hierarchical Conformal Prediction
        </h1>
        <p style={{ color:C.muted, fontSize:13, margin:0 }}>
          How each method picks its boundary — n={n} circuit constraints + G={G} extra group bounds available (J={J} total) · only Max-Score uses all J
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display:"flex", gap:0, borderBottom:`1px solid ${C.border}`, marginBottom:24 }}>
        {TABS.map(([k,lbl]) => (
          <button key={k} style={tabSty(k)} onClick={() => setTab(k)}>{lbl}</button>
        ))}
      </div>

      {/* ── TAB 1 ── */}
      {tab === "howit" && (
        <div>
          <p style={{ ...label(), margin:"0 0 20px", lineHeight:1.6 }}>
            The demo shows one shared m×J score matrix with <strong>n={n} circuit</strong> scores (blue) and <strong>G={G} group-sum</strong> scores (orange).
            <strong>Max-Score</strong> calibrates on all J={J} columns, while <strong>Bonferroni</strong> and <strong>Max-Rank</strong> ignore the orange group columns and use only the n={n} circuit scores.
          </p>

          {/* Coverage strip — above method cards */}

          {/* Text cards */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,minmax(0,1fr))", gap:16, alignItems:"start", ...sectionGap }}>
            {methodsMeta.map(mth => (
              <div key={mth.key} style={{ ...card(), borderTopWidth:3, borderTopColor:mth.color, minWidth:0, overflowX:"hidden" }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                  <span style={{ fontSize:14, fontWeight:700, color:mth.color }}>{mth.name}</span>
                </div>
                <p style={{ ...label(), margin:"0 0 8px" }}>{mth.tagline}</p>
                <div style={{ padding:"8px 12px", background:C.surface2, borderRadius:5, marginBottom:12, borderLeft:`3px solid ${mth.color}`, overflowX:"auto" }}>
                  <Tex display color={mth.color}>{mth.formula}</Tex>
                </div>
                {[mth.step1, mth.step2, mth.step3].map((s, i) => (
                  <div key={i} style={{ display:"flex", gap:8, marginBottom:6 }}>
                    <div style={{ minWidth:18, height:18, borderRadius:"50%", background:mth.color, display:"flex", flexShrink:0, alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:700, color:"white" }}>
                      {i+1}
                    </div>
                    <span style={{ fontSize:12, color:C.muted, lineHeight:1.5 }}>{s}</span>
                  </div>
                ))}
                <div style={{ marginTop:10, padding:"6px 10px", borderLeft:`3px solid ${C.border}`, fontSize:12, color:C.muted, lineHeight:1.5 }}>
                  {mth.why}
                </div>
                <div style={{ marginTop:10, display:"flex", gap:6, flexWrap:"wrap" }}>
                  <span style={{ fontSize:11, padding:"2px 8px", borderRadius:4, background:`${C.good}15`, color:C.good, border:`1px solid ${C.good}44` }}>✓ {mth.strength}</span>
                  <span style={{ fontSize:11, padding:"2px 8px", borderRadius:4, background:`${C.bad}12`, color:C.bad, border:`1px solid ${C.bad}44` }}>✗ {mth.weakness}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Diagrams */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,minmax(0,1fr))", gap:16, ...sectionGap }}>
            {methodsMeta.map(mth => (
              <div key={mth.key} style={{ ...card(), borderTopWidth:3, borderTopColor:mth.color, minWidth:0 }}>
                <p style={{ ...label({ fontWeight:600, marginBottom:8 }) }}>MATRIX → SERIES → THRESHOLD</p>
                <HowItWorksDiagram sim={sim} method={mth.key} />
              </div>
            ))}
          </div>

          {/* Coverage strip — after diagrams */}
          <CoverageStrip methodsMeta={methodsMeta} mt={0} mb={20}/>

          {/* Hint — same card style, nominal top border */}
          <div style={{ ...card({ padding:"12px 16px" }), borderTopWidth:3, borderTopColor:C.nominal, marginBottom:0 }}>
            <span style={{ fontWeight:600, color:C.nominal, fontSize:13 }}>💡 Try: </span>
            <span style={{ color:C.muted, fontSize:13 }}>
              {rhoAR > 0.5
                ? `ρ_AR=${rhoAR.toFixed(2)} — rows are temporally correlated. In the Max-Rank diagram, row-max-ranks are no longer i.i.d. → r★ is wrong → under-coverage.`
                : gamma > 0.5
                ? `γ=${gamma.toFixed(2)} — within-group correlation makes the orange group columns informative. Max-Score gets to use them; the baselines still ignore them.`
                : `Push ρ_AR → 0.9 to stress Max-Rank's exchangeability assumption. Push γ → 0.9 to make the extra group bounds more useful for Max-Score.`}
            </span>
          </div>

          <Controls rhoAR={rhoAR} setRhoAR={setP(setRhoAR)} gamma={gamma} setGamma={setP(setGamma)} alpha={alpha} setAlpha={setP(setAlpha)} seed={seed} setSeed={setP(setSeed)}/>
        </div>
      )}

      {/* ── TAB 2 ── */}
      {tab === "compare" && (
        <div>
          <p style={{ ...label(), margin:"0 0 20px", lineHeight:1.6 }}>
            Same data, all three methods overlaid. Each bar is the test score for constraint j.
            Orange group-sum bars matter only for Max-Score; the two baselines calibrate and evaluate on the blue circuit bars only.
          </p>

          <div style={{ ...card(), ...sectionGap, overflowX:"auto" }}>
            <PerConstraintView sim={sim} width={760}/>
          </div>

          {/* Coverage strip — above threshold anatomy */}
          <CoverageStrip methodsMeta={methodsMeta} mt={0} mb={20}/>

          {/* Threshold anatomy */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,minmax(0,1fr))", gap:16, alignItems:"start", ...sectionGap }}>
            {methodsMeta.map(mth => {
              const taus = mth.key==="ours" ? Array(J).fill(sim.tauMS) : mth.key==="bonf" ? sim.tauBonf : sim.tauMR;
              const lo = Math.min(...taus), hi = Math.max(...taus);
              return (
                <div key={mth.key} style={{ ...card(), borderTopWidth:3, borderTopColor:mth.color, minWidth:0 }}>
                  <div style={{ ...heading(), color:mth.color }}>{mth.name}</div>
                  <div style={{ fontSize:12, color:C.muted, lineHeight:1.9 }}>
                    <div>Shape: <span style={{ color:C.text }}>{mth.key==="ours" ? "flat — one τ̂ for all j" : "per-column — τ̂_j varies with j"}</span></div>
                    <div>min τ̂_j: <span style={{ color:mth.color, fontWeight:600 }}>{lo.toFixed(3)}</span></div>
                    <div>max τ̂_j: <span style={{ color:mth.color, fontWeight:600 }}>{hi.toFixed(3)}</span></div>
                    <div>Spread: <span style={{ color:C.text }}>{(hi-lo).toFixed(3)}{mth.key==="ours" && <span style={{ color:C.good }}> (zero by design)</span>}</span></div>
                  </div>
                  <div style={{ marginTop:8, padding:"6px 10px", background:C.surface2, borderRadius:5, fontSize:12, color:C.muted, lineHeight:1.5 }}>
                    {mth.key==="ours" && `Single envelope quantile over all J=${J} circuit-plus-group constraints.`}
                    {mth.key==="bonf" && `Only the n=${n} circuit columns are calibrated, each at 1−α/n = ${(1-alpha/n).toFixed(4)}.`}
                    {mth.key==="mr"   && `Only the n=${n} circuit columns share rank index r★=${Math.round(sim.rStar)}.`}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Width ranking */}
          <div style={{ ...card(), ...sectionGap }}>
            <div style={{ ...heading() }}>Threshold width ranking within each method's active constraint set</div>
            {[
              { label:"Ours (Max-Score)", val:sim.widthMS, color:C.ours },
              { label:"Bonferroni",       val:sim.widthBonf, color:C.bonf },
              { label:"Max-Rank",         val:sim.widthMR,   color:C.mr  },
            ].sort((a,b)=>b.val-a.val).map((row,i)=>{
              const mx = Math.max(sim.widthMS, sim.widthBonf, sim.widthMR);
              return (
                <div key={row.label} style={{ marginBottom:12 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                    <span style={{ color:C.muted, fontSize:13 }}>{i===0?"Widest":i===2?"Tightest":"Middle"}: {row.label}</span>
                    <span style={{ color:row.color, fontSize:13, fontWeight:700, fontFamily:"monospace" }}>{row.val.toFixed(3)}</span>
                  </div>
                  <div style={{ background:C.surface2, borderRadius:4, height:8 }}>
                    <div style={{ width:`${(row.val/mx)*100}%`, height:"100%", borderRadius:4, background:row.color, transition:"width 0.4s" }}/>
                  </div>
                </div>
              );
            })}
            {sim.widthMS < sim.widthBonf && (
              <p style={{ fontSize:12, color:C.ours, margin:"4px 0 0" }}>
                Even while covering the extra group bounds, Max-Score is {((sim.widthBonf-sim.widthMS)/sim.widthBonf*100).toFixed(1)}% tighter than Bonferroni on this sample.
              </p>
            )}
          </div>

          <Controls rhoAR={rhoAR} setRhoAR={setP(setRhoAR)} gamma={gamma} setGamma={setP(setGamma)} alpha={alpha} setAlpha={setP(setAlpha)} seed={seed} setSeed={setP(setSeed)}/>
        </div>
      )}

      {/* ── TAB 3 ── */}
      {tab === "mc" && (
        <div>
          <p style={{ ...label(), margin:"0 0 16px", lineHeight:1.6 }}>
            {mcReps} independent replications with the current parameters (ρ_AR={rhoAR.toFixed(2)}, γ={gamma.toFixed(2)}, α={alpha.toFixed(2)}).
            Coverage targets differ by method: <strong>Max-Score</strong> must cover all J={J} circuit-plus-group constraints, while the two baselines are evaluated on the n={n} circuit constraints only.
            Each method still targets joint coverage <Tex>{`\\geq 1-\\alpha = ${((1-alpha)*100).toFixed(0)}\\%`}</Tex> for the constraint set it uses.
          </p>

          <MonteCarloControls
            rhoAR={rhoAR} setRhoAR={setP(setRhoAR)}
            gamma={gamma} setGamma={setP(setGamma)}
            alpha={alpha} setAlpha={setP(setAlpha)}
            seed={seed} setSeed={setP(setSeed)}
            mcReps={mcReps} setMcReps={setMcReps}
            doMC={doMC} mcBusy={mcBusy}
          />

          {mcRes && (
            <>
              <div style={{ ...card(), ...sectionGap }}>
                <div style={{ ...heading() }}>Empirical joint coverage for each method's target event — blue tick = {((1-alpha)*100).toFixed(0)}%</div>
                <CovBar value={mcRes.ms}   color={C.ours} label="Ours (Max-Score)" target={1-alpha}/>
                <CovBar value={mcRes.bonf} color={mcRes.bonf >= 1-alpha ? C.ours : C.bonf} label="Bonferroni"       target={1-alpha}/>
                <CovBar value={mcRes.mr}   color={mcRes.mr >= 1-alpha ? C.ours : C.mr}   label="Max-Rank"         target={1-alpha}/>
              </div>

              <div style={{ display:"grid", gridTemplateColumns:"repeat(3,minmax(0,1fr))", gap:16, ...sectionGap }}>
                {[
                  { label:"Ours", val:mcRes.ms, color:C.ours,
                    ok: mcRes.ms >= 1-alpha,
                    verdict: mcRes.ms >= 1-alpha ? "Valid on circuits + groups" : "Under-covers",
                    note:"Uses the full circuit-plus-group constraint set. This is the multiscale target method." },
                  { label:"Bonferroni", val:mcRes.bonf, color:C.bonf,
                    ok: mcRes.bonf >= 1-alpha,
                    verdict: mcRes.bonf >= 1-alpha ? "Valid on circuits" : "Under-covers",
                    note: rhoAR>0.5 ? "Circuit-only union bound. It still ignores the group constraints that Max-Score enforces." : "Simple circuit-only baseline; ignores the extra group bounds." },
                  { label:"Max-Rank", val:mcRes.mr, color:C.mr,
                    ok: mcRes.mr >= 1-alpha,
                    verdict: mcRes.mr >= 1-alpha ? "Valid on circuits" : "Under-covers",
                    note: rhoAR>0.3
                      ? `ρ_AR=${rhoAR.toFixed(2)} breaks row exchangeability → ranks not i.i.d. → r★ miscalibrated. Group bounds are ignored here too.`
                      : `Circuit-only rank baseline. It does not enforce the extra group constraints.` },
                ].map(row => (
                  <div key={row.label} style={{
                    ...card({ padding:"16px", textAlign:"center" }),
                    borderTopWidth:3, borderTopColor: row.ok ? C.ours : C.bad,
                  }}>
                    <div style={{ fontSize:13, fontWeight:600, color:C.text, marginBottom:6 }}>{row.label}</div>
                    <div style={{ fontSize:32, fontWeight:700, fontFamily:"monospace", color:row.ok?C.ours:C.bad, marginBottom:4 }}>
                      {(row.val*100).toFixed(1)}%
                    </div>
                    <div style={{ fontSize:12, color:row.ok?C.good:C.bad, fontWeight:600, marginBottom:8 }}>{row.verdict}</div>
                    <div style={{ fontSize:12, color:C.muted, lineHeight:1.5 }}>{row.note}</div>
                  </div>
                ))}
              </div>

              <div style={{ ...card({ padding:"12px 16px" }), borderTopWidth:3, borderTopColor:C.nominal, marginBottom:0 }}>
                <span style={{ fontWeight:600, color:C.nominal, fontSize:13 }}>Interpretation: </span>
                <span style={{ fontSize:13, color:C.muted, lineHeight:1.6 }}>
                  {rhoAR>0.5 && mcRes.mr < 1-alpha
                    ? `Max-Rank under-covers at ρ_AR=${rhoAR.toFixed(2)}: AR correlation means calibration rows are not exchangeable. Max-Score still has the advantage of enforcing the extra group bounds.`
                    : gamma>0.5
                    ? `High γ=${gamma.toFixed(2)} makes the extra group-sum constraints informative. Max-Score is the only method here that gets to use them.`
                    : `Near-independence baseline. The two baselines remain circuit-only, while Max-Score keeps the stricter circuit-plus-group target.`}
                </span>
              </div>

            </>
          )}

          {!mcRes && (
            <div style={{ textAlign:"center", padding:"40px 0", color:C.muted, fontSize:13 }}>
              Click Run to estimate empirical coverage over {mcReps} replications.
            </div>
          )}

          {/* Width ranking — only after MC run */}
          {mcRes ? (
            <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:16, marginTop:20 }}>
              <div style={{ fontSize:13, fontWeight:600, color:C.text, fontFamily:"system-ui,sans-serif", marginBottom:4 }}>
                Threshold width ranking — average over {mcReps} MC reps
              </div>
              <div style={{ fontSize:11, color:C.muted, marginBottom:10 }}>Average <Tex>{`\\hat{\\tau}`}</Tex> across the constraints each method actually uses. Max-Score uses J={J}; the baselines use n={n} circuits.</div>
              {[
                { label:"Ours (Max-Score)", val: mcRes.widthMS,   color:C.ours },
                { label:"Bonferroni",        val: mcRes.widthBonf, color:C.bonf },
                { label:"Max-Rank",          val: mcRes.widthMR,   color:C.mr   },
              ].sort((a,b)=>b.val-a.val).map((row,i)=>{
                const mx = Math.max(mcRes.widthMS, mcRes.widthBonf, mcRes.widthMR);
                return (
                  <div key={row.label} style={{ marginBottom:12 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                      <span style={{ color:C.muted, fontSize:13 }}>{i===0?"Widest":i===2?"Tightest":"Middle"}: {row.label}</span>
                      <span style={{ color:row.color, fontSize:13, fontWeight:700, fontFamily:"monospace" }}>{row.val.toFixed(3)}</span>
                    </div>
                    <div style={{ background:C.surface2, borderRadius:4, height:8 }}>
                      <div style={{ width:`${(row.val/mx)*100}%`, height:"100%", borderRadius:4, background:row.color, transition:"width 0.4s" }}/>
                    </div>
                  </div>
                );
              })}
              {mcRes.widthMS < mcRes.widthBonf && (
                <p style={{ fontSize:12, color:C.ours, margin:"4px 0 0" }}>
                  Even while covering the extra group bounds, Max-Score is {((mcRes.widthBonf - mcRes.widthMS) / mcRes.widthBonf * 100).toFixed(1)}% tighter than Bonferroni on average.
                </p>
              )}
            </div>
          ) : (
            <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:16, marginTop:20, color:C.muted, fontSize:13, textAlign:"center" }}>
              Run MC to see average threshold widths over {mcReps} replications.
            </div>
          )}

        </div>
      )}

      {/* Footer */}
      <div style={{ marginTop:32, paddingTop:16, borderTop:`1px solid ${C.border}`, display:"flex", justifyContent:"space-between" }}>
        <span style={{ fontSize:12, color:C.muted }}>n={n} circuits · G={G} group bounds · J={J} total available · m={m} · α={alpha.toFixed(2)} · ρ_AR={rhoAR.toFixed(2)} · γ={gamma.toFixed(2)} · seed={seed}</span>
        <span style={{ fontSize:12, color:C.muted }}>Hierarchical Conformal Coverage</span>
      </div>
    </div>
  );
}

const _conformalRootEl = document.getElementById("conformal-demo-root");
if (_conformalRootEl && typeof ReactDOM !== "undefined") {
  if (ReactDOM.createRoot) {
    ReactDOM.createRoot(_conformalRootEl).render(<App />);
  } else if (ReactDOM.render) {
    ReactDOM.render(<App />, _conformalRootEl);
  }
}
