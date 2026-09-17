/* app.js — CCE vs VMI dashboard logic. Vanilla JS, no dependencies. */
(function(){
"use strict";
var R = window.REPORT;
if(!R){ document.getElementById("view").innerHTML = '<p class="muted">data.js missing.</p>'; return; }
var ROWS = R.rows;
var META = R.meta;
var SUM = R.summary;
var MATCHED = ROWS.filter(function(r){ return r.vmi && r.vmi.ex != null && !r.excluded; });
var CCEONLY = ROWS.filter(function(r){ return !(r.vmi && r.vmi.ex != null) && !r.excluded; });
var EXCLUDED = ROWS.filter(function(r){ return !!r.excluded; });

// Source-code links into the pto-vmi repo on gitcode (kernel dirs mirror on both sides:
// cce/<Kernel>/ and dsl/<Kernel>/). Used in the detail modal so any kernel is one click
// from its source. Canonical gitcode /tree/main/<path> form.
var PTO_VMI_REPO_URL = "https://gitcode.com/csjlchen/pto-vmi/tree/";
function ptoVmiCommit(){ return (META && META.pto_vmi_commit) ? META.pto_vmi_commit : "main"; }
function srcUrl(kernel, side){ return PTO_VMI_REPO_URL + ptoVmiCommit() + "/" + side + "/" + encodeURIComponent(kernel); }

document.getElementById("hdr-matched").textContent = META.matched_pairs || R.matched_count || MATCHED.length;
var smc=document.getElementById("sum-matched-count"); if(smc) smc.textContent=MATCHED.length;
// Footer — all counts + versions are dynamic (was previously hardcoded and stale)
function initFooter(){
  var set=function(id,v){ var n=document.getElementById(id); if(n) n.textContent=v; };
  set("ft-cce-cases", META.cce_cases_total || ROWS.length);
  set("ft-matched", MATCHED.length);
  set("ft-cceonly", META.cce_only_count || CCEONLY.length);
  set("ft-excluded", META.excluded_count || EXCLUDED.length);
  set("ft-commit", META.pto_vmi_short_commit || META.pto_vmi_commit || "main");
  set("ft-ptoas", META.ptoas_version || "PTOAS");
  set("ft-cann", META.cann_version || "CANN");
}
initFooter();
// Raw Report is now a footer link (no tab) — renders the markdown into the view
function showRawReport(){
  document.querySelectorAll(".tab").forEach(function(t){ t.classList.remove("active"); });
  currentView = "report";
  render("report");
}
var ftReport = document.getElementById("ft-report-link");
if(ftReport) ftReport.addEventListener("click", function(e){ e.preventDefault(); showRawReport(); });
// data freshness indicator on the homepage
(function(){
  var el2=document.getElementById("data-freshness"); if(!el2) return;
  var bd=META.build_date, bt=META.build_timestamp;
  var commit=META.pto_vmi_short_commit||META.pto_vmi_commit||"?";
  var dStatus=META.daily_status||"unknown";
  if(!bd){ el2.innerHTML="Data: pto-vmi <code>"+commit+"</code>"; return; }
  // compute age
  var now=Date.now()/1000|0;
  var ageH = bt ? Math.floor((now-bt)/3600) : null;
  var ageStr="";
  if(ageH!=null){
    if(ageH<1) ageStr="just now";
    else if(ageH<24) ageStr=ageH+"h ago";
    else { var d=Math.floor(ageH/24); ageStr=d+" day"+(d>1?"s":"")+" ago"; }
  }
  var cls = (ageH!=null && ageH>48) ? "stale" : "fresh";
  // daily run status badge
  var dBadge="";
  if(dStatus==="success") dBadge='<span class="daily-status-badge daily-ok" title="Last nightly run succeeded">✓ nightly OK</span>';
  else if(dStatus==="failed") dBadge='<span class="daily-status-badge daily-fail" title="Last nightly run FAILED — data may be stale">✗ nightly FAIL</span>';
  else if(dStatus==="degraded") dBadge='<span class="daily-status-badge daily-degraded" title="Last nightly run completed but push/sync failed — data may be stale">⚠ nightly degraded</span>';
  else dBadge='<span class="daily-status-badge daily-unknown" title="No nightly run status available">? nightly unknown</span>';
  el2.innerHTML=dBadge+'<span class="freshness-'+cls+'">●</span> Last full run: '+bd+(ageStr?" ("+ageStr+")":"")+" · pto-vmi <code>"+commit+"</code> · "+MATCHED.length+" matched pairs";
})();

/* ---------------- helpers ---------------- */
function el(id){ return document.getElementById(id); }
function h(tag, attrs, kids){
  var e = document.createElement(tag);
  if(attrs) for(var k in attrs){
    if(k==="class") e.className = attrs[k];
    else if(k==="html") e.innerHTML = attrs[k];
    else if(k==="text") e.textContent = attrs[k];
    else e.setAttribute(k, attrs[k]);
  }
  if(kids) (Array.isArray(kids)?kids:[kids]).forEach(function(c){
    e.appendChild(typeof c==="string"?document.createTextNode(c):c);
  });
  return e;
}
function fmt(v, d){
  if(v==null || v==="" || (typeof v==="number" && !isFinite(v))) return "—";
  if(typeof v!=="number") return String(v);
  if(d==null) d = (v%1===0?0:3);
  return v.toFixed(d);
}
function clsDelta(v){ return v>0?"pos":(v<0?"neg":"zero"); }
function delta(v,d){ return (v>0?"+":"")+fmt(v,d); }
function badge(verdict){
  if(!verdict || verdict==="—") return '<span class="badge other">n/a</span>';
  var v = verdict.toLowerCase();
  if(v.indexOf("vmi")===0) return '<span class="badge vmi">'+verdict+'</span>';
  if(v.indexOf("cce")===0) return '<span class="badge cce">'+verdict+'</span>';
  if(v.indexOf("similar")===0) return '<span class="badge sim">'+verdict+'</span>';
  return '<span class="badge other">'+verdict+'</span>';
}
function esc(s){
  if(s==null) return "";
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function attrEsc(s){
  if(s==null) return "";
  return String(s).replace(/&/g,"&amp;").replace(/"/g,"&quot;");
}

/* ---------------- router ---------------- */
var currentView="overview";
var tabs = el("tabs");
function clearTabActive(){
  document.querySelectorAll(".tab").forEach(function(t){t.classList.remove("active")});
}
tabs.addEventListener("click", function(e){
  var b = e.target.closest(".tab"); if(!b) return;
  clearTabActive();
  b.classList.add("active");
  currentView=b.dataset.view;
  hideKernelDetail();
  render(b.dataset.view);
});
// global delegated handler for "explore ↗" links inside kernel-row tables
// (stops propagation so the row-click → modal doesn't also fire)
document.addEventListener("click", function(e){
  var a = e.target.closest(".explore-link"); if(!a) return;
  e.preventDefault(); e.stopPropagation();
  // Close the detail modal before opening explorer
  var modal = document.getElementById("modal");
  if(modal && !modal.classList.contains("hidden")) modal.classList.add("hidden");
  exploreKernel(a.getAttribute("data-explore"));
}, true);
// global delegated handler for "data-jump" CTA buttons (e.g. Overview → Diagnosis)
document.addEventListener("click", function(e){
  var b = e.target.closest("[data-jump]"); if(!b) return;
  var v = b.getAttribute("data-jump");
  var tab = document.querySelector('.tab[data-view="'+v+'"]');
  if(tab){ tab.click(); }
});
// global delegated handler for merged-view sub-tabs (.sub-tab / .sub-panel)
document.addEventListener("click", function(e){
  var b = e.target.closest(".sub-tab"); if(!b) return;
  var root = b.closest(".view-section");
  if(!root) return;
  root.querySelectorAll(".sub-tab").forEach(function(x){ x.classList.toggle("active", x===b); });
  var which = b.getAttribute("data-sub");
  root.querySelectorAll(".sub-panel").forEach(function(p){ p.classList.toggle("active", p.getAttribute("data-sub")===which); });
});
function render(view){
  var tpl = el("tpl-"+view); if(!tpl){ return; }
  var host = el("view");
  host.innerHTML = "";
  host.appendChild(document.importNode(tpl.content, true));
  (VIEWS[view]||function(){}).call(host);
}
var VIEWS = {};

/* ---------------- OVERVIEW ---------------- */
VIEWS.overview = function(){
  // KPIs — a curated hero set (the full comparison lives in the other tabs)
  var grid = el("kpi-grid");
  var cceEx = avg(MATCHED, function(r){return r.cce.ex;}),
      vmiEx = avg(MATCHED, function(r){return r.vmi.ex;}),
      cceIpc = avg(MATCHED, function(r){return r.cce.ipc;}),
      vmiIpc = avg(MATCHED, function(r){return r.vmi.ipc;}),
      cceVF = avg(MATCHED, function(r){return r.cce.vf_real;}),
      vmiVF = avg(MATCHED, function(r){return r.vmi.vf_real;});
  grid.innerHTML = "";
  [
    kpi("Matched pairs", META.matched_pairs||R.matched_count||MATCHED.length, "CCE ↔ VMI both populated", null, "🔗", "good"),
    kpi("CCE cases", META.cce_cases_total||ROWS.length, "total kernels analysed", null, "🔷", "cce"),
    kpi("Excluded", META.excluded_count||EXCLUDED.length, "correctness fail / toolchain bug", null, "🚫", "bad"),
    kpi("avg vf_real · CCE", cceVF, "lower = faster", cceVF<vmiVF?"up":"down", "⏱️", "cce"),
    kpi("avg vf_real · VMI", vmiVF, "CCE "+fmt(cceVF,1), vmiVF<cceVF?"up":"down", "⏱️", "vmi"),
    kpi("avg EX · CCE", cceEx, "VMI "+fmt(vmiEx,1), vmiEx<cceEx?"up":"down", "⚙️", "cce"),
    kpi("avg EX · VMI", vmiEx, "CCE "+fmt(cceEx,1), vmiEx>cceEx?"down":"up", "⚙️", "vmi"),
    kpi("avg IPC · CCE", cceIpc, "VMI "+fmt(vmiIpc,3), vmiIpc>cceIpc?"down":"up", "⚡", "cce"),
  ].forEach(function(n){ grid.appendChild(n); });

  // unit mapping
  var um = el("unit-map-table");
  um.innerHTML = thead(["user term","CA unit","category","meaning"]) +
    SUM.unit_mapping.map(function(u){
      return '<tr><td>'+esc(u.user)+'</td><td><code>'+esc(u.ca_unit)+'</code></td><td>'+esc(u.category)+'</td><td>'+esc(u.meaning)+'</td></tr>';
    }).join("");

  // definitions
  var dl = el("defs-list"); dl.innerHTML="";
  Object.keys(SUM.definitions).forEach(function(k){
    dl.appendChild(h("dt",{},k)); dl.appendChild(h("dd",{},SUM.definitions[k]));
  });

  el("bottom-line").textContent = SUM.bottom_line;
  el("net-conclusion").textContent = SUM.net_conclusion;
};
function avg(arr, f){
  var s=0,n=0; arr.forEach(function(r){var v=f(r); if(v!=null && typeof v==="number" && isFinite(v)){s+=v;n++;}}); return n?s/n:0;
}
function kpi(label, value, delta, dir, icon, acc){
  var lab = h("div",{class:"label"});
  if(icon) lab.appendChild(h("span",{class:"kpi-icon"},icon));
  lab.appendChild(h("span",{},label));
  return h("div",{class:"kpi "+(acc?"kpi-"+acc:"")},[
    lab,
    h("div",{class:"value"},fmt(value, value%1===0?0:2)),
    h("div",{class:"delta "+(dir||"")},delta||""),
    h("div",{class:"bar"})
  ]);
}

/* ---------------- SUMMARY ---------------- */
VIEWS.summary = function(){
  // A1
  var a1 = el("a1-table");
  a1.innerHTML = thead(["dimension","CCE worse","VMI worse / tie","interpretation"]) +
    SUM.a1_tally.map(function(r){
      return '<tr><td class="kernel">'+esc(r.dimension)+'</td>'+
        '<td class="num bad">'+r.cce_worse+'</td>'+
        '<td class="num">'+r.vmi_worse+'</td>'+
        '<td class="muted" style="text-align:left;max-width:420px">'+esc(r.interpretation)+'</td></tr>';
    }).join("");
  scatterBars("a1-chart", SUM.a1_tally, "dimension", ["cce_worse","vmi_worse"], ["CCE worse","VMI worse/tie"], ["cce","vmi"]);

  // A2
  var a2c = el("a2-count"); if(a2c) a2c.textContent = SUM.a2_vmi_ex.length;
  el("a2-table").innerHTML = thead(["kernel","CCE EX","VMI EX","ΔEX","EX-IPC ratio (VMI/CCE)","note"]) +
    SUM.a2_vmi_ex.map(function(r){
      var ratio = r.exipc_ratio==null?'—':(r.exipc_ratio<1?'<span class="bad">'+fmt(r.exipc_ratio,3)+'</span>':'<span class="good">'+fmt(r.exipc_ratio,3)+'</span>');
      return '<tr><td class="kernel">'+esc(r.kernel)+'</td>'+
        '<td class="num">'+r.cce_ex+'</td><td class="num">'+r.vmi_ex+'</td>'+
        '<td class="num '+clsDelta(r.dex)+'">'+delta(r.dex,0)+'</td>'+
        '<td class="num">'+ratio+'</td>'+
        '<td class="muted" style="text-align:left;max-width:380px">'+esc(r.note)+'</td></tr>';
    }).join("");

  // A3
  el("a3-table").innerHTML = thead(["kernel","CCE EX","VMI EX","ΔEX (CCE−VMI)","root cause"]) +
    SUM.a3_cce_ex.map(function(r){
      return '<tr><td class="kernel">'+esc(r.kernel)+'</td>'+
        '<td class="num">'+r.cce_ex+'</td><td class="num">'+r.vmi_ex+'</td>'+
        '<td class="num neg">+'+r.dex+'</td>'+
        '<td class="muted" style="text-align:left;max-width:380px">'+esc(r.root_cause)+'</td></tr>';
    }).join("");

  // A4
  el("a4-table").innerHTML = thead(["kernel","CCE vf_real","VMI vf_real","Δ","slower","cause"]) +
    SUM.a4_vfreal.map(function(r){
      var slower = r.slower==="CCE"?'<span class="cce-badge" style="color:var(--cce)">'+r.slower+'</span>':'<span style="color:var(--vmi)">'+r.slower+'</span>';
      return '<tr><td class="kernel">'+esc(r.kernel)+'</td>'+
        '<td class="num">'+r.cce+'</td><td class="num">'+r.vmi+'</td>'+
        '<td class="num '+clsDelta(r.delta)+'">'+delta(r.delta,0)+'</td>'+
        '<td class="num">'+slower+'</td>'+
        '<td class="muted" style="text-align:left;max-width:360px">'+esc(r.cause)+'</td></tr>';
    }).join("");

  // A5
  el("a5-table").innerHTML = thead(["kernel","CCE pred","VMI pred","issue"]) +
    SUM.a5_pred.map(function(r){
      return '<tr><td class="kernel">'+esc(r.kernel)+'</td>'+
        '<td class="num">'+r.cce_pred+'</td><td class="num">'+r.vmi_pred+'</td>'+
        '<td class="muted" style="text-align:left;max-width:520px">'+esc(r.issue)+'</td></tr>';
    }).join("");

  // A6
  el("a6-note").textContent = (SUM.a6_stall_pattern&&SUM.a6_stall_pattern.note)?SUM.a6_stall_pattern.note:"";
  el("a6-cce").textContent = (SUM.a6_stall_pattern&&SUM.a6_stall_pattern.cce_root)?SUM.a6_stall_pattern.cce_root:"";
  el("a6-vmi").textContent = (SUM.a6_stall_pattern&&SUM.a6_stall_pattern.vmi_root)?SUM.a6_stall_pattern.vmi_root:"";
  el("a6-store").textContent = (SUM.a6_stall_pattern&&SUM.a6_stall_pattern.cce_store_stalls)?SUM.a6_stall_pattern.cce_store_stalls:"";
  var a6h=el("a6-headline"); if(a6h && SUM.a6_stall_pattern && SUM.a6_stall_pattern.headline) a6h.textContent = SUM.a6_stall_pattern.headline;

  // A7
  el("a7-table").innerHTML = thead(["problem area","who","pairs","fix direction"]) +
    SUM.a7_conclusion.map(function(r){
      var who = r.who==="CCE"?'<span style="color:var(--cce)">'+r.who+'</span>':'<span style="color:var(--vmi)">'+r.who+'</span>';
      return '<tr><td class="kernel">'+esc(r.problem)+'</td>'+
        '<td class="num">'+who+'</td>'+
        '<td class="num">'+esc(r.pairs)+'</td>'+
        '<td class="muted" style="text-align:left;max-width:460px">'+esc(r.fix)+'</td></tr>';
    }).join("");
};

/* ---------------- PAIRS ---------------- */
VIEWS.pairs = function(){
  el("pairs-count").textContent = "("+MATCHED.length+" pairs)";
  var sortSel = el("pairs-sort"), metricSel = el("pairs-metric"), search = el("pairs-search");
  function draw(){
    var q = search.value.trim().toLowerCase();
    var rows = MATCHED.filter(function(r){
      return !q || r.case_id.toLowerCase().indexOf(q)>=0 || (r.vmi_kernel||"").toLowerCase().indexOf(q)>=0 || r.kernel.toLowerCase().indexOf(q)>=0;
    });
    var sk = sortSel.value;
    rows.sort(function(a,b){
      switch(sk){
        case "dex_desc": return dex(b)-dex(a);
        case "dex_asc": return dex(a)-dex(b);
        case "dvf_desc": return Math.abs(dvf(b))-Math.abs(dvf(a));
        case "exipc_ratio_desc": return ratio(b)-ratio(a);
        case "kernel": return a.kernel<b.kernel?-1:(a.kernel>b.kernel?1:0);
        case "vfreal_desc": return (b.cce.vf_real||0)-(a.cce.vf_real||0);
      }
      return 0;
    });
    var t = el("pairs-table");
    var cols = metricCols(metricSel.value);
    t.innerHTML = thead(cols.headers, cols.headerClasses) + rows.map(function(r){
      return row(r, cols);
    }).join("");
    t.querySelectorAll("tr[data-case]").forEach(function(tr){
      tr.addEventListener("click", function(){ openModal(tr.dataset.case); });
    });
  }
  sortSel.addEventListener("change", draw);
  metricSel.addEventListener("change", draw);
  search.addEventListener("input", draw);
  draw();
  // sub-tab counts + the two folded panels (Excluded / CCE-only)
  var segM = el("pairs-seg-matched"), segE = el("pairs-seg-excluded"), segC = el("pairs-seg-cceonly");
  if(segM) segM.textContent = "("+MATCHED.length+")";
  if(segE) segE.textContent = "("+EXCLUDED.length+")";
  if(segC) segC.textContent = "("+CCEONLY.length+")";
  if(VIEWS.excluded) VIEWS.excluded.call(this);
  if(VIEWS.cceonly) VIEWS.cceonly.call(this);
};
function dex(r){ return r.vmi.ex - r.cce.ex; }
function dvf(r){ return (r.vmi.vf_real||0) - (r.cce.vf_real||0); }
function ratio(r){ var c=r.cce.ex_ipc, v=r.vmi.ex_ipc; if(!c||!v) return -1; return v/c; }
function metricCols(m){
  if(m==="ipc") return {
    headers:["kernel","CCE vf","VMI vf","Δvf","CCE IPC","VMI IPC","CCE EX-IPC","VMI EX-IPC","ratio","verdict"],
    headerClasses:["","","cce","vmi","","cce","vmi","","","",""]
  };
  if(m==="stalls") return {
    headers:["kernel","CCE dual","VMI dual","CCE max/c","VMI max/c","CCE ex_stalls","VMI ex_stalls","CCE max_stall","VMI max_stall","CCE top stall","verdict"],
    headerClasses:["","cce","vmi","cce","vmi","cce","vmi","cce","vmi","cce",""]
  };
  return {
    headers:["kernel","CCE EX","VMI EX","ΔEX","CCE SU","VMI SU","ΔSU","CCE pred","VMI pred","CCE LD","VMI LD","CCE ST","VMI ST","CCE SCAL","VMI SCAL","CCE MTE2","VMI MTE2"],
    headerClasses:["","cce","vmi","","cce","vmi","","cce","vmi","cce","vmi","cce","vmi","cce","vmi","cce","vmi"]
  };
}
function row(r, cols){
  var c=r.cce, v=r.vmi;
  var verdict = verdictOf(r);
  var base = '<td class="kernel clickable" title="click for detail">'+esc(r.kernel)+' <a class="explore-link" data-explore="'+esc(r.case_id)+''+'" title="Open in Explorer (source ↔ disasm)">explore&nbsp;↗</a></td>';
  var cells;
  if(cols.headers[0]==="kernel" && cols.headers.length===10){
    cells = [
      c.vf_real, v.vf_real, '<span class="'+clsDelta(dvf(r))+'">'+delta(dvf(r),0)+'</span>',
      fmt(c.ipc,3), fmt(v.ipc,3), fmt(c.ex_ipc,3), fmt(v.ex_ipc,3),
      ratioStr(r), verdict
    ];
  } else if(cols.headers.length===12 && cols.headers[6]==="VMI ex_stalls"){
    cells = [
      c.rvec_dual, v.rvec_dual, c.max_issue, v.max_issue,
      c.ex_stalls, v.ex_stalls, c.max_stall, v.max_stall,
      '<span class="muted small" style="text-align:left">'+esc(c.top_stall||"—")+'</span>',
      verdict
    ];
  } else {
    cells = [
      c.ex, v.ex, '<span class="'+clsDelta(dex(r))+'">'+delta(dex(r),0)+'</span>',
      c.su, v.su, '<span class="'+clsDelta(v.su-c.su)+'">'+delta(v.su-c.su,0)+'</span>',
      c.pred, v.pred, c.ld, v.ld, c.st, v.st, c.scalar, v.scalar, c.dma, v.dma
    ];
  }
  return '<tr data-case="'+esc(r.case_id)+'">'+base+cells.map(function(x,i){
    var raw = (typeof x==="number"||/^[<]/.test(String(x)));
    if(raw && typeof x==="number") return '<td class="num">'+fmt(x, x%1===0?0:2)+'</td>';
    if(raw) return '<td class="num">'+x+'</td>';
    return '<td class="num">'+x+'</td>';
  }).join("")+'</tr>';
}
function ratioStr(r){
  var c=r.cce.ex_ipc, v=r.vmi.ex_ipc;
  if(!c||!v) return '<span class="zero">—</span>';
  var rr=v/c, cls = rr>=1.2?'good':(rr<0.9?'bad':'zero');
  return '<span class="'+cls+'">'+fmt(rr,3)+'</span>';
}
function verdictOf(r){
  var c=r.cce.ex_ipc, v=r.vmi.ex_ipc;
  if(!c||!v) return "n/a";
  var rr=v/c;
  if(Math.abs(rr-1)<0.1) return "similar";
  return rr>1?"VMI hotter":"CCE hotter";
}

/* ---------------- SCATTER ---------------- */
var WIPC_DATA = null;
var WIPC_SORT = "ex_desc";
var WIPC_SIDE = "all";
var WIPC_SEARCH = "";
var WIPC_MIX = "bottleneck";  // bottleneck | ex | ldst | su
function loadWipc(cb){
  if(WIPC_DATA){cb(WIPC_DATA);return;}
  fetch("wipc_all.json").then(function(r){return r.ok?r.json():null;}).then(function(d){
    WIPC_DATA=d||[];cb(WIPC_DATA);
  }).catch(function(){WIPC_DATA=[];cb([]);});
}
function drawWipcChart(){
  loadWipc(function(data){
    var host=el("wipc-chart"); if(!host) return;
    if(!data.length){ host.innerHTML='<p class="muted">no wIPC data</p>'; return; }
    // filter by side + search
    var rows = data.filter(function(r){
      if(WIPC_SIDE!=="all" && r.side!==WIPC_SIDE) return false;
      if(WIPC_SEARCH && r.kernel.toLowerCase().indexOf(WIPC_SEARCH)<0) return false;
      return true;
    });
    // sort
    rows.sort(function(a,b){
      switch(WIPC_SORT){
        case "ldst_desc": return b.ldst_wipc-a.ldst_wipc;
        case "su_desc": return b.su_wipc-a.su_wipc;
        case "ubbw_desc": return b.ub_bw-a.ub_bw;
        case "kernel": return a.kernel<b.kernel?-1:1;
        default: return b.ex_wipc-a.ex_wipc;
      }
    });
    var instrColors=["var(--cce)","var(--vmi)","var(--good)","var(--warn)","var(--bad)","var(--violet)","var(--cce)","var(--orange)"];
    var instrColorMap={}; var colorIdx=0;
    function getColor(name){if(!instrColorMap[name]){instrColorMap[name]=instrColors[colorIdx%instrColors.length];colorIdx++;}return instrColorMap[name];}
    var html='<table class="wipc-table"><thead><tr>'+
      '<th>Kernel</th><th>Side</th><th>Bound</th>'+
      '<th class="num">EX wIPC</th><th class="num">LD/ST wIPC</th><th class="num">SU wIPC</th><th class="num">UB BW (B/cyc)</th>'+
      '<th>Instruction mix at peak (20c window)</th>'+
      '</tr></thead><tbody>';
    rows.forEach(function(r){
      // Determine which mix to show based on WIPC_MIX selection
      var mixType = WIPC_MIX;
      if (mixType === "bottleneck") {
        // Auto-select based on bottleneck tag
        if (r.bottleneck === "SU-bound") mixType = "su";
        else if (r.bottleneck === "LD/ST-bound") mixType = "ldst";
        else mixType = "ex";
      }
      var mix, mixLabel, mixClass;
      if (mixType === "su") { mix = r.su_peak_mix||[]; mixLabel="SU"; mixClass="su"; }
      else if (mixType === "ldst") { mix = r.ldst_peak_mix||[]; mixLabel="LD/ST"; mixClass="ldst"; }
      else { mix = r.ex_peak_mix||[]; mixLabel="EX"; mixClass="ex"; }
      var mixTotal=mix.reduce(function(s,m){return s+m.count;},0)||1;
      var bar='<div class="wipc-bar">';
      mix.forEach(function(m){var pct=m.count/mixTotal*100;var col=getColor(m.name);bar+='<div class="wipc-seg" style="width:'+pct+'%;background:'+col+'" title="'+m.count+'x '+m.name+'">'+(pct>8?m.count:'')+'</div>';});
      bar+='</div>';
      var chips=mix.slice(0,5).map(function(m){return '<span class="wipc-chip" style="border-color:'+getColor(m.name)+'">'+m.count+'x '+esc(m.name)+'</span>';}).join(' ');
      var exCol=r.ex_wipc>=1.8?'gap-good':'';
      var ldstCol=r.ldst_wipc>=1.5?'gap-good':'';
      var suCol=(r.su_wipc||0)>=0.5?'gap-warn':'';
      var bwCol=r.ub_bw>=60?'gap-good':'';
      html+='<tr data-case="'+esc(r.case_id)+'">'+
        '<td class="kernel clickable">'+esc(r.kernel)+' <a class="explore-link" data-explore="'+esc(r.case_id)+'" title="Open in Kernel Lab">explore&nbsp;↗</a></td>'+
        '<td class="'+(r.side==='cce'?'cce-tag':'vmi-tag')+'">'+r.side.toUpperCase()+'</td>'+
        '<td class="bn-tag bn-'+(r.bottleneck||'Balanced').toLowerCase().replace('/','').replace('-','')+'">'+(r.bottleneck||'Balanced')+'</td>'+
        '<td class="num '+exCol+'" style="font-weight:600">'+r.ex_wipc.toFixed(2)+'</td>'+
        '<td class="num '+ldstCol+'">'+r.ldst_wipc.toFixed(2)+'</td>'+
        '<td class="num '+suCol+'" title="SU: '+esc((r.su_peak_mix||[]).map(function(m){return m.count+'x '+m.name;}).join(', '))+'">'+(r.su_wipc||0).toFixed(2)+'</td>'+
        '<td class="num '+bwCol+'">'+r.ub_bw.toFixed(0)+'</td>'+
        '<td class="wipc-mix"><span class="mix-label '+mixClass+'">'+mixLabel+'</span>'+bar+'<div class="wipc-chips">'+chips+'</div></td>'+
        '</tr>';
    });
    html+='</tbody></table>';
    host.innerHTML=html;
    host.querySelectorAll('tr[data-case]').forEach(function(tr){tr.addEventListener('click',function(){openModal(tr.dataset.case);});});
    // wire sort/filter/search/mix
    var sortSel=el("wipc-sort"), sideSel=el("wipc-filter-side"), search=el("wipc-search"), mixSel=el("wipc-mix");
    if(sortSel) sortSel.onchange=function(){WIPC_SORT=sortSel.value;drawWipcChart();};
    if(sideSel) sideSel.onchange=function(){WIPC_SIDE=sideSel.value;drawWipcChart();};
    if(search) search.oninput=function(){WIPC_SEARCH=search.value.toLowerCase();drawWipcChart();};
    if(mixSel) mixSel.onchange=function(){WIPC_MIX=mixSel.value;drawWipcChart();};
  });
}


VIEWS.scatter = function(){
  var data = MATCHED.filter(function(r){ return r.cce.ipc!=null && r.vmi.ipc!=null; });
  scatter("scatter-ipc", data, function(r){return r.cce.ipc;}, function(r){return r.vmi.ipc;},
    "CCE IPC","VMI IPC", 3);
  scatter("scatter-exipc", MATCHED, function(r){return r.cce.ex_ipc;}, function(r){return r.vmi.ex_ipc;},
    "CCE EX-IPC","VMI EX-IPC", 3);
  // LD/ST IPC = (ld+st) / vf_compute_span
  var ldstData = MATCHED.filter(function(r){return r.cce.vf_compute && r.vmi.vf_compute;});
  scatter("scatter-ldst", ldstData,
    function(r){return (r.cce.ld+r.cce.st)/r.cce.vf_compute;},
    function(r){return (r.vmi.ld+r.vmi.st)/r.vmi.vf_compute;},
    "CCE LD/ST IPC","VMI LD/ST IPC", 3);
  // EXU IPC = ex / vf_compute_span
  scatter("scatter-exu", ldstData,
    function(r){return r.cce.ex/r.cce.vf_compute;},
    function(r){return r.vmi.ex/r.vmi.vf_compute;},
    "CCE EXU IPC","VMI EXU IPC", 3);
  // Predicate IPC = ex_pred_setup / vf_compute_span (PSET/PLT/PAND etc, not PUSH_PB)
  // Exclude LICM-hoisted kernels (narrowIntKernel, ReverseIndexVfKernel) whose CCE pred
  // counts are artificially inflated by unhoisted PLT/VCI — they distort the scale
  var predData = ldstData.filter(function(r){
    return r.kernel !== "narrowIntKernel" && r.kernel !== "ReverseIndexVfKernel";
  });
  scatter("scatter-pred", predData,
    function(r){return (r.cce.ex_pred_setup||0)/r.cce.vf_compute;},
    function(r){return (r.vmi.ex_pred_setup||0)/r.vmi.vf_compute;},
    "CCE Pred IPC","VMI Pred IPC", 4);
  scatter("scatter-vfreal", MATCHED.filter(function(r){return r.cce.vf_real!=null&&r.vmi.vf_real!=null;}),
    function(r){return r.cce.vf_real;}, function(r){return r.vmi.vf_real;},
    "CCE vf_real","VMI vf_real", 0);
  scatter("scatter-ex", MATCHED, function(r){return r.cce.ex;}, function(r){return r.vmi.ex;},
    "CCE EX","VMI EX", 0);
  // ⑧ Dual-issue rate = dual / vf_compute (fraction of VF cycles with dual-issued ops)
  var dualData = MATCHED.filter(function(r){return r.cce.vf_compute>0 && r.vmi.vf_compute>0;});
  scatter("scatter-ci", dualData,
    function(r){return r.cce.dual / r.cce.vf_compute;},
    function(r){return r.vmi.dual / r.vmi.vf_compute;},
    "CCE Dual-Issue Rate","VMI Dual-Issue Rate", 2);
  // ⑨ wIPC per instruction type (bar chart)
  drawWipcChart();
  // Breakdown panel (merged Instruction + Pipeline) + auto headline
  if(VIEWS.subcats) VIEWS.subcats.call(this);
  if(VIEWS.pipeline) VIEWS.pipeline.call(this);
  renderBreakdownHeadline();
};
function scatterClick(r){ openModal(r.case_id); }

/* ---------------- BREAKDOWN HEADLINE ---------------- */
function renderBreakdownHeadline(){
  var host = el("breakdown-headline");
  if(!host) return;
  var subs = ["arith","cast","broadcast","pred_setup","interleave","select_cmp","reduce"];
  var fams = subs.map(function(s){
    var c=0,v=0;
    MATCHED.forEach(function(r){ c += r.cce["ex_"+s]||0; v += r.vmi["ex_"+s]||0; });
    return {name:s.replace("_"," "), d:v-c};
  }).sort(function(a,b){ return b.d-a.d; });
  var more = fams.filter(function(x){ return x.d>20; });
  var fewer = fams.filter(function(x){ return x.d<-20; });
  var parts = [];
  if(more.length){
    parts.push("VMI emits more <b>"+more.map(function(x){return x.name;}).join(", ")+"</b> ops"+(Math.abs(more[0].d)>=20?" (up to +"+more[0].d+")":"")+";");
  }
  if(fewer.length){
    parts.push("fewer <b>"+fewer.map(function(x){return x.name;}).join(", ")+"</b> (down to "+fewer[0].d+").");
  }
  var memDeltas = MATCHED.map(function(r){ return (r.vmi.mte2_wait||0)-(r.cce.mte2_wait||0); }).filter(function(x){ return isFinite(x); });
  var avgMem = memDeltas.length ? Math.round(memDeltas.reduce(function(a,b){return a+b;},0)/memDeltas.length) : null;
  if(avgMem!=null && avgMem<0){
    parts.push("CCE waits <b>~"+Math.abs(avgMem)+" cyc longer</b> on the GM→UB memory move (avg).");
  } else if(avgMem!=null && avgMem>0){
    parts.push("VMI waits <b>~"+avgMem+" cyc longer</b> on the GM→UB memory move (avg).");
  }
  var hotV=0, hotC=0, sim=0;
  MATCHED.forEach(function(r){ var vd=verdictOf(r); if(vd==="VMI hotter") hotV++; else if(vd==="CCE hotter") hotC++; else sim++; });
  parts.push("<b>"+hotV+"</b> kernels are VMI-hot, <b>"+hotC+"</b> CCE-hot, <b>"+sim+"</b> similar.");
  host.innerHTML = parts.join(" ");
}

/* ---------------- SUBCATS ---------------- */
VIEWS.subcats = function(){
  el("subcats-count").textContent = "("+MATCHED.length+" pairs)";
  var search = el("subcats-search"), hl = el("subcats-highlight"), colsSel = el("subcats-cols");
  var subs = ["arith","cast","broadcast","pred_setup","interleave","select_cmp","reduce"];
  // instruction delta by family (VMI − CCE), diverging bars
  (function(){
    var fams = subs.map(function(s){
      var c=0, v=0;
      MATCHED.forEach(function(r){ c += r.cce["ex_"+s]||0; v += r.vmi["ex_"+s]||0; });
      return {label:s.replace("_"," "), d:v-c};
    }).sort(function(a,b){ return b.d-a.d; });
    var maxAbs = Math.max.apply(null, fams.map(function(x){ return Math.abs(x.d); })) || 1;
    var W=780, rowH=22, padL=150, padR=160;
    var center = padL + (W-padL-padR)/2, maxW=(W-padL-padR)/2;
    var H=fams.length*rowH+42;
    var s=svgOpen(W,H);
    fams.forEach(function(x,i){
      var y=12+i*rowH;
      s+='<text x="'+(padL-10)+'" y="'+(y+14)+'" text-anchor="end" fill="var(--heading)" font-size="11">'+esc(x.label)+'</text>';
      var w=(Math.abs(x.d)/maxAbs)*maxW;
      if(x.d>0){
        s+='<rect x="'+center+'" y="'+y+'" width="'+Math.max(w,1)+'" height="14" rx="2" fill="var(--good)"/>';
        s+='<text x="'+(center+5)+'" y="'+(y+11)+'" fill="var(--surface-0)" font-size="9" font-weight="600">+'+x.d+'</text>';
      } else if(x.d<0){
        s+='<rect x="'+(center-w)+'" y="'+y+'" width="'+w+'" height="14" rx="2" fill="var(--bad)"/>';
        s+='<text x="'+(center-5)+'" y="'+(y+11)+'" text-anchor="end" fill="var(--surface-0)" font-size="9" font-weight="600">'+x.d+'</text>';
      } else {
        s+='<text x="'+(center+4)+'" y="'+(y+11)+'" fill="var(--muted)" font-size="9">0</text>';
      }
    });
    s+='<line x1="'+center+'" y1="2" x2="'+center+'" y2="'+(H-30)+'" stroke="var(--border)"/>';
    s+='<rect x="'+(center+6)+'" y="'+(H-24)+'" width="11" height="11" rx="2" fill="var(--good)"/><text x="'+(center+21)+'" y="'+(H-14)+'" fill="var(--heading)" font-size="11">VMI emits more</text>';
    s+='<rect x="'+(padL-6)+'" y="'+(H-24)+'" width="11" height="11" rx="2" fill="var(--bad)"/><text x="'+(padL+9)+'" y="'+(H-14)+'" fill="var(--heading)" font-size="11">VMI emits fewer</text>';
    el("subcats-chart").innerHTML = svgClose(s);
  })();
  function draw(){
    var q = search.value.trim().toLowerCase();
    var which = hl ? hl.value : "arith";
    var full = colsSel && colsSel.value==="full";
    var rows = MATCHED.filter(function(r){
      return !q || r.kernel.toLowerCase().indexOf(q)>=0 || (r.vmi_kernel||"").toLowerCase().indexOf(q)>=0;
    }).sort(function(a,b){ return (b.vmi["ex_"+which]-b.cce["ex_"+which]) - (a.vmi["ex_"+which]-a.cce["ex_"+which]); });
    var t = el("subcats-table");
    var hdr = ["kernel"];
    subs.forEach(function(s){ if(full) hdr.push("CCE "+s,"VMI "+s,"Δ"); else hdr.push("Δ "+s); });
    var cls = [""]; subs.forEach(function(){ if(full) cls.push("cce","vmi",""); else cls.push(""); });
    t.innerHTML = thead(hdr, cls) + rows.map(function(r){
      var out = '<tr data-case="'+esc(r.case_id)+'"><td class="kernel clickable">'+esc(r.kernel)+'</td>';
      subs.forEach(function(s){
        var cv=r.cce["ex_"+s], vv=r.vmi["ex_"+s], d=(vv||0)-(cv||0);
        if(full){
          var c = s===which ? (d>0?'pos':(d<0?'neg':'zero')) : clsDelta(d);
          out += '<td class="num">'+(cv||0)+'</td><td class="num">'+(vv||0)+'</td><td class="num '+c+'">'+delta(d,0)+'</td>';
        } else {
          out += '<td class="num '+clsDelta(d)+'">'+delta(d,0)+'</td>';
        }
      });
      return out+'</tr>';
    }).join("");
    t.querySelectorAll("tr[data-case]").forEach(function(tr){
      tr.addEventListener("click", function(){ openModal(tr.dataset.case); });
    });
  }
  search.addEventListener("input", draw);
  if(hl) hl.addEventListener("change", draw);
  if(colsSel) colsSel.addEventListener("change", draw);
  draw();
};

/* ---------------- PIPELINE ---------------- */
VIEWS.pipeline = function(){
  el("pipe-count").textContent = "("+MATCHED.length+" pairs)";
  // memory stalls — MTE2 wait delta (VMI − CCE), diverging bars
  (function(){
    var items = MATCHED.map(function(r){ return {label:r.kernel, d:(r.vmi.mte2_wait||0)-(r.cce.mte2_wait||0)}; })
      .filter(function(x){ return isFinite(x.d); })
      .sort(function(a,b){ return a.d-b.d; });
    var neg = items.filter(function(x){ return x.d<0; }).slice(0,10);
    var pos = items.filter(function(x){ return x.d>0; }).slice(-10).reverse();
    var rows = neg.concat(pos);
    var maxAbs = Math.max.apply(null, rows.map(function(x){ return Math.abs(x.d); })) || 1;
    var W=780, rowH=20, padL=210, padR=15;
    var areaL=padL, areaR=W-padR, center=(areaL+areaR)/2, maxW=(areaR-areaL)/2;
    var H=rows.length*rowH+50;
    var s=svgOpen(W,H);
    rows.forEach(function(x,i){
      var y=14+i*rowH;
      var lbl = x.label.length>24 ? x.label.slice(0,23)+'…' : x.label;
      s+='<text x="'+(padL-10)+'" y="'+(y+13)+'" text-anchor="end" fill="var(--heading)" font-size="10">'+esc(lbl)+'</text>';
      var w=(Math.abs(x.d)/maxAbs)*maxW;
      if(x.d<0){
        s+='<rect x="'+(center-w)+'" y="'+y+'" width="'+w+'" height="13" rx="2" fill="var(--cce)"/>';
        s+='<text x="'+(center-5)+'" y="'+(y+11)+'" text-anchor="end" fill="var(--surface-0)" font-size="9" font-weight="600">'+x.d+'</text>';
      } else {
        s+='<rect x="'+center+'" y="'+y+'" width="'+w+'" height="13" rx="2" fill="var(--vmi)"/>';
        s+='<text x="'+(center+5)+'" y="'+(y+11)+'" fill="var(--surface-0)" font-size="9" font-weight="600">+'+x.d+'</text>';
      }
    });
    s+='<line x1="'+center+'" y1="4" x2="'+center+'" y2="'+(H-40)+'" stroke="var(--border)"/>';
    s+='<rect x="'+areaL+'" y="'+(H-26)+'" width="11" height="11" rx="2" fill="var(--cce)"/><text x="'+(areaL+16)+'" y="'+(H-16)+'" fill="var(--heading)" font-size="11">CCE waits longer</text>';
    s+='<rect x="'+(center+8)+'" y="'+(H-26)+'" width="11" height="11" rx="2" fill="var(--vmi)"/><text x="'+(center+24)+'" y="'+(H-16)+'" fill="var(--heading)" font-size="11">VMI waits longer</text>';
    el("mte2-chart").innerHTML = svgClose(s);
  })();
  var search = el("pipe-search"), vf = el("pipe-verdict");
  function draw(){
    var q = search.value.trim().toLowerCase();
    var fv = vf.value;
    var rows = MATCHED.filter(function(r){
      if(q && r.kernel.toLowerCase().indexOf(q)<0 && (r.vmi_kernel||"").toLowerCase().indexOf(q)<0) return false;
      if(fv==="all") return true;
      var vd = verdictOf(r);
      if(fv==="other") return vd==="n/a";
      return vd===fv;
    }).sort(function(a,b){ return (b.cce.max_stall||0)-(a.cce.max_stall||0); });
    var t = el("pipe-table");
    t.innerHTML = thead(["CCE kernel","VMI kernel","CCE dual-issue","VMI dual-issue","CCE max issue/c","VMI max issue/c","CCE EX stalls","VMI EX stalls","CCE max stall","VMI max stall","CCE top stall","VMI top stall","CCE EX-IPC","VMI EX-IPC","ratio","verdict"],
      ["","cce","vmi","cce","vmi","cce","vmi","cce","vmi","cce","vmi","cce","vmi","","",""]) +
      rows.map(function(r){
        return '<tr data-case="'+esc(r.case_id)+'">'+
          '<td class="kernel clickable">'+esc(r.kernel)+' <a class="explore-link" data-explore="'+esc(r.case_id)+'" title="Open in Kernel Lab">explore&nbsp;↗</a></td>'+
          '<td class="kernel muted">'+esc(r.vmi_kernel||"—")+'</td>'+
          '<td class="num">'+r.cce.rvec_dual+'</td><td class="num">'+r.vmi.rvec_dual+'</td>'+
          '<td class="num">'+r.cce.max_issue+'</td><td class="num">'+r.vmi.max_issue+'</td>'+
          '<td class="num">'+r.cce.ex_stalls+'</td><td class="num">'+r.vmi.ex_stalls+'</td>'+
          '<td class="num">'+r.cce.max_stall+'</td><td class="num">'+r.vmi.max_stall+'</td>'+
          '<td class="muted small" style="text-align:left">'+esc(r.cce.top_stall||"—")+'</td>'+
          '<td class="muted small" style="text-align:left">'+esc(r.vmi.top_stall||"—")+'</td>'+
          '<td class="num">'+fmt(r.cce.ex_ipc,3)+'</td><td class="num">'+fmt(r.vmi.ex_ipc,3)+'</td>'+
          '<td class="num">'+ratioStr(r)+'</td>'+
          '<td class="num">'+badge(verdictOf(r))+'</td></tr>';
      }).join("");
    t.querySelectorAll("tr[data-case]").forEach(function(tr){
      tr.addEventListener("click", function(){ openModal(tr.dataset.case); });
    });
  }
  search.addEventListener("input", draw); vf.addEventListener("change", draw);
  draw();

  // latency inventory horizontal bars
  var inv = SUM.latency_inventory;
  var max = Math.max.apply(null, inv.map(function(x){return x.occurrences;}));
  var rows = inv.map(function(x){ return x.occurrences; });
  var LABELW=170, COUNTW=50, W=760, H=24*inv.length+40, svg=svgOpen(W,H);
  inv.forEach(function(x,i){
    var y=20+i*24, w=(x.occurrences/max)*(W-LABELW-COUNTW);
    svg+='<rect x="'+LABELW+'" y="'+y+'" width="'+w+'" height="16" rx="3" fill="'+(x.unit==="RVECST"?'var(--warn)':'var(--cce)')+'"/>';
    svg+='<text x="'+(LABELW-5)+'" y="'+(y+12)+'" text-anchor="end" fill="var(--heading)" font-size="11" font-family="monospace">'+x.instruction+'</text>';
    svg+='<text x="'+(LABELW+w+6)+'" y="'+(y+12)+'" fill="var(--text)" font-size="11">'+x.occurrences+'</text>';
  });
  el("latency-chart").innerHTML = svgClose(svg);

  // outliers
  el("outliers-table").innerHTML = thead(["kernel","EX","SU","LD","ST","vf_real","IPC","EX-IPC","note"]) +
    SUM.outliers.map(function(r){
      return '<tr><td class="kernel">'+esc(r.kernel)+'</td>'+
        '<td class="num">'+r.ex+'</td><td class="num">'+r.su+'</td>'+
        '<td class="num">'+r.ld+'</td><td class="num">'+r.st+'</td>'+
        '<td class="num bad">'+r.vf_real+'</td><td class="num">'+fmt(r.ipc,3)+'</td>'+
        '<td class="num">'+fmt(r.ex_ipc,3)+'</td>'+
        '<td class="muted" style="text-align:left">'+esc(r.note)+'</td></tr>';
    }).join("");
};

/* ---------------- CCE-ONLY ---------------- */
VIEWS.cceonly = function(){
  el("cceonly-count").textContent = "("+CCEONLY.length+" cases)";
  var search = el("cceonly-search");
  function draw(){
    var q = search.value.trim().toLowerCase();
    var rows = CCEONLY.filter(function(r){
      return !q || r.kernel.toLowerCase().indexOf(q)>=0 || r.case_id.toLowerCase().indexOf(q)>=0;
    }).sort(function(a,b){ return (b.cce.vf_real||0)-(a.cce.vf_real||0); });
    var t = el("cceonly-table");
    t.innerHTML = thead(["case_id","EX","SU","pred","LD","ST","SCALAR","MTE2","vf_real","IPC","EX-IPC","note"]) +
      rows.map(function(r){
        var c=r.cce;
        return '<tr data-case="'+esc(r.case_id)+'"><td class="kernel clickable">'+esc(r.case_id)+' <a class="explore-link" data-explore="'+esc(r.case_id)+'" title="Open in Kernel Lab">explore&nbsp;↗</a></td>'+
          '<td class="num">'+fmt(c.ex,0)+'</td><td class="num">'+fmt(c.su,0)+'</td>'+
          '<td class="num">'+fmt(c.pred,0)+'</td><td class="num">'+fmt(c.ld,0)+'</td>'+
          '<td class="num">'+fmt(c.st,0)+'</td><td class="num">'+fmt(c.scalar,0)+'</td>'+
          '<td class="num">'+fmt(c.dma,0)+'</td><td class="num">'+fmt(c.vf_real,0)+'</td>'+
          '<td class="num">'+fmt(c.ipc,3)+'</td><td class="num">'+fmt(c.ex_ipc,3)+'</td>'+
          '<td class="muted" style="text-align:left">'+esc(r.vmi_kernel==="—"?"no VMI dir":"VMI matched but no CA sim")+'</td></tr>';
      }).join("");
    t.querySelectorAll("tr[data-case]").forEach(function(tr){
      tr.addEventListener("click", function(){ openModal(tr.dataset.case); });
    });
  }
  search.addEventListener("input", draw); draw();
};

/* ---------------- EXCLUDED (semantic divergence) ---------------- */
// Detect LICM-hoisted outlier pairs (§0d) client-side
function detectLicmOutliers(rows){
  var out = [];
  rows.forEach(function(r){
    if(!r.vmi || r.vmi.ex==null || r.excluded) return;
    var c=r.cce, v=r.vmi;
    if(!c.vf_real || !v.vf_real) return;
    var exRatio = v.ex / c.ex;
    var vfRatio = v.vf_real / c.vf_real;
    var cp = c.ex_pred_setup||0, vp = v.ex_pred_setup||0;
    var predRatio = cp>0 ? vp/cp : 1;
    var isExHoist = (exRatio <= 0.05 && vfRatio >= 0.85 && vfRatio <= 1.15);
    var isPredHoist = (predRatio <= 0.1 && cp >= 10 && vfRatio >= 0.3 && vfRatio <= 3.0);
    if(isExHoist || isPredHoist){
      out.push({kernel:r.kernel, case_id:r.case_id, vmi_kernel:r.vmi_kernel,
        cce:c, vmi:v, exRatio:exRatio, vfRatio:vfRatio, predRatio:predRatio,
        type: isPredHoist ? "pred_hoist" : "ex_hoist"});
    }
  });
  return out;
}

VIEWS.excluded = function(){
  // Split excluded into toolchain-bug vs correctness-failed vs semantic-divergence
  var correctExcl = EXCLUDED.filter(function(r){ return r.excluded.indexOf("Correctness check failed") === 0; });
  var bugExcl = EXCLUDED.filter(function(r){ return r.excluded.indexOf("Toolchain bug") === 0; });
  var semanticExcl = EXCLUDED.filter(function(r){ return r.excluded.indexOf("Correctness check failed") !== 0 && r.excluded.indexOf("Toolchain bug") !== 0; });
  var t = el("excluded-table");
  var html = '';
  // Section 0: Correctness-failed pairs (new)
  if(correctExcl.length){
    html += '<h3>§0a — Correctness Check Failed ('+correctExcl.length+')</h3>';
    html += '<p class="muted small">These pairs failed correctness verification (CCE <code>ResultCmp</code> or VMI <code>np.allclose</code> against golden output). They may produce wrong results, crash, or time out. Excluded from all comparisons.</p>';
    html += '<div class="licm-cards">';
    correctExcl.forEach(function(r){
      var c=r.cce, v=r.vmi;
      var cceSt = r.cce_status || (r.excluded.indexOf("CCE") >= 0 ? "FAIL" : "PASS");
      var vmiSt = r.vmi_status || (r.excluded.indexOf("VMI") >= 0 ? "FAIL" : "PASS");
      var cceTag = cceSt === "PASS" ? '<span class="licm-badge ex" style="background:#1a3a1a;color:#4a4">CCE PASS</span>' : '<span class="licm-badge pred">CCE '+esc(cceSt)+'</span>';
      var vmiTag = vmiSt === "PASS" ? '<span class="licm-badge ex" style="background:#1a3a1a;color:#4a4">VMI PASS</span>' : '<span class="licm-badge pred">VMI '+esc(vmiSt)+'</span>';
      html += '<div class="licm-card" data-case="'+esc(r.case_id)+'">'+
        '<div class="licm-card-header">'+
          '<span class="kernel clickable">'+esc(r.kernel)+'</span>'+
          cceTag + vmiTag +
        '</div>'+
        '<div class="licm-card-metrics">'+
          '<div class="licm-metric"><span class="licm-label">EX ops</span><span class="licm-val">CCE '+(c.ex!=null?c.ex:'—')+' / VMI '+(v.ex!=null?v.ex:'—')+'</span></div>'+
          '<div class="licm-metric"><span class="licm-label">vf_real</span><span class="licm-val">CCE '+(c.vf_real!=null?fmt(c.vf_real,0)+'c':'—')+' / VMI '+(v.vf_real!=null?fmt(v.vf_real,0)+'c':'—')+'</span></div>'+
        '</div>'+
        '<div class="licm-card-detail">'+esc(r.excluded)+'</div>'+
      '</div>';
    });
    html += '</div>';
    html += '<hr style="margin:24px 0">';
  }
  // Section 1b: §0b Toolchain bug (ptoas/simulator) — card layout
  if(bugExcl.length){
    html += '<h3>§0b — Toolchain Bug (ptoas/simulator) ('+bugExcl.length+')</h3>';
    html += '<p class="muted small">These pairs pass correctness but the simulated instruction stream is not representative of real hardware — a ptoas lowering bug mangles the loop structure (e.g. <code>pto.static_range()</code> is fully unrolled into SLDI/SSTI scalar ops instead of a hardware loop). Excluded from all comparisons pending a ptoas fix.</p>';
    html += '<div class="licm-cards">';
    bugExcl.forEach(function(r){
      var c=r.cce, v=r.vmi;
      var reason = r.excluded.split(';')[0].replace(/\s+/g,' ').trim();
      var exDelta = v.ex - c.ex;
      var vfDelta = v.vf_real - c.vf_real;
      var vfPct = c.vf_real ? Math.round(vfDelta / c.vf_real * 100) : 0;
      html += '<div class="licm-card" data-case="'+esc(r.case_id)+'">'+
        '<div class="licm-card-header">'+
          '<span class="kernel clickable">'+esc(r.kernel)+'</span>'+
          '<span class="licm-badge ex">TOOLCHAIN BUG</span>'+
        '</div>'+
        '<div class="licm-card-metrics">'+
          '<div class="licm-metric"><span class="licm-label">EX ops</span><span class="licm-val">CCE '+c.ex+' / VMI '+v.ex+'</span><span class="licm-delta">'+(exDelta>0?'+':'')+exDelta+'</span></div>'+
          '<div class="licm-metric"><span class="licm-label">vf_real</span><span class="licm-val">CCE '+fmt(c.vf_real,0)+'c / VMI '+fmt(v.vf_real,0)+'c</span><span class="licm-delta '+(vfDelta>0?'bad':'good')+'">'+(vfDelta>0?'+':'')+vfPct+'%</span></div>'+
        '</div>'+
        '<div class="licm-card-detail">'+esc(reason)+'</div>'+
      '</div>';
    });
    html += '</div>';
    html += '<hr style="margin:24px 0">';
  }
  // Section 1: §0c Semantic Divergence (excluded pairs) — card layout
  html += '<h3>§0c — Semantic Divergence ('+semanticExcl.length+')</h3>';
  html += '<p class="muted small">These pairs are excluded because CCE and VMI do different work (different inputs, different algorithm, or different work fraction). They are NOT valid performance comparisons.</p>';
  if(semanticExcl.length){
    html += '<div class="licm-cards">';
    semanticExcl.forEach(function(r){
      var c=r.cce, v=r.vmi;
      var reason = r.excluded.split(';')[0].replace(/\s+/g,' ').trim();
      // classify the divergence type
      var dtype = reason.toLowerCase().indexOf('input')>=0 ? 'input' : (reason.toLowerCase().indexOf('scalar')>=0||reason.toLowerCase().indexOf('loop')>=0 ? 'algo' : 'other');
      var typeTag = dtype==='input'
        ? '<span class="licm-badge pred">DIFF INPUT</span>'
        : (dtype==='algo'
          ? '<span class="licm-badge ex">DIFF ALGO</span>'
          : '<span class="licm-badge ex">DIVERGENT</span>');
      var exDelta = v.ex - c.ex;
      var vfDelta = v.vf_real - c.vf_real;
      var vfPct = c.vf_real ? Math.round(vfDelta / c.vf_real * 100) : 0;
      html += '<div class="licm-card" data-case="'+esc(r.case_id)+'">'+
        '<div class="licm-card-header">'+
          '<span class="kernel clickable">'+esc(r.kernel)+'</span>'+
          typeTag+
        '</div>'+
        '<div class="licm-card-metrics">'+
          '<div class="licm-metric"><span class="licm-label">EX ops</span><span class="licm-val">CCE '+c.ex+' / VMI '+v.ex+'</span><span class="licm-delta '+(exDelta>0?"good":"")+'">'+(exDelta>0?"+":"")+exDelta+'</span></div>'+
          '<div class="licm-metric"><span class="licm-label">vf_real</span><span class="licm-val">CCE '+fmt(c.vf_real,0)+'c / VMI '+fmt(v.vf_real,0)+'c</span><span class="licm-delta '+(vfDelta>0?"good":"")+'">'+(vfDelta>0?"+":"")+vfPct+'%</span></div>'+
        '</div>'+
        '<div class="licm-card-detail">'+esc(reason)+'</div>'+
      '</div>';
    });
    html += '</div>';
  } else {
    html += '<p class="muted">No semantic-divergence pairs.</p>';
  }

  // Section 2: §0d Metric Outliers (LICM-hoisted) — card layout
  var licm = detectLicmOutliers(MATCHED);
  html += '<hr style="margin:24px 0"><div class="licm-not-excluded-banner">⚠️ These pairs are <strong>NOT excluded</strong> — they are valid matched pairs included in all comparisons and scatter charts. They appear here only as a <strong>metric caveat</strong>: IPC is misleading for these pairs due to VMI LICM optimization.</div><h3>§0d — Metric Outliers: LICM-hoisted pairs ('+licm.length+')</h3>';
  html += '<p class="muted small">These pairs are <strong>valid matches</strong> (same input, same golden output) but VMI hoists loop-invariant ops out of the loop while CCE re-executes them every iteration. The IPC/Pred-IPC metrics are distorted by CCE\'s redundant ops — <strong>use vf_real for these pairs, not IPC.</strong> They are excluded from the Predicate IPC scatter to keep the scale readable.</p>';
  if(licm.length){
    html += '<div class="licm-cards">';
    licm.forEach(function(x){
      var c=x.cce, v=x.vmi;
      var detail = "";
      if(x.type === "pred_hoist"){
        detail = 'CCE re-generates a predicate mask (<code>plt_b32</code>) every loop iteration ('+c.ex_pred_setup+'× PLT/PUNPACK) for tail handling, even though the mask is loop-invariant. VMI uses <code>create_mask</code> hoisted outside the loop ('+v.ex_pred_setup+'× PSET). VMI is ~'+Math.round(1/x.vfRatio)+'× faster (vf_real '+fmt(c.vf_real,0)+'→'+fmt(v.vf_real,0)+'c).';
      } else {
        detail = 'CCE re-executes a loop-invariant EX op every iteration ('+c.ex+' ops); VMI hoists it out of the loop ('+v.ex+' ops). vf_real is within ±15% ('+fmt(c.vf_real,0)+' vs '+fmt(v.vf_real,0)+'c) — same real work, but CCE\'s IPC is inflated by the redundant ops.';
      }
      var typeTag = x.type==="pred_hoist"
        ? '<span class="licm-badge pred">PRED HOIST</span>'
        : '<span class="licm-badge ex">EX HOIST</span>';
      var vfDelta = c.vf_real - v.vf_real;
      var vfPct = Math.round(vfDelta / c.vf_real * 100);
      html += '<div class="licm-card" data-case="'+esc(x.case_id)+'">'+
        '<div class="licm-card-header">'+
          '<span class="kernel clickable">'+esc(x.kernel)+'</span>'+
          typeTag+
        '</div>'+
        '<div class="licm-card-metrics">'+
          '<div class="licm-metric"><span class="licm-label">EX ops</span><span class="licm-val">CCE '+c.ex+' to VMI '+v.ex+'</span><span class="licm-delta '+(x.exRatio<=0.05?'bad':'')+'">ratio '+x.exRatio.toFixed(3)+'</span></div>'+
          '<div class="licm-metric"><span class="licm-label">Pred setup</span><span class="licm-val">CCE '+(c.ex_pred_setup||0)+' to VMI '+(v.ex_pred_setup||0)+'</span><span class="licm-delta '+(x.predRatio<=0.1?'bad':'')+'">ratio '+x.predRatio.toFixed(3)+'</span></div>'+
          '<div class="licm-metric"><span class="licm-label">vf_real</span><span class="licm-val">CCE '+fmt(c.vf_real,0)+'c to VMI '+fmt(v.vf_real,0)+'c</span><span class="licm-delta '+(vfDelta>0?'good':'')+'">'+(vfDelta>0?"-":"+")+Math.abs(vfPct)+'%</span></div>'+
        '</div>'+
        '<div class="licm-card-detail">'+esc(detail)+'</div>'+
      '</div>';
    });
    html += '</div>';
  } else {
    html += '<p class="muted">No LICM-hoisted outliers detected.</p>';
  }
  t.innerHTML = html;
  t.querySelectorAll(".licm-card[data-case]").forEach(function(card){
    card.addEventListener("click", function(){ openModal(card.dataset.case); });
  });
};

/* ---------------- COVERAGE ---------------- */
var COV_BUNDLES = null;  // manifest bundles (with tags)
var COV_FILTER = {};     // {dimension: Set(values)}
var COV_SEL_FEATURE = null;  // selected feature key (KPI/detail)
var COV_UNDOCUMENTED = [];  // kernels with 0 features in the doc
var COV_FEAT_COUNTS = {};    // feature key -> kernel count
var COV_SUB_COUNTS = {};     // sub key -> kernel count
function loadCovManifest(cb){
  if(COV_BUNDLES){ cb(COV_BUNDLES); return; }
  fetch("explorer/manifest.json").then(function(r){return r.ok?r.json():null;}).then(function(m){
    COV_BUNDLES = (m&&m.bundles)?m.bundles.filter(function(b){return b.kernel && b.kernel!=="?" && b.tags;}):[]; cb(COV_BUNDLES);
  }).catch(function(){ COV_BUNDLES=[]; cb([]); });
}
var COV_TAXO = null;
function loadCovTaxonomy(cb){
  if(COV_TAXO){ cb(COV_TAXO); return; }
  fetch("explorer/coverage_taxonomy.json").then(function(r){return r.ok?r.json():null;}).then(function(t){
    COV_TAXO = t || null;
    if(COV_TAXO && COV_TAXO.features && COV_TAXO.features.length){ COV_TAXONOMY = COV_TAXO.features; }
    cb(COV_TAXO);
  }).catch(function(){ COV_TAXO = null; cb(null); });
}

// VMI feature taxonomy (§1–§6 from docs/pto_vmi_features.md).
// Categories with `subs` expose the doc's sub-categories (§2 dist modes, §3 vcvt
// width classes, §6 intent-op families); the others are leaf categories.
var COV_TAXONOMY = [
  {key:"logical_vector",  label:"§1 Logical Vector",  desc:"Auto K-way fan-out, compact/partial, Category A/B/C", subs:null},
  {key:"load_store_dist", label:"§2 Load/Store Dist",  desc:"dist_mode: brc, unpack, dintlv, block_stride, group+stride", subs:[
    {key:"dist_brc",          label:"brc (broadcast)"},
    {key:"dist_dintlv",        label:"dintlv"},
    {key:"dist_unpack",        label:"unpack"},
    {key:"dist_block_stride",  label:"block_stride / group+stride"}
  ]},
  {key:"unified_vcvt",    label:"§3 Unified vcvt",     desc:"Hides part/pack/EVEN-ODD; fp+int unified", subs:[
    {key:"vcvt_narrow_wide",  label:"Narrow → wide"},
    {key:"vcvt_wide_narrow",  label:"Wide → narrow"},
    {key:"vcvt_same_width",   label:"Same width"}
  ]},
  {key:"group_reduce",    label:"§4 Group Reduce",     desc:"vcmax/vcadd {group=C} + vbrc broadcast", subs:null},
  {key:"mask_predication",label:"§5 Mask/Predication", desc:"create_mask, pmode=zero/merge, first-N tail mask", subs:null},
  {key:"intent_ops",      label:"§6 Intent Ops",       desc:"vselr, vgather, vchist/vdhist, vintlv/vdintlv, fused SFU", subs:[
    {key:"intent_rearrange",     label:"Rearrange (vintlv/vdintlv)"},
    {key:"intent_hist",          label:"Histogram (vchist/vdhist)"},
    {key:"intent_gather",        label:"In-register gather (vselr)"},
    {key:"intent_gather_scatter",label:"UB gather/scatter"},
    {key:"intent_fused",          label:"Fused SFU (vaxpy/vprelu/…)"}
  ]}
];

// --- sub-category derivation (client-side, from each bundle's vmi_evidence) ---
// §3: parse vcvt arrow X→Y / X↔Y, comparing dtype bit-widths (8/16/32).
//      vinterpret_cast clauses → same width only (bit-reinterpret, skip directional).
//      Keyword + non-adjacent fallbacks for evidence phrased as "…vcvt → f32".
var COV_DTYPE_BITS = {fp8:8,f8:8,f8e4m3:8,si8:8,ui8:8,i8:8,int8:8,uint8:8,
  f16:16,fp16:16,bf16:16,si16:16,ui16:16,i16:16,int16:16,uint16:16,bfloat16:16,
  f32:32,fp32:32,si32:32,ui32:32,i32:32,int32:32,uint32:32,float:32,
  fp4:4,f4:4,fp8e4m3:8};
function covDtypeBits(t){
  t=(t||"").toLowerCase();
  if(COV_DTYPE_BITS[t]!=null) return COV_DTYPE_BITS[t];
  for(var k in COV_DTYPE_BITS){ if(t.indexOf(k)===0) return COV_DTYPE_BITS[k]; }
  return null;
}
var COV_ARROW_RE = /([a-z][a-z0-9]*(?:e\d+m\d+)?)\s*([→↔])\s*([a-z][a-z0-9]*(?:e\d+m\d+)?)/g;
function covDeriveVcvt(ev){
  var s = {};
  if(!ev) return s;
  var el = ev.toLowerCase();
  el.split(/\s*;\s*/).forEach(function(cl){
    cl = cl.replace(/\d+\s*[×x]\s*/g,"").replace(/[×x]\s*\d+/g,"");   // strip "128×" prefixes
    if(cl.indexOf("vinterpret_cast")>=0){ s.vcvt_same_width=1; return; }   // bit-reinterpret = same width
    COV_ARROW_RE.lastIndex=0; var m;
    while((m=COV_ARROW_RE.exec(cl))){
      var a=covDtypeBits(m[1]), b=covDtypeBits(m[3]), bidir=(m[2]==="↔");
      if(a==null||b==null) continue;
      if(a===b) s.vcvt_same_width=1;
      else if(a<b) s.vcvt_narrow_wide=1; else s.vcvt_wide_narrow=1;
      if(bidir&&a!==b){ if(a>b) s.vcvt_narrow_wide=1; else s.vcvt_wide_narrow=1; }
    }
    if(/widen/.test(cl)) s.vcvt_narrow_wide=1;
    if(/fpnarrow|fptoui|narrow/.test(cl)) s.vcvt_wide_narrow=1;
  });
  // non-adjacent fallback: "fp16 … vcvt → f32" etc. (also catches fp4 as narrow)
  if(/(fp4|f4|fp8|f8|si8|ui8|i8|f16|fp16|bf16)[^→]{0,20}→[^a-z0-9]{0,3}(f32|fp32|si32|ui32)/.test(el)) s.vcvt_narrow_wide=1;
  if(/(f32|fp32|si32|ui32|f16|fp16|bf16)[^→]{0,20}→[^a-z0-9]{0,3}(fp4|f4|fp8|f8|si8|ui8|i8|f16|fp16|bf16)/.test(el)) s.vcvt_wide_narrow=1;
  // keyword fallback: "densify+vcvt → f32" implies narrow→wide
  if(/densify.*vcvt.*→.*f32/.test(el)) s.vcvt_narrow_wide=1;
  return s;
}
function covDeriveDist(ev){
  var s={}; if(!ev) return s;
  if(/\bbrc\b/i.test(ev)) s.dist_brc=1;
  if(/dintlv/i.test(ev)) s.dist_dintlv=1;
  if(/unpack/i.test(ev)) s.dist_unpack=1;
  if(/block_stride|group=|stride/i.test(ev)) s.dist_block_stride=1;
  return s;
}
function covDeriveIntent(ev){
  var s={}; if(!ev) return s;
  if(/vintlv|vdintlv/i.test(ev)) s.intent_rearrange=1;
  if(/vchist|vdhist/i.test(ev)) s.intent_hist=1;
  if(/vselr/i.test(ev)) s.intent_gather=1;
  if(/vgather|vscatter/i.test(ev)) s.intent_gather_scatter=1;
  if(/vaxpy|vprelu|vmula|vmull|vlrelu|vexpdif/i.test(ev)) s.intent_fused=1;
  return s;
}
var COV_SUB_DERIVERS = {unified_vcvt:covDeriveVcvt, load_store_dist:covDeriveDist, intent_ops:covDeriveIntent};
function covSubs(b, catKey){
  // 1. doc-derived structured subs (coverage_taxonomy.json)
  var km = COV_TAXO && COV_TAXO.kernels && COV_TAXO.kernels[b.kernel];
  if(km && km.subs && km.subs[catKey]){
    var o={}; km.subs[catKey].forEach(function(s){ o[s]=1; }); return o;
  }
  // 2. bundle tags.vmi_subs (written at build/retag time)
  if(b.tags && b.tags.vmi_subs && b.tags.vmi_subs[catKey]){
    var o2={}; b.tags.vmi_subs[catKey].forEach(function(s){ o2[s]=1; }); return o2;
  }
  // 3. legacy fallback: regex derivation from the evidence string
  if(!COV_SUB_DERIVERS[catKey]) return {};
  var ev = (b.tags&&b.tags.vmi_evidence&&b.tags.vmi_evidence[catKey])||"";
  return COV_SUB_DERIVERS[catKey](ev);
}
function covKernelInfo(b){
  var km = COV_TAXO && COV_TAXO.kernels && COV_TAXO.kernels[b.kernel];
  var features = (km && km.features) || ((b.tags&&b.tags.vmi_features)||[]);
  var evidence = (km && km.evidence) || ((b.tags&&b.tags.vmi_evidence)||{});
  return {features:features, evidence:evidence};
}
function covTaxLabel(key){
  for(var i=0;i<COV_TAXONOMY.length;i++){
    if(COV_TAXONOMY[i].key===key) return COV_TAXONOMY[i].label;
    var subs=COV_TAXONOMY[i].subs;
    if(subs) for(var j=0;j<subs.length;j++) if(subs[j].key===key) return subs[j].label;
  }
  return key;
}

function covChip(text, kind, sub){
  return '<span class="cov-chip '+kind+(sub?" cov-chip-sub":"")+'">'+esc(text)+'</span>';
}
function covMatches(b){
  // true if b matches all active COV_FILTER dimensions
  for(var dim in COV_FILTER){
    var want = COV_FILTER[dim];  // Set
    if(!want || !want.size) continue;
    var hit=false;
    if(dim==="vmi_subs"){
      // values are "catKey/subKey"; a bundle hits if its derived subs include any
      want.forEach(function(v){ var p=v.split("/"); if(covSubs(b,p[0])[p[1]]) hit=true; });
    } else if(dim==="vmi_features"){
      covKernelInfo(b).features.forEach(function(v){ if(want.has(String(v))) hit=true; });
    } else {
      var have = (b.tags && b.tags[dim]) || [];
      if(!Array.isArray(have)) have = have?[have]:[];
      // for reduce_group_size / reduce_dim (scalar tags), match if the scalar is in the set
      have.forEach(function(v){ if(want.has(String(v))) hit=true; });
    }
    if(!hit) return false;
  }
  return true;
}
VIEWS.coverage = function(){
  loadCovTaxonomy(function(){
  loadCovManifest(function(bundles){
    el("cov-kernel-count").textContent = "("+bundles.length+" kernels)";
    // version badge from REPORT.methodology
    var meth = (R&&R.methodology)||"";
    var ptoasMatch = meth.match(/PTOAS\s+([^+]+?)\s*\+/);
    var cannMatch = meth.match(/CANN\s+([^+]+?)\s+sim/);
    var socMatch = meth.match(/sim\s*\(([^)]+)\)/);
    var vBadge = el("cov-version-badge");
    if(vBadge){
      var parts = [];
      if(ptoasMatch) parts.push("ptoas "+ptoasMatch[1].trim());
      if(cannMatch) parts.push("CANN "+cannMatch[1].trim());
      if(socMatch) parts.push(socMatch[1].trim());
      vBadge.innerHTML = parts.length ? '<span class="cov-ver-chip">'+esc(parts.join(" · "))+'</span>' : '';
    }
    // per-feature + per-sub counts
    COV_FEAT_COUNTS = {}; COV_SUB_COUNTS = {};
    COV_TAXONOMY.forEach(function(f){ COV_FEAT_COUNTS[f.key]=0; if(f.subs) f.subs.forEach(function(s){COV_SUB_COUNTS[s.key]=0;}); });
    bundles.forEach(function(b){
      covKernelInfo(b).features.forEach(function(f){ COV_FEAT_COUNTS[f]=(COV_FEAT_COUNTS[f]||0)+1; });
      COV_TAXONOMY.forEach(function(cat){
        if(cat.subs){ var subs=covSubs(b,cat.key); cat.subs.forEach(function(s){ if(subs[s.key]) COV_SUB_COUNTS[s.key]++; }); }
      });
    });
    COV_UNDOCUMENTED = bundles.filter(function(b){ return covKernelInfo(b).features.length===0; });
    // URL hash → select feature (#cov=<key>)
    if(!COV_SEL_FEATURE){
      var hsh=(location.hash||"").replace(/^#/,"").replace(/^cov[=-]/,"");
      if(hsh && COV_TAXONOMY.some(function(f){return f.key===hsh;})) COV_SEL_FEATURE=hsh;
    }
    if(!COV_SEL_FEATURE || !COV_TAXONOMY.some(function(f){return f.key===COV_SEL_FEATURE;})) COV_SEL_FEATURE = COV_TAXONOMY[0].key;
    covRenderHealth();
    covRenderKpis();
    covRenderActiveChips();
    covRenderFeatureDetail();
    covBindIndexControls();
    covDrawTable();
    covRenderGaps();
    covRenderMatrix();
  });
  });
};

// re-render the surfaces that depend on COV_FILTER / COV_SEL_FEATURE
function covRefresh(){
  covRenderKpis();
  covRenderActiveChips();
  covRenderFeatureDetail();
  covDrawTable();
}

// ① coverage health strip
function covRenderHealth(){
  var host = el("cov-health"); if(!host) return;
  var well=0, thin=0, low=0;
  COV_TAXONOMY.forEach(function(f){ var n=COV_FEAT_COUNTS[f.key]||0; if(n>=10)well++; else if(n>=3)thin++; else low++; });
  var subGaps=0; for(var k in COV_SUB_COUNTS){ if(!(COV_SUB_COUNTS[k]||0)) subGaps++; }
  var undoc = (COV_UNDOCUMENTED||[]).length;
  host.innerHTML =
    '<div class="cov-h-item"><span class="v">'+COV_TAXONOMY.length+'</span><span class="k">features</span></div>'+
    '<div class="cov-h-item"><span class="v good">'+well+'</span><span class="k">well covered</span></div>'+
    '<div class="cov-h-item"><span class="v warn">'+thin+'</span><span class="k">thin</span></div>'+
    '<div class="cov-h-item"><span class="v warn">'+low+'</span><span class="k">low</span></div>'+
    '<div class="cov-h-item'+(subGaps?' warn':'')+'"><span class="v">'+subGaps+'</span><span class="k">sub-category gaps</span></div>'+
    '<div class="cov-h-item'+(undoc?' bad':'')+'" title="demo kernels with 0 features tagged in the doc"><span class="v">'+undoc+'</span><span class="k">undocumented</span></div>';
}

// ② KPI cards — click toggles the feature filter AND inspects it
function covRenderKpis(){
  var host = el("cov-kpis"); if(!host) return;
  var total = (COV_BUNDLES||[]).length || 1;
  host.innerHTML = COV_TAXONOMY.map(function(f){
    var n = COV_FEAT_COUNTS[f.key]||0;
    var pct = Math.round(n/total*100);
    var isOn = !!(COV_FILTER.vmi_features && COV_FILTER.vmi_features.has(f.key));
    var cls = "cov-kpi" + (isOn?" active":"") + (n===0?" gap":n<=2?" thin":"");
    var warn = "";
    if(f.subs){ for(var i=0;i<f.subs.length;i++){ if(!(COV_SUB_COUNTS[f.subs[i].key]||0)){ warn=' <span class="cov-legend-warn" title="a sub-category has 0 kernels">⚠</span>'; break; } } }
    return '<button class="'+cls+'" data-feat="'+esc(f.key)+'">'+
      '<div class="cov-kpi-label">'+esc(f.label)+warn+'</div>'+
      '<div class="cov-kpi-num">'+n+'<span class="cov-kpi-den"> / '+total+'</span></div>'+
      '<div class="cov-kpi-bar"><span style="width:'+pct+'%"></span></div>'+
      '</button>';
  }).join("");
  host.querySelectorAll(".cov-kpi").forEach(function(card){
    card.addEventListener("click", function(){
      var f = card.dataset.feat;
      COV_SEL_FEATURE = f;
      try{ history.replaceState(null,"","#cov="+f); }catch(e){}
      covToggleFilter("vmi_features", f, !(COV_FILTER.vmi_features && COV_FILTER.vmi_features.has(f)));
      covRefresh();
    });
  });
}

// active filter chips + clear
function covRenderActiveChips(){
  var host = el("cov-active"); if(!host) return;
  var af = covActiveFilters();
  if(!af.length){
    host.innerHTML='<span class="muted small">no filter — showing all '+((COV_BUNDLES||[]).length)+' kernels. Click a feature card (or a sub-category) to filter.</span>';
    return;
  }
  host.innerHTML = af.map(function(f){
    return '<span class="cov-achip" data-dim="'+esc(f.dim)+'" data-val="'+esc(f.val)+'">'+esc(f.label)+' ✕</span>';
  }).join("") + '<button class="cov-clear-bar" id="cov-clear-bar">Clear all</button>';
  host.querySelectorAll(".cov-achip").forEach(function(chip){
    chip.onclick = function(){ covToggleFilter(chip.dataset.dim, chip.dataset.val, false); covRefresh(); };
  });
  var cb = el("cov-clear-bar");
  if(cb) cb.onclick = function(){ COV_FILTER={}; covRefresh(); };
}

// ③ feature detail (inspected feature; sub-category bars are clickable filters)
function covRenderFeatureDetail(){
  var host = el("cov-feature-detail"); if(!host) return;
  var f = COV_TAXONOMY.filter(function(x){return x.key===COV_SEL_FEATURE;})[0] || COV_TAXONOMY[0];
  COV_SEL_FEATURE = f.key;
  var n = COV_FEAT_COUNTS[f.key]||0;
  var total = (COV_BUNDLES||[]).length;
  var list = (COV_BUNDLES||[]).filter(function(b){ return covKernelInfo(b).features.indexOf(f.key)>=0; });
  list.sort(function(a,b){ return a.kernel.localeCompare(b.kernel); });
  var html = '<div class="cov-detail-head">'+
    '<h3>'+esc(f.label)+' <span class="cov-detail-count '+(n===0?"bad":n<=2?"warn":"")+'">'+n+' / '+total+' kernels</span></h3>'+
    '<p>'+esc(f.desc)+'</p></div>';
  if(f.subs){
    var maxSub=0; f.subs.forEach(function(s){ maxSub=Math.max(maxSub, COV_SUB_COUNTS[s.key]||0); });
    html += '<div class="cov-subs">';
    f.subs.forEach(function(s){
      var sn = COV_SUB_COUNTS[s.key]||0;
      var pct = maxSub>0 ? Math.round(sn/maxSub*100) : 0;
      var isOn = !!(COV_FILTER.vmi_subs && COV_FILTER.vmi_subs.has(f.key+"/"+s.key));
      html += '<div class="cov-subbar-row'+(isOn?" active":"")+'" role="button" tabindex="0" data-sub="'+esc(f.key+'/'+s.key)+'" title="'+esc(s.label)+': '+sn+' kernel'+(sn===1?'':'s')+' — click to filter">'+
        '<div class="cov-sub-label">'+esc(s.label)+'</div>'+
        '<div class="cov-sub-bar'+(sn===0?" zero":sn<=1?" thin":"")+'"><span style="width:'+(sn===0?4:pct)+'%"></span></div>'+
        '<div class="cov-sub-num'+(sn===0?" bad":sn<=1?" warn":"")+'">'+sn+(sn===0?' ⚠':'')+'</div>'+
        '</div>';
    });
    html += '</div>';
  }
  html += '<h4>Kernels exercising '+esc(f.label)+'</h4>';
  if(list.length){
    html += '<ul class="cov-ev-list">';
    list.forEach(function(k){
      var info = covKernelInfo(k);
      html += '<li data-case="'+esc(k.case_id)+'">'+
        '<span class="cov-ev-kernel">'+esc(k.kernel)+'</span>'+
        '<span class="cov-ev-text">'+(info.evidence[f.key]&&info.evidence[f.key]!=="—" ? esc(info.evidence[f.key]) : '<span class="muted">(no evidence recorded)</span>')+'</span>'+
        '<a class="explore-link" data-explore="'+esc(k.case_id)+'" title="Open in Kernel Lab">explore ↗</a></li>';
    });
    html += '</ul>';
  } else {
    html += '<p class="muted">No demo kernel exercises this feature — a coverage gap.</p>';
  }
  host.innerHTML = html;
  host.querySelectorAll(".cov-subbar-row").forEach(function(b){
    b.addEventListener("click", function(){
      covToggleFilter("vmi_subs", b.dataset.sub, !(COV_FILTER.vmi_subs && COV_FILTER.vmi_subs.has(b.dataset.sub)));
      covRefresh();
    });
    b.addEventListener("keydown", function(e){ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); b.click(); } });
  });
  host.querySelectorAll("li[data-case]").forEach(function(li){
    li.addEventListener("click", function(e){ if(e.target.closest(".explore-link")) return; covToggleKernelDetail(li.dataset.case); });
  });
}

// index controls
function covBindIndexControls(){
  var s = el("cov-index-search"), sort = el("cov-index-sort");
  if(s){ s.oninput = function(){ covDrawTable(); }; }
  if(sort){ sort.onchange = function(){ covDrawTable(); }; }
}

// ④ reverse index (filtered by COV_FILTER + search + sort, click row → kernel detail)
function covDrawTable(){
  var all = COV_BUNDLES || [];
  var featF = all.filter(covMatches);
  var q = (el("cov-index-search") ? el("cov-index-search").value : "").trim().toLowerCase();
  var sort = el("cov-index-sort") ? el("cov-index-sort").value : "coverage";
  var rows = featF.filter(function(b){
    if(!q) return true;
    var info = covKernelInfo(b);
    return b.kernel.toLowerCase().indexOf(q)>=0 || info.features.join(" ").toLowerCase().indexOf(q)>=0;
  }).map(function(b){ var info = covKernelInfo(b); return {b:b, n:info.features.length, info:info}; });
  if(sort==="alpha") rows.sort(function(a,b){ return a.b.kernel.localeCompare(b.b.kernel); });
  else if(sort==="coverage-desc") rows.sort(function(a,b){ return b.n-a.n || a.b.kernel.localeCompare(b.b.kernel); });
  else rows.sort(function(a,b){ return a.n-b.n || a.b.kernel.localeCompare(b.b.kernel); });
  var cnt = el("cov-index-count"); if(cnt) cnt.textContent = "("+rows.length+" of "+all.length+")";
  var t = el("cov-table"); if(!t) return;
  t.innerHTML = thead(["kernel","features exercised","#"]) +
    rows.map(function(r){
      var chips = r.info.features.map(function(f){ return covChip(covTaxLabel(f),'pat'); }).join(" ") || '<span class="cov-undoc">undocumented</span>';
      return '<tr data-case="'+esc(r.b.case_id)+'"><td class="kernel clickable">'+esc(r.b.kernel)+' <a class="explore-link" data-explore="'+esc(r.b.case_id)+'" title="Open in Kernel Lab">explore ↗</a></td>'+
        '<td class="chips">'+chips+'</td>'+
        '<td class="num'+(r.n===0?' bad':'')+'">'+r.n+'</td></tr>';
    }).join("");
  t.querySelectorAll('tr[data-case]').forEach(function(tr){
    tr.addEventListener("click", function(){ covToggleKernelDetail(tr.dataset.case); });
  });
}

// kernel detail: expand a row to show all its features + evidence
function covToggleKernelDetail(case_id){
  var tr = document.querySelector('#cov-table tr[data-case="'+case_id+'"]');
  if(!tr) return;
  var next = tr.nextElementSibling;
  if(next && next.classList.contains("cov-kdetail-row")){ next.remove(); return; }
  var b = (COV_BUNDLES||[]).filter(function(x){ return x.case_id===case_id; })[0];
  if(!b) return;
  var info = covKernelInfo(b);
  var src = (COV_TAXO && COV_TAXO.source) || "docs/pto_vmi_features.md";
  var body = info.features.map(function(f){
    var lab = covTaxLabel(f);
    var ev = info.evidence[f] && info.evidence[f]!=="—" ? esc(info.evidence[f]) : '<span class="muted">(no evidence recorded)</span>';
    return '<div class="cov-kd-line"><button class="cov-kd-feat" data-feat="'+esc(f)+'" title="inspect this feature">'+esc(lab)+'</button><span class="cov-kd-ev">'+ev+'</span></div>';
  }).join("");
  if(!body) body = '<div class="cov-kd-line"><span class="cov-undoc">undocumented in '+esc(src)+' — no features tagged.</span></div>';
  var kd = document.createElement("tr");
  kd.className = "cov-kdetail-row";
  kd.innerHTML = '<td colspan="3"><div class="cov-kdetail"><div class="cov-kd-head">'+esc(b.kernel)+' — features &amp; evidence</div>'+body+'</div></td>';
  tr.after(kd);
  kd.querySelectorAll(".cov-kd-feat").forEach(function(btn){
    btn.addEventListener("click", function(){
      COV_SEL_FEATURE = btn.dataset.feat;
      covToggleFilter("vmi_features", btn.dataset.feat, true);
      covRefresh();
    });
  });
}

// ⑤ gaps + undocumented + doc gaps (inline, prominent)
function covRenderGaps(){
  var host = el("cov-gaps"); if(!host) return;
  var subGaps = [];
  COV_TAXONOMY.forEach(function(f){
    if(!f.subs) return;
    f.subs.forEach(function(s){ if(!(COV_SUB_COUNTS[s.key]||0)) subGaps.push({cat:f.key, label:f.label+" · "+s.label}); });
  });
  var undoc = COV_UNDOCUMENTED || [];
  var docGaps = (COV_TAXO && COV_TAXO.known_gaps) || [];
  var src = (COV_TAXO && COV_TAXO.source) || "docs/pto_vmi_features.md";
  var h = '<div class="cov-gaps-col"><h4>⚠ Coverage gaps — sub-categories with no demo kernel</h4><ul>';
  if(subGaps.length){ subGaps.forEach(function(g){ h+='<li class="cov-gap-item"><button class="cov-gap-btn" data-feat="'+esc(g.cat)+'">'+esc(g.label)+'</button> <span class="muted small">· add a demo kernel to the doc</span></li>'; }); }
  else h+='<li class="cov-ok-item">every sub-category has at least one demo kernel ✓</li>';
  h+='</ul></div>';
  h+='<div class="cov-gaps-col"><h4>🔍 Undocumented kernels (missing from the doc)</h4><ul>';
  if(undoc.length){ undoc.forEach(function(b){ h+='<li class="cov-gap-item">'+esc(b.kernel)+' <a class="explore-link" data-explore="'+esc(b.case_id)+'">explore ↗</a></li>'; }); }
  else h+='<li class="cov-ok-item">every demo kernel is tagged in the doc ✓</li>';
  h+='</ul></div>';
  h+='<div class="cov-gaps-col"><h4>Known gaps <span class="muted small">(from '+esc(src)+')</span></h4><ul>';
  if(docGaps.length){ docGaps.forEach(function(g){ h+='<li class="cov-gap-item">'+esc(g)+'</li>'; }); }
  else h+='<li class="cov-ok-item">(none recorded in the doc)</li>';
  h+='</ul></div>';
  host.innerHTML = h;
  host.querySelectorAll(".cov-gap-btn").forEach(function(btn){
    btn.addEventListener("click", function(){
      COV_SEL_FEATURE = btn.dataset.feat;
      covToggleFilter("vmi_features", btn.dataset.feat, true);
      covRefresh();
    });
  });
}

// ⑥ advanced matrix (cell click → inspect + filter)
function covRenderMatrix(){
  var mat = el("cov-matrix"); if(!mat) return;
  var bundles = COV_BUNDLES || [];
  var byKernel = {}; bundles.forEach(function(b){ byKernel[b.kernel]=b; });
  var kernels = bundles.map(function(b){return b.kernel;}).sort();
  var h='<table class="cov-mat-table"><thead><tr><th>Feature \\ Kernel</th>';
  kernels.forEach(function(k){ h+='<th class="cov-colhead" title="'+esc(k)+'">'+esc(k.replace(/Kernel$/,"").replace(/Vf$/,"Vf"))+'</th>'; });
  h+='</tr></thead><tbody>';
  COV_TAXONOMY.forEach(function(cat){
    h+='<tr class="cov-cat-row" data-cat="'+esc(cat.key)+'"><td class="cov-rowhead cov-cat-head'+(cat.subs?" cov-has-subs":"")+'" title="'+esc(cat.desc)+'">'+
       (cat.subs?'<span class="cov-caret" data-cat="'+esc(cat.key)+'" title="collapse/expand">▾</span> ':"")+
       esc(cat.label)+' <span class="muted">('+(COV_FEAT_COUNTS[cat.key]||0)+')</span></td>';
    kernels.forEach(function(k){
      var b=byKernel[k]; var info=b?covKernelInfo(b):{features:[],evidence:{}};
      var has=info.features.indexOf(cat.key)>=0;
      var ev=info.evidence[cat.key]||"";
      h+='<td class="cov-cell '+(has?'cov-hit':'cov-miss')+'" data-feat="'+esc(cat.key)+'" data-kernel="'+esc(k)+'" title="'+esc(k+(has?": "+ev:" — not covered"))+'">'+(has?'✓':'·')+'</td>';
    });
    h+='</tr>';
    if(cat.subs){
      cat.subs.forEach(function(sub){
        h+='<tr class="cov-sub-row" data-cat="'+esc(cat.key)+'"><td class="cov-rowhead cov-sub-head" title="'+esc(sub.label)+'">↳ '+esc(sub.label)+' <span class="muted">('+(COV_SUB_COUNTS[sub.key]||0)+')</span></td>';
        kernels.forEach(function(k){
          var b=byKernel[k]; var subs=b?covSubs(b,cat.key):{}; var has=!!subs[sub.key];
          h+='<td class="cov-cell '+(has?'cov-hit sub':'cov-miss')+'" data-feat="'+esc(cat.key)+'" data-sub="'+esc(sub.key)+'" data-kernel="'+esc(k)+'" title="'+(has?esc(sub.label):esc(k+' — not covered'))+'">'+(has?'✓':'·')+'</td>';
        });
        h+='</tr>';
      });
    }
  });
  h+='</tbody></table>';
  mat.innerHTML = h;
  mat.querySelectorAll(".cov-cell.cov-hit").forEach(function(c){
    c.addEventListener("click", function(){
      COV_SEL_FEATURE = c.dataset.feat;
      covToggleFilter("vmi_features", c.dataset.feat, true);
      covRefresh();
      var d=document.getElementById("cov-feature-detail"); if(d) d.scrollIntoView({behavior:"smooth", block:"nearest"});
    });
  });
  mat.querySelectorAll(".cov-caret").forEach(function(c){
    c.addEventListener("click", function(e){
      e.stopPropagation();
      var cat=c.dataset.cat, row=c.closest("tr"), collapsed=row.classList.toggle("collapsed");
      var n=row.nextElementSibling;
      while(n && n.classList.contains("cov-sub-row") && n.getAttribute("data-cat")===cat){
        n.style.display=collapsed?"none":""; n=n.nextElementSibling;
      }
      c.textContent=collapsed?"▸":"▾";
    });
  });
}

// mutate the filter set (callers re-render via covRefresh)
function covToggleFilter(dim, val, on){
  if(!COV_FILTER[dim]) COV_FILTER[dim]=new Set();
  if(on){ COV_FILTER[dim].add(val); }
  else { COV_FILTER[dim].delete(val); }
  if(dim==="vmi_subs"){
    var cat=val.split("/")[0];
    if(on){ if(!COV_FILTER.vmi_features) COV_FILTER.vmi_features=new Set(); COV_FILTER.vmi_features.add(cat); }
  } else if(dim==="vmi_features"){
    if(!on){
      if(COV_FILTER.vmi_subs){
        var toDel=[];
        COV_FILTER.vmi_subs.forEach(function(sv){ if(sv.indexOf(val+"/")===0) toDel.push(sv); });
        toDel.forEach(function(sv){ COV_FILTER.vmi_subs.delete(sv); });
        if(!COV_FILTER.vmi_subs.size) delete COV_FILTER.vmi_subs;
      }
    }
  }
  if(COV_FILTER[dim] && !COV_FILTER[dim].size) delete COV_FILTER[dim];
}

// active filter chips (dimension → values) for covRenderActiveChips
function covActiveFilters(){
  var out = [];
  for(var dim in COV_FILTER){
    var vals = COV_FILTER[dim];
    if(!vals || !vals.size) continue;
    vals.forEach(function(v){ out.push({dim:dim, val:v, label:covTaxLabel(dim==='vmi_subs'?v.split('/')[1]:v)}); });
  }
  return out;
}

/* ---------------- THEORY VS ACTUAL ---------------- */
var TH_DATA = null;
function loadTheory(cb){
  if(TH_DATA){ cb(TH_DATA); return; }
  fetch("theory_vs_actual.json").then(function(r){
    if(!r.ok) throw new Error("HTTP "+r.status);
    return r.json();
  }).then(function(d){
    TH_DATA = d||[];
    try { cb(TH_DATA); } catch(e){ console.log("PROBE: theory render err: "+e.message); }
  }).catch(function(e){
    console.log("PROBE: theory fetch err: "+e.message);
    if(!TH_DATA){ TH_DATA=[]; cb([]); }
  });
}
VIEWS.theory = function(){
  loadTheory(function(data){
    el("th-count").textContent = "("+data.length+" kernels)";
    if(!data.length){ el("th-scatter").innerHTML='<p class="muted">no theory data</p>'; return; }
    // per-kernel gaps (CCE + VMI) vs theory lower, plus an in-range flag
    data.forEach(function(d){
      var lo = d.theory_lower || d.theory || 0;
      d.gap_cce = lo ? Math.round((d.cce - lo)/lo*100) : null;
      d.gap_vmi = lo ? Math.round((d.vmi - lo)/lo*100) : null;
      var hi = d.theory_higher || lo;
      d.in_range = (d.cce>=lo && d.cce<=hi && d.vmi>=lo && d.vmi<=hi);
    });
    // KPI strip
    function avg(arr){ var n=arr.filter(function(x){return x!=null;}); return n.length?Math.round(n.reduce(function(a,b){return a+b;},0)/n.length):null; }
    function pct(g){ return g==null ? "—" : (g>0?"+":"")+g+"%"; }
    function gcls(g){ return g==null ? "" : (g>0 ? "bad" : "good"); }
    var avgCCE = avg(data.map(function(d){return d.gap_cce;}));
    var avgVMI = avg(data.map(function(d){return d.gap_vmi;}));
    var inRange = data.filter(function(d){return d.in_range;}).length;
    el("th-kpis").innerHTML =
      '<div class="cp-kpi"><div class="k">kernels</div><div class="v">'+data.length+'</div><div class="s">matched pairs with theory data</div></div>'+
      '<div class="cp-kpi '+gcls(avgCCE)+'"><div class="k">avg CCE gap</div><div class="v">'+pct(avgCCE)+'</div><div class="s">actual vs theory lower</div></div>'+
      '<div class="cp-kpi '+gcls(avgVMI)+'"><div class="k">avg VMI gap</div><div class="v">'+pct(avgVMI)+'</div><div class="s">actual vs theory lower</div></div>'+
      '<div class="cp-kpi"><div class="k">in range</div><div class="v">'+inRange+'/'+data.length+'</div><div class="s">actual within [lo–hi]</div></div>';
    // 1. gap chart (CCE + VMI grouped, sorted by worst deviation)
    var gapData = data.slice().sort(function(a,b){
      var wa=Math.max(Math.abs(a.gap_cce||0),Math.abs(a.gap_vmi||0));
      var wb=Math.max(Math.abs(b.gap_cce||0),Math.abs(b.gap_vmi||0));
      return wb-wa;
    });
    drawGapBars("th-scatter", gapData);
    // 2. IPC scatter (theory x vs actual y, CCE + VMI)
    var ipcData = [];
    data.forEach(function(d){
      var tip=d.kernel+" | th_ipc="+d.th_ipc+" cce_ipc="+d.cce_ipc+" vmi_ipc="+(d.vmi_ipc||"?")
        +" | range=["+d.theory_lower+", "+d.theory_higher+"] loop="+d.loop_count+" epc="+d.th_epc;
      if(d.th_ipc && d.cce_ipc) ipcData.push({case_id:d.case_id, kernel:d.kernel, _x:d.th_ipc, _y:d.cce_ipc, _side:"CCE", _tip:tip});
      if(d.th_ipc && d.vmi_ipc) ipcData.push({case_id:d.case_id, kernel:d.kernel, _x:d.th_ipc, _y:d.vmi_ipc, _side:"VMI", _tip:tip});
    });
    scatterWithTip("th-ipc-scatter", ipcData, "Theory IPC", "Actual IPC", 3);
    // 3. table (sortable, VMI first + both gaps)
    var sortSel = el("th-sort");
    function drawTable(){
      var sk = sortSel ? sortSel.value : "theory_desc";
      var sorted = data.slice().sort(function(a,b){
        var ga = a.gap_cce||0, gb = b.gap_cce||0;
        switch(sk){
          case "theory_asc": return (a.theory||0)-(b.theory||0);
          case "cce_desc": return (b.cce||0)-(a.cce||0);
          case "vmi_desc": return (b.vmi||0)-(a.vmi||0);
          case "gap_desc": return Math.abs(gb)-Math.abs(ga);
          case "gap_asc": return Math.abs(ga)-Math.abs(gb);
          case "th_ipc_desc": return (b.th_ipc||0)-(a.th_ipc||0);
          case "cce_ipc_desc": return (b.cce_ipc||0)-(a.cce_ipc||0);
          case "kernel": return a.kernel<b.kernel?-1:(a.kernel>b.kernel?1:0);
          default: return (b.theory||0)-(a.theory||0);
        }
      });
      el("th-table-note").textContent = "("+sorted.length+" kernels)";
      var t=el("th-table");
      function gpct(g){ return g==null?'—':(g>0?'+':'')+g+'%'; }
      t.innerHTML=thead(["kernel","per-iter [lo–hi]","total [lo–hi]","VMI","VMI gap%","CCE","CCE gap%","bound","loops","src","th IPC","VMI IPC","CCE IPC","th EPC","explore"])+
        sorted.map(function(d){
          var perIterRange = d.per_iter_lower ? (d.per_iter_lower+(d.per_iter_higher?"–"+d.per_iter_higher:"")) : "—";
          var totalRange = d.theory_lower ? (d.theory_lower+(d.theory_higher?"–"+d.theory_higher:"")) : (d.theory||"—");
          var auto = d.auto !== false;
          var srcLabel = auto ? '<span class="muted small">auto</span>' : '<span class="whl-badge pending" title="'+esc(d.note||'')+'">MANUAL</span>';
          return '<tr data-case="'+esc(d.case_id)+'"><td class="kernel clickable">'+esc(d.kernel)+'</td>'+
            '<td class="num" style="font-weight:600">'+perIterRange+'</td>'+
            '<td class="num muted">'+totalRange+'</td>'+
            '<td class="num">'+d.vmi+'</td><td class="num">'+gpct(d.gap_vmi)+'</td>'+
            '<td class="num">'+d.cce+'</td><td class="num">'+gpct(d.gap_cce)+'</td>'+
            '<td class="muted small">'+esc(d.bound)+'</td>'+
            '<td class="num muted">'+(d.loop_count||"—")+'</td>'+
            '<td>'+srcLabel+'</td>'+
            '<td class="num">'+(d.th_ipc?d.th_ipc.toFixed(3):'—')+'</td>'+
            '<td class="num">'+(d.vmi_ipc?d.vmi_ipc.toFixed(3):'—')+'</td>'+
            '<td class="num">'+(d.cce_ipc?d.cce_ipc.toFixed(3):'—')+'</td>'+
            '<td class="num">'+(d.th_epc?d.th_epc.toFixed(2):'—')+'</td>'+
            '<td><a class="explore-link" data-explore="'+esc(d.case_id)+'">explore ↗</a></td></tr>';
        }).join("");
      t.querySelectorAll('tr[data-case]').forEach(function(tr){tr.addEventListener("click",function(){openCompareModal(tr.dataset.case);});});
    }
    if(sortSel) sortSel.addEventListener("change", drawTable);
    drawTable();
  });
};

// gap% bar chart for the theory page (CCE + VMI grouped, diverging around 0%)
function drawGapBars(id, data){
  var host=el(id); if(!host) return;
  if(!data.length){ host.innerHTML='<p class="empty-state">no data</p>'; return; }
  var W=780, rowH=22, H=data.length*rowH+64, padL=180, padR=40, padT=28;
  var maxAbs=10;
  data.forEach(function(d){ maxAbs = Math.max(maxAbs, Math.abs(d.gap_cce||0), Math.abs(d.gap_vmi||0)); });
  var zeroX = padL + (W-padL-padR)/2;
  var scale = (W-padL-padR)/(2*maxAbs);
  var sx=function(g){ return zeroX + g*scale; };
  var s=svgOpen(W,H);
  s+='<line x1="'+zeroX+'" y1="'+padT+'" x2="'+zeroX+'" y2="'+(H-40)+'" stroke="var(--muted)" stroke-dasharray="3 3"/>';
  s+='<text x="'+zeroX+'" y="'+(H-30)+'" text-anchor="middle" fill="var(--muted)" font-size="9">0% = theory lower</text>';
  s+='<text x="'+padL+'" y="14" fill="var(--good)" font-size="10">← faster than theory</text>';
  s+='<text x="'+(W-padR)+'" y="14" text-anchor="end" fill="var(--bad)" font-size="10">slower than theory →</text>';
  data.forEach(function(d,i){
    var y=padT+i*rowH;
    var lbl=esc(d.kernel); if(lbl.length>22) lbl=lbl.slice(0,21)+'…';
    var inRange = d.in_range;
    var g1=d.gap_cce||0, g2=d.gap_vmi||0;
    var x1=Math.min(zeroX,sx(g1)), w1=Math.abs(g1)*scale;
    var x2=Math.min(zeroX,sx(g2)), w2=Math.abs(g2)*scale;
    var tipTxt = d.kernel+" | CCE gap="+(g1>0?"+":"")+g1+"%  VMI gap="+(g2>0?"+":"")+g2+"%"
      +" | theory=["+(d.theory_lower||"?")+", "+(d.theory_higher||"?")+"]"
      +" | cce="+d.cce+"c vmi="+d.vmi+"c"
      +" | "+(inRange?'✓ within range':'⚠ outside range');
    s+='<text x="'+(padL-6)+'" y="'+(y+11)+'" text-anchor="end" fill="'+(inRange?'var(--good)':'var(--muted)')+'" font-size="9.5">'+(inRange?'✓ ':'')+lbl+'</text>';
    s+='<g class="pt" data-case="'+esc(d.case_id)+'" data-tip="'+esc(tipTxt)+'">'+
       '<rect x="'+(padL-4)+'" y="'+(y-1)+'" width="'+(W-padL-padR+4)+'" height="'+(rowH-1)+'" fill="transparent"/>'+
       '<rect x="'+x1+'" y="'+y+'" width="'+w1+'" height="8" fill="var(--cce)" opacity="0.85" rx="2"/>'+
       '<rect x="'+x2+'" y="'+(y+11)+'" width="'+w2+'" height="8" fill="var(--vmi)" opacity="0.9" rx="2"/></g>';
  });
  // legend
  var ly=H-16;
  s+='<rect x="'+padL+'" y="'+ly+'" width="12" height="8" fill="var(--cce)" rx="1"/>';
  s+='<text x="'+(padL+16)+'" y="'+(ly+7)+'" fill="var(--heading)" font-size="9">CCE</text>';
  s+='<rect x="'+(padL+56)+'" y="'+ly+'" width="12" height="8" fill="var(--vmi)" rx="1"/>';
  s+='<text x="'+(padL+72)+'" y="'+(ly+7)+'" fill="var(--heading)" font-size="9">VMI</text>';
  s+='<text x="'+(padL+116)+'" y="'+(ly+7)+'" fill="var(--good)" font-size="9">✓ within [lo–hi] range</text>';
  host.innerHTML=svgClose(s);
  // hover tooltip
  var tip=host.querySelector(".scatter-tip")||function(){var d=document.createElement("div");d.className="scatter-tip";host.style.position="relative";host.appendChild(d);return d;}();
  var hideTimer=null;
  function showTip(pt){ if(hideTimer){clearTimeout(hideTimer);hideTimer=null;}
    var tipText=pt.getAttribute("data-tip")||""; var cid=pt.getAttribute("data-case");
    tip.innerHTML='<div class="st-line">'+tipText+'</div><div class="st-actions"><a class="st-act" data-act="detail" data-case="'+esc(cid)+'">peek</a><a class="st-act st-explore" data-act="explore" data-case="'+esc(cid)+'">explore ↗</a></div>';
    tip.classList.add("show"); var rect=host.getBoundingClientRect(),pr=pt.getBoundingClientRect(); var left=pr.left-rect.left+12,top=pr.top-rect.top-6; if(left+200>host.offsetWidth)left=pr.left-rect.left-200; if(top<4)top=pr.bottom-rect.top+8; tip.style.left=left+"px";tip.style.top=top+"px"; }
  function scheduleHide(){ if(hideTimer)clearTimeout(hideTimer); hideTimer=setTimeout(function(){tip.classList.remove("show");hideTimer=null;},120); }
  host.querySelectorAll(".pt").forEach(function(pt){ pt.style.cursor="pointer";
    pt.addEventListener("mouseenter",function(){showTip(pt);}); pt.addEventListener("mouseleave",scheduleHide);
    pt.addEventListener("click",function(e){if(e.target.classList.contains("st-act"))return; openModal(pt.getAttribute("data-case"));}); });
  tip.addEventListener("mouseenter",function(){if(hideTimer){clearTimeout(hideTimer);hideTimer=null;}}); tip.addEventListener("mouseleave",scheduleHide);
  tip.addEventListener("click",function(e){var a=e.target.closest(".st-act");if(!a)return;e.preventDefault();e.stopPropagation();var act=a.getAttribute("data-act"),cid=a.getAttribute("data-case");tip.classList.remove("show");if(act==="explore")exploreKernel(cid);else openModal(cid);});
}

// scatter with hover tooltip (theory page variant — colored by _side, tooltip from _tip)
function scatterWithTip(id, data, lx, ly, dec){
  var host=el(id); if(!host) return;
  var W=480,H=420, pad=42;
  var xs=data.map(function(d){return d._x;}).filter(function(x){return x!=null&&isFinite(x);});
  var ys=data.map(function(d){return d._y;}).filter(function(x){return x!=null&&isFinite(x);});
  if(!xs.length){ host.innerHTML='<p class="empty-state">no data</p>'; return; }
  var max=Math.max.apply(null, xs.concat(ys))*1.08, min=0;
  if(dec===3) max=Math.max(max,1.1);
  var sx=function(x){return pad+(x-min)/(max-min)*(W-pad-pad);};
  var sy=function(y){return H-pad-(y-min)/(max-min)*(H-pad-pad);};
  var s=svgOpen(W,H);
  for(var g=0;g<=4;g++){var val=min+(max-min)*g/4; s+='<g class="grid"><line x1="'+pad+'" x2="'+(W-pad)+'" y1="'+sy(val)+'" y2="'+sy(val)+'"/></g>';}
  s+='<g class="axis"><line x1="'+pad+'" y1="'+(H-pad)+'" x2="'+(W-pad)+'" y2="'+(H-pad)+'"/><line x1="'+pad+'" y1="'+pad+'" x2="'+pad+'" y2="'+(H-pad)+'"/></g>';
  s+='<line class="diag" x1="'+pad+'" y1="'+(H-pad)+'" x2="'+(W-pad)+'" y2="'+pad+'"/>';
  [0.5,0.75,0.9,0.95,1.05,1.1,1.25,1.5,2.0].forEach(function(r){
    var xa=min,xb=max,ya=r*xa,yb=r*xb;
    if(ya>max&&yb>max)return; if(ya<min&&yb<min)return;
    var xa2=xa,xb2=xb,yt=r*xa2,yb2=r*xb2;
    if(yt>max){xa2=max/r;yt=max;}else if(yt<min){xa2=min/r;yt=min;}
    if(yb2>max){xb2=max/r;yb2=max;}else if(yb2<min){xb2=min/r;yb2=min;}
    xa2=Math.max(min,Math.min(max,xa2));xb2=Math.max(min,Math.min(max,xb2));
    var pct=Math.round((r-1)*100);var lbl=(pct>0?"+":"")+pct+"%";
    s+='<line class="refln" x1="'+sx(xa2)+'" y1="'+sy(yt)+'" x2="'+sx(xb2)+'" y2="'+sy(yb2)+'"/>';
    var lx2=sx(xb2),ly2=sy(yb2); if(ly2<pad+10)ly2=pad+10; if(ly2>H-pad-6)ly2=H-pad-6; if(lx2>W-pad-4)lx2=W-pad-4; if(lx2<pad+20)lx2=pad+20;
    s+='<text class="refln-lbl '+(r>1?"vmi":"cce")+'" x="'+lx2+'" y="'+ly2+'" text-anchor="end" dx="-3" dy="-3">'+lbl+'</text>';
  });
  // points
  data.forEach(function(d){
    var x=d._x,y=d._y; if(x==null||y==null) return;
    var col = d._side==="VMI" ? "var(--vmi)" : "var(--cce)";
    var tip = d._tip || (d.kernel+" "+d._side);
    s+='<g class="pt" data-case="'+esc(d.case_id)+'" data-tip="'+esc(tip)+'"><circle cx="'+sx(x)+'" cy="'+sy(y)+'" r="5" fill="'+col+'" opacity="0.8"/><circle cx="'+sx(x)+'" cy="'+sy(y)+'" r="10" fill="transparent" class="pt-hit"/></g>';
  });
  s+='<text class="axis-title" x="'+(W/2)+'" y="'+(H-10)+'" text-anchor="middle">'+esc(lx)+'</text>';
  s+='<text class="axis-title" transform="rotate(-90 14 '+fmt(H/2,0)+')" x="14" y="'+fmt(H/2,0)+'" text-anchor="middle">'+esc(ly)+'</text>';
  s+='<g class="axis">';
  for(g=0;g<=4;g++){var val=min+(max-min)*g/4; s+='<text x="'+pad+'" y="'+sy(val)+'" text-anchor="end" dx="-6" dy="3">'+fmt(val,dec)+'</text>'; s+='<text x="'+sx(val)+'" y="'+(H-pad)+'" text-anchor="middle" dy="16">'+fmt(val,dec)+'</text>'; }
  s+='</g>';
  s+='<text x="'+(W-pad-8)+'" y="'+(pad+12)+'" text-anchor="end" fill="var(--good)" font-size="9">● CCE</text>';
  s+='<text x="'+(W-pad-8)+'" y="'+(pad+26)+'" text-anchor="end" fill="var(--vmi)" font-size="9">● VMI</text>';
  host.innerHTML=svgClose(s);
  var tip=host.querySelector(".scatter-tip")||function(){var d=document.createElement("div");d.className="scatter-tip";host.style.position="relative";host.appendChild(d);return d;}();
  var hideTimer=null;
  function showTip(pt){ if(hideTimer){clearTimeout(hideTimer);hideTimer=null;}
    var tipText=pt.getAttribute("data-tip")||""; var cid=pt.getAttribute("data-case");
    tip.innerHTML='<div class="st-line">'+tipText+'</div><div class="st-actions"><a class="st-act" data-act="detail" data-case="'+esc(cid)+'">peek</a><a class="st-act st-explore" data-act="explore" data-case="'+esc(cid)+'">explore ↗</a></div>';
    tip.classList.add("show"); var rect=host.getBoundingClientRect(),pr=pt.getBoundingClientRect(); var left=pr.left-rect.left+12,top=pr.top-rect.top-6; if(left+180>host.offsetWidth)left=pr.left-rect.left-180; if(top<4)top=pr.bottom-rect.top+8; tip.style.left=left+"px";tip.style.top=top+"px"; }
  function scheduleHide(){ if(hideTimer)clearTimeout(hideTimer); hideTimer=setTimeout(function(){tip.classList.remove("show");hideTimer=null;},120); }
  host.querySelectorAll(".pt").forEach(function(pt){ pt.style.cursor="pointer";
    pt.addEventListener("mouseenter",function(){showTip(pt);}); pt.addEventListener("mouseleave",scheduleHide);
    pt.addEventListener("click",function(e){if(e.target.classList.contains("st-act"))return; openModal(pt.getAttribute("data-case"));}); });
  tip.addEventListener("mouseenter",function(){if(hideTimer){clearTimeout(hideTimer);hideTimer=null;}}); tip.addEventListener("mouseleave",scheduleHide);
  tip.addEventListener("click",function(e){var a=e.target.closest(".st-act");if(!a)return;e.preventDefault();e.stopPropagation();var act=a.getAttribute("data-act"),cid=a.getAttribute("data-case");tip.classList.remove("show");if(act==="explore")exploreKernel(cid);else openModal(cid);});
}

/* ---------------- CRITICAL PATH (cost model) ---------------- */
var CP_DATA = null;
function loadCriticalPath(cb){
  if(CP_DATA){ cb(CP_DATA); return; }
  fetch("critical_path.json").then(function(r){
    if(!r.ok) throw new Error("HTTP "+r.status);
    return r.json();
  }).then(function(d){
    CP_DATA = d||[];
    try { cb(CP_DATA); } catch(e){ console.log("PROBE: critical-path render err: "+e.message); }
  }).catch(function(e){
    console.log("PROBE: critical-path fetch err: "+e.message);
    if(!CP_DATA){ CP_DATA=[]; cb([]); }
  });
}
var CP_PENDING = null;
function jumpToCriticalPath(kernel, openDetail){
  CP_PENDING = {kernel: kernel, detail: !!openDetail};
  var tab = document.querySelector('.tab[data-view="criticalpath"]');
  if(tab){ tab.click(); }
}
function renderExplorerDag(){
  var host = el("explorer-cpdag");
  if(!host || !EX_BUNDLE || !EX_BUNDLE.kernel) return;
  var kernel = EX_BUNDLE.kernel;
  loadCriticalPath(function(list){
    var d = (list||[]).find(function(x){ return x.kernel===kernel; });
    var noteEl = el("explorer-dag-note");
    if(d && d.dag){
      function chainHtml(chain){
        return (chain||[]).map(function(c,i){
          return (i>0?'<span class="cp-flow-arrow">→</span>':'')+
            '<span class="cp-chip" style="'+cpSuStyle(c.subunit)+'" title="'+esc(c.op+(c.reg?' → '+c.reg:'')+' · '+c.subunit+' · lat '+c.latency)+'">'+esc(c.op)+'<span class="lat"> '+(c.latency!=null?c.latency:"?")+'</span></span>';
        }).join("");
      }
      function dagPanel(title, color, cpVal, chain, side){
        var panel = document.createElement("div");
        panel.className = "cp-dag-side";
        panel.innerHTML = '<h4 class="cp-dag-side-title" style="color:'+color+'">● '+title+' <span class="muted small">· '+cpVal+' cyc</span></h4>'+
          (chain && chain.length?'<div class="cp-detail-chain">'+chainHtml(chain)+'</div>':'');
        var w = document.createElement("div");
        w.className = "cp-dag-wrap";
        panel.appendChild(w);
        drawCpDag(d, w, side);
        return panel;
      }
      var dagCp = (d.dag.critical_path!=null) ? d.dag.critical_path : d.critical_path;
      var dslChain = (d.dsl_dag && d.dsl_dag.critical) ? d.dsl_dag.critical.map(function(i){ return d.dsl_dag.nodes[i]; }) : [];
      var dslCp = d.dsl_critical_path;

      host.innerHTML = '<div class="cp-dag-chain-header"><strong>'+esc(d.kernel)+'</strong> · '+cpVerdictBadge(d.verdict)+
        (d.excluded?' · <span class="cp-excl-badge" title="'+esc(d.excluded_reason||'excluded')+'">⚠ excluded</span>':'')+'</div>';
      var duo = document.createElement("div");
      duo.className = "cp-dag-duo";
      var ccePanel = dagPanel("CCE", "var(--cce)", dagCp!=null?dagCp:"?", d.chain||[], "cce");
      duo.appendChild(ccePanel);
      if(EX_EDITED_CP && EX_EDITED_CP.kernel===kernel && EX_EDITED_CP.critical_path!=null){
        var oCp = dagCp, eCp = EX_EDITED_CP.critical_path;
        var dCp = (oCp!=null) ? (eCp - oCp) : null;
        var ech = chainHtml(EX_EDITED_CP.chain||[]);
        var edDiv = document.createElement("div");
        edDiv.className = "cp-dag-edited"+(dCp!=null?(dCp>0?" worse":dCp<0?" better":""):"");
        edDiv.innerHTML = '<div class="cp-dag-chain-header">✏️ edited — critical path <strong>'+(eCp!=null?eCp:'?')+' cyc</strong>'+
          (dCp!=null?' <span class="'+(dCp>0?'cp-delta-worse':dCp<0?'cp-delta-better':'')+'">(Δ '+(dCp>0?'+':'')+dCp+' cyc vs original)</span>':'')+'</div>'+
          (ech?'<div class="cp-detail-chain">'+ech+'</div>':'');
        ccePanel.appendChild(edDiv);
      }
      var dslPanel = dagPanel("DSL", "var(--vmi)", dslCp!=null?dslCp:"—", dslChain, "dsl");
      duo.appendChild(dslPanel);
      host.appendChild(duo);
      if(noteEl) noteEl.innerHTML = '○ CCE (left) vs DSL (right) critical paths'+(EX_EDITED_CP&&EX_EDITED_CP.kernel===kernel?' · ✏️ edited CCE below the original CCE graph':'')+'.';
    } else { host.innerHTML = '<p class="muted small">critical-path DAG unavailable for this kernel.</p>'; }
  });
}

function exReportRow(b){
  if(!b) return null;
  return ROWS.find(function(x){ return b.case_id && x.case_id===b.case_id; }) ||
         ROWS.find(function(x){ return b.kernel && x.kernel===b.kernel; });
}
function switchExTab(name){
  var tab = document.querySelector('.ex-tab[data-extab="'+name+'"]');
  if(tab){ tab.click(); return; }
  EX_PENDING_TAB = name;  // Explorer not yet rendered — apply once the bundle loads
}
function openKernelDetail(caseId){
  exploreKernel(caseId);
  switchExTab("overview");
}
var DETAIL_DRAWER_CASE = null;
function showKernelDetail(caseId){
  var r = ROWS.find(function(x){ return x.case_id===caseId; }) || ROWS.find(function(x){ return x.kernel===caseId; });
  if(!r) return;
  DETAIL_DRAWER_CASE = r.case_id;
  var title = el("detail-drawer-title"); if(title) title.textContent = r.case_id;
  var c=r.cce, v=r.vmi;
  var matched = v && v.ex!=null;
  var cceSrc = ' <a class="src-link" href="'+srcUrl(r.kernel,'cce')+'" target="_blank" rel="noopener">cce ↗</a>';
  var vmiSrc = (r.vmi_kernel && r.vmi_kernel!=="—") ? ' <a class="src-link" href="'+srcUrl(r.vmi_kernel,'dsl')+'" target="_blank" rel="noopener">dsl ↗</a>' : '';
  var html = '<div class="dd-kernelline"><strong>CCE:</strong> '+esc(r.kernel)+cceSrc+' &nbsp; <strong>VMI/DSL:</strong> '+(matched?esc(r.vmi_kernel):'—')+vmiSrc+'</div>';
  html += '<div class="dd-sec">'+gapComment(c, v, r)+'</div>';
  if(matched){
    html += '<div class="dd-sec"><div class="dd-sec-title">Metrics (CCE / VMI)</div>'+exMetricsTable(c, v)+
      '<div class="dd-line"><strong>Verdict:</strong> '+badge(verdictOf(r))+' &nbsp; ratio: '+ratioStr(r)+'</div>'+
      '<div class="dd-line"><strong>Top stalls:</strong> CCE <code>'+esc(c.top_stall||"—")+'</code> · VMI <code>'+esc(v.top_stall||"—")+'</code></div></div>';
    html += '<div class="dd-sec"><div class="dd-sec-title">Instruction list — CCE vs VMI</div>'+instrCompare(c.instr_list, v.instr_list)+'</div>';
  } else {
    html += '<div class="dd-sec"><div class="dd-sec-title">CCE-only metrics</div><div class="metric-row">'+
      m2("EX",c.ex)+m2("SU",c.su)+m2("pred",c.pred)+m2("LD",c.ld)+m2("ST",c.st)+m2("SCALAR",c.scalar)+m2("vf_real",c.vf_real)+m2("IPC",fmt(c.ipc,3))+m2("EX-IPC",fmt(c.ex_ipc,3))+'</div></div>';
  }
  html += '<div class="dd-sec"><div class="dd-sec-title">Analyst conclusion <span class="muted small">(shared with Kernel Lab)</span></div>'+
    '<div id="dd-conclusion-text" class="conclusion-text" contenteditable="true" placeholder="Add your conclusion about the performance gap..."></div>'+
    '<div class="conclusion-toolbar"><button id="dd-conclusion-save" class="conclusion-save-btn">💾 Save</button><span id="dd-conclusion-status" class="muted small"></span></div></div>';
  el("detail-drawer-body").innerHTML = html;
  el("detail-drawer").classList.remove("hidden");
  wireConclusion(r.case_id, "dd-conclusion-text", "dd-conclusion-save", "dd-conclusion-status");
}
function hideKernelDetail(){
  var d = el("detail-drawer");
  if(d) d.classList.add("hidden");
}
var ddClose = el("detail-drawer-close");
if(ddClose) ddClose.addEventListener("click", hideKernelDetail);
var ddExplore = el("detail-drawer-explore");
if(ddExplore) ddExplore.addEventListener("click", function(){
  var c = DETAIL_DRAWER_CASE;
  hideKernelDetail();
  if(c) openKernelDetail(c);
});
function wireConclusion(caseId, textId, saveId, statusId){
  var text = el(textId);
  if(!text) return;
  var status = statusId ? el(statusId) : null;
  var save = saveId ? el(saveId) : null;
  fetch("/conclusion/"+encodeURIComponent(caseId)).then(function(r){return r.json();}).then(function(d){
    if(d.text){ text.innerHTML = d.text; text.classList.add("has-content"); }
    else { text.classList.remove("has-content"); }
  }).catch(function(){});
  if(save){
    save.addEventListener("click", function(){
      var t = text.innerHTML.trim();
      if(status) status.textContent = "Saving...";
      fetch("/conclusion/"+encodeURIComponent(caseId), {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({case_id: caseId, text: t})
      }).then(function(r){return r.json();}).then(function(d){
        if(d.saved){
          if(status) status.textContent = "✅ Saved";
          if(t) text.classList.add("has-content"); else text.classList.remove("has-content");
          setTimeout(function(){ if(status) status.textContent = ""; }, 2000);
        } else { if(status) status.textContent = "⚠ Save failed"; }
      }).catch(function(){ if(status) status.textContent = "⚠ Network error"; });
    });
  }
}
function exMetricsTable(c, v){
  function I(x){ return (x==null || isNaN(x)) ? "—" : Math.round(x); }
  function F3(x){ return (x==null || isNaN(x)) ? "—" : (Math.round(x*1000)/1000); }
  function row(label, cv, vv, fmtFn, higherBetter){
    if(cv==null || vv==null){
      return '<div class="ex-metric-row"><span class="ex-metric-lbl">'+label+'</span>'+
        '<span class="ex-metric-val cce">'+(cv!=null?fmtFn(cv):"—")+'</span>'+
        '<span class="ex-metric-val vmi">'+(vv!=null?fmtFn(vv):"—")+'</span>'+
        '<span class="ex-metric-delta zero">—</span></div>';
    }
    var d = vv - cv;
    var cls = "zero";
    if(d !== 0){ cls = (higherBetter ? d>0 : d<0) ? "good" : "bad"; }
    return '<div class="ex-metric-row">'+
      '<span class="ex-metric-lbl">'+label+'</span>'+
      '<span class="ex-metric-val cce">'+fmtFn(cv)+'</span>'+
      '<span class="ex-metric-val vmi">'+fmtFn(vv)+'</span>'+
      '<span class="ex-metric-delta '+cls+'">'+(d>0?"+":"")+fmtFn(d)+'</span>'+
    '</div>';
  }
  var html = '<div class="ex-metrics-table">'+
    '<div class="ex-metric-row ex-metric-head"><span class="ex-metric-lbl">metric</span>'+
    '<span class="ex-metric-val cce">CCE</span><span class="ex-metric-val vmi">VMI/DSL</span>'+
    '<span class="ex-metric-delta" title="VMI − CCE">Δ</span></div>';
  html += row("EX (compute)", c.ex, v.ex, I, false);
  html += row("SU (store-desc)", c.su, v.su, I, false);
  html += row("pred", c.pred, v.pred, I, false);
  html += row("LD (load)", c.ld, v.ld, I, false);
  html += row("ST (store)", c.st, v.st, I, false);
  html += row("SCALAR", c.scalar, v.scalar, I, false);
  html += row("MTE2", c.dma, v.dma, I, false);
  html += row("vf_real (cycles)", c.vf_real, v.vf_real, I, false);
  html += row("IPC", c.ipc, v.ipc, F3, true);
  html += row("EX-IPC", c.ex_ipc, v.ex_ipc, F3, true);
  html += row("dual-issue", c.rvec_dual, v.rvec_dual, F3, true);
  html += row("max_stall", c.max_stall, v.max_stall, I, false);
  html += row("MTE2_wait", c.mte2_wait, v.mte2_wait, I, false);
  html += '</div><div class="ex-metric-note muted small">Δ = VMI − CCE · <span class="good">green</span> = VMI better (fewer ops / faster / higher throughput) · <span class="bad">red</span> = VMI worse</div>';
  return html;
}
function exDetailHtml(r){
  var c=r.cce, v=r.vmi;
  var matched = v && v.ex!=null;
  var html = '<div class="ex-ov-card"><div class="ex-ov-title">Performance gap — CCE vs VMI</div>'+gapComment(c,v,r)+'</div>';
  if(matched){
    html += '<div class="ex-ov-card"><div class="ex-ov-title">Metrics (CCE / VMI)</div>'+
      exMetricsTable(c, v)+
      '<div class="ex-ov-line"><strong>Verdict:</strong> '+badge(verdictOf(r))+' &nbsp; ratio (VMI/CCE EX-IPC): '+ratioStr(r)+'</div>'+
      '<div class="ex-ov-line"><strong>CCE top stall:</strong> <code>'+esc(c.top_stall||"—")+'</code> &nbsp; <strong>VMI top stall:</strong> <code>'+esc(v.top_stall||"—")+'</code></div>'+
      '</div>';
    html += '<div class="ex-ov-card"><div class="ex-ov-title">Instruction list — CCE vs VMI</div>'+instrCompare(c.instr_list, v.instr_list)+'</div>';
  } else {
    html += '<div class="ex-ov-card"><div class="ex-ov-title">CCE-only metrics</div><div class="metric-row">'+
      m2("EX",c.ex)+m2("SU",c.su)+m2("pred",c.pred)+m2("LD",c.ld)+m2("ST",c.st)+m2("SCALAR",c.scalar)+m2("vf_real",c.vf_real)+m2("IPC",fmt(c.ipc,3))+m2("EX-IPC",fmt(c.ex_ipc,3))+
      '</div></div>';
  }
  html += '<div class="ex-ov-card"><div id="ex-ov-wipc" class="ex-ov-wipc"></div></div>';
  html += '<div class="ex-ov-card"><div class="ex-ov-title">Analyst conclusion <span class="muted small">(click to edit)</span></div>'+
    '<div id="ex-ov-conclusion-text" class="conclusion-text" contenteditable="true" placeholder="Add your conclusion about the performance gap..."></div>'+
    '<div class="conclusion-toolbar"><button id="ex-ov-conclusion-save" class="conclusion-save-btn">💾 Save</button><span id="ex-ov-conclusion-status" class="muted small"></span></div></div>';
  return html;
}
function renderExOverview(b){
  var host = el("explorer-overview");
  if(!host) return;
  var tg = b.tags || {};
  var chips = [];
  (tg.dtypes||[]).forEach(function(t){ chips.push('<span class="ex-ov-chip dt">'+esc(t)+'</span>'); });
  if(tg.shapes && tg.shapes.length){
    tg.shapes.forEach(function(s){ if(s && s.rows!=null) chips.push('<span class="ex-ov-chip dm">'+esc(s.rows)+'×'+esc(s.cols)+'</span>'); });
  }
  (tg.compute_pattern||[]).forEach(function(t){ chips.push('<span class="ex-ov-chip pat">'+esc(t)+'</span>'); });
  (tg.vmi_features||[]).forEach(function(t){ chips.push('<span class="ex-ov-chip rk">'+esc(t)+'</span>'); });
  var ev = tg.vmi_evidence || {};
  // Overview is a pure BASELINE view — live numbers live in the fact strip and
  // the IDE 'My Edit vs Original' tab, so nothing here changes after a run.
  var html = '<div class="ex-ov-zone-label baseline">ⓘ ORIGINAL — full CCE vs VMI comparison from the report · not recomputed after edits</div>';
  html += '<div class="ex-ov-card"><div class="ex-ov-title">Kernel features</div>';
  html += '<div class="ex-ov-chips">'+(chips.length?chips.join(''):'<span class="muted small">no tags</span>')+'</div>';
  var evKeys = Object.keys(ev);
  if(evKeys.length){
    html += '<div class="ex-ov-title" style="margin-top:10px">VMI feature evidence</div>';
    evKeys.forEach(function(k){
      if(ev[k]) html += '<div class="ex-ov-ev"><span class="ex-ov-ev-k">'+esc(k)+'</span><span class="muted">'+esc(ev[k])+'</span></div>';
    });
  }
  if(tg.reduce_kind||tg.reduce_dim){
    html += '<div class="ex-ov-title" style="margin-top:10px">Reduction</div>';
    if(tg.reduce_kind) html += '<div>kind: <b>'+esc(tg.reduce_kind)+'</b></div>';
    if(tg.reduce_dim) html += '<div>dim: <b>'+esc(tg.reduce_dim)+'</b></div>';
    if(tg.reduce_group_size!=null) html += '<div>group size: <b>'+esc(tg.reduce_group_size)+'</b></div>';
  }
  html += '</div>';
  var r = exReportRow(b);
  html += r ? exDetailHtml(r) : '<div class="ex-ov-card"><div class="muted small">No report row for this kernel (bundle may be from a different version).</div></div>';
  host.innerHTML = html;
  if(r){
    renderModalWipc(r.case_id || b.case_id, "ex-ov-wipc");
    wireConclusion(r.case_id || b.case_id, "ex-ov-conclusion-text", "ex-ov-conclusion-save", "ex-ov-conclusion-status");
  }
}
function renderExIde(b){
  var host = el("explorer-ide");
  if(!host) return;
  host.innerHTML = '';
  host.appendChild(exIdePanel(b));
  exIdeUpdateState();
  exIdeRenderGate();
}
function renderExStageContent(b){
  renderExFactStrip(b);
  renderExOverview(b);
  renderExplorerDag();
  renderExIde(b);
  if(EX_PENDING_TAB){ var t=EX_PENDING_TAB; EX_PENDING_TAB=null; switchExTab(t); }
}
function exHasEdits(){
  for(var k in EX_EDITED){ if(EX_EDITED[k]) return true; }
  return false;
}
function exEditState(){
  // 'run' = bundle rebuilt from your edited run; 'editing' = source edited, not run; 'original' = no edits
  if(EX_BUNDLE_EDITED) return 'run';
  if(exHasEdits()) return 'editing';
  return 'original';
}
function exEditBadge(){
  var st = exEditState();
  if(st === 'run') return '<span class="ex-edit-badge edited" title="Rebuilt from your edited run">✏️ EDITED</span>';
  if(st === 'editing') return '<span class="ex-edit-badge editing" title="Source has edits — not yet run, the numbers below are still original">✏️ EDITING</span>';
  return '<span class="ex-edit-badge original" title="Original source — no edits applied">ORIGINAL</span>';
}
function renderExFactStrip(b){
  var host = el("ex-fact-strip");
  if(!host) return;
  var st = b.stats||{}, tl = b.timeline||{};
  var cceVf = (b.cce_timeline&&b.cce_timeline.vf_real!=null) ? b.cce_timeline.vf_real : null;
  var vmiVf = (b.vmi_timeline&&b.vmi_timeline.vf_real!=null) ? b.vmi_timeline.vf_real : (tl.vf_real!=null?tl.vf_real:null);
  var stalls = (tl.stalls!=null) ? tl.stalls.length : (st.stall_count!=null?st.stall_count:null);
  var chips = [];
  if(cceVf!=null) chips.push('<span class="ex-fact" title="CCE vf_real (cycles)"><b>CCE</b> '+cceVf+'c</span>');
  if(vmiVf!=null) chips.push('<span class="ex-fact" title="VMI vf_real (cycles)"><b>VMI</b> '+vmiVf+'c</span>');
  if(st.rv_instr_count!=null) chips.push('<span class="ex-fact" title="RVEC executed instruction count"><b>RVEC</b> '+st.rv_instr_count+'</span>');
  if(stalls!=null) chips.push('<span class="ex-fact" title="stall count"><b>stalls</b> '+stalls+'</span>');
  (b.tags&&b.tags.compute_pattern||[]).slice(0,3).forEach(function(t){ chips.push('<span class="ex-fact tag" title="compute pattern">'+esc(t)+'</span>'); });
  var base = exEditBadge() + (chips.join('') || '<span class="muted small">select a kernel…</span>');
  host.innerHTML = base;
  if(!b.kernel){ return; }
  loadCriticalPath(function(list){
    var d = (list||[]).find(function(x){ return x.kernel===b.kernel; });
    if(!d) return;
    var extra = '';
    if(d.critical_path!=null) extra += '<span class="ex-fact cp" title="critical path (longest RAW-dependency chain, cycles)">⛓ critical path '+d.critical_path+'c</span>';
    if(d.excluded) extra += '<span class="ex-fact excl" title="'+esc(d.excluded_reason||'excluded')+'">⚠ excluded</span>';
    if(extra) host.innerHTML = base + extra;
  });
}
// Extract syntax/compile error lines from a raw log blob (ECSs is noisy).
function exIdeExtractErrors(raw){
  if(!raw) return [];
  var errs = [];
  raw.split("\n").forEach(function(line){
    var t = line.trim();
    if(!t) return;
    var lc = t.toLowerCase();
    if(lc.indexOf("error")>=0 || lc.indexOf("exception")>=0 || lc.indexOf("traceback")>=0 ||
       lc.indexOf("syntaxerror")>=0 || lc.indexOf("undefined symbol")>=0 || lc.indexOf("failed to")>=0 ||
       lc.indexOf("no such")>=0 || lc.indexOf("cannot")>=0 || lc.indexOf("failed")>=0){
      if(errs.length < 12) errs.push(t);
    }
  });
  return errs;
}
// Compile-first gate: shows syntax/compile status + MI IR guidance + run CTA.
function exIdeRenderGate(){
  var host = el("ex-ide-gate");
  if(!host) return;
  var hasEdits = false;
  for(var k in EX_EDITED){ if(EX_EDITED[k]){ hasEdits=true; break; } }
  // after a successful run there is nothing left to gate
  if(EX_IDE_STATE === "ran"){ host.innerHTML = ''; return; }
  if(EX_IDE_COMPILE_OK === true){
    host.innerHTML = '<div class="ex-gate ex-gate-ok">'+
      '<div class="ex-gate-title">✅ Compiled clean</div>'+
      '<div class="ex-gate-sub">MI IR diff is shown above. Review it, then run the full simulation (~30–130s).</div>'+
      '<button class="ex-gate-btn run" id="ex-gate-run">▶ Run full simulation</button>'+
    '</div>';
    var b1 = el("ex-gate-run"); if(b1) b1.onclick = function(){ exSaveAndRun("run"); };
  } else if(EX_IDE_COMPILE_OK === false){
    var errs = EX_IDE_COMPILE_ERRORS||[];
    host.innerHTML = '<div class="ex-gate ex-gate-fail">'+
      '<div class="ex-gate-title">❌ Compile failed'+(errs.length?' — '+errs.length+' error(s)':'')+'</div>'+
      (errs.length ? '<div class="ex-gate-errors">'+errs.map(function(e){ return '<div class="ex-gate-errline">'+esc(e)+'</div>'; }).join('')+'</div>' : '')+
      '<div class="ex-gate-sub">Fix the errors and re-compile before running.</div>'+
      '<button class="ex-gate-btn compile" id="ex-gate-recompile">⚙ Re-compile</button>'+
    '</div>';
    var b2 = el("ex-gate-recompile"); if(b2) b2.onclick = function(){ exSaveAndRun("compile"); };
  } else if(hasEdits){
    host.innerHTML = '<div class="ex-gate ex-gate-warn">'+
      '<div class="ex-gate-title">⚠ Not compiled since your last edit</div>'+
      '<div class="ex-gate-sub">Compile first — it is fast (~3s) and catches syntax errors + shows the MI IR diff before the slow simulation.</div>'+
      '<button class="ex-gate-btn compile" id="ex-gate-compile">⚙ Compile &amp; check</button> '+
      '<button class="ex-gate-btn run" id="ex-gate-runanyway">▶ Run anyway</button>'+
    '</div>';
    var b3 = el("ex-gate-compile"); if(b3) b3.onclick = function(){ exSaveAndRun("compile"); };
    var b4 = el("ex-gate-runanyway"); if(b4) b4.onclick = function(){ EX_IDE_SKIP_GATE = true; exSaveAndRun("run"); };
  } else {
    host.innerHTML = '';
  }
}
var CP_SU_COLOR = {
  ADD: "var(--good)", MUL: "var(--teal)", MOV: "var(--slate)", LNEXP: "var(--mi)",
  SLIDE: "var(--warn)", LDU: "var(--cce)", STU: "var(--vmi)", SFU: "var(--pink)",
  GSU: "var(--bad)", ADDR: "var(--dim)", BARRIER: "#94a3b8", OTHER: "var(--dim)"
};
function cpSuStyle(su){
  var c = CP_SU_COLOR[su] || CP_SU_COLOR.OTHER;
  return "color:"+c+";background:rgba(255,255,255,.03);border-color:"+c+"55";
}
function cpChainChips(chain, max){
  if(!chain || !chain.length) return '<span class="muted small">—</span>';
  var n = max || 24;
  var html = '<span class="cp-chain">';
  for(var i=0;i<chain.length && i<n;i++){
    var c = chain[i];
    var lbl = esc(c.op) + '<span class="lat">'+(c.latency!=null?c.latency:"?")+'</span>';
    html += '<span class="cp-chip" style="'+cpSuStyle(c.subunit)+'" title="'+esc(c.op+(c.reg?" → "+c.reg:"")+" · "+c.subunit+" · lat "+c.latency)+'">'+lbl+'</span>';
  }
  if(chain.length>n) html += '<span class="cp-chain-more">+'+(chain.length-n)+'</span>';
  html += '</span>';
  return html;
}
function cpTagBadge(tag){
  if(!tag) return '<span class="muted small">—</span>';
  return '<span class="cov-chip">'+esc(tag)+'</span>';
}
function cpVerdictBadge(v, title){
  var t = title ? ' title="'+esc(title)+'"' : '';
  return v==="latency-bound"
    ? '<span class="cp-su-badge cp-verdict-lat"'+t+'>latency-bound</span>'
    : '<span class="cp-su-badge cp-verdict-thr"'+t+'>throughput-bound</span>';
}
VIEWS.criticalpath = function(){
  loadCriticalPath(function(data){
    el("cp-count").textContent = "("+data.length+" kernels)";
    if(!data.length){
      el("cp-dag-cce").innerHTML='<p class="muted">no critical-path data (run scripts/critical_path.py)</p>';
      el("cp-table").innerHTML="";
      return;
    }
    // KPI grid
    var nLat = data.filter(function(d){return d.verdict==="latency-bound";}).length;
    var nThr = data.length - nLat;
    var cps = data.map(function(d){return d.critical_path;}).filter(function(x){return x!=null&&isFinite(x);});
    var avgCp = cps.length ? Math.round(cps.reduce(function(a,b){return a+b;},0)/cps.length) : 0;
    var top = data[0];
    el("cp-kpi").innerHTML =
      '<div class="cp-kpi"><div class="k">kernels modelled</div><div class="v">'+data.length+'</div><div class="s">cost model coverage</div></div>'+
      '<div class="cp-kpi lat"><div class="k">latency-bound</div><div class="v">'+nLat+'</div><div class="s">SLIDE / LNEXP / SFU / GSU dominant</div></div>'+
      '<div class="cp-kpi thr"><div class="k">throughput-bound</div><div class="v">'+nThr+'</div><div class="s">dual-issue can hide the chain</div></div>'+
      '<div class="cp-kpi"><div class="k">avg critical path</div><div class="v">'+avgCp+' cyc</div><div class="s">per-iteration serial latency</div></div>'+
      '<div class="cp-kpi"><div class="k">longest chain</div><div class="v">'+top.critical_path+' cyc</div><div class="s">'+esc(top.kernel)+' · '+top.depth+' ops</div></div>';

    // Dependency DAG: populate kernel selector + render (longest chain first)
    var dagSel = el("cp-dag-select");
    var dagData = data.slice().sort(function(a,b){ return a.kernel < b.kernel ? -1 : (a.kernel > b.kernel ? 1 : 0); });
    dagSel.innerHTML = dagData.map(function(d){
      return '<option value="'+esc(d.kernel)+'">'+esc(d.kernel)+' (CCE '+d.critical_path+' / DSL '+(d.dsl_critical_path!=null?d.dsl_critical_path:'—')+' cyc)</option>';
    }).join("");
    var dagInfo = el("cp-dag-info");
    function renderDag(){
      var k = dagSel.value;
      var d = CP_DATA ? CP_DATA.find(function(x){return x.kernel===k;}) : null;
      var cceHost = el("cp-dag-cce"), dslHost = el("cp-dag-dsl");
      if(!d){
        if(cceHost) cceHost.innerHTML='<p class="empty-state">no data</p>';
        if(dslHost) dslHost.innerHTML='';
        dagInfo.innerHTML="";
        return;
      }
      drawCpDag(d, cceHost, "cce");
      drawCpDag(d, dslHost, "dsl");
      var ex = d.excluded ? ' · <span class="cp-excl-badge" title="'+esc(d.excluded_reason||'excluded')+'">⚠ excluded</span>' : '';
      dagInfo.innerHTML = '<strong>'+esc(d.kernel)+'</strong> · CCE cp <strong>'+(d.critical_path||0)+' cyc</strong> ('+d.depth+' ops) · DSL cp <strong>'+(d.dsl_critical_path!=null?d.dsl_critical_path+' cyc':'—')+'</strong>'+(d.dsl_depth?' ('+d.dsl_depth+' ops)':'')+' · '+(d.resource_bound!=null?'throughput floor '+d.resource_bound+' cyc · ':'')+cpVerdictBadge(d.verdict)+ex;
    }
    dagSel.addEventListener("change", renderDag);
    renderDag();

    // cross-nav link: open this kernel in the Kernel page
    var exLink = el("cp-dag-explore");
    if(exLink) exLink.addEventListener("click", function(e){
      e.preventDefault();
      var k = dagSel.value;
      var dd = CP_DATA ? CP_DATA.find(function(x){ return x.kernel===k; }) : null;
      if(dd && dd.case_id) exploreKernel(dd.case_id);
    });

    // honour a queued jump (from Explorer's "critical path ↗")
    if(CP_PENDING){
      var pk = CP_PENDING.kernel;
      var match = CP_DATA ? CP_DATA.find(function(x){ return x.kernel===pk; }) : null;
      if(match){
        dagSel.value = pk;
        renderDag();
      }
      CP_PENDING = null;
    }

    // Table
    var sortSel = el("cp-sort"), search = el("cp-search");
    function drawTable(){
      var q = (search.value||"").toLowerCase();
      var sk = sortSel ? sortSel.value : "cp_desc";
      var rows = data.slice().filter(function(d){ return !q || d.kernel.toLowerCase().indexOf(q)>=0; });
      rows.sort(function(a,b){
        switch(sk){
          case "cp_asc": return (a.critical_path||0)-(b.critical_path||0);
          case "cce_desc": return (b.cce_vf_real||0)-(a.cce_vf_real||0);
          case "vmi_desc": return (b.vmi_vf_real||0)-(a.vmi_vf_real||0);
          case "ratio_desc": return (b.cce_hidden||0)-(a.cce_hidden||0);
          case "kernel": return a.kernel<b.kernel?-1:(a.kernel>b.kernel?1:0);
          default: return (b.critical_path||0)-(a.critical_path||0);
        }
      });
      el("cp-table-note").textContent = "("+rows.length+" kernels)";
      var t = el("cp-table");
      t.innerHTML = thead(["kernel","critical path chain","CCE cp","DSL cp","nodes","bottleneck","verdict","CCE vf_real","VMI vf_real","CCE hide","tag",""]) +
        rows.map(function(d){
          var hid = d.cce_hidden!=null ? Math.round(d.cce_hidden*100)+"%" : "—";
          var chainCell = '<td class="cp-cell">'+cpChainChips(d.chain, 26)+'</td>';
          return '<tr data-kernel="'+esc(d.kernel)+'"><td class="kernel clickable">'+esc(d.kernel)+'</td>'+
            chainCell+
            '<td class="num" style="font-weight:600">'+d.critical_path+'</td>'+
            '<td class="num" style="font-weight:600">'+(d.dsl_critical_path!=null?d.dsl_critical_path:'—')+'</td>'+
            '<td class="num muted">'+d.depth+'</td>'+
            '<td class="muted small">'+esc(d.bottleneck)+'</td>'+
            '<td>'+cpVerdictBadge(d.verdict, "critical path "+d.critical_path+" cyc vs throughput floor "+(d.resource_bound!=null?d.resource_bound+" cyc":"n/a"))+'</td>'+
            '<td class="num">'+(d.cce_vf_real!=null?d.cce_vf_real:"—")+'</td>'+
            '<td class="num">'+(d.vmi_vf_real!=null?d.vmi_vf_real:"—")+'</td>'+
            '<td class="num muted">'+hid+'</td>'+
            '<td>'+cpTagBadge(d.tag)+(d.excluded?' <span class="cp-excl-badge" title="'+esc(d.excluded_reason||'excluded')+'">⚠ excluded</span>':'')+'</td>'+
            '<td><a class="explore-link" data-explore="'+esc(d.case_id||d.kernel)+'">explore ↗</a></td></tr>';
        }).join("");
      t.querySelectorAll('tr[data-kernel]').forEach(function(tr){
        tr.addEventListener("click",function(){
          var k = tr.dataset.kernel;
          if(dagSel && dagSel.value !== k){ dagSel.value = k; renderDag(); }
          var dagEl = el("cp-dag-cce");
          if(dagEl && dagEl.scrollIntoView) dagEl.scrollIntoView({behavior:"smooth", block:"nearest"});
        });
      });
    }
    if(sortSel) sortSel.addEventListener("change", drawTable);
    if(search) search.addEventListener("input", drawTable);
    drawTable();
  });
  // folded Roofline panel (merged into Cost Model)
  if(VIEWS.theory) VIEWS.theory.call(this);
};
var DAG_UID = 0;
function drawCpDag(d, elId, side){
  var host = typeof elId === "string" ? el(elId) : elId;
  if(!host) return;
  var dag = (side==="dsl") ? d.dsl_dag : d.dag;
  var sideName = (side==="dsl") ? "DSL" : "CCE";
  if(!dag || !dag.nodes || !dag.nodes.length){
    host.innerHTML = '<p class="muted">no '+sideName+' dependency graph available for this kernel.</p>';
    return;
  }
  var nodes = dag.nodes, edges = dag.edges || [], crit = dag.critical || [];
  var critSet = {}, critEdge = {}, critCum = {}, cum = 0;
  crit.forEach(function(i){ critSet[i] = 1; cum += (nodes[i].latency||0); critCum[i] = cum; });
  for(var ci=0; ci<crit.length-1; ci++){ critEdge[crit[ci]+':'+crit[ci+1]] = 1; }
  var n = nodes.length, i;
  var preds = [];
  for(i=0;i<n;i++) preds.push([]);
  edges.forEach(function(e){ if(e[0]<n && e[1]<n){ preds[e[1]].push(e[0]); } });
  // rank = longest path from sources (layers)
  var rank = [];
  function rankOf(id){
    if(rank[id]!=null) return rank[id];
    var r = 0, p;
    for(p=0;p<preds[id].length;p++) r = Math.max(r, rankOf(preds[id][p])+1);
    rank[id] = r; return r;
  }
  for(i=0;i<n;i++) rankOf(i);
  var maxRank = 0;
  for(i=0;i<n;i++) maxRank = Math.max(maxRank, rank[i]);
  var cols = [];
  for(i=0;i<=maxRank;i++) cols.push([]);
  for(i=0;i<n;i++) cols[rank[i]].push(i);
  cols.forEach(function(col){ col.sort(function(a,b){ return (critSet[b]?1:0)-(critSet[a]?1:0); }); });
  var NODE_W=66, NODE_H=52, COL_GAP=32, ROW_GAP=12, M=20;
  var colH = [];
  for(i=0;i<=maxRank;i++) colH.push(Math.max(1, cols[i].length*(NODE_H+ROW_GAP)-ROW_GAP));
  var maxColH = Math.max.apply(null, colH);
  var x = {}, y = {};
  for(var r=0;r<=maxRank;r++){
    for(var k=0;k<cols[r].length;k++){
      var id = cols[r][k];
      x[id] = M + r*(NODE_W+COL_GAP);
      y[id] = M + (maxColH - colH[r])/2 + k*(NODE_H+ROW_GAP);
    }
  }
  var W = M*2 + (maxRank+1)*(NODE_W+COL_GAP) - COL_GAP;
  var H = M*2 + maxColH + 14;
  var color = function(su){ return CP_SU_COLOR[su] || CP_SU_COLOR.OTHER; };
  var uid = ++DAG_UID;
  var arrId = 'cpDagArr'+uid, arrCId = 'cpDagArrC'+uid;
  var s = svgOpen(W, H);
  s += '<defs>'+
    '<marker id="'+arrId+'" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--slate-dark)"/></marker>'+
    '<marker id="'+arrCId+'" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--warn)"/></marker>'+
    '</defs>';
  s += '<g class="cp-dag-zoom">';
  // dependency edges (RAW) with hover detail
  edges.forEach(function(e){
    var f=e[0], t=e[1], reg=e[2];
    if(x[f]==null || x[t]==null) return;
    var isCrit = critEdge[f+':'+t];
    var col = isCrit ? 'var(--warn)' : 'var(--slate-dark)';
    var wid = isCrit ? 2.4 : 1.15;
    var marker = isCrit ? 'url(#'+arrCId+')' : 'url(#'+arrId+')';
    var x0 = x[f]+NODE_W, y0 = y[f]+NODE_H/2;
    var x1 = x[t], y1 = y[t]+NODE_H/2;
    var mx = (x0+x1)/2;
    var etip = '<div class="cp-tip-h">dependency (RAW)</div>'+
      '<div><b>'+esc(nodes[f].op)+'</b> writes <code>'+esc(reg||'?')+'</code> → <b>'+esc(nodes[t].op)+'</b> reads it</div>'+
      (isCrit?'<div class="cp-tip-crit">⚡ on critical path</div>':'');
    s += '<path class="cp-dag-edge'+(isCrit?' cp-dag-edge-c':'')+'" data-tip="'+attrEsc(etip)+'" d="M '+x0+' '+y0+' C '+mx+' '+y0+', '+mx+' '+y1+', '+x1+' '+y1+'" fill="none" stroke="'+col+'" stroke-width="'+wid+'" marker-end="'+marker+'"/>';
  });
  // nodes with anatomy + hover detail
  nodes.forEach(function(nd, id){
    var xx=x[id], yy=y[id];
    if(xx==null) return;
    var isCrit = critSet[id];
    var col = color(nd.subunit);
    var stroke = isCrit ? 'var(--warn)' : col;
    var fill = isCrit ? 'rgba(251,191,36,0.12)' : 'rgba(255,255,255,0.02)';
    var lat = (nd.latency!=null ? nd.latency : '?');
    var tip = '<div class="cp-tip-h">'+esc(nd.op)+' <span style="opacity:.7">· '+esc(nd.subunit)+'</span></div>'+
      '<div>latency <b>'+lat+' cyc</b>'+(isCrit?' · cumulative <b>'+critCum[id]+' cyc</b>':'')+'</div>'+
      (nd.writes&&nd.writes.length?'<div>writes: <code>'+esc(nd.writes.join(', '))+'</code></div>':'')+
      (nd.reads&&nd.reads.length?'<div>reads: <code>'+esc(nd.reads.join(', '))+'</code></div>':'')+
      (isCrit?'<div class="cp-tip-crit">⚡ critical path</div>':'');
    s += '<g class="cp-dag-node'+(isCrit?' cp-dag-node-c':'')+'" data-tip="'+attrEsc(tip)+'">';
    s += '<rect x="'+xx+'" y="'+yy+'" width="'+NODE_W+'" height="'+NODE_H+'" rx="7" fill="'+fill+'" stroke="'+stroke+'" stroke-width="'+(isCrit?2.2:1.2)+'"/>';
    s += '<text x="'+(xx+NODE_W/2)+'" y="'+(yy+16)+'" text-anchor="middle" fill="'+(isCrit?'var(--warn)':'var(--text)')+'" font-size="10" font-weight="'+(isCrit?700:500)+'" font-family="monospace">'+esc(nd.op)+'</text>';
    s += '<text x="'+(xx+NODE_W/2)+'" y="'+(yy+30)+'" text-anchor="middle" fill="var(--slate)" font-size="8" font-family="monospace">'+esc(nd.subunit)+'</text>';
    s += '<text x="'+(xx+NODE_W/2)+'" y="'+(yy+44)+'" text-anchor="middle" fill="'+(isCrit?'var(--warn)':col)+'" font-size="9" font-family="monospace">'+lat+' cyc</text>';
    s += '</g>';
  });
  s += '</g>';
  s = svgClose(s);

  host.innerHTML =
    '<div class="cp-dag-controls">'+
      '<span class="muted small">↕ scroll = zoom · drag = pan · hover node/arrow for details</span>'+
      '<button class="cp-zoom-btn" data-z="in" title="zoom in">+</button>'+
      '<button class="cp-zoom-btn" data-z="out" title="zoom out">−</button>'+
      '<button class="cp-zoom-btn" data-z="reset" title="reset view">⤢</button>'+
    '</div>'+
    '<div class="cp-dag-stage">'+ s +'<div class="cp-dag-tip"></div></div>';

  var svgEl = host.querySelector('svg');
  var gEl = svgEl.querySelector('.cp-dag-zoom');
  var tip = host.querySelector('.cp-dag-tip');
  host.querySelectorAll('.cp-dag-node, .cp-dag-edge').forEach(function(elm){
    elm.addEventListener('mouseenter', function(){ tip.innerHTML = elm.getAttribute('data-tip'); tip.style.display='block'; });
    elm.addEventListener('mousemove', function(e){ tip.style.left = (e.clientX+16)+'px'; tip.style.top = (e.clientY+14)+'px'; });
    elm.addEventListener('mouseleave', function(){ tip.style.display='none'; });
  });
  attachDagPanZoom(svgEl, gEl, host);
}

function attachDagPanZoom(svgEl, gEl, host){
  var st = {tx:0, ty:0, s:1};
  function apply(){ gEl.setAttribute('transform', 'translate('+st.tx+' '+st.ty+') scale('+st.s+')'); }
  function toUser(cx, cy){
    var pt = svgEl.createSVGPoint();
    pt.x = cx; pt.y = cy;
    var ctm = svgEl.getScreenCTM();
    return ctm ? pt.matrixTransform(ctm.inverse()) : {x:cx, y:cy};
  }
  function zoomAt(cx, cy, factor){
    var ns = Math.min(6, Math.max(0.2, st.s * factor));
    var p = toUser(cx, cy);
    var gx = (p.x - st.tx) / st.s, gy = (p.y - st.ty) / st.s;
    st.s = ns;
    st.tx = p.x - gx * ns;
    st.ty = p.y - gy * ns;
    apply();
  }
  svgEl.addEventListener('wheel', function(e){
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 0.87);
  }, {passive:false});
  var drag = null;
  svgEl.addEventListener('mousedown', function(e){
    drag = {x: e.clientX, y: e.clientY, tx: st.tx, ty: st.ty};
    svgEl.classList.add('cp-dragging');
    e.preventDefault();
  });
  window.addEventListener('mousemove', function(e){
    if(!drag) return;
    var p0 = toUser(drag.x, drag.y), p1 = toUser(e.clientX, e.clientY);
    st.tx = drag.tx + (p1.x - p0.x);
    st.ty = drag.ty + (p1.y - p0.y);
    apply();
  });
  window.addEventListener('mouseup', function(){ if(drag){ drag=null; svgEl.classList.remove('cp-dragging'); } });
  host.querySelectorAll('.cp-zoom-btn').forEach(function(b){
    b.addEventListener('click', function(){
      var z = b.getAttribute('data-z');
      if(z === 'reset'){ st = {tx:0, ty:0, s:1}; apply(); }
      else {
        var rect = svgEl.getBoundingClientRect();
        zoomAt(rect.left + rect.width/2, rect.top + rect.height/2, z === 'in' ? 1.3 : 0.77);
      }
    });
  });
}



/* ---------------- RAW REPORT ---------------- */
VIEWS.report = function(){
  el("md-render").innerHTML = mdToHtml(R.report_md);
};

/* ---------------- MODAL ---------------- */
function exploreKernel(caseId){
  // jump to the Explorer tab + load this kernel's bundle + sync the dropdown.
  // We queue EX_PENDING_FILE so VIEWS.explorer (fired by tab.click) loads the
  // requested bundle instead of defaulting to the first kernel — and so the
  // dropdown selection matches what's rendered.
  var tab=document.querySelector('.tab[data-view="explorer"]');
  var file=null;
  if(EX_MANIFEST && EX_MANIFEST.bundles){
    for(var i=0;i<EX_MANIFEST.bundles.length;i++){
      if(EX_MANIFEST.bundles[i].case_id===caseId || EX_MANIFEST.bundles[i].kernel===caseId){ file=EX_MANIFEST.bundles[i].file; break; }
    }
  }
  if(file){
    // manifest already loaded — just load the bundle (and sync the select now)
    EX_PENDING_FILE = file;
    if(tab){ tab.click(); }
    // if the Explorer view is already mounted (manifest cached), tab.click won't
    // re-run VIEWS.explorer, so load directly + sync the select.
    var sel = el("explorer-select");
    if(sel && sel.value !== file){ loadBundle(file); }
  } else {
    // manifest not loaded yet — load it, then load the bundle
    loadManifest(function(man){
      var f=null;
      for(var i=0;i<man.bundles.length;i++){
        if(man.bundles[i].case_id===caseId || man.bundles[i].kernel===caseId){ f=man.bundles[i].file; break; }
      }
      if(f){ EX_PENDING_FILE=f; if(tab){ tab.click(); } var sel=el("explorer-select"); if(sel&&sel.value!==f) loadBundle(f); }
    });
  }
}
function gapComment(c, v, r){
  // Human-readable performance gap analysis between CCE and VMI.
  if(!v || v.ex==null) return '<p class="muted">No VMI/DSL counterpart — cannot compare.</p>';
  var parts=[];
  // vf_real (wall-clock) gap
  if(c.vf_real && v.vf_real){
    var vg=Math.round((v.vf_real-c.vf_real)/c.vf_real*100);
    var who = vg>0 ? 'VMI is slower' : (vg<0 ? 'VMI is faster' : 'identical');
    parts.push('<strong>vf_real (wall-clock):</strong> CCE='+c.vf_real+'c, VMI='+v.vf_real+'c → <span class="'+(vg>0?'gap-bad':vg<0?'gap-good':'gap-same')+'">'+who+' by '+Math.abs(vg)+'%</span>. '+(vg===0?'Both sides execute the same instruction mix at the same throughput.':vg>0?'VMI has overhead (see EX/SU/scalar breakdown below).':'VMI is leaner (fewer setup/store-desc ops).'));
  }
  // EX count gap
  if(c.ex!=null && v.ex!=null){
    var eg=v.ex-c.ex;
    if(eg!==0){
      var epct=Math.round(eg/c.ex*100);
      parts.push('<strong>EX (vector compute):</strong> CCE='+c.ex+', VMI='+v.ex+' (Δ'+(eg>0?'+':'')+eg+', '+epct+'%). '+(eg>0?'VMI emits more compute ops — typically multi-stage cast workarounds or decomposed fused ops, but often dual-issued for free (check EX-IPC).':'VMI emits fewer compute ops — typically LICM hoisting or fewer tile-unrolled ops.'));
    } else {
      parts.push('<strong>EX:</strong> identical ('+c.ex+' ops).');
    }
  }
  // IPC gap
  if(c.ipc && v.ipc){
    var ir=v.ipc-c.ipc;
    parts.push('<strong>IPC:</strong> CCE='+c.ipc.toFixed(3)+', VMI='+v.ipc.toFixed(3)+' ('+(ir>0?'+':'')+ir.toFixed(3)+'). '+(ir>0?'VMI has higher issue throughput.':'CCE has higher issue throughput (may be inflated by redundant ops — see §0d).'));
  }
  // EX-IPC gap
  if(c.ex_ipc && v.ex_ipc){
    var er=v.ex_ipc-c.ex_ipc;
    if(Math.abs(er)>0.05){
      parts.push('<strong>EX-IPC:</strong> CCE='+c.ex_ipc.toFixed(3)+', VMI='+v.ex_ipc.toFixed(3)+' ('+(er>0?'+':'')+er.toFixed(3)+'). '+(er>0?'VMI dual-issues the EX pipe more effectively.':'CCE keeps the EX pipe busier (possibly with redundant ops).'));
    }
  }
  // SU / scalar overhead
  if(c.su!=null && v.su!=null && c.su!==v.su){
    parts.push('<strong>SU (store-desc):</strong> CCE='+c.su+', VMI='+v.su+'. '+(c.su>v.su?'CCE does manual per-stream store-descriptor setup; VMI consolidates.':'VMI has more store-desc setup.'));
  }
  if(c.scalar!=null && v.scalar!=null && c.scalar!==v.scalar){
    parts.push('<strong>Scalar prologue:</strong> CCE='+c.scalar+', VMI='+v.scalar+'. '+(c.scalar>v.scalar?'CCE\'s manual addr/loop setup is heavier; VMI uses MLIR-generated prologue.':''));
  }
  // verdict summary
  var kn=(r.kernel||'').toLowerCase();
  var summary='';
  if(c.vf_real && v.vf_real && Math.abs(vg)<=5) summary='<strong>Verdict:</strong> CCE and VMI are performance-equivalent (vf_real within 5%).';
  else if(vg>15) summary='<strong>Verdict:</strong> VMI is materially slower ('+vg+'%) — investigate the EX/SU overhead above.';
  else if(vg<-15) summary='<strong>Verdict:</strong> VMI is materially faster ('+Math.abs(vg)+'%) — CCE has overhead VMI avoids.';
  if(summary) parts.push(summary);
  return '<div class="gap-comment">'+parts.map(function(p){return '<p class="gap-line">'+p+'</p>';}).join('')+'</div>';
}


// Render wIPC peak instruction mix graphs in the modal (CCE vs VMI, all 3 pipes)
function renderModalWipc(caseId, hostId){
  var host=el(hostId || "modal-wipc"); if(!host) return;
  host.innerHTML='<p class="loading-state">Loading wIPC data…</p>';
  loadWipc(function(data){
    // find CCE + VMI entries for this case_id
    var cce=null, vmi=null;
    data.forEach(function(e){
      if(e.case_id===caseId){
        if(e.side==="cce") cce=e; else if(e.side==="vmi") vmi=e;
      }
    });
    if(!cce && !vmi){ host.innerHTML=""; return; }
    var pipes=[
      {key:"ex", label:"EX", wipcKey:"ex_wipc", mixKey:"ex_peak_mix", cls:"ex"},
      {key:"ldst", label:"LD/ST", wipcKey:"ldst_wipc", mixKey:"ldst_peak_mix", cls:"ldst"},
      {key:"su", label:"SU", wipcKey:"su_wipc", mixKey:"su_peak_mix", cls:"su"}
    ];
    var colors=["var(--cce)","var(--vmi)","var(--good)","var(--warn)","var(--bad)","var(--violet)","var(--cce)","var(--orange)"];
    var colorMap={}; var ci=0;
    function getColor(name){if(!colorMap[name]){colorMap[name]=colors[ci%colors.length];ci++;}return colorMap[name];}
    function mixBar(entry, pipe){
      var mix=entry ? (entry[pipe.mixKey]||[]) : [];
      if(!mix.length) return '<span class="muted">—</span>';
      var total=mix.reduce(function(s,m){return s+m.count;},0)||1;
      var bar='<div class="wipc-bar modal-wipc-bar">';
      mix.forEach(function(m){var pct=m.count/total*100;var col=getColor(m.name);bar+='<div class="wipc-seg" style="width:'+pct+'%;background:'+col+'" title="'+m.count+'x '+m.name+'">'+(pct>10?m.count:'')+'</div>';});
      bar+='</div>';
      var chips=mix.slice(0,6).map(function(m){return '<span class="wipc-chip" style="border-color:'+getColor(m.name)+'">'+m.count+'x '+m.name+'</span>';}).join(' ');
      return bar+'<div class="wipc-chips">'+chips+'</div>';
    }
    var html='<h4>Peak Instruction Mix (20c window) — CCE vs VMI</h4>';
    html+='<p class="muted small">Peak issue rate in a 20-cycle sliding window per pipe. Bar = instruction count at peak, chips = instruction breakdown.</p>';
    html+='<table class="modal-wipc-table"><thead><tr><th>Pipe</th><th class="cce">CCE wIPC</th><th>CCE mix</th><th class="vmi">VMI wIPC</th><th>VMI mix</th></tr></thead><tbody>';
    pipes.forEach(function(pipe){
      var cceW=cce?(cce[pipe.wipcKey]||0).toFixed(2):'—';
      var vmiW=vmi?(vmi[pipe.wipcKey]||0).toFixed(2):'—';
      html+='<tr>'+
        '<td><span class="mix-label '+pipe.cls+'">'+pipe.label+'</span></td>'+
        '<td class="num cce-val">'+cceW+'</td>'+
        '<td class="wipc-mix">'+mixBar(cce,pipe)+'</td>'+
        '<td class="num vmi-val">'+vmiW+'</td>'+
        '<td class="wipc-mix">'+mixBar(vmi,pipe)+'</td>'+
        '</tr>';
    });
    // UB BW row
    if(cce||vmi){
      var cceBw=cce?cce.ub_bw.toFixed(0):'—';
      var vmiBw=vmi?vmi.ub_bw.toFixed(0):'—';
      var cceBn=cce?cce.bottleneck:'—';
      var vmiBn=vmi?vmi.bottleneck:'—';
      html+='<tr class="wipc-summary-row">'+
        '<td><span class="mix-label">UB BW</span></td>'+
        '<td class="num cce-val">'+cceBw+' B/cyc</td>'+
        '<td class="bn-tag bn-'+cceBn.toLowerCase().replace('/','').replace('-','')+'">'+cceBn+'</td>'+
        '<td class="num vmi-val">'+vmiBw+' B/cyc</td>'+
        '<td class="bn-tag bn-'+vmiBn.toLowerCase().replace('/','').replace('-','')+'">'+vmiBn+'</td>'+
        '</tr>';
    }
    html+='</tbody></table>';
    host.innerHTML=html;
  });
}

function openCompareModal(caseId){
  if(!CMP_DA || !CMP_DB) { openModal(caseId); return; }
  // Find the row in version B data
  var rB = CMP_DB.rows.find(function(x){return x.case_id===caseId;});
  if(!rB) { openModal(caseId); return; }
  // Find the matching row in version A (by kernel name)
  var rA = CMP_DA.rows.find(function(x){return x.kernel===rB.kernel;});
  if(!rA) { openModal(caseId); return; }
  
  var c=rA.cce, v=rB.cce;  // A=cce side, B=cce side (or vmi side depending on chart)
  var cVmi=rA.vmi, vVmi=rB.vmi;
  var matched = v && v.ex!=null;
  
  // Build metrics comparing A vs B (CCE side)
  var metricsCCE = matched ? [
    m("EX", c.ex, v.ex), m("SU", c.su, v.su), m("pred", c.pred, v.pred),
    m("LD", c.ld, v.ld), m("ST", c.st, v.st), m("SCALAR", c.scalar, v.scalar),
    m("MTE2", c.dma, v.dma), m("vf_real", c.vf_real, v.vf_real),
    m("IPC", fmt(c.ipc,3), fmt(v.ipc,3)), m("EX-IPC", fmt(c.ex_ipc,3), fmt(v.ex_ipc,3)),
    m("dual-issue", c.rvec_dual, v.rvec_dual), m("max_stall", c.max_stall, v.max_stall),
    m("MTE2_wait", c.mte2_wait, v.mte2_wait)
  ] : [];
  
  // Build metrics comparing A vs B (VMI side)
  var vmiMatched = vVmi && vVmi.ex!=null && cVmi && cVmi.ex!=null;
  var metricsVMI = vmiMatched ? [
    m("EX", cVmi.ex, vVmi.ex), m("SU", cVmi.su, vVmi.su), m("pred", cVmi.pred, vVmi.pred),
    m("LD", cVmi.ld, vVmi.ld), m("ST", cVmi.st, vVmi.st), m("SCALAR", cVmi.scalar, vVmi.scalar),
    m("MTE2", cVmi.dma, vVmi.dma), m("vf_real", cVmi.vf_real, vVmi.vf_real),
    m("IPC", fmt(cVmi.ipc,3), fmt(vVmi.ipc,3)), m("EX-IPC", fmt(cVmi.ex_ipc,3), fmt(vVmi.ex_ipc,3)),
    m("dual-issue", cVmi.rvec_dual, vVmi.rvec_dual), m("max_stall", cVmi.max_stall, vVmi.max_stall),
    m("MTE2_wait", cVmi.mte2_wait, vVmi.mte2_wait)
  ] : [];
  
  el("modal-title").textContent = rB.kernel + " — " + CMP_TAG_A + " vs " + CMP_TAG_B;
  var body = el("modal-body");
  
  var html = '<h4>Kernel</h4><p><strong>'+esc(rB.kernel)+'</strong> · '+esc(rB.case_id)+'</p>';
  
  // CCE comparison
  if(matched){
    html += '<h4>CCE Metrics — A ('+esc(CMP_TAG_A)+') / B ('+esc(CMP_TAG_B)+')</h4>';
    html += '<div class="metric-legend"><span class="leg cce"><span class="dot cce"></span>A ('+esc(CMP_TAG_A)+')</span><span class="leg vmi"><span class="dot vmi"></span>B ('+esc(CMP_TAG_B)+')</span></div>';
    html += '<div class="metric-row">'+metricsCCE.join("")+'</div>';
  }
  
  // VMI comparison
  if(vmiMatched){
    html += '<h4>VMI Metrics — A ('+esc(CMP_TAG_A)+') / B ('+esc(CMP_TAG_B)+')</h4>';
    html += '<div class="metric-legend"><span class="leg cce"><span class="dot cce"></span>A ('+esc(CMP_TAG_A)+')</span><span class="leg vmi"><span class="dot vmi"></span>B ('+esc(CMP_TAG_B)+')</span></div>';
    html += '<div class="metric-row">'+metricsVMI.join("")+'</div>';
  }
  
  // vf_real delta summary
  if(c.vf_real && v.vf_real){
    var delta = v.vf_real - c.vf_real;
    var pct = Math.round(delta/c.vf_real*100);
    html += '<h4>vf_real delta (CCE)</h4><p>';
    html += 'A='+c.vf_real+'c → B='+v.vf_real+'c (Δ='+(delta>0?"+":"")+delta+'c, '+(pct>0?"+":"")+pct+'%)';
    if(pct>5) html += ' <span class="gap-bad">B slower</span>';
    else if(pct<-5) html += ' <span class="gap-good">B faster</span>';
    else html += ' <span class="muted">~same</span>';
    html += '</p>';
  }
  if(vmiMatched && cVmi.vf_real && vVmi.vf_real){
    var deltaV = vVmi.vf_real - cVmi.vf_real;
    var pctV = Math.round(deltaV/cVmi.vf_real*100);
    html += '<h4>vf_real delta (VMI)</h4><p>';
    html += 'A='+cVmi.vf_real+'c → B='+vVmi.vf_real+'c (Δ='+(deltaV>0?"+":"")+deltaV+'c, '+(pctV>0?"+":"")+pctV+'%)';
    if(pctV>5) html += ' <span class="gap-bad">B slower</span>';
    else if(pctV<-5) html += ' <span class="gap-good">B faster</span>';
    else html += ' <span class="muted">~same</span>';
    html += '</p>';
  }
  
  body.innerHTML = html;
  el("modal").classList.remove("hidden");
}


function openModal(caseId){
  // Quick per-kernel detail in a slide-in drawer — keeps the user on the current
  // view so they can hop between graph dots without losing their place. The
  // drawer's "open in Explorer" button goes to the full Kernel page.
  showKernelDetail(caseId);
}

function m(label, cv, vv){
  return '<div class="metric cce"><div class="k">'+label+'</div><div class="v">'+fmt(cv)+'</div></div>'+
         '<div class="metric vmi"><div class="k">'+label+'</div><div class="v">'+fmt(vv)+'</div></div>';
}
function m2(label, val){ return '<div class="metric"><div class="k">'+label+'</div><div class="v">'+fmt(val)+'</div></div>'; }
function instrBlock(list, side){
  if(!list || !Object.keys(list).length) return '<p class="muted">no instruction breakdown</p>';
  var units = ["RVECEX","RVECSU","RVECLD","RVECST","MTE2","FLOWCTRL","SCALAR","PUSHQ"];
  var out='<div class="instr-grid">';
  units.forEach(function(u){
    if(!list[u]) return;
    var total=0, items=Object.keys(list[u]).map(function(k){ total+=list[u][k]; return '<span class="k">'+esc(k)+'</span><span class="v">'+list[u][k]+'</span>'; }).join("");
    out += '<div class="instr-block"><h5><code>'+u+'</code> <span>'+total+'</span></h5><div class="instr-list">'+items+'</div></div>';
  });
  // any remaining units not in standard order
  Object.keys(list).forEach(function(u){ if(units.indexOf(u)<0){ var items=Object.keys(list[u]).map(function(k){return '<span class="k">'+esc(k)+'</span><span class="v">'+list[u][k]+'</span>';}).join(""); out += '<div class="instr-block"><h5><code>'+u+'</code></h5><div class="instr-list">'+items+'</div></div>'; } });
  return out+'</div>';
}
function instrCompare(cList, vList){
  // Side-by-side per-unit table: opcode | CCE count | VMI count | Δ (VMI−CCE).
  // Rows highlighted: green = VMI fewer (better), red = VMI more, "only" = one-sided.
  if(!cList || !Object.keys(cList).length) return '<p class="muted">no CCE instruction breakdown</p>';
  if(!vList || !Object.keys(vList).length) return '<p class="muted">no VMI instruction breakdown</p>';
  var order = ["RVECEX","RVECSU","RVECLD","RVECST","PUSHQ","MTE2","FLOWCTRL","SCALAR","RVECLP"];
  var units = order.filter(function(u){ return cList[u] || vList[u]; });
  Object.keys(cList).concat(Object.keys(vList)).forEach(function(u){ if(units.indexOf(u)<0) units.push(u); });
  function totalOf(map){ var s=0; for(var k in map) s+=map[k]; return s; }
  var out = '<div class="instr-cmp">';
  units.forEach(function(u){
    var cc = cList[u]||{}, vc = vList[u]||{};
    var ops = Object.keys(cc).concat(Object.keys(vc)).filter(function(v,i,a){return a.indexOf(v)===i;});
    ops.sort();
    var cTot = totalOf(cc), vTot = totalOf(vc), dTot = vTot - cTot;
    var totCls = dTot>0 ? "dc-bad" : (dTot<0 ? "dc-good" : (cTot!==vTot || cTot===0 ? "" : "dc-same"));
    out += '<div class="instr-cmp-unit">';
    out += '<div class="instr-cmp-head"><code>'+u+'</code>'+
           '<span class="unit-tot cce-tag">CCE '+cTot+'</span>'+
           '<span class="unit-tot vmi-tag">VMI '+vTot+'</span>'+
           '<span class="unit-delta '+totCls+'">Δ '+(dTot>0?'+':'')+dTot+'</span></div>';
    out += '<table class="instr-cmp-table"><thead><tr><th>opcode</th><th class=\"cce-tag\">CCE</th><th class=\"vmi-tag\">VMI/DSL</th><th>Δ</th></tr></thead><tbody>';
    if(!ops.length) out += '<tr><td colspan=\"4\" class=\"muted\">—</td></tr>';
    ops.forEach(function(op){
      var cv = cc[op]||0, vv = vc[op]||0, d = vv - cv;
      var cls = cv===0 ? "dc-only-vmi" : (vv===0 ? "dc-only-cce" : (d>0 ? "dc-bad" : (d<0 ? "dc-good" : "dc-same")));
      var dStr = cv===0 ? "only" : (vv===0 ? "only" : (d>0?"+":"")+d);
      out += '<tr class="'+cls+'"><td class=\"op\"><code>'+esc(op)+'</code></td>'+
             '<td class=\"num\">'+(cv||'—')+'</td><td class=\"num\">'+(vv||'—')+'</td>'+
             '<td class=\"num delta\">'+dStr+'</td></tr>';
    });
    out += '</tbody></table></div>';
  });
  return out+'</div>';
}
el("modal").addEventListener("click", function(e){
  if(e.target.hasAttribute("data-close")||e.target.closest("[data-close]")) el("modal").classList.add("hidden");
});
document.addEventListener("keydown", function(e){ if(e.key==="Escape") el("modal").classList.add("hidden"); });

/* ---------------- shared table helpers ---------------- */
function thead(headers, classes){
  return "<thead><tr>"+headers.map(function(hh,i){
    var c = classes?classes[i]:"";
    if(hh.indexOf("CCE")===0) c=(c?c+" ":"")+"cce";
    if(hh.indexOf("VMI")===0) c=(c?c+" ":"")+"vmi";
    if(hh==="Δ"||hh.indexOf("Δ")===0||hh==="ratio"||hh==="verdict") c=(c?c+" ":"")+"sep";
    if(hh==="kernel") c=(c?c+" ":"")+"kernel";
    return '<th class="'+c+'">'+hh+'</th>';
  }).join("")+"</tr></thead>";
}

/* ---------------- SVG chart helpers ---------------- */
function svgOpen(w,h){ return '<svg viewBox="0 0 '+w+' '+h+'" width="'+w+'" height="'+h+'">'; }
function svgClose(s){ return s+'</svg>'; }

function scatter(id, data, fx, fy, lx, ly, dec){
  var host = el(id); if(!host) return;
  var W=480,H=420, pad=42;
  var xs=data.map(fx).filter(function(x){return x!=null&&isFinite(x);});
  var ys=data.map(fy).filter(function(x){return x!=null&&isFinite(x);});
  if(!xs.length){ host.innerHTML='<p class="empty-state">no data</p>'; return; }
  var max=Math.max.apply(null, xs.concat(ys))*1.08, min=0;
  if(dec===3) max=Math.max(max,1.1);
  if(dec===4){dec=3;} // 4 = 3-decimal formatting but skip the 1.1 floor (for tiny values)
  var sx=function(x){return pad+(x-min)/(max-min)*(W-pad-pad);};
  var sy=function(y){return H-pad-(y-min)/(max-min)*(H-pad-pad);};
  var s=svgOpen(W,H);
  // grid + axes
  for(var g=0; g<=4; g++){ var val=min+(max-min)*g/4; s+='<g class="grid"><line x1="'+pad+'" x2="'+(W-pad)+'" y1="'+sy(val)+'" y2="'+sy(val)+'"/></g>'; }
  s+='<g class="axis"><line x1="'+pad+'" y1="'+(H-pad)+'" x2="'+(W-pad)+'" y2="'+(H-pad)+'"/><line x1="'+pad+'" y1="'+pad+'" x2="'+pad+'" y2="'+(H-pad)+'"/></g>';
  s+='<line class="diag" x1="'+pad+'" y1="'+(H-pad)+'" x2="'+(W-pad)+'" y2="'+pad+'"/>';
  // dotted reference lines at fixed VMI/CCE ratios (±5/10/25/50% + 2×)
  // y = ratio * x  =>  screen: sy(ratio*x) for x in [min,max]
  var ratios = [0.50, 0.75, 0.90, 0.95, 1.05, 1.10, 1.25, 1.50, 2.00];
  ratios.forEach(function(r){
    var x0=min, x1=max, y0=r*x0, y1=r*x1;
    // clip to plot area (both endpoints must be within [min,max] on y)
    if(y0>max && y1>max) return;
    if(y0<min && y1<min) return;
    // solve intersection with y=max (top) and y=min (bottom) to clip the segment
    function clipY(ytarget){ // x where y=ytarget: x = ytarget/r
      if(r===0) return null;
      return ytarget/r;
    }
    var xa=x0, xb=x1;
    var yt=r*xa, yb=r*xb;
    if(yt>max){ xa=clipY(max); yt=max; } else if(yt<min){ xa=clipY(min); yt=min; }
    if(yb>max){ xb=clipY(max); yb=max; } else if(yb<min){ xb=clipY(min); yb=min; }
    if(xa==null||xb==null) return;
    if(xa<min&&xb<min) return; if(xa>max&&xb>max) return;
    xa=Math.max(min,Math.min(max,xa)); xb=Math.max(min,Math.min(max,xb));
    var pct = Math.round((r-1)*100);
    var lbl = (pct>0?'+':'')+pct+'%';
    var above = r>1; // above diagonal = VMI better
    s+='<line class="refln" x1="'+sx(xa)+'" y1="'+sy(yt)+'" x2="'+sx(xb)+'" y2="'+sy(yb)+'"/>';
    // label near the right edge of the segment (top of plot)
    var lx=sx(xb), ly=sy(yb);
    // nudge label so it stays inside the plot area
    if(ly<pad+10) ly=pad+10; if(ly>H-pad-6) ly=H-pad-6;
    if(lx>W-pad-4) lx=W-pad-4; if(lx<pad+20) lx=pad+20;
    s+='<text class="refln-lbl '+(above?'vmi':'cce')+'" x="'+lx+'" y="'+ly+'" text-anchor="end" dx="-3" dy="-3">'+lbl+'</text>';
  });
  // points (with hover tooltip data)
  data.forEach(function(r){
    var x=fx(r), y=fy(r); if(x==null||y==null) return;
    var rr = (y/x); var col = rr>1.15?'var(--vmi)':(rr<0.87?'var(--cce)':'var(--muted)');
    var pct = Math.round((rr-1)*100);
    var tip = esc(r.kernel)+' | '+esc(lx)+'='+fmt(x,dec)+', '+esc(ly)+'='+fmt(y,dec)+' | Δ'+(pct>0?'+':'')+pct+'%';
    s+='<g class="pt" data-case="'+esc(r.case_id)+'" data-tip="'+tip+'"><circle cx="'+sx(x)+'" cy="'+sy(y)+'" r="4.5" fill="'+col+'" opacity="0.8"/><circle cx="'+sx(x)+'" cy="'+sy(y)+'" r="9" fill="transparent" class="pt-hit"/></g>';
  });
  // labels
  s+='<text class="axis-title" x="'+(W/2)+'" y="'+(H-10)+'" text-anchor="middle">'+esc(lx)+'</text>';
  s+='<text class="axis-title" transform="rotate(-90 14 '+fmt(H/2,0)+')" x="14" y="'+fmt(H/2,0)+'" text-anchor="middle">'+esc(ly)+'</text>';
  s+='<g class="axis">';
  for(g=0; g<=4; g++){ var val=min+(max-min)*g/4; s+='<text x="'+pad+'" y="'+sy(val)+'" text-anchor="end" dx="-6" dy="3">'+fmt(val,dec)+'</text>'; s+='<text x="'+sx(val)+'" y="'+(H-pad)+'" text-anchor="middle" dy="16">'+fmt(val,dec)+'</text>'; }
  s+='</g>';
  host.innerHTML = svgClose(s);
  // shared hover tooltip + click (detail) + explore link
  var tip = host.querySelector(".scatter-tip") || (function(){
    var d=document.createElement("div"); d.className="scatter-tip"; host.style.position="relative"; host.appendChild(d); return d;
  })();
  var hideTimer=null;
  function showTipFor(pt){
    if(hideTimer){ clearTimeout(hideTimer); hideTimer=null; }
    var tipText = pt.getAttribute("data-tip");
    var cid = pt.getAttribute("data-case");
    tip.innerHTML = '<div class="st-line">'+tipText+'</div>'+
      '<div class="st-actions"><a class="st-act" data-act="detail" data-case="'+esc(cid)+'">peek</a>'+
      '<a class="st-act st-explore" data-act="explore" data-case="'+esc(cid)+'">explore ↗</a></div>';
    tip.classList.add("show");
    var rect=host.getBoundingClientRect(), pr=pt.getBoundingClientRect();
    var left=pr.left-rect.left+12, top=pr.top-rect.top-6;
    if(left+180>host.offsetWidth) left=pr.left-rect.left-180;
    if(top<4) top=pr.bottom-rect.top+8;
    tip.style.left=left+"px"; tip.style.top=top+"px";
  }
  function scheduleHide(){
    if(hideTimer){ clearTimeout(hideTimer); }
    hideTimer=setTimeout(function(){ tip.classList.remove("show"); hideTimer=null; }, 2000);
  }
  // --- Zoom & Pan (inline: no zoom, only expand) ---
  enableZoomPanInline(host);
  if(!host.querySelector(".chart-expand")) {
    var btn=document.createElement("button");
    btn.className="chart-expand";
    btn.innerHTML="⤢";
    btn.title="Expand chart";
    btn.onclick=function(){
      var modal=document.getElementById("modal");
      var body=document.getElementById("modal-body");
      var title=document.getElementById("modal-title");
      if(!modal||!body) return;
      title.textContent=host.id || "Chart";
      // Clone the SVG + zoom state
      var clone=host.cloneNode(true);
      clone.style.width="100%";
      clone.style.height="auto";
      // Remove old hint/expand from clone
      clone.querySelectorAll(".zoom-hint, .chart-expand").forEach(function(e){e.remove();});
      body.innerHTML="";
      body.appendChild(clone);
      // Re-enable zoom on the clone
      enableZoomPan(clone);
      // Wire dot clicks → open kernel detail
      clone.querySelectorAll(".pt").forEach(function(pt){
        pt.style.cursor="pointer";
        pt.addEventListener("click", function(){
          var cid=pt.getAttribute("data-case");
          if(cid){
            document.getElementById("modal").classList.add("hidden");
            openModal(cid);
          }
        });
        // Also add hover tooltip
        pt.addEventListener("mouseenter", function(){
          var tipText=pt.getAttribute("data-tip");
          if(tipText){
            var t=clone.querySelector(".scatter-tip")||function(){
              var d=document.createElement("div");d.className="scatter-tip";
              clone.style.position="relative";clone.appendChild(d);return d;
            }();
            var cid=pt.getAttribute("data-case")||"";
            t.innerHTML='<div class="st-line">'+tipText+'</div>'+
              '<div class="st-actions"><a class="st-act" data-act="detail" data-case="'+esc(cid)+'">peek</a>'+
              '<a class="st-act st-explore" data-act="explore" data-case="'+esc(cid)+'">explore ↗</a></div>';
            t.classList.add("show");
            var rect=clone.getBoundingClientRect(),pr=pt.getBoundingClientRect();
            var left=pr.left-rect.left+12,top=pr.top-rect.top-6;
            if(left+180>clone.offsetWidth)left=pr.left-rect.left-180;
            if(top<4)top=pr.bottom-rect.top+8;
            t.style.left=left+"px";t.style.top=top+"px";
            // Wire action clicks
            t.querySelectorAll(".st-act").forEach(function(a){
              a.addEventListener("click", function(e){
                e.preventDefault(); e.stopPropagation();
                var act=a.getAttribute("data-act"),ac=a.getAttribute("data-case");
                t.classList.remove("show");
                document.getElementById("modal").classList.add("hidden");
                if(act==="explore") exploreKernel(ac);
                else openModal(ac);
              });
            });
          }
        });
        var hideT=null;
        pt.addEventListener("mouseleave", function(){
          hideT=setTimeout(function(){
            var t=clone.querySelector(".scatter-tip");
            if(t) t.classList.remove("show");
          },2000);
        });
      });
      // Keep tooltip alive when hovering it
      var cloneTip=clone.querySelector(".scatter-tip");
      if(cloneTip){
        cloneTip.addEventListener("mouseenter",function(){if(hideT){clearTimeout(hideT);hideT=null;}});
        cloneTip.addEventListener("mouseleave",function(){
          hideT=setTimeout(function(){cloneTip.classList.remove("show");},2000);
        });
      }
      modal.classList.remove("hidden");
    };
    host.appendChild(btn);
  }

  host.querySelectorAll(".pt").forEach(function(pt){
    pt.style.cursor="pointer";
    pt.addEventListener("mouseenter", function(){ showTipFor(pt); });
    pt.addEventListener("mouseleave", scheduleHide);
    pt.addEventListener("click", function(e){
      if(e.target.classList.contains("st-act")) return;
      openModal(pt.getAttribute("data-case"));
    });
  });
  // keep tooltip alive while the cursor is over the tooltip itself
  tip.addEventListener("mouseenter", function(){ if(hideTimer){ clearTimeout(hideTimer); hideTimer=null; } });
  tip.addEventListener("mouseleave", scheduleHide);
  // tooltip action clicks (delegated)
  tip.addEventListener("click", function(e){
    var a=e.target.closest(".st-act"); if(!a) return;
    e.preventDefault(); e.stopPropagation();
    var act=a.getAttribute("data-act"), cid=a.getAttribute("data-case");
    tip.classList.remove("show");
    if(act==="explore") exploreKernel(cid); else openModal(cid);
  });
}


function scatterBars(id, data, labelKey, keys, names, colors){
  var host=el(id); if(!host) return;
  var W=720, H=260, padL=140, padB=50, padT=20;
  var max=Math.max.apply(null, data.reduce(function(a,d){return a.concat(keys.map(function(k){return d[k]||0;}));},[]))*1.15||1;
  var bw=(W-padL-40)/(data.length*keys.length);
  var s=svgOpen(W,H);
  data.forEach(function(d,i){
    var gx=padL + i*((W-padL-40)/data.length);
    s+='<text x="'+(gx+ (bw*keys.length)/2)+'" y="'+(H-padB+16)+'" text-anchor="middle" fill="var(--muted)" font-size="9.5" transform="rotate(-20 '+(gx+(bw*keys.length)/2)+','+(H-padB+16)+')">'+esc(d[labelKey].split(" (")[0].slice(0,18))+'</text>';
    keys.forEach(function(k,j){
      var val=d[k]||0, h=(val/max)*(H-padT-padB), x=gx+j*bw, y=H-padB-h;
      s+='<rect x="'+x+'" y="'+y+'" width="'+(bw-2)+'" height="'+h+'" rx="2" fill="var(--'+colors[j]+')"/>';
      s+='<text x="'+(x+bw/2)+'" y="'+(y-3)+'" text-anchor="middle" fill="var(--text)" font-size="10">'+val+'</text>';
    });
  });
  // axes
  s+='<g class="axis"><line x1="'+padL+'" y1="'+(H-padB)+'" x2="'+(W-20)+'" y2="'+(H-padB)+'"/><line x1="'+padL+'" y1="'+padT+'" x2="'+padL+'" y2="'+(H-padB)+'"/></g>';
  // legend
  names.forEach(function(n,i){ s+='<rect x="'+(W-180+i*90)+'" y="'+(padT)+'" width="11" height="11" rx="2" fill="var(--'+colors[i]+')"/><text x="'+(W-180+i*90+16)+'" y="'+(padT+9)+'" fill="var(--heading)" font-size="11">'+esc(n)+'</text>'; });
  host.innerHTML=svgClose(s);
}

/* ---------------- minimal markdown -> html ---------------- */
function mdToHtml(md){
  if(!md) return "";
  // tables
  var lines = md.split(/\r?\n/), out=[], i=0;
  while(i<lines.length){
    var ln=lines[i];
    // detect table block
    if(/^\s*\|/.test(ln) && i+1<lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i+1])){
      var hdr=rowSplit(ln), rowsArr=[];
      i+=2;
      while(i<lines.length && /^\s*\|/.test(lines[i])){ rowsArr.push(rowSplit(lines[i])); i++; }
      out.push('<table><thead><tr>'+hdr.map(function(c){return '<th>'+inlineMd(c)+'</th>';}).join("")+'</tr></thead><tbody>'+
        rowsArr.map(function(r){return '<tr>'+r.map(function(c){return '<td>'+inlineMd(c)+'</td>';}).join("")+'</tr>';}).join("")+'</tbody></table>');
      continue;
    }
    out.push(blockMd(ln, lines, i).html);
    i += blockMd(ln, lines, i).advance || 1;
  }
  return out.join("\n");
}
function rowSplit(s){ return s.replace(/^\s*\|/,"").replace(/\|\s*$/,"").split("|").map(function(x){return x.trim();}); }
function inlineMd(s){
  return esc(s)
    .replace(/`([^`]+)`/g,'<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g,'<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}
function blockMd(ln, lines, i){
  if(/^\s*#{1,6}\s/.test(ln)){ var m=ln.match(/^(\s*)(#{1,6})\s+(.*)$/); return {html:'<h'+m[2].length+'>'+inlineMd(m[3])+'</h'+m[2].length+'>', advance:1}; }
  if(/^\s*>\s?/.test(ln)){ return {html:'<blockquote>'+inlineMd(ln.replace(/^\s*>\s?/,""))+'</blockquote>', advance:1}; }
  if(/^\s*$/.test(ln)){ return {html:'', advance:1}; }
  return {html:'<p>'+inlineMd(ln)+'</p>', advance:1};
}

/* ---------------- EXPLORER (compiler-explorer-style) ---------------- */
var EX_MANIFEST = null;
var EX_BUNDLE = null;
var EX_PENDING_TAB = null;
var EX_IR_TAB = "mlir";
var EX_ACTIVE_LINE = null;
var EX_SIDE = "vmi";
var EX_OPCODE_INFO = null;
var EX_REVERSE_IDX = null;  // {cce:{lineNum:[instrIdx]}, dsl:{...}, ir:{...}}
var EX_COLOR_MAP = null;    // {cce:{lineNum:"hsl(...)"}, dsl:{...}, ir:{...}}
var EX_FILTER = "";
var EX_STALLS_ONLY = false;
var EX_DISASM_MODE = (function(){ try { return localStorage.getItem("ex_disasm_mode") || "trace"; } catch(_){ return "trace"; } })();  // trace (tick order) | unit (sorted unit+PC static disasm)

function loadManifest(cb){
  if(EX_MANIFEST){ cb(EX_MANIFEST); return; }
  fetch("explorer/manifest.json")
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(m){ EX_MANIFEST = m || {bundles:[]}; cb(EX_MANIFEST); })
    .catch(function(){ EX_MANIFEST = {bundles:[]}; cb(EX_MANIFEST); });
}

function loadOpcodeInfo(cb){
  if(EX_OPCODE_INFO){ cb(EX_OPCODE_INFO); return; }
  fetch("explorer/opcode_info.json")
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(d){ EX_OPCODE_INFO = d || null; cb(d); })
    .catch(function(){ cb(null); });
}

// Build reverse index: for each source pane, map lineNum → [disasm instr indices]
function buildReverseIndex(disasm){
  var idx = {cce:{}, dsl:{}, ir:{}, mi:{}};
  disasm.forEach(function(r, i){
    if(r.cce_line){ (idx.cce[r.cce_line] = idx.cce[r.cce_line]||[]).push(i); }
    if(r.dsl_line){ (idx.dsl[r.dsl_line] = idx.dsl[r.dsl_line]||[]).push(i); }
    if(r.mlir_line){ (idx.ir[r.mlir_line] = idx.ir[r.mlir_line]||[]).push(i); }
    if(r.vpto_line){ (idx.mi[r.vpto_line] = idx.mi[r.vpto_line]||[]).push(i); }
  });
  return idx;
}

// Stable color per source line (hash lineNum → hue). Only for lines with correlations.
function buildColorMap(revIdx){
  var map = {cce:{}, dsl:{}, ir:{}, mi:{}};
  var hue = 0;
  function assign(pane){
    var lines = Object.keys(revIdx[pane]).sort(function(a,b){return a-b;});
    lines.forEach(function(ln){
      map[pane][ln] = "hsl("+hue+",70%,55%)";
      hue = (hue + 37) % 360;  // golden-angle spacing for visual distinction
    });
  }
  assign("cce"); assign("dsl"); assign("ir"); assign("mi");
  return map;
}

// MI IR (lowered pto.* ops) → disasm RV mnemonic, for client-side vpto_line correlation.
// Mirrors cce_to_rv from explorer/corr_map.json, extended with MI-specific lowered names.
// Only RV_* targets are correlated — infra ops (copy_gm_to_ubuf / set_flag / castptr /
// addptr / vecscope) have no 1:1 RV instruction in the VF-scoped trace and are absent.
var MI_TO_RV = {
  vmuls:"RV_VMULS", vmul:"RV_VMUL", vadds:"RV_VADDS", vadd:"RV_VADD", vsub:"RV_VSUB",
  vdiv:"RV_VDIV", vcvt:"RV_VCVT_F2F", vsel:"RV_VSEL", vld:"RV_VLD", vlds:"RV_VLDS",
  vldi:"RV_VLDI", vsts:"RV_VST", vst:"RV_VST", vsstb:"RV_VSSTB", vdup:"RV_VDUP",
  vbr:"RV_VBR", vmax:"RV_VMAX", vmaxs:"RV_VMAXS", vmin:"RV_VMINS", vmins:"RV_VMINS",
  vexp:"RV_VEXP", vln:"RV_VLN", vneg:"RV_VNEG_FP", vabs:"RV_VABS_FP", vand:"RV_VAND",
  vor:"RV_VOR", vshl:"RV_VSHL", vshr:"RV_VSHR", vdintlv:"RV_VDINTLV", vintlv:"RV_VINTLV",
  vpack:"RV_VPACK", vcadd:"RV_VCADD", vcmax:"RV_VCMAX", vcgmax:"RV_VCGMAX",
  dhistv2:"RV_DHISTv2",
  pset_b32:"RV_PSET", pset_b16:"RV_PSET", pset_b8:"RV_PSET", plt_b32:"RV_PLT", pand:"RV_PAND"
};

// Derive vpto_line per disasm instruction via occurrence-order matching (same algorithm
// as build_bundle.py's correlate()). MI IR is the VMI lowering pipeline output, so it
// only correlates to the VMI disasm trace — not to the CCE trace (different compiler).
function deriveVptoLines(disasm, vptoLines, side){
  disasm.forEach(function(r){ r.vpto_line = null; });  // reset (avoid stale on trace switch)
  if(side !== "vmi" || !vptoLines || !vptoLines.length) return;
  var miIdx = {};
  var re = /pto\.([a-z_][a-z0-9_]*)/g;
  vptoLines.forEach(function(ln, i){
    var n = i+1, m;
    re.lastIndex = 0;
    while((m = re.exec(ln))){
      var rv = MI_TO_RV[m[1]];
      if(rv){ (miIdx[rv] = miIdx[rv]||[]).push(n); }
    }
  });
  var counters = {};
  disasm.forEach(function(r){
    var mn = r.mnemonic;
    if(mn.indexOf("RV_")===0 || mn==="PUSH_PB"){
      var arr = miIdx[mn];
      if(arr && arr.length){
        var n = counters[mn]||0;
        r.vpto_line = arr[n % arr.length];
        counters[mn] = n+1;
      }
    }
  });
}

VIEWS.explorer = function(){
  var sel = el("explorer-select");
  var status = el("explorer-status");
  loadManifest(function(man){
    if(!man.bundles.length){ sel.innerHTML = '<option value="">No bundles — run build_bundle.py first</option>'; status.textContent=""; return; }
    sel.innerHTML = man.bundles.map(function(b){
      return '<option value="'+esc(b.file)+'">'+esc(b.kernel)+(b.case_id!==b.kernel?" · "+esc(b.case_id):"")+'</option>';
    }).join("");
    el("explorer-count").textContent = "("+man.bundles.length+" kernels)";
    // if exploreKernel queued a target bundle, load that instead of the default first
    if(EX_PENDING_FILE){
      sel.value = EX_PENDING_FILE;
      loadBundle(EX_PENDING_FILE);
      EX_PENDING_FILE = null;
    } else if(man.bundles.length){ sel.value = man.bundles[0].file; loadBundle(man.bundles[0].file); }
  });
  sel.onchange = function(){ if(sel.value) loadBundle(sel.value); };
  // Stage-1 tab switching (Lowering / DAG / Overview / Edit & Simulate)
  var exTabs = el("ex-tabs");
  if(exTabs) exTabs.addEventListener("click", function(e){
    var b = e.target.closest(".ex-tab"); if(!b) return;
    document.querySelectorAll(".ex-tab").forEach(function(t){ t.classList.toggle("active", t===b); });
    var which = b.getAttribute("data-extab");
    ["lowering","criticalpath","overview","ide"].forEach(function(t){
      var p = el("ex-panel-"+t); if(p) p.classList.toggle("active", t===which);
    });
  });
  // live job monitor: keep the running-job count visible at all times
  exIdeStartJobMonitor();
};

function loadBundle(file){
  var status = el("explorer-status");
  if(status) status.textContent = "Loading…";
  // keep the dropdown in sync with whatever bundle is loaded
  var sel = el("explorer-select");
  if(sel){ sel.value = file; }
  // reset the IDE perf baseline when switching kernels (the new kernel's original perf is the baseline)
  EX_IDE_BASELINE = null;
  EX_IDE_BASELINE_SNAPSHOT = null;
  EX_EDITED_CP = null;
  EX_IDE_LAST_PERF = null;
  EX_IDE_LAST_SESSION = null;
  EX_IR_BASELINE = {};
  EX_ORIGINAL = {};       // reset original-source cache (new kernel = new original)
  EX_EDITED = {};         // clear any edits from the previous kernel
  EX_BUNDLE_EDITED = false; // fresh kernel = original bundle
  fetch("explorer/"+file)
    .then(function(r){ if(!r.ok) throw new Error(r.status); return r.json(); })
    .then(function(b){ EX_BUNDLE = b; EX_SIDE = b.primary_side||"vmi"; if(status) status.textContent=""; renderExplorer(); })
    .catch(function(e){ if(status) status.textContent = "Load failed: "+e.message; });
}

var EX_LEFT = "cce", EX_MIDDLE = "dsl", EX_RIGHT = "vpto";   // default 3-way panes (CCE | VMI/DSL | MI IR)
var EX_3PANE = true;   // 3-pane layout (CCE|VMI|MI IR) vs 2-pane (any two panes)
var EX_PENDING_FILE = null;  // queued by exploreKernel so VIEWS.explorer loads the right bundle

// Pane catalog: value → {label, build(disasm,tl,ir)→paneElement}
// Order = dropdown order. The user picks any two (left + right).
var EX_PANES = [
  {value:"cce",  label:"CCE C++",           kind:"src"},
  {value:"dsl",  label:"VMI/DSL Python",    kind:"src"},
  {value:"mlir", label:"VMI MLIR",          kind:"ir"},
  {value:"vpto", label:"MI IR",              kind:"ir"},
  {value:"llvm", label:"LLVM IR",           kind:"ir"},
  {value:"vmi_disasm", label:"A5 disasm (VMI trace)",  kind:"disasm", side:"vmi"},
  {value:"cce_disasm", label:"A5 disasm (CCE trace)",  kind:"disasm", side:"cce"},
];
function paneLabel(v){ for(var i=0;i<EX_PANES.length;i++) if(EX_PANES[i].value===v) return EX_PANES[i].label; return v; }
function paneKind(v){ for(var i=0;i<EX_PANES.length;i++) if(EX_PANES[i].value===v) return EX_PANES[i].kind; return "src"; }

function buildPane(value, b, disasm, tl, ir){
  // returns a pane element for the given layer value
  if(value==="cce")  return exPane("CCE C++", b.layers.cce_cpp.lines, b.layers.cce_cpp.src_url, "cce", b.layers.cce_cpp.file, "cce");
  if(value==="dsl")  return exPane("VMI/DSL Python", b.layers.dsl_py.lines, b.layers.dsl_py.src_url, "dsl", b.layers.dsl_py.file, "py");
  if(value==="mlir") return exPane("VMI MLIR", b.layers.mlir.lines||[], null, "ir", b.layers.mlir.file, "ir", true);
  if(value==="vpto") return exPane("MI IR", b.layers.vpto.lines||[], null, "mi", b.layers.vpto.file, "ir", true);
  if(value==="llvm") return exPane("LLVM IR", b.layers.llvm_ir.lines||[], null, "ir", b.layers.llvm_ir.file, "ir", true);
  // disasm variants
  if(value==="cce_disasm" && b.layers.cce_disasm) return exDisasmPane(b.layers.cce_disasm.instructions, b.cce_timeline||tl, "CCE");
  return exDisasmPane(b.layers.vmi_disasm ? b.layers.vmi_disasm.instructions : disasm, tl, "VMI");
}

function renderExplorer(){
  var host = el("explorer-view");
  if(!EX_BUNDLE){ host.innerHTML = '<p class="muted">Select a kernel to load its bundle.</p>'; return; }
  var b = EX_BUNDLE;
  // disasm + timeline defaults (kept for the timeline bar + wireExplorer)
  var disasmKey = (EX_SIDE==="cce" && b.layers.cce_disasm) ? "cce_disasm" : (b.layers.vmi_disasm ? "vmi_disasm" : "disasm");
  var disasm = b.layers[disasmKey] ? b.layers[disasmKey].instructions : b.layers.disasm.instructions;
  var disasmSide = b.layers[disasmKey] ? b.layers[disasmKey].side : "vmi";
  var tl = (EX_SIDE==="cce" && b.cce_timeline) ? b.cce_timeline : ((EX_SIDE=="cce" && b.vmi_timeline) ? b.vmi_timeline : b.timeline);
  var ir = (b.layers[EX_IR_TAB] || b.layers.mlir);

  // derive MI IR (vpto) line correlation client-side. MI IR is the VMI lowering, so it
  // only maps to the VMI disasm trace (not the CCE trace).
  deriveVptoLines(disasm, (b.layers.vpto||{}).lines||[], disasmSide);

  // build reverse index + color map for hover/P2
  EX_REVERSE_IDX = buildReverseIndex(disasm);
  EX_COLOR_MAP = buildColorMap(EX_REVERSE_IDX);

  host.innerHTML = '';
  // pane-pair selector (left + [middle] + right dropdowns) + layout toggle
  var bar = document.createElement("div"); bar.className = "ex-panebar";
  var optsL = EX_PANES.map(function(p){return '<option value="'+p.value+'"'+(p.value===EX_LEFT?' selected':'')+'>'+esc(p.label)+'</option>';}).join("");
  var optsM = EX_PANES.map(function(p){return '<option value="'+p.value+'"'+(p.value===EX_MIDDLE?' selected':'')+'>'+esc(p.label)+'</option>';}).join("");
  var optsR = EX_PANES.map(function(p){return '<option value="'+p.value+'"'+(p.value===EX_RIGHT?' selected':'')+'>'+esc(p.label)+'</option>';}).join("");
  var hint = EX_3PANE ? 'Click a line in any pane to highlight correlated lines across all three (bridged via the A5 disasm trace).'
                     : 'Click a line in either pane to highlight correlated lines across both. Hover for temporary highlight.';
  if(EX_3PANE && disasmSide!=="vmi") hint += ' Note: MI IR correlates to the VMI trace — switch to “VMI trace” for full correlation.';
  hint += ' MI IR diff is VMI-only (CCE compiles to machine code, not MI IR).';
  bar.innerHTML =
    '<div class="ex-layout-toggle">'+
      '<button class="ex-lay-btn'+(EX_3PANE?' active':'')+'" data-lay="3">3-way</button>'+
      '<button class="ex-lay-btn'+(!EX_3PANE?' active':'')+'" data-lay="2">2-pane</button>'+
    '</div>'+
    '<label class="ex-sellbl">Left: <select id="ex-left-sel">'+optsL+'</select></label>'+
    (EX_3PANE ? '<label class="ex-sellbl">Middle: <select id="ex-mid-sel">'+optsM+'</select></label>' : '')+
    '<span class="ex-swap" id="ex-swap-btn" title="Swap left/right">⇄</span>'+
    '<label class="ex-sellbl">Right: <select id="ex-right-sel">'+optsR+'</select></label>'+
    (EX_3PANE ? '<button class="ex-jump-all-btn" id="ex-jump-all" title="Scroll all panes to the vector-compute body (e.g. __VEC_SCOPE__)">⤓ show compute</button>' : '')+
    '<span class="muted ex-panebar-hint">'+hint+'</span>';
  host.appendChild(bar);

  // 3-pane (CCE | VMI | MI IR) or 2-pane grid
  var grid = document.createElement("div"); grid.className = "ex-grid"+(EX_3PANE?" ex-grid-3":" ex-grid-2");
  grid.appendChild(buildPane(EX_LEFT, b, disasm, tl, ir));
  if(EX_3PANE) grid.appendChild(buildPane(EX_MIDDLE, b, disasm, tl, ir));
  grid.appendChild(buildPane(EX_RIGHT, b, disasm, tl, ir));
  host.appendChild(grid);

  // timeline
  host.appendChild(exTimeline(tl, disasm));
  // wire line clicks + hover + tooltips + pane selectors
  wireExplorer(disasm, tl);
  // render Stage-1 siblings (Overview + Critical path DAG) and Stage-2 IDE panel
  renderExStageContent(b);
  var leftSel=el("ex-left-sel"), rightSel=el("ex-right-sel"), midSel=el("ex-mid-sel");
  if(leftSel) leftSel.onchange=function(){ EX_LEFT=leftSel.value; renderExplorer(); };
  if(rightSel) rightSel.onchange=function(){ EX_RIGHT=rightSel.value; renderExplorer(); };
  if(midSel) midSel.onchange=function(){ EX_MIDDLE=midSel.value; renderExplorer(); };
  var swap=el("ex-swap-btn");
  if(swap) swap.onclick=function(){ var t=EX_LEFT; EX_LEFT=EX_RIGHT; EX_RIGHT=t; renderExplorer(); };
  document.querySelectorAll(".ex-lay-btn").forEach(function(btn){
    btn.onclick=function(){
      EX_3PANE = (btn.dataset.lay==="3");
      if(EX_3PANE){ EX_LEFT="cce"; EX_MIDDLE="dsl"; EX_RIGHT="vpto"; }  // sensible 3-way defaults
      renderExplorer();
    };
  });
  // jump-to-compute-all: scroll every source/IR pane to its compute section at once.
  var jumpAll = el("ex-jump-all");
  if(jumpAll){
    jumpAll.onclick = function(){
      var panes = host.querySelectorAll(".ex-pane:not(.disasm)");
      var hits = 0;
      panes.forEach(function(pane){
        var btn = pane.querySelector(".ex-jump-btn");
        if(btn && btn.dataset.target){
          var row = pane.querySelector('.ex-line[data-line="'+btn.dataset.target+'"]');
          if(row){ row.classList.add("hl"); row.scrollIntoView({block:"center", behavior:"smooth"}); hits++; }
        }
      });
      // clear highlights after the scroll settles
      if(hits) setTimeout(function(){ document.querySelectorAll(".ex-line.hl").forEach(function(x){ x.classList.remove("hl"); }); }, 2000);
    };
  }
  // IDE: run + compile + side selector + revert buttons
  var ideRun = el("ex-ide-run");
  if(ideRun){ ideRun.onclick = function(){ if(EX_BUNDLE) exSaveAndRun("run"); }; }
  var ideCompile = el("ex-ide-compile");
  if(ideCompile){ ideCompile.onclick = function(){ if(EX_BUNDLE) exSaveAndRun("compile"); }; }
  // side selector
  document.querySelectorAll(".ex-side-btn").forEach(function(btn){
    btn.onclick = function(){ EX_IDE_SIDE = btn.dataset.side; document.querySelectorAll(".ex-side-btn").forEach(function(b){ b.classList.toggle("active", b===btn); }); };
  });
  // edit toggle buttons (per source pane)
  document.querySelectorAll(".ex-edit-btn").forEach(function(btn){
    btn.onclick = function(e){ e.stopPropagation(); exToggleEdit(btn.dataset.pane, btn.dataset.file); };
  });
  // revert buttons
  document.querySelectorAll(".ex-revert-btn").forEach(function(btn){
    btn.onclick = function(e){ e.stopPropagation(); exRevertPane(btn.dataset.pane); };
  });
  // stop button — terminates the running sim/compile on ecs
  var stopBtn = el("ex-ide-stop");
  if(stopBtn) stopBtn.onclick = function(){ exIdeStop(); };
  // kill-all button — terminates EVERY running sandbox sim/compile on ecs
  var killallBtn = el("ex-ide-killall");
  if(killallBtn) killallBtn.onclick = function(){ exIdeKillAll(); };
  // re-baseline button — sets the current state as the new "before" for diff comparison
  var rebaselineBtn = el("ex-ide-rebaseline");
  if(rebaselineBtn) rebaselineBtn.onclick = function(){
    if(!EX_BUNDLE) return;
    EX_IDE_BASELINE_SNAPSHOT = exIdeSnapshot(EX_BUNDLE);
    if(EX_BUNDLE.layers && EX_BUNDLE.layers.vpto && EX_BUNDLE.layers.vpto.lines){
      EX_IR_BASELINE["mi"] = EX_BUNDLE.layers.vpto.lines.join("\n");
    }
    if(EX_BUNDLE.layers && EX_BUNDLE.layers.mlir && EX_BUNDLE.layers.mlir.lines){
      EX_IR_BASELINE["ir"] = EX_BUNDLE.layers.mlir.lines.join("\n");
    }
    exIdeLog("📑 Baseline updated to current state. Future diffs compare against this.", "ok");
    exIdeUpdateState();
    exIdeRenderDiff();
    exIdeRenderPerfDiff();
  };
  // results tab switching (My Edit vs Original / Instruction Breakdown)
  document.querySelectorAll(".ex-rtab").forEach(function(btn){
    btn.onclick = function(){
      document.querySelectorAll(".ex-rtab").forEach(function(b){ b.classList.remove("active"); });
      btn.classList.add("active");
      var tab = btn.dataset.rtab;
      document.querySelectorAll(".ex-rtab-panel").forEach(function(p){ p.classList.remove("active"); });
      var panel = el("ex-rtab-"+tab); if(panel) panel.classList.add("active");
    };
  });
  // VMI vs CCE → Matched Pairs tab (full per-kernel comparison)
  var jumpPairs = el("ex-jump-pairs");
  if(jumpPairs) jumpPairs.onclick = function(e){
    e.preventDefault();
    var tab = document.querySelector('.tab[data-view="pairs"]');
    if(tab){ tab.click(); }
  };
  // run history dropdown — load a past run's bundle
  var histSel = el("ex-ide-history");
  if(histSel) histSel.onchange = function(){
    var idx = histSel.value;
    if(idx==="" || !EX_IDE_RUN_HISTORY[idx]) return;
    var h = EX_IDE_RUN_HISTORY[idx];
    if(h.bundle){ EX_BUNDLE=h.bundle; renderExplorer(); exIdeRenderDiff(); exIdeRenderPerfDiff(); exIdeSetStatus("restored run #"+(EX_IDE_RUN_HISTORY.length-parseInt(idx)),0); }
  };
}

function exIrTabs(){
  var tabs = ["mlir","vpto","llvm-ir"], out = [];
  var irTabLabel = {"mlir":"MLIR","vpto":"MI","llvm-ir":"LLVM"};
  tabs.forEach(function(t){
    var has = EX_BUNDLE.layers[t==="llvm-ir"?"llvm_ir":t];
    has = has && has.lines && has.lines.length;
    if(has) out.push('<a class="ex-irtab'+(t===EX_IR_TAB?" active":"")+'" data-irtab="'+t+'" href="#">'+(irTabLabel[t]||t.toUpperCase())+'</a>');
  });
  return out.join(" ");
}

// P2: color a line's lineno cell if it has correlations
function exLineColor(pane, lineNum){
  if(EX_COLOR_MAP && EX_COLOR_MAP[pane] && EX_COLOR_MAP[pane][lineNum]){
    return EX_COLOR_MAP[pane][lineNum];
  }
  return null;
}

// Detect comment lines (C++ and Python) for visual greyout + correlation skip
function isCommentLine(text, lang){
  var s = (text||"").trim();
  if(lang === "py") return s.startsWith("#") || s.startsWith('"""') || s.startsWith("'''");
  return s.startsWith("//") || s.startsWith("/*") || s.startsWith("*") || s.startsWith("/*");
}

// Find the first "compute section" line in a source/IR pane, to skip boilerplate
// (copyright/includes/GM→UB DMA) and jump straight to the vector-compute body.
// Markers (priority order, first line top→down that matches any, skipping comments):
//   __VEC_SCOPE__ (CCE) · vecscope (MI IR) · pto.vmi. (MLIR/DSL compute ops) · define (LLVM IR)
// Fallback: the first line with a disasm correlation (first traced instruction).
var EX_COMPUTE_MARKERS = ["__VEC_SCOPE__", "vecscope", "pto.vmi.", "define "];
function findComputeLine(lines, lang, paneClass){
  if(lines && lines.length){
    var inPyStr = false, inBlock = false;
    for(var i=0;i<lines.length;i++){
      var ln = lines[i], s = ln.trim();
      if(lang === "py"){
        if(inPyStr){ if(s.indexOf('"""')>=0 || s.indexOf("'''")>=0) inPyStr=false; continue; }  // inside docstring
        if(s.startsWith("#")) continue;
        if(s.startsWith('"""') || s.startsWith("'''")){
          var dq = s.startsWith('"""') ? '"""' : "'''";
          if(s.slice(3).indexOf(dq) < 0) inPyStr = true;  // multi-line docstring opening
          continue;
        }
      } else if(lang === "cce"){
        if(inBlock){ if(s.indexOf("*/")>=0) inBlock=false; continue; }  // inside /* */ block
        if(s.startsWith("//")||s.startsWith("/*")||s.startsWith("*")){ if(s.indexOf("/*")>=0 && s.indexOf("*/")<0) inBlock=true; continue; }
      } else { // ir: mlir/vpto (//) + llvm (;)
        if(s.startsWith("//") || s.startsWith(";")) continue;
      }
      var markers = (lang === "cce") ? ["__VEC_SCOPE__", "vecscope", "pto.vmi."] : EX_COMPUTE_MARKERS;
      for(var m=0;m<markers.length;m++){
        if(ln.indexOf(markers[m]) >= 0) return {line: i+1, marker: markers[m]};
      }
    }
  }
  // fallback: first correlated (traced) line in this pane
  if(EX_REVERSE_IDX && EX_REVERSE_IDX[paneClass]){
    var keys = Object.keys(EX_REVERSE_IDX[paneClass]).map(function(k){return +k;}).sort(function(a,b){return a-b;});
    if(keys.length) return {line: keys[0], marker: "first traced line"};
  }
  return null;
}

/* ---------------- syntax highlighting (zero-dep tokenizer) ---------------- */
// Sticky-regex rule list per language. First matching rule (priority order) wins.
// Comment + string rules come before keyword/ident so they win inside.
function _kw(s){ return s.split(/\s+/).filter(Boolean); }
function _re_kw(words){ return "\\b(?:"+words.join("|")+")\\b"; }
var HL_RULES = {
  cce: [
    {type:"comment", re:/\/\/[^\n]*|\/\*[\s\S]*?\*\//y},
    {type:"string",  re:/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/y},
    {type:"preproc", re:/#[^\n]*/y},
    {type:"number",  re:/0[xX][0-9a-fA-F]+[uUlL]*|\d+\.?\d*(?:[eE][+-]?\d+)?[fFuUlL]*/y},
    {type:"keyword", re:new RegExp(_re_kw(_kw("void char short int long float double unsigned signed bool const static inline template typename class struct enum union namespace using return if else for while do switch case break continue default new delete sizeof operator public private protected virtual override final constexpr auto decltype nullptr true false this typedef volatile extern mutable register thread_local static_cast dynamic_cast reinterpret_cast const_cast explicit friend noexcept throw try catch")),"y")},
    {type:"type",    re:new RegExp(_re_kw(_kw("uint8_t uint16_t uint32_t uint64_t int8_t int16_t int32_t int64_t size_t ptrdiff_t wchar_t aclFloat16 bfloat16_t float16_t"))+"|vector_\\w+|__\\w+__","y")},
    {type:"func",    re:/[a-zA-Z_]\w*(?=\s*\()/y},
    {type:"ident",   re:/[a-zA-Z_]\w*/y}
  ],
  py: [
    {type:"comment", re:/#[^\n]*/y},
    {type:"string",  re:/"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/y},
    {type:"decorator",re:/@[a-zA-Z_][\w.]*/y},
    {type:"number",  re:/0[xX][0-9a-fA-F]+|\d+\.?\d*/y},
    {type:"keyword", re:new RegExp(_re_kw(_kw("def class import from as for while if elif else try except finally with return yield raise break continue pass lambda global nonlocal assert del in is not and or None True False print range len int float str list dict set tuple bool self")),"y")},
    {type:"func",    re:/[a-zA-Z_]\w*(?=\s*\()/y},
    {type:"ident",   re:/[a-zA-Z_]\w*/y}
  ],
  ir: [
    {type:"comment", re:/\/\/[^\n]*|;[^\n]*/y},
    {type:"string",  re:/"[^"]*"/y},
    {type:"number",  re:/\d+/y},
    {type:"type",    re:/![\w.<>]+|index|\b[siu]i?\d+\b|\bf\d+\b|bf16|fp16|fp8/y},
    {type:"ident",   re:/[%@][a-zA-Z_0-9]\w*|[a-zA-Z_][\w.]*/y}
  ]
};
function hlLang(paneClass){
  if(paneClass==="cce") return "cce";
  if(paneClass==="dsl") return "py";
  return "ir";
}
function hlTokenize(text, rules){
  var out=[]; var i=0, n=text.length;
  while(i<n){
    var hit=null;
    for(var r=0;r<rules.length;r++){
      rules[r].re.lastIndex=i;
      var m=rules[r].re.exec(text);
      if(m && m.index===i && m[0].length>0){ hit={t:rules[r].type, x:m[0]}; break; }
    }
    if(hit){ out.push(hit.t, hit.x); i+=hit.x.length; }
    else { out.push("plain", text.charAt(i)); i++; }
  }
  return out;
}
function hlRender(tokens){
  var h="";
  for(var i=0;i<tokens.length;i+=2){
    var t=tokens[i], x=tokens[i+1];
    h += (t==="plain") ? esc(x) : '<span class="hl-'+t+'">'+esc(x)+'</span>';
  }
  return h;
}
function hlLine(line, paneClass){
  var rules = HL_RULES[hlLang(paneClass)];
  return rules ? hlRender(hlTokenize(line, rules)) : esc(line);
}
function hlText(text, paneClass){  // multi-line (for editor overlay)
  var rules = HL_RULES[hlLang(paneClass)];
  return rules ? hlRender(hlTokenize(text, rules)) : esc(text);
}
// highlight with per-line modification diff (modified lines get .ex-mod-line span)
function hlTextWithDiff(text, paneClass){
  // for IR panes (mi/ir): diff against EX_IR_BASELINE (previous run's IR)
  // for source panes (cce/dsl): diff against EX_ORIGINAL (original source)
  var orig = EX_ORIGINAL[paneClass] || EX_IR_BASELINE[paneClass] || "";
  var origLines = orig.split("\n");
  var curLines = text.split("\n");
  var html = "";
  for(var i=0; i<curLines.length; i++){
    var isMod = (i >= origLines.length) || (curLines[i] !== origLines[i]);
    var lineHtml = hlLine(curLines[i], paneClass);
    if(isMod) html += '<span class="ex-mod-line">'+lineHtml+'</span>';
    else html += lineHtml;
    if(i < curLines.length-1) html += "\n";
  }
  return html;
}

function exPane(title, lines, srcUrl, paneClass, file, lang, isIR){
  var div = document.createElement("div"); div.className = "ex-pane "+paneClass;
  // store original source for modified-line diff + revert — ONLY on first load
  // (not on every re-render, or the baseline is lost after compile/run)
  if(!isIR && (paneClass==="cce" || paneClass==="dsl") && !EX_ORIGINAL[paneClass]) {
    EX_ORIGINAL[paneClass] = (lines||[]).join("\n");
  }
  // for IR panes: store the current IR as baseline for diff (if not already stored)
  if(isIR && !EX_IR_BASELINE[paneClass] && lines && lines.length){
    EX_IR_BASELINE[paneClass] = lines.join("\n");
  }
  // use edited source if available (survives re-renders); else original
  var srcForCache = EX_EDITED[paneClass] || EX_ORIGINAL[paneClass] || (lines||[]).join("\n");
  var jump = findComputeLine(lines, lang, paneClass);
  var editable = !isIR && (paneClass==="cce" || paneClass==="dsl");  // only source panes are editable
  var head = '<div class="ex-pane-head"><span>'+esc(title)+'</span>';
  if(srcUrl) head += ' <a class="src-link" href="'+srcUrl+'" target="_blank" rel="noopener">source&nbsp;↗</a>';
  if(file) head += ' <code class="ex-file">'+esc(file)+'</code>';
  // jump-to-compute: skip boilerplate, land on the vector-compute body (e.g. __VEC_SCOPE__)
  if(jump) head += ' <button class="ex-jump-btn" data-pane="'+paneClass+'" data-target="'+jump.line+'" title="Jump to compute — line '+jump.line+' ('+esc(jump.marker.trim())+')">⤓ compute</button>';
  // edit toggle (CCE/DSL only)
  if(editable) head += ' <button class="ex-edit-btn" id="ex-edit-'+paneClass+'" data-pane="'+paneClass+'" data-file="'+esc(file||'')+'" title="Toggle edit mode">✎ edit</button> <button class="ex-revert-btn" id="ex-revert-'+paneClass+'" data-pane="'+paneClass+'" title="Revert to original source" style="display:none">↺ revert</button>';
  // P4: maximize button
  head += ' <button class="ex-max-btn" data-pane="'+paneClass+'" title="Maximize pane">▢</button>';
  head += '</div>';
  var body = '<div class="ex-pane-body" id="ex-body-'+paneClass+'">';
  if(!lines || !lines.length){ body += '<p class="muted">'+(isIR?"emit failed":"no source")+'</p>'; }
  else {
    // store raw source for the textarea (hidden div, read by edit toggle)
    if(editable) body += '<div class="ex-src-cache" id="ex-src-'+paneClass+'" style="display:none">'+esc(srcForCache)+'</div>';
    // also re-render the view-mode table from the edited source (if any) so diffs show
    if(editable && EX_EDITED[paneClass]) lines = EX_EDITED[paneClass].split("\n");
    body += '<table class="ex-code" id="ex-code-table-'+paneClass+'">';
    lines.forEach(function(ln, i){
      var n = i+1;
      var col = exLineColor(paneClass, n);
      var cmt = isCommentLine(ln, lang);
      var cls = "ex-line" + (cmt?" comment":"");
      var style = col ? ' style="border-left:3px solid '+col+'"' : '';
      var lnStyle = col ? ' style="background:'+col+'22"' : '';
      body += '<tr class="'+cls+'" data-line="'+n+'" data-pane="'+paneClass+'"'+style+'>';
      body += '<td class="ex-lineno"'+lnStyle+'>'+n+'</td>';
      var lineHtml = hlLine(ln, paneClass);
      // for IR panes with a baseline: highlight changed lines (diff vs previous run)
      var irBase = EX_IR_BASELINE[paneClass];
      var irBaseLines = irBase ? irBase.split("\n") : null;
      var isIrMod = irBaseLines && ((i >= irBaseLines.length) || (ln !== irBaseLines[i]));
      // for source panes (cce/dsl) with edits: highlight modified lines (diff vs original)
      var srcOrig = (!isIR && (paneClass==="cce"||paneClass==="dsl")) ? EX_ORIGINAL[paneClass] : null;
      var srcOrigLines = srcOrig ? srcOrig.split("\n") : null;
      var isSrcMod = srcOrigLines && ((i >= srcOrigLines.length) || (ln !== srcOrigLines[i]));
      if(isIrMod || isSrcMod) lineHtml = '<span class="ex-mod-line">'+lineHtml+'</span>';
      body += '<td class="ex-code"><pre>'+lineHtml+'</pre></td></tr>';
    });
    body += '</table>';
  }
  body += '</div>';
  div.innerHTML = head+body;
  return div;
}

// toggle edit mode: swap <table> <-> <textarea> with highlighted overlay for a source pane
function exToggleEdit(paneClass, file){
  var body = el("ex-body-"+paneClass);
  if(!body) return;
  var cache = el("ex-src-"+paneClass);
  var table = el("ex-code-table-"+paneClass);
  var existing = body.querySelector(".ex-editor-wrap");
  var btn = el("ex-edit-"+paneClass);
  var revBtn = el("ex-revert-"+paneClass);
  if(existing){
    // switch back to view mode (save edited text to EX_EDITED so it survives re-renders)
    var ta = existing.querySelector("textarea.ex-editor");
    if(ta){
      EX_EDITED[paneClass] = ta.value;   // persist edits across re-renders
      if(cache) cache.textContent = ta.value;
    }
    existing.remove();
    // save scroll position before re-render so we can restore it
    var savedScroll = {};
    ["cce","dsl","mi","ir","disasm"].forEach(function(p){
      var b = el("ex-body-"+p);
      if(b) savedScroll[p] = b.scrollTop;
    });
    if(btn){ btn.textContent="✎ edit"; btn.classList.remove("active"); }
    if(revBtn) revBtn.style.display = "none";
    // re-render so the view-mode table shows the edited source (from EX_EDITED)
    renderExplorer();
    exIdeUpdateState();
    // restore the edit button state (renderExplorer rebuilds it)
    var newBtn = el("ex-edit-"+paneClass);
    if(newBtn){ newBtn.textContent="✎ edit"; newBtn.classList.remove("active"); }
    // restore scroll positions on all panes
    ["cce","dsl","mi","ir","disasm"].forEach(function(p){
      if(savedScroll[p] != null){ var b = el("ex-body-"+p); if(b) b.scrollTop = savedScroll[p]; }
    });
  } else {
    // switch to edit mode: overlay = highlighted <pre> behind transparent <textarea>
    if(table) table.style.display = "none";
    var src = cache ? cache.textContent : "";
    var wrap = document.createElement("div"); wrap.className = "ex-editor-wrap";
    var pre = document.createElement("pre"); pre.className = "ex-editor-hl"; pre.setAttribute("aria-hidden","true");
    pre.innerHTML = hlTextWithDiff(src, paneClass);
    var ta = document.createElement("textarea"); ta.className = "ex-editor"; ta.spellcheck = false;
    ta.setAttribute("wrap", "off");
    ta.value = src;
    ta.setAttribute("data-pane", paneClass);
    ta.setAttribute("data-file", file||"");
    // live re-highlight with modified-line diff + scroll sync (rAF so it runs AFTER reflow)
    function syncHl(){ pre.innerHTML = hlTextWithDiff(ta.value, paneClass); pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft; }
    ta.addEventListener("input", function(){ requestAnimationFrame(syncHl); });
    ta.addEventListener("scroll", function(){ pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft; });
    ta.addEventListener("keydown", function(e){
      if(e.key==="Tab"){ e.preventDefault();
        var s=ta.selectionStart, en=ta.selectionEnd;
        ta.value = ta.value.substring(0,s) + "    " + ta.value.substring(en);
        ta.selectionStart = ta.selectionEnd = s+4;
        requestAnimationFrame(syncHl);
      }
    });
    wrap.appendChild(pre); wrap.appendChild(ta);
    body.appendChild(wrap);
    if(btn){ btn.textContent="✓ done"; btn.classList.add("active"); }
    if(revBtn) revBtn.style.display = "";
    setTimeout(function(){ ta.focus(); pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft; }, 0);
  }
}

// revert pane to original source
function exRevertPane(paneClass){
  // clear the persisted edit so the next render shows the original
  delete EX_EDITED[paneClass];
  var ta = document.querySelector('textarea.ex-editor[data-pane="'+paneClass+'"]');
  if(!ta) return;
  ta.value = EX_ORIGINAL[paneClass] || "";
  var pre = document.querySelector('.ex-editor-hl');
  if(pre) pre.innerHTML = hlTextWithDiff(ta.value, paneClass);
  var cache = el("ex-src-"+paneClass);
  if(cache) cache.textContent = ta.value;
}

// save edited source(s) to ecs sandbox, then run with --reuse
function exSaveAndRun(mode){  // mode = "run" or "compile"
  if(!EX_BUNDLE || EX_IDE_POLL) return;
  var b = EX_BUNDLE;
  var k = b.kernel||"", cid = b.case_id||b.case||"";
  if(!k||!cid) return;
  mode = mode || "run";
  var side = EX_IDE_SIDE || "both";
  // collect edited panes — check BOTH the live textarea (if in edit mode)
  // AND the persisted EX_EDITED (if the user toggled back to view mode with ✓ done)
  var edits = [];
  ["cce","dsl"].forEach(function(pane){
    var ta = document.querySelector('textarea.ex-editor[data-pane="'+pane+'"]');
    var content = ta ? ta.value : (EX_EDITED[pane] || "");
    // find the filename: from the textarea's data-file, or from the bundle's layer
    var filename = ta ? (ta.getAttribute("data-file")||"") : "";
    if(!filename){
      // derive from the bundle's layer file field
      var layerKey = pane==="cce" ? "cce_cpp" : "dsl_py";
      if(b.layers && b.layers[layerKey] && b.layers[layerKey].file)
        filename = b.layers[layerKey].file;
    }
    // strip path prefix — the save endpoint needs just the basename
    if(filename && filename.indexOf("/")>=0){
      var parts = filename.split("/");
      filename = parts[parts.length-1];
    }
    if(content && content !== (EX_ORIGINAL[pane]||"")){
      edits.push({side:pane, filename:filename, content:content});
    }
  });
  // compile-first gate: with unsaved-checked edits, require a clean compile before run
  if(mode === "run" && edits.length > 0 && EX_IDE_COMPILE_OK !== true && !EX_IDE_SKIP_GATE){
    exIdeLog("Run gated — compile first to catch syntax errors before the slow sim.", "warn");
    exIdeRenderGate();
    return;
  }
  EX_IDE_SKIP_GATE = false;
  // if no edits, just run (baseline)
  if(edits.length===0){ exIdeRun(b, mode, side); return; }
  exIdeSetStatus((mode==="compile"?"compiling":"running")+" (saving edits…)…",2);
  exIdeLog("Saving "+edits.length+" edited file(s) to sandbox…", "info");
  var btn=el(mode==="compile"?"ex-ide-compile":"ex-ide-run"); if(btn) btn.disabled=true;
  // generate a session up front, save edits, then run with --reuse
  fetch("/ide/run",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({kernel:k,case_id:cid,side:side,mode:mode})})
    .then(function(r){return r.json();})
    .then(function(d){
      if(d.error){ exIdeSetStatus("error",0); exIdeLog("Error: "+d.error, "err"); if(btn)btn.disabled=false; return; }
      EX_IDE_SESSION=d.session;
      EX_IDE_MODE=mode;
      exIdeLog("Session "+d.session+" — sandbox created. Saving edits…", "info");
      // save each edit sequentially, then run with --reuse
      var chain = Promise.resolve();
      edits.forEach(function(e){
        chain = chain.then(function(){
          return fetch("/ide/save",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({session:d.session,kernel:k,side:e.side,filename:e.filename,content:e.content})})
            .then(function(r){return r.json();});
        }).then(function(r){
          if(r.error) throw new Error(r.error);
          exIdeLog("  saved "+e.side+"/"+e.filename+" ✓", "ok");
        });
      });
      chain.then(function(){
        exIdeLog("Edits saved. "+(mode==="compile"?"Compiling":"Running")+" with edited source (--reuse)…", "info");
        exIdeSetStatus((mode==="compile"?"compiling":"running")+" (edited)…",5);
        // trigger the run with --reuse (re-uses the sandbox we just saved to)
        return fetch("/ide/run",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({kernel:k,case_id:cid,side:side,mode:mode,session:d.session,reuse:true})});
      }).then(function(){ exIdePoll(); })
      .catch(function(e){ exIdeSetStatus("error",0); exIdeLog("Error: "+e.message); if(btn)btn.disabled=false; });
    })
    .catch(function(e){ exIdeSetStatus("error",0); exIdeLog("Network error: "+e.message, "err"); if(btn)btn.disabled=false; });
}

var DISASM_UNIT_ORDER = ["PUSHQ","SCALAR","FLOWCTRL","RVECSU","RVECLD","RVECEX","RVECST","MTE2","MTE3","RVECLP","VEC"];

// Rebuild the disasm as a STATIC listing: group by unit (canonical order), sort
// by PC within each unit, dedupe by (unit, pc) and attach an execution count.
function sortUnitPc(disasm){
  var rank = {};
  DISASM_UNIT_ORDER.forEach(function(u,i){ rank[u]=i; });
  var count = {}, firstIdx = {}, firstIns = {};
  disasm.forEach(function(r, i){
    var u = r.unit || "?";
    var pc = r.pc || "0x0";
    var key = u + "|" + pc;
    count[key] = (count[key]||0) + 1;
    if(firstIdx[key]==null){ firstIdx[key]=i; firstIns[key]=r; }
  });
  var keys = Object.keys(count);
  keys.sort(function(a,b){
    var ua=a.split("|")[0], ub=b.split("|")[0];
    var pa=parseInt((a.split("|")[1]||"0x0").replace(/^0x/i,""),16);
    var pb=parseInt((b.split("|")[1]||"0x0").replace(/^0x/i,""),16);
    var ra=rank[ua]!=null?rank[ua]:999, rb=rank[ub]!=null?rank[ub]:999;
    if(ra!==rb) return ra-rb;
    if(ua!==ub) return ua<ub?-1:1;
    return pa-pb;
  });
  var groups=[], cur=null, grp=null;
  keys.forEach(function(k){
    var u=k.split("|")[0];
    var pcNum=parseInt((k.split("|")[1]||"0x0").replace(/^0x/i,""),16);
    if(u!==cur){ grp={unit:u, rows:[], low:pcNum, high:pcNum}; groups.push(grp); cur=u; }
    grp.rows.push({ins:firstIns[k], idx:firstIdx[k], count:count[k], pc:pcNum});
    if(pcNum<grp.low) grp.low=pcNum;
    if(pcNum>grp.high) grp.high=pcNum;
  });
  return groups;
}

function exDisasmPane(disasm, tl, sideLabel){
  var side = sideLabel || EX_SIDE.toUpperCase();
  var div = document.createElement("div"); div.className = "ex-pane disasm";
  var unitMode = (EX_DISASM_MODE === "unit");
  var head = '<div class="ex-pane-head"><span>'+(unitMode ? ("A5 disasm \u00b7 unit\u00b7PC ("+esc(side)+" static)") : ("A5 disasm + ticks ("+esc(side)+" trace)"))+'</span>';
  if(tl && tl.vf_real) head += ' <span class="muted">vf_real='+tl.vf_real+'</span>';
  head += ' <span class="ex-disasm-mode">'+
    '<button class="ex-mode-btn'+(unitMode?"":" active")+'" data-dismode="trace" title="Execution order (tick)">\u23f1 Trace</button>'+
    '<button class="ex-mode-btn'+(unitMode?" active":"")+'" data-dismode="unit" title="Static disasm grouped by unit, sorted by PC">\u2699 Unit\u00b7PC</button>'+
    '</span>';
  head += ' <input type="search" id="ex-filter" placeholder="filter\u2026" value="'+esc(EX_FILTER)+'" style="width:80px;font-size:10px" title="Filter by mnemonic or operand">';
  if(!unitMode) head += ' <label style="font-size:10px"><input type="checkbox" id="ex-stalls-only"'+(EX_STALLS_ONLY?" checked":"")+'> stalls</label>';
  head += ' <button class="ex-max-btn" data-pane="disasm" title="Maximize pane">\u25a2</button>';
  head += '</div>';
  var body = '<div class="ex-pane-body" id="ex-body-disasm"><table class="ex-code ex-disasm">';
  var filterLc = EX_FILTER.toLowerCase();

  function matches(r){
    if(!filterLc) return true;
    return ((r.mnemonic+" "+(r.operands||"")).toLowerCase().indexOf(filterLc)>=0);
  }
  function rowHtml(r, idx, count, leftHtml, clsSuffix){
    var corr = [];
    if(r.cce_line) corr.push("cce:"+r.cce_line);
    if(r.dsl_line) corr.push("dsl:"+r.dsl_line);
    if(r.mlir_line) corr.push("ir:"+r.mlir_line);
    if(r.vpto_line) corr.push("mi:"+r.vpto_line);
    var cls = "ex-line" + (clsSuffix||"") + (r.mnemonic.startsWith("RV_")?" rv":"");
    var mnemEsc = esc(r.mnemonic);
    var countBadge = (count!=null && count>1) ? ' <span class="ex-count muted" title="executed '+count+'\u00d7">\u00d7'+count+'</span>' : '';
    return '<tr class="'+cls+'" data-idx="'+idx+'" data-tick="'+(r.tick||'')+'" data-cce="'+(r.cce_line||'')+'" data-dsl="'+(r.dsl_line||'')+'" data-ir="'+(r.mlir_line||'')+'" data-mi="'+(r.vpto_line||'')+'">'+
      leftHtml+
      '<td class="ex-code"><span class="ex-mnem" data-mnemonic="'+mnemEsc+'">'+mnemEsc+'</span> <span class="ex-ops muted">'+esc(r.operands||'').slice(0,80)+'</span>'+
      (corr.length?' <span class="ex-corr muted">['+corr.join(" ")+']</span>':'')+countBadge+
      '</td></tr>';
  }

  if(unitMode){
    sortUnitPc(disasm).forEach(function(g){
      var rows = g.rows.filter(function(rr){ return matches(rr.ins); });
      if(!rows.length) return;
      var addr = "0x"+g.low.toString(16).toUpperCase() + (g.high!==g.low ? "\u2013"+"0x"+g.high.toString(16).toUpperCase() : "");
      body += '<tr class="ex-unit-hdr"><td colspan="3">'+esc(g.unit)+' <span class="muted">\u00b7 '+rows.length+' ops \u00b7 '+addr+'</span></td></tr>';
      rows.forEach(function(rr){
        var leftHtml = '<td class="ex-lineno ex-pc">'+("0x"+rr.pc.toString(16).toUpperCase())+'</td><td class="ex-tickbar ex-count-cell">'+(rr.count>1?("\u00d7"+rr.count):"")+'</td>';
        body += rowHtml(rr.ins, rr.idx, rr.count, leftHtml, "");
      });
    });
  } else {
    disasm.forEach(function(r, i){
      var tick = r.tick;
      var stall = 0;
      if(tl && tl.stalls){ for(var s=0;s<tl.stalls.length;s++){ if(tl.stalls[s].tick===tick){stall=tl.stalls[s].gap;break;} } }
      if(!matches(r)) return;
      if(EX_STALLS_ONLY && !stall) return;
      var tickStyle = '';
      if(r.cce_line && EX_COLOR_MAP && EX_COLOR_MAP.cce[r.cce_line]){ tickStyle = ' style="border-left:3px solid '+EX_COLOR_MAP.cce[r.cce_line]+'"'; }
      else if(r.dsl_line && EX_COLOR_MAP && EX_COLOR_MAP.dsl[r.dsl_line]){ tickStyle = ' style="border-left:3px solid '+EX_COLOR_MAP.dsl[r.dsl_line]+'"'; }
      else if(r.vpto_line && EX_COLOR_MAP && EX_COLOR_MAP.mi[r.vpto_line]){ tickStyle = ' style="border-left:3px solid '+EX_COLOR_MAP.mi[r.vpto_line]+'"'; }
      var leftHtml = '<td class="ex-lineno"'+tickStyle+'>'+tick+'</td><td class="ex-tickbar">'+(stall?'<span class="stall-bar" style="width:'+Math.min(stall*3,60)+'px" title="'+stall+'c gap"></span>':"")+'</td>';
      body += rowHtml(r, i, null, leftHtml, (stall?" stalled":""));
    });
  }
  body += '</table></div>';
  div.innerHTML = head+body;
  return div;
}

/* ---------------- IDE: run-on-ecs + re-correlate ---------------- */
var EX_IDE_SESSION = null;   // current ide_run session id
var EX_IDE_POLL = null;       // poll timer
var EX_IDE_DONE = false;      // guards the done-handler against in-flight duplicate poll responses
var EX_IDE_PHASES = [];       // [{phase, status, detail, start, end}] for the run summary
var EX_IDE_CUR_PHASE = "";     // current phase name (for change detection)
var EX_BUNDLE_EDITED = false; // true once the bundle was reloaded from an edited sandbox run
var EX_IDE_BASELINE = null;  // baseline bundle stats (before run)
var EX_IDE_BASELINE_SNAPSHOT = null; // full perf snapshot of the ORIGINAL (pre-edit) bundle
var EX_EDITED_CP = null;              // {kernel, critical_path, depth, chain} of the last edited run
var EX_IDE_RUN_HISTORY = [];  // [{kernel, session, mode, side, time, vmiStatus, cceStatus, perf}]
var EX_IDE_SIDE = "both";    // which side to compile/run: both|cce|vmi
var EX_IDE_MODE = "run";     // current mode: run|compile
var EX_IDE_COMPILE_OK = null;   // null=not compiled since last edit; true=clean; false=failed
var EX_IDE_COMPILE_ERRORS = []; // syntax/compile error lines extracted from the log
var EX_IDE_SKIP_GATE = false;   // one-shot: run anyway despite the compile-first gate
var EX_IDE_ERRS_ONLY = false;    // log filter: show only error/warn lines
var EX_IDE_ENV = null;           // cached {cann, ptoas, bisheng, python, soc} from /ide/env
var EX_IDE_COUNT_TIMER = null;    // periodic /ide/count poll for the live job monitor
var EX_IDE_START_TIME = 0;       // when the current compile/run launched
var EX_IDE_LAST_ACTIVITY = 0;    // last time progress or log changed
var EX_IDE_LAST_DETAIL = "";    // last progress detail (for change detection)
var EX_IDE_LAST_WARN = 0;        // last time we logged a "may be stuck" warning
var EX_IDE_ELAPSED_TIMER = null; // 1s ticker for the elapsed counter
var EX_ORIGINAL = {};         // {paneClass: original source string} — for modified-line diff
var EX_EDITED = {};           // {paneClass: edited source string} — survives re-renders
var EX_IR_BASELINE = {};      // {paneClass: previous IR text} — for diff highlighting after a run/compile
var EX_IDE_LAST_PERF = null;  // structured perf from last run (persists across re-renders)
var EX_IDE_LAST_SESSION = null;  // session of last completed run (to refetch perf)
var EX_IDE_RUN_HISTORY = [];  // [{kernel, session, mode, side, time, vmiStatus, cceStatus, perf}]

function exIdePanel(b){
  var div = document.createElement("div"); div.className = "ex-ide-panel";
  var k = b.kernel||"", cid = b.case_id||b.case||"";
  // baseline stats for delta comparison after a run — capture ONCE (the original)
  if(!EX_IDE_BASELINE){
    EX_IDE_BASELINE = {ex: b.stats&&b.stats.rv_instr_count, vf_real: b.timeline&&b.timeline.vf_real, disasm: b.stats&&b.stats.disasm_count};
  }
  // capture the ORIGINAL (pre-edit) perf snapshot on first load — used as the "before" baseline
  if(!EX_IDE_BASELINE_SNAPSHOT){
    EX_IDE_BASELINE_SNAPSHOT = exIdeSnapshot(b);
  }
  // preserve the streaming log across re-renders (only reset if no run is/was active)
  if(!EX_IDE_SESSION && !EX_IDE_LAST_SESSION){ EX_IDE_LOG_LINES = []; EX_IDE_LAST_LOG = ""; }
  div.innerHTML =
    '<div class="ex-ide-head"><span class="ex-ide-title">⚙ IDE — run on ecs (sandbox)</span>'+
    '<span class="muted small" id="ex-ide-status">idle</span>'+
    '<span class="ex-ide-elapsed" id="ex-ide-elapsed"></span>'+
    '<span class="ex-ide-jobcount" id="ex-ide-jobcount" title="running/orphaned Kernel Lab IDE jobs on ecs (refreshes automatically)"></span>'+
    '<button class="ex-ide-btn rebaseline" id="ex-ide-rebaseline" title="Set current state as the new baseline for before/after comparison">📑 re-baseline</button>'+
    '<button class="ex-ide-btn killall" id="ex-ide-killall" title="Terminate ALL running compile/sim jobs on ecs (emergency cleanup)">🧹 kill all</button>'+
    '<select class="ex-ide-history" id="ex-ide-history" title="Run history"><option value="">run history…</option></select>'+
    '</div>'+
    '<div class="ex-ide-actions">'+
      '<span class="ex-ide-actions-lbl muted small">experiment:</span>'+
      '<button class="ex-ide-btn compile" id="ex-ide-compile" title="Compile (fast): VMI emits MLIR, CCE checks build — no sim">⚙ compile</button>'+
      '<button class="ex-ide-btn run" id="ex-ide-run" title="Run sim on ecs and reload the explorer with the fresh trace">▶ run</button>'+
      '<button class="ex-ide-btn stop" id="ex-ide-stop" title="Terminate the running sim/compile on ecs" style="display:none">⏹ stop</button>'+
      '<span class="ex-ide-side-sel" title="Which side gets compiled / simulated">'+
        '<span class="muted small">side:</span>'+
        '<button class="ex-side-btn'+(EX_IDE_SIDE==="both"?" active":"")+'" data-side="both">both</button>'+
        '<button class="ex-side-btn'+(EX_IDE_SIDE==="cce"?" active":"")+'" data-side="cce">CCE</button>'+
        '<button class="ex-side-btn'+(EX_IDE_SIDE==="vmi"?" active":"")+'" data-side="vmi">VMI</button>'+
      '</span>'+
    '</div>'+
    '<div class="ex-ide-env" id="ex-ide-env"><span class="muted small">loading toolchain versions…</span></div>'+
    '<div class="ex-ide-statusbar" id="ex-ide-statusbar"><span class="ex-ide-state" id="ex-ide-state">📦 Loaded original source (no edits yet)</span></div>'+
    '<div class="ex-ide-gate" id="ex-ide-gate"></div>'+
    '<div class="ex-ide-diff" id="ex-ide-diff"></div>'+
    '<div class="ex-ide-results" id="ex-ide-results">'+
      '<div class="ex-rtabs">'+
        '<button class="ex-rtab active" data-rtab="diff" title="Compare your edited kernel against the original (before edit). Shows what changed after your edit.">📊 My Edit vs Original</button>'+
        '<button class="ex-rtab" data-rtab="mix" title="Instruction unit breakdown (EX/LD/ST/SU/SCALAR) — which instruction types each compiler emits.">📈 Instruction Breakdown</button>'+
        '<a class="ex-rtab-link" id="ex-jump-pairs" href="#" title="Full per-kernel CCE vs VMI metric comparison — opens the Matched Pairs tab">🔀 VMI vs CCE → Matched Pairs ↗</a>'+
      '</div>'+
      '<div class="ex-rtab-panel active" id="ex-rtab-diff">'+
        '<div class="ex-rtab-hint" id="ex-rtab-hint-diff"></div>'+
        '<div id="ex-ide-perf"></div>'+
        '<div id="ex-ide-charts-diff"></div>'+
      '</div>'+
      '<div class="ex-rtab-panel" id="ex-rtab-mix">'+
        '<div class="ex-rtab-hint" id="ex-rtab-hint-mix"></div>'+
        '<div id="ex-ide-charts-mix"></div>'+
      '</div>'+
    '</div>'+
    '<div class="ex-ide-body" id="ex-ide-body">'+
    '<div class="ex-ide-progress" id="ex-ide-progress"><div class="ex-ide-bar" id="ex-ide-bar"></div></div>'+
    '<div class="ex-ide-summary" id="ex-ide-summary"></div>'+
    '<div class="ex-ide-loghead"><span class="muted small">run log</span><label class="ex-errs-only"><input type="checkbox" id="ex-errs-only"> errors only</label></div>'+
    '<div class="ex-ide-term" id="ex-ide-log"><div class="ex-ide-term-inner" id="ex-ide-log-inner"></div></div>'+
    '</div>';
  // errors-only log filter
  var errsOnly = div.querySelector("#ex-errs-only");
  if(errsOnly){
    errsOnly.checked = EX_IDE_ERRS_ONLY;
    errsOnly.onchange = function(){
      EX_IDE_ERRS_ONLY = errsOnly.checked;
      var lg = el("ex-ide-log"); if(lg) lg.classList.toggle("ex-errs-only", EX_IDE_ERRS_ONLY);
    };
  }
  if(EX_IDE_ERRS_ONLY && div.querySelector("#ex-ide-log")) div.querySelector("#ex-ide-log").classList.add("ex-errs-only");
  exIdeLoadEnv();
  // render perf + log INTO the div (not via document.getElementById, which can't
  // find the elements yet — the div hasn't been appended to the DOM by renderExplorer)
  // VMI-vs-CCE table is now rendered by exIdeRenderPerf() (called after DOM attach)
  var pfInner = div.querySelector("#ex-ide-perf-cce");
  if(false && EX_IDE_LAST_PERF && EX_IDE_LAST_PERF.rows){
    var rows = EX_IDE_LAST_PERF.rows;
    var h2 = '<div class="ex-perf-head"><span>📊 last run results</span>'+
      '<span class="muted small">'+esc(EX_IDE_LAST_PERF.kernel||'')+' · session '+esc(EX_IDE_LAST_SESSION||'')+'</span></div>'+
      '<table class="ex-perf-table"><thead><tr><th>metric</th><th>VMI</th><th>CCE</th><th>Δ</th></tr></thead><tbody>';
    rows.forEach(function(r){
      var dcls = (r.delta && r.delta.indexOf('-')===0) ? 'neg' : (r.delta && r.delta.indexOf('+')===0 ? 'pos' : '');
      h2 += '<tr><td>'+esc(r.label)+'</td><td>'+esc(String(r.vmi))+'</td><td>'+esc(String(r.cce))+'</td><td class="'+dcls+'">'+esc(r.delta||'')+'</td></tr>';
    });
    h2 += '</tbody></table>';
    pfInner.innerHTML = h2;
  }
  // restore log INTO the div
  var logInner = div.querySelector("#ex-ide-log-inner");
  if(logInner && EX_IDE_LOG_LINES.length){
    EX_IDE_LOG_LINES.forEach(function(L){
      var d = document.createElement("div"); d.className = "ex-term-line ex-term-"+L.type;
      var prefix = L.type==="cmd" ? "$ " : "";
      d.innerHTML = '<span class="ex-term-pfx">'+prefix+'</span><span class="ex-term-txt">'+esc(L.text)+'</span>';
      logInner.appendChild(d);
    });
  }
  // render charts INTO the div (before it's appended to DOM)
  var chartsInnerDiff = div.querySelector("#ex-ide-charts-diff");
  var chartsInnerMix = div.querySelector("#ex-ide-charts-mix");
  if(chartsInnerDiff){ exIdeRenderChartsDiff(b, chartsInnerDiff); }
  if(chartsInnerMix){ exIdeRenderChartsMix(b, chartsInnerMix); }
  // populate run history dropdown
  var histSel = div.querySelector("#ex-ide-history");
  if(histSel){
    var hh='<option value="">run history…</option>';
    EX_IDE_RUN_HISTORY.forEach(function(h,i){
      hh+='<option value="'+i+'">#'+(EX_IDE_RUN_HISTORY.length-i)+' '+esc(h.mode)+' '+esc(h.time||'')+(h.vf_real!=null?' vf='+h.vf_real:'')+'</option>';
    });
    histSel.innerHTML=hh;
  }
  return div;
}

function exIdeSetStatus(txt, pct){
  var s=el("ex-ide-status"); if(s) s.textContent=txt;
  var bar=el("ex-ide-bar"); if(bar && pct!=null) bar.style.width=pct+"%";
  var panel=el("ex-ide-body"); if(panel) panel.classList.toggle("active", !!txt && txt!=="idle");
  // show/hide stop button + lock/unlock UI based on whether a run is active
  var isRunning = !!EX_IDE_POLL;
  var stopBtn = el("ex-ide-stop");
  if(stopBtn) stopBtn.style.display = isRunning ? "" : "none";
  exIdeLockUI(isRunning);
}
function exIdeStartElapsed(){
  exIdeStopElapsed();
  EX_IDE_START_TIME = Date.now();
  EX_IDE_LAST_ACTIVITY = Date.now();
  EX_IDE_LAST_DETAIL = "";
  EX_IDE_LAST_WARN = 0;
  EX_IDE_ELAPSED_TIMER = setInterval(function(){
    var e = el("ex-ide-elapsed"); if(!e) return;
    var sec = Math.floor((Date.now()-EX_IDE_START_TIME)/1000);
    var mm = Math.floor(sec/60), ss = sec%60;
    e.textContent = "⏱ " + mm + ":" + (ss<10?"0":"") + ss;
  }, 1000);
}
function exIdeStopElapsed(){
  if(EX_IDE_ELAPSED_TIMER){ clearInterval(EX_IDE_ELAPSED_TIMER); EX_IDE_ELAPSED_TIMER = null; }
  var e = el("ex-ide-elapsed"); if(e) e.textContent = "";
}
function exIdeTouch(){ EX_IDE_LAST_ACTIVITY = Date.now(); }
function exIdeStuckSeconds(){ return Math.floor((Date.now()-EX_IDE_LAST_ACTIVITY)/1000); }
// lock/unlock UI elements during a run/compile (case switcher, edit buttons,
// side selector, layout toggle, swap, and the opposite action button)
function exIdeLockUI(locked){
  var sel = el("explorer-select"); if(sel) sel.disabled = locked;
  // disable edit/revert buttons
  document.querySelectorAll(".ex-edit-btn, .ex-revert-btn").forEach(function(b){ b.disabled = locked; });
  // disable side selector + layout toggle + swap
  document.querySelectorAll(".ex-side-btn, .ex-lay-btn").forEach(function(b){ b.disabled = locked; });
  var swap = el("ex-swap-btn"); if(swap) swap.style.opacity = locked ? 0.4 : 1; swap && (swap.style.pointerEvents = locked ? "none" : "");
  // disable the pane selectors
  ["ex-left-sel","ex-mid-sel","ex-right-sel"].forEach(function(id){ var s=el(id); if(s) s.disabled = locked; });
  // disable both compile + run buttons (can't start a new one while one is running)
  var runBtn = el("ex-ide-run"), compBtn = el("ex-ide-compile");
  if(runBtn) runBtn.disabled = locked;
  if(compBtn) compBtn.disabled = locked;
}
// fetch + render the toolchain versions banner (CANN, ptoas, bisheng, python)
function exIdeLoadEnv(){
  var envEl = el("ex-ide-env");
  if(!envEl) return;
  fetch("/ide/env").then(function(r){return r.json();}).then(function(e){
    if(e.error){ envEl.innerHTML = '<span class="muted small">toolchain info unavailable</span>'; return; }
    EX_IDE_ENV = e;  // cache for the kill-all popup
    envEl.innerHTML = '<span class="ex-env-chip" title="CANN toolkit version">CANN '+esc(e.cann||'?')+'</span>'+
      '<span class="ex-env-chip" title="ptoas version">ptoas '+esc(e.ptoas||'?')+'</span>'+
      '<span class="ex-env-chip" title="bisheng (CCE compiler)">'+esc(e.bisheng||'?')+'</span>'+
      '<span class="ex-env-chip" title="simulator SoC">SOC '+esc(e.soc||'?')+'</span>';
  }).catch(function(){ if(envEl) envEl.innerHTML = '<span class="muted small">toolchain info unavailable</span>'; });
}

// ---- Phase 1: MI IR Diff Panel (side-by-side before/after) ----
// Simple LCS-based line diff for MI IR text. Returns [{type:'same'|'add'|'del'|'chg', left, right}].
function exLineDiff(oldText, newText){
  var oldL = (oldText||'').split('\n'), newL = (newText||'').split('\n');
  var n = oldL.length, m = newL.length;
  // build LCS table (cap at 2000 lines for performance)
  if(n>2000) oldL = oldL.slice(0,2000), n=2000;
  if(m>2000) newL = newL.slice(0,2000), m=2000;
  var dp = [];
  for(var i=0;i<=n;i++){ dp[i]=new Array(m+1).fill(0); }
  for(i=n-1;i>=0;i--){
    for(var j=m-1;j>=0;j--){
      dp[i][j] = (oldL[i]===newL[j]) ? dp[i+1][j+1]+1 : Math.max(dp[i+1][j], dp[i][j+1]);
    }
  }
  var result = [];
  i=0; var j=0;
  while(i<n && j<m){
    if(oldL[i]===newL[j]){ result.push({type:'same', left:oldL[i], right:newL[j]}); i++; j++; }
    else if(dp[i+1][j] >= dp[i][j+1]){ result.push({type:'del', left:oldL[i], right:''}); i++; }
    else { result.push({type:'add', left:'', right:newL[j]}); j++; }
  }
  while(i<n){ result.push({type:'del', left:oldL[i], right:''}); i++; }
  while(j<m){ result.push({type:'add', left:'', right:newL[j]}); j++; }
  return result;
}

// render the MI IR diff panel (side-by-side, appears after compile/run)
function exIdeRenderDiff(){
  var host = el('ex-ide-diff');
  if(!host) return;
  var baseline = EX_IR_BASELINE['mi'] || '';
  var current = (EX_BUNDLE && EX_BUNDLE.layers && EX_BUNDLE.layers.vpto && EX_BUNDLE.layers.vpto.lines)
    ? EX_BUNDLE.layers.vpto.lines.join('\n') : '';
  if(!baseline || !current || baseline === current){
    host.innerHTML = '';
    return;
  }
  var diff = exLineDiff(baseline, current);
  var addCount = diff.filter(function(d){return d.type==='add';}).length;
  var delCount = diff.filter(function(d){return d.type==='del';}).length;
  var h = '<div class="ex-diff-head"><span>🔄 MI IR Diff <span class="muted small">(original → edited)</span></span>'+
    '<span class="muted small">+'+addCount+' / −'+delCount+' lines changed</span></div>';
  h += '<div class="ex-diff-split"><div class="ex-diff-col"><div class="ex-diff-col-hdr">Original</div>';
  h += '<table class="ex-diff-table">';
  diff.forEach(function(d){
    var cls = d.type==='add' ? 'ex-diff-empty' : (d.type==='del' ? 'ex-diff-del' : 'ex-diff-same');
    h += '<tr class="'+cls+'"><td class="ex-diff-lineno"></td><td class="ex-diff-line">'+esc(d.left||'')+'</td></tr>';
  });
  h += '</table></div><div class="ex-diff-col"><div class="ex-diff-col-hdr">Edited</div>';
  h += '<table class="ex-diff-table">';
  diff.forEach(function(d){
    var cls = d.type==='del' ? 'ex-diff-empty' : (d.type==='add' ? 'ex-diff-add' : 'ex-diff-same');
    h += '<tr class="'+cls+'"><td class="ex-diff-lineno"></td><td class="ex-diff-line">'+esc(d.right||'')+'</td></tr>';
  });
  h += '</table></div></div>';
  host.innerHTML = h;
}

// ---- State tracker: updates the status bar + per-tab hints to explain what the user is looking at ----
var EX_IDE_STATE = "loaded";  // loaded | edited | compiled | ran
function exIdeUpdateState(){
  // determine state from EX_EDITED + EX_IDE_LAST_SESSION
  var hasEdits = false;
  for(var k in EX_EDITED){ if(EX_EDITED[k]) { hasEdits=true; break; } }
  if(EX_IDE_LAST_SESSION && EX_IDE_LAST_PERF) EX_IDE_STATE = "ran";
  else if(EX_IDE_LAST_SESSION) EX_IDE_STATE = "compiled";
  else if(hasEdits) EX_IDE_STATE = "edited";
  else EX_IDE_STATE = "loaded";
  // compile-first gate: editing invalidates a previous clean compile
  if(EX_IDE_STATE === "edited"){ EX_IDE_COMPILE_OK = null; EX_IDE_COMPILE_ERRORS = []; }
  // Stage 3: results area only after a compile or run (not on plain load/edit)
  var resultsEl = el("ex-ide-results");
  if(resultsEl) resultsEl.classList.toggle("hidden", !(EX_IDE_STATE === "compiled" || EX_IDE_STATE === "ran"));

  var stateEl = el("ex-ide-state");
  var hints = {
    loaded: {
      badge: "📦 Original source (no edits yet)",
      diff: "<strong>What this compares:</strong> Your edited kernel (after you run) vs the original kernel (before any edits).<br><strong>Current state:</strong> No edits yet — both columns show the original. All deltas are 0.<br><strong>To see changes:</strong> Edit the DSL source → click ▶ run.",
      cce: "<strong>What this compares:</strong> VMI (ptoas compiler, the new logical ISA) vs CCE (bisheng compiler, the physical ISA) — both running the <strong>same kernel</strong>.<br><strong>Current state:</strong> Original kernel (pre-built from the dashboard).<br><strong>This answers:</strong> Does the VMI lowering produce more or fewer instructions than CCE?",
      mix: "<strong>What this shows:</strong> Instruction unit breakdown (EX/LD/ST/SU/SCALAR/MTE2/PRED/FLOW) — which instruction types each compiler emits.<br><strong>Current state:</strong> Original kernel.<br><strong>This answers:</strong> Where do VMI and CCE differ in instruction mix?"
    },
    edited: {
      badge: "✏️ Source edited — not yet compiled or run",
      diff: "<strong>What this compares:</strong> Your edited kernel (after you run) vs the original kernel (before any edits).<br><strong>Current state:</strong> Edits saved but not run yet — the table still shows the original (no sim = no new metrics).<br><strong>To see changes:</strong> Click <strong>⚙ compile</strong> (quick MI IR check) or <strong>▶ run</strong> (full sim + perf).",
      cce: "<strong>What this compares:</strong> VMI vs CCE for the <strong>same kernel</strong>.<br><strong>Current state:</strong> Still showing the original kernel. Run the sim to update with your edited version.",
      mix: "<strong>What this shows:</strong> Instruction unit breakdown.<br><strong>Current state:</strong> Still showing the original kernel. Run the sim to update."
    },
    compiled: {
      badge: "⚙ Compiled — MI IR updated, no sim yet",
      diff: "<strong>What this compares:</strong> Your edited kernel (after you run) vs the original kernel.<br><strong>Current state:</strong> MI IR has been re-emitted from your edited DSL (see the 🔄 MI IR Diff panel above). But no sim has run yet — the perf table below still shows the original's metrics.<br><strong>To see perf changes:</strong> Click <strong>▶ run</strong>.",
      cce: "<strong>What this compares:</strong> VMI vs CCE for the <strong>same kernel</strong>.<br><strong>Current state:</strong> Still showing the original (compile doesn't run the sim). Run to update.",
      mix: "<strong>What this shows:</strong> Instruction unit breakdown.<br><strong>Current state:</strong> Still showing the original (compile doesn't run the sim). Run to update."
    },
    ran: {
      badge: "▶ Sim completed — showing your edited kernel's results",
      diff: "<strong>What this compares:</strong> Your edited kernel's sim results vs the original kernel's sim results.<br><strong>Current state:</strong> The sim ran with your edited source. The table and chart below show the real deltas.<br><strong>Δ column:</strong> positive (red) = your edit made it worse (more instructions/cycles). negative (green) = your edit improved it.<br><strong>📑 re-baseline:</strong> Click this to set the current state as the new 'original' for future comparisons.",
      cce: "<strong>What this compares:</strong> VMI vs CCE for your <strong>edited kernel</strong> (from the latest sim run).<br><strong>Current state:</strong> Updated with your edited kernel's sim results.<br><strong>This answers:</strong> After your edit, does VMI or CCE produce fewer instructions?",
      mix: "<strong>What this shows:</strong> Instruction unit breakdown for your <strong>edited kernel</strong>.<br><strong>Current state:</strong> Updated with the latest sim run results."
    }
  };
  var h = hints[EX_IDE_STATE] || hints.loaded;
  // update the status bar with state-specific color + icon + next step
  var bar = el("ex-ide-statusbar");
  if(bar){
    // remove old state classes, add new one
    bar.className = "ex-ide-statusbar state-"+EX_IDE_STATE;
    var icons = {loaded:"\u{1F4E6}", edited:"\u270F}\uFE0F", compiled:"\u2699}\uFE0F", ran:"\u25B6}\uFE0F"};
    var nextSteps = {
      loaded: "\u2192 edit the DSL source, then \u2699 compile or \u25B6 run",
      edited: "\u2192 click \u2699 compile (quick) or \u25B6 run (full sim)",
      compiled: "\u2192 click \u25B6 run to get performance numbers",
      ran: "\u2192 edit again to iterate, or \u{1F4D1} re-baseline to compare against this"
    };
    bar.innerHTML = '<span class="ex-ide-state-icon">'+(icons[EX_IDE_STATE]||"\u{1F4E6}")+'</span>'+
      '<span class="ex-ide-state">'+h.badge+'</span>'+
      '<span class="ex-ide-next-step">'+(nextSteps[EX_IDE_STATE]||"")+'</span>';
  }
  var setHint = function(id, txt){ var e=el(id); if(e) e.innerHTML = '<p class="ex-rtab-hint-text state-'+EX_IDE_STATE+'">'+txt+'</p>'; };
  setHint("ex-rtab-hint-diff", h.diff);
  setHint("ex-rtab-hint-cce", h.cce);
  setHint("ex-rtab-hint-mix", h.mix);
}

// ---- Phase 2: Perf Diff Panel (original vs edited) ----
// render the original-vs-edited perf table (alongside the existing VMI-vs-CCE table)
function exIdeRenderPerfDiff(){
  var pf = el('ex-ide-perf');
  if(!pf) return;
  var before = EX_IDE_BASELINE_SNAPSHOT;
  var after = exIdeSnapshot(EX_BUNDLE);
  if(!before || !after || before.kernel !== after.kernel){ return; }
  var metrics = [
    {label:'vf_real (cycles)', b:before.vf_real, a:after.vf_real, lowerBetter:true, perf:true},
    {label:'RV instr count', b:before.rv_count, a:after.rv_count, lowerBetter:true},
    {label:'EX (RVECEX)', b:before.ex_vmi, a:after.ex_vmi, lowerBetter:true},
    {label:'LD (RVECLD)', b:before.ld_vmi, a:after.ld_vmi, lowerBetter:true},
    {label:'ST (RVECST)', b:before.st_vmi, a:after.st_vmi, lowerBetter:true},
    {label:'SU (RVECSU)', b:before.su_vmi, a:after.su_vmi, lowerBetter:true},
    {label:'SCALAR', b:before.scal_vmi, a:after.scal_vmi, lowerBetter:true},
    {label:'stalls', b:before.stalls_vmi, a:after.stalls_vmi, lowerBetter:true, perf:true},
    {label:'max stall', b:before.max_stall_vmi, a:after.max_stall_vmi, lowerBetter:true, perf:true},
  ];
  var h = '';
  // ① verdict + regression callout (one-line conclusion)
  var vf = metrics[0], rv = metrics[1];
  if(vf.b!=null && vf.a!=null){
    var dvf = vf.a - vf.b;
    var pvf = vf.b>0 ? Math.round(dvf/vf.b*1000)/10 : null;
    var faster = dvf<0;
    var changed = (rv.a!=null && rv.b!=null) ? (rv.a - rv.b) : null;
    var regr = metrics.filter(function(m){ return m.perf && m.b!=null && m.a!=null && m.a>m.b; });
    var regrTxt = regr.map(function(m){ return m.label+' +'+(m.a-m.b); }).join(' · ');
    h += '<div class="ex-perf-verdict '+(faster?'good':dvf>0?'bad':'')+'">'+
      '<strong>'+(faster?'✅ Faster':'⚠ Slower')+'</strong> — VMI vf_real '+vf.b+' → '+vf.a+' cyc'+
      (pvf!=null?' ('+(pvf>0?'+':'')+pvf+'%)':'')+
      (changed!=null?' · changed '+(changed>0?'+':'')+changed+' RV instr':'')+
      (regr.length?' · ⚠ regressed: '+esc(regrTxt):'')+
      '</div>';
  }
  // ② Δ% diverging bars (green = improved, red = worse)
  var pctMetrics = metrics.filter(function(m){ return m.b!=null && m.a!=null && m.b!==0 && m.a!==m.b; }).map(function(m){
    return {label:m.label, pct:(m.a-m.b)/m.b*100, better:(m.lowerBetter ? (m.a<m.b) : (m.a>m.b))};
  });
  if(pctMetrics.length){
    var W=520, rowH=20, H=pctMetrics.length*rowH+26, padL=150;
    var maxAbs=1; pctMetrics.forEach(function(m){ maxAbs=Math.max(maxAbs, Math.abs(m.pct)); });
    var zeroX=padL+(W-padL-16)/2, scale=(W-padL-16)/(2*maxAbs);
    var svg=svgOpen(W,H);
    svg+='<line x1="'+zeroX+'" y1="6" x2="'+zeroX+'" y2="'+(H-12)+'" stroke="var(--muted)" stroke-dasharray="3 3"/>';
    svg+='<text x="'+zeroX+'" y="'+(H-2)+'" text-anchor="middle" fill="var(--muted)" font-size="8">0%</text>';
    pctMetrics.forEach(function(m,i){
      var y=10+i*rowH;
      var w=m.pct*scale, x=Math.min(zeroX, zeroX+w);
      var col=m.better?'var(--good)':'var(--bad)';
      svg+='<text x="'+(padL-6)+'" y="'+(y+8)+'" text-anchor="end" fill="var(--heading)" font-size="9.5">'+esc(m.label)+'</text>';
      svg+='<rect x="'+x+'" y="'+y+'" width="'+Math.max(2,Math.abs(w))+'" height="9" fill="'+col+'" opacity="0.85" rx="2"/>';
      var tx=x+Math.abs(w)+(m.pct>=0?4:-4), ta=m.pct>=0?'start':'end';
      svg+='<text x="'+tx+'" y="'+(y+8)+'" text-anchor="'+ta+'" fill="'+col+'" font-size="9">'+(m.pct>0?'+':'')+Math.round(m.pct*10)/10+'%</text>';
    });
    h += '<div class="ex-perf-diff-head"><span>Δ% vs original <span class="muted small">(green = improved, red = worse)</span></span></div>'+
      '<div class="chart" style="margin:4px 0 10px">'+svgClose(svg)+'</div>';
  }
  // ③ table
  h += '<div class="ex-perf-diff-head"><span>📊 Original vs Edited <span class="muted small">(Δ = edited − original, lower = better)</span></span></div>'+
    '<table class="ex-perf-table ex-perf-diff"><thead><tr><th>metric</th><th>Original</th><th>Edited</th><th>Δ</th><th>Δ%</th></tr></thead><tbody>';
  metrics.forEach(function(m){
    var bv = m.b, av = m.a;
    if(bv==null && av==null) return;
    var d = (av!=null && bv!=null) ? (av - bv) : null;
    var dStr = d!=null ? ((d>0?'+':'')+d) : '—';
    var pct = (d!=null && bv>0) ? '('+(d>0?'+':'')+(Math.round(d/bv*1000)/10)+'%)' : '';
    var dCls = d!=null ? (d>0 ? 'worse' : (d<0 ? 'better' : 'zero')) : '';
    h += '<tr><td>'+esc(m.label)+'</td><td class="orig">'+esc(String(bv))+'</td><td class="edit">'+esc(String(av))+'</td><td class="'+dCls+'">'+dStr+'</td><td class="'+dCls+'">'+pct+'</td></tr>';
  });
  h += '</tbody></table>';
  pf.innerHTML += h;
}

// render the persisted perf results panel (VMI vs CCE table with deltas)
function exIdeRenderPerf(){
  var pf = el("ex-ide-perf-cce");
  if(!pf || !EX_BUNDLE) { if(pf) pf.innerHTML=''; return; }
  var b = EX_BUNDLE;
  // generate VMI-vs-CCE table from the bundle (works on initial load, not just after a run)
  var snap = exIdeSnapshot(b);
  if(!snap){ pf.innerHTML=''; return; }
  var rows = [
    {label:"vf_real (cycles)", vmi:snap.vf_real, cce:snap.vf_real_cce},
    {label:"RV instr count", vmi:snap.rv_count, cce:b.stats&&b.stats.disasm_count},
    {label:"EX (RVECEX)", vmi:snap.ex_vmi, cce:snap.ex_cce},
    {label:"LD (RVECLD)", vmi:snap.ld_vmi, cce:snap.ld_cce},
    {label:"ST (RVECST)", vmi:snap.st_vmi, cce:snap.st_cce},
    {label:"SU (RVECSU)", vmi:snap.su_vmi, cce:snap.su_cce},
    {label:"SCALAR", vmi:snap.scal_vmi, cce:snap.scal_cce},
    {label:"stalls", vmi:snap.stalls_vmi, cce:snap.stalls_cce},
    {label:"max stall", vmi:snap.max_stall_vmi, cce:snap.max_stall_cce},
  ];
  var h = '<div class="ex-perf-head"><span>VMI vs CCE</span>'+
    '<span class="muted small">'+esc(b.kernel||'')+'</span></div>'+
    '<table class="ex-perf-table"><thead><tr><th>metric</th><th>VMI</th><th>CCE</th><th>Δ</th></tr></thead><tbody>';
  rows.forEach(function(r){
    var d = (r.vmi!=null && r.cce!=null) ? (r.vmi - r.cce) : null;
    var dStr = d!=null ? ((d>0?"+":"")+d) : "—";
    var dcls = d!=null ? (d>0 ? "worse" : (d<0 ? "better" : "")) : "";
    h += '<tr><td>'+esc(r.label)+'</td><td>'+esc(String(r.vmi))+'</td><td>'+esc(String(r.cce))+'</td><td class="'+dcls+'">'+dStr+'</td></tr>';
  });
  h += '</tbody></table>';
  pf.innerHTML = h;
}

// extract a structured perf snapshot from a bundle (for before/after comparison)
function exIdeSnapshot(b){
  if(!b) return null;
  var tl=b.timeline||{}, ctl=b.cce_timeline||{};
  function countUnits(side){
    var ins=((b.layers||{})[side]||{}).instructions||[];
    var c={}; ins.forEach(function(r){c[r.unit]=(c[r.unit]||0)+1;}); return c;
  }
  var vu = countUnits("vmi_disasm"), cu = countUnits("cce_disasm");
  function U(key){ return {vmi: vu[key]||0, cce: cu[key]||0}; }
  function countMnemonics(side){
    var ins=((b.layers||{})[side]||{}).instructions||[];
    var c={}; ins.forEach(function(r){ if(r.mnemonic) c[r.mnemonic]=(c[r.mnemonic]||0)+1; }); return c;
  }
  var vm = countMnemonics("vmi_disasm"), cm = countMnemonics("cce_disasm");
  var mnKeys = {};
  Object.keys(vm).forEach(function(k){ mnKeys[k]=1; });
  Object.keys(cm).forEach(function(k){ mnKeys[k]=1; });
  var mnemonics = {};
  Object.keys(mnKeys).forEach(function(k){ mnemonics[k] = {vmi: vm[k]||0, cce: cm[k]||0}; });
  return {
    kernel: b.kernel||"",
    vf_real: tl.vf_real, vf_real_cce: ctl.vf_real,
    rv_count: b.stats&&b.stats.rv_instr_count, disasm_count: b.stats&&b.stats.disasm_count,
    ex_vmi: U("RVECEX").vmi, ex_cce: U("RVECEX").cce,
    ld_vmi: U("RVECLD").vmi, ld_cce: U("RVECLD").cce,
    st_vmi: U("RVECST").vmi, st_cce: U("RVECST").cce,
    su_vmi: U("RVECSU").vmi, su_cce: U("RVECSU").cce,
    scal_vmi: U("SCALAR").vmi, scal_cce: U("SCALAR").cce,
    stalls_vmi: (tl.stalls||[]).length, stalls_cce: (ctl.stalls||[]).length,
    max_stall_vmi: (tl.stalls||[]).reduce(function(m,s){return Math.max(m,s.gap||0);},0),
    max_stall_cce: (ctl.stalls||[]).reduce(function(m,s){return Math.max(m,s.gap||0);},0),
    units: {
      RVECEX: U("RVECEX"), RVECLD: U("RVECLD"), RVECST: U("RVECST"), RVECSU: U("RVECSU"),
      SCALAR: U("SCALAR"), MTE2: U("MTE2"), MTE3: U("MTE3"), PUSHQ: U("PUSHQ"), FLOWCTRL: U("FLOWCTRL"),
    },
    mnemonics: mnemonics,
  };
}

// render performance analysis charts: before-vs-after comparison
function exIdeRenderChartsDiff(b, hostEl){
  var host = hostEl || el("ex-ide-charts-diff");
  if(!host || !b) { if(host) host.innerHTML=''; return; }
  var after = exIdeSnapshot(b);
  var before = EX_IDE_BASELINE_SNAPSHOT;
  if(!after) { host.innerHTML=''; return; }
  var metrics = [
    {label:"vf_real", key:"vf_real"}, {label:"RV total", key:"rv_count"},
    {label:"EX", key:"ex_vmi"}, {label:"LD", key:"ld_vmi"}, {label:"ST", key:"st_vmi"},
    {label:"SU", key:"su_vmi"}, {label:"SCALAR", key:"scal_vmi"},
    {label:"stalls", key:"stalls_vmi"}, {label:"max stall", key:"max_stall_vmi"},
  ];
  var h='';
  if(before && before.kernel === after.kernel){
    var maxVal=0;
    metrics.forEach(function(m){ maxVal=Math.max(maxVal, before[m.key]||0, after[m.key]||0, 1); });
    h += '<div class="ex-ba-bars">';
    metrics.forEach(function(m){
      var bv=before[m.key]||0, av=after[m.key]||0, d=av-bv;
      var bp=maxVal>0?Math.round(bv/maxVal*100):0, ap=maxVal>0?Math.round(av/maxVal*100):0;
      h += '<div class="ex-ba-row"><span class="ex-ba-lbl">'+esc(m.label)+'</span>'+
        '<div class="ex-ba-bar-wrap"><div class="ex-ba-bar before" style="width:'+bp+'%"></div>'+
        '<div class="ex-ba-bar after" style="width:'+ap+'%"></div></div>'+
        '<span class="ex-ba-val before">'+bv+'</span><span class="ex-ba-val after">'+av+'</span>'+
        '<span class="ex-ba-delta '+(d>0?'bad':d<0?'good':'zero')+'">'+(d>0?'+':'')+d+'</span></div>';
    });
    h += '</div>';
    h += '<div class="ex-ide-chart-legend"><span class="leg-dot" style="background:#6b7896"></span> original <span class="leg-dot" style="background:var(--vmi)"></span> edited</div>';
  } else {
    h += '<p class="muted small">Run after editing to see before/after comparison.</p>';
  }
  host.innerHTML=h;
}

// chart 2: VMI vs CCE instruction mix bar chart
function exIdeRenderChartsMix(b, hostEl){
  var host = hostEl || el("ex-ide-charts-mix");
  if(!host || !b) { if(host) host.innerHTML=''; return; }
  var after = exIdeSnapshot(b);
  var before = EX_IDE_BASELINE_SNAPSHOT;
  var unitLabels={RVECEX:"EX",RVECLD:"LD",RVECST:"ST",RVECSU:"SU",SCALAR:"SCAL",MTE2:"MTE2",MTE3:"MTE3",PUSHQ:"PRED",FLOWCTRL:"FLOW"};
  var units=Object.keys(unitLabels);
  if(!after || !after.units){ host.innerHTML='<p class="muted small">No instruction mix data.</p>'; return; }
  var hasBefore = !!(before && before.units && before.kernel === after.kernel);

  function uDelta(u, side){
    var a = after.units[u] ? (after.units[u][side]||0) : 0;
    var bf = hasBefore && before.units[u] ? (before.units[u][side]||0) : 0;
    return a - bf;
  }
  var changedUnits = units.filter(function(u){ return uDelta(u,'vmi')!==0 || uDelta(u,'cce')!==0; });

  // headline
  var tot = 0; units.forEach(function(u){ tot += Math.abs(uDelta(u,'vmi')) + Math.abs(uDelta(u,'cce')); });
  var top = changedUnits.slice().map(function(u){ return {u:u, d: Math.abs(uDelta(u,'vmi'))+Math.abs(uDelta(u,'cce'))}; })
    .sort(function(a,b){ return b.d-a.d; }).slice(0,3)
    .map(function(x){ return unitLabels[x.u]+" "+(uDelta(x.u,'vmi')>=0?"+":"")+uDelta(x.u,'vmi')+"/"+(uDelta(x.u,'cce')>=0?"+":"")+uDelta(x.u,'cce'); });
  var h = '<div class="ex-ide-headline">'+
    (hasBefore ? 'Your edit changed <strong>'+tot+'</strong> instruction'+(tot===1?'':'s')+(top.length?' — biggest: '+top.join(', '):'')+'.' : '<span class="muted">Edit then compile/run to see the before/after breakdown.</span>')+
    '</div>';

  // Δ chart (per unit, VMI + CCE, diverging vertical)
  var bw=13, groupPad=4, gap=10, leftPad=30, topPad=8, labelH=18, chartH=170;
  var maxAbs = 1;
  units.forEach(function(u){ maxAbs = Math.max(maxAbs, Math.abs(uDelta(u,'vmi')), Math.abs(uDelta(u,'cce'))); });
  var barAreaH = chartH - labelH - topPad, zeroY = topPad + barAreaH/2;
  var perGroup = bw*2 + groupPad, W = leftPad + units.length*(perGroup+gap) + 10;
  function by(d){ return Math.round((Math.abs(d)/maxAbs)*(barAreaH/2)); }
  h += '<div class="ex-ide-chart-title">Instruction delta — edited − original</div>';
  h += '<svg viewBox="0 0 '+W+' '+chartH+'" width="'+W+'" style="max-width:100%">';
  h += '<line x1="'+leftPad+'" y1="'+zeroY+'" x2="'+(W-10)+'" y2="'+zeroY+'" stroke="var(--border)"/>';
  units.forEach(function(u,i){
    var x = leftPad + i*(perGroup+gap);
    var dv = uDelta(u,'vmi'), dc = uDelta(u,'cce');
    var hhv = by(dv), hhc = by(dc);
    if(dv!==0) h += '<rect x="'+x+'" y="'+(dv>=0?zeroY-hhv:zeroY)+'" width="'+bw+'" height="'+Math.max(hhv,1)+'" fill="var(--vmi)" rx="1" opacity="0.9"/>';
    if(dc!==0) h += '<rect x="'+(x+bw+groupPad)+'" y="'+(dc>=0?zeroY-hhc:zeroY)+'" width="'+bw+'" height="'+Math.max(hhc,1)+'" fill="var(--cce)" rx="1" opacity="0.55"/>';
    h += '<text x="'+(x+perGroup/2)+'" y="'+(chartH-labelH+12)+'" text-anchor="middle" font-size="9" fill="var(--muted)">'+unitLabels[u]+'</text>';
  });
  h += '</svg>';
  h += '<div class="ex-ide-chart-legend">'+
    '<span class="leg-dot" style="background:var(--vmi)"></span> VMI <span class="leg-dot" style="background:var(--cce)"></span> CCE '+
    '<span class="muted small">· up = more, down = fewer (edited − original)</span></div>';

  // units table
  h += '<div class="ex-ide-chart-title">Units <span class="muted small">('+changedUnits.length+' changed)</span>'+
       '<label class="ex-showall"><input type="checkbox" id="ex-mix-showall-units"> show all</label></div>';
  h += '<div class="table-wrap"><table class="data-table compact ex-mix-table" id="ex-mix-units-table"><thead><tr>'+
    '<th>unit</th><th class="vmi">Δ VMI</th><th class="cce">Δ CCE</th></tr></thead><tbody></tbody></table></div>';

  // opcode table
  if(after.mnemonics){
    var mnSet = {};
    Object.keys(after.mnemonics).forEach(function(k){ mnSet[k]=1; });
    if(hasBefore && before.mnemonics) Object.keys(before.mnemonics).forEach(function(k){ mnSet[k]=1; });
    function mnDv(m){ var a=after.mnemonics[m]||{vmi:0,cce:0}; var bf=(hasBefore&&before.mnemonics)?(before.mnemonics[m]||{vmi:0,cce:0}):null; return bf?(a.vmi-bf.vmi):0; }
    function mnDc(m){ var a=after.mnemonics[m]||{vmi:0,cce:0}; var bf=(hasBefore&&before.mnemonics)?(before.mnemonics[m]||{vmi:0,cce:0}):null; return bf?(a.cce-bf.cce):0; }
    function mnChanged(m){ return mnDv(m)!==0 || mnDc(m)!==0; }
    var changedCount = Object.keys(mnSet).filter(mnChanged).length;
    h += '<div class="ex-ide-chart-title">Opcodes <span class="muted small">('+changedCount+' changed)</span>'+
         '<input type="search" id="ex-mix-op-search" placeholder="filter mnemonic…" style="margin-left:8px;width:150px">'+
         '<label class="ex-showall" style="margin-left:8px"><input type="checkbox" id="ex-mix-showall-op"> show all</label></div>';
    h += '<div class="table-wrap"><table class="data-table compact ex-mix-table" id="ex-mix-op-table"><thead><tr>'+
      '<th>mnemonic</th><th class="vmi">Δ VMI</th><th class="cce">Δ CCE</th></tr></thead><tbody></tbody></table></div>';
  }
  host.innerHTML = h;

  function dcCell(d){ if(!d) return '<td class="num muted">0</td>'; var cls=d>0?'good':'bad'; return '<td class="num '+cls+'">'+(d>0?'+':'')+d+'</td>'; }
  function renderUnits(){
    var tbody = el("ex-mix-units-table"); if(tbody) tbody = tbody.querySelector("tbody"); if(!tbody) return;
    var showAll = el("ex-mix-showall-units") && el("ex-mix-showall-units").checked;
    var list = showAll ? units : changedUnits;
    tbody.innerHTML = list.map(function(u){ return '<tr><td class="kernel">'+unitLabels[u]+'</td>'+dcCell(uDelta(u,'vmi'))+dcCell(uDelta(u,'cce'))+'</tr>'; }).join('');
  }
  function renderOps(){
    var tbody = el("ex-mix-op-table"); if(tbody) tbody = tbody.querySelector("tbody"); if(!tbody) return;
    var showAll = el("ex-mix-showall-op") && el("ex-mix-showall-op").checked;
    var q = (el("ex-mix-op-search") && el("ex-mix-op-search").value||"").trim().toLowerCase();
    var list = Object.keys(mnSet).filter(function(m){ return showAll || mnChanged(m); })
      .filter(function(m){ return !q || m.toLowerCase().indexOf(q)>=0; })
      .sort(function(x,y){ var dx=Math.abs(mnDv(x))+Math.abs(mnDc(x)), dy=Math.abs(mnDv(y))+Math.abs(mnDc(y)); if(dx!==dy) return dy-dx; return x<y?-1:1; });
    tbody.innerHTML = list.map(function(m){ return '<tr class="ex-mix-changed"><td class="kernel">'+esc(m)+'</td>'+dcCell(mnDv(m))+dcCell(mnDc(m))+'</tr>'; }).join('') || '<tr><td colspan="3" class="muted">no matching opcodes</td></tr>';
  }
  renderUnits(); renderOps();
  var su = el("ex-mix-showall-units"); if(su) su.addEventListener("change", renderUnits);
  var so = el("ex-mix-showall-op"); if(so) so.addEventListener("change", renderOps);
  var os = el("ex-mix-op-search"); if(os) os.addEventListener("input", renderOps);
}

function exIdeRenderSummary(){
  var host = el("ex-ide-summary");
  if(!host) return;
  if(!EX_IDE_PHASES.length){ host.innerHTML = ''; return; }
  var html = '<div class="ex-sum-title">Run phases</div>';
  EX_IDE_PHASES.forEach(function(p){
    var label = exPhaseLabel(p.phase);
    var dur = p.start ? Math.max(0, ((p.end||Date.now())-p.start)/1000) : 0;
    var durStr = p.end ? (dur<60 ? Math.round(dur)+"s" : (dur/60).toFixed(1)+"m") : "";
    var icon = p.status==="done" ? "✓" : p.status==="failed" ? "✗" : "▶";
    var cls = p.status==="done" ? "ok" : p.status==="failed" ? "bad" : "running";
    html += '<div class="ex-sum-row '+cls+'">'+
      '<span class="ex-sum-ic">'+icon+'</span>'+
      '<span class="ex-sum-ph">'+esc(label)+'</span>'+
      '<span class="ex-sum-dt muted">'+esc(p.detail||"")+'</span>'+
      (durStr?'<span class="ex-sum-dur muted">'+durStr+'</span>':'')+
      '</div>';
  });
  host.innerHTML = html;
}
function exIdeShowFailBanner(detail){
  var log = EX_IDE_LAST_LOG || "";
  var lc = log.toLowerCase();
  function has(re){ return re.test(lc); }
  var type;
  if(/mismatch|not equal|allclose|resultcmp|incorrect|wrong result|differs|assertionerror|assert/.test(lc)) type = "correctness";
  else if(/error:|undefined|syntaxerror|no such|not found|fatal error|cannot|command not found/.test(lc)) type = "compile";
  else type = "failed";
  var T = {
    correctness:["❌ Correctness check failed","The kernel ran but produced incorrect output — see the mismatch in the log below."],
    compile:["❌ Compile failed","The kernel failed to build — see the compiler error in the log below."],
    failed:["❌ Run failed","The run did not complete (compile error, crash, or timeout) — see the log below."],
  }[type];
  var banner = el("ex-ide-fail-banner") || document.createElement("div");
  banner.id = "ex-ide-fail-banner";
  banner.className = "ex-ide-fail-banner";
  banner.innerHTML = '<div class="fail-title">'+esc(T[0])+'</div>'+
    '<div class="fail-detail">'+esc(detail)+'</div>'+
    '<div class="fail-hint">'+esc(T[1])+'</div>';
  var body = el("ex-ide-body");
  if(body && !body.querySelector("#ex-ide-fail-banner")) body.insertBefore(banner, body.firstChild);
}
function exIdeSelectRtab(name){
  var btn = document.querySelector('.ex-rtab[data-rtab="'+name+'"]');
  if(btn){ btn.click(); }
  else {
    document.querySelectorAll(".ex-rtab").forEach(function(b){ b.classList.remove("active"); });
    document.querySelectorAll(".ex-rtab-panel").forEach(function(p){ p.classList.remove("active"); });
    var panel = el("ex-rtab-"+name); if(panel) panel.classList.add("active");
  }
}

// re-render the persisted terminal log lines after an explorer re-render
function exIdeRestoreLog(){
  var inner = el("ex-ide-log-inner");
  if(!inner || !EX_IDE_LOG_LINES.length) return;
  inner.innerHTML = '';
  EX_IDE_LOG_LINES.forEach(function(L){
    var d = document.createElement("div"); d.className = "ex-term-line ex-term-"+L.type;
    var prefix = L.type==="cmd" ? "$ " : "";
    d.innerHTML = '<span class="ex-term-pfx">'+prefix+'</span><span class="ex-term-txt">'+esc(L.text)+'</span>';
    inner.appendChild(d);
  });
  var log = el("ex-ide-log");
  if(log) log.scrollTop = log.scrollHeight;
}
// terminal-style logging: append a colored line to the streaming log buffer.
// type drives color: cmd (cyan, $ prefix), ok (green), err (red), warn (amber),
// info (blue), out (dim — raw sim output), plain (default).
var EX_IDE_LOG_LINES = [];
var EX_IDE_LAST_LOG = "";
function exIdeLog(txt, type){
  type = type || "plain";
  var inner = el("ex-ide-log-inner");
  if(!inner) return;
  // split multi-line txt into separate lines so each gets its own div
  txt.split("\n").forEach(function(line){
    if(line.length===0) return;
    EX_IDE_LOG_LINES.push({type:type, text:line});
    var div = document.createElement("div"); div.className = "ex-term-line ex-term-"+type;
    var prefix = type==="cmd" ? "$ " : "";
    div.innerHTML = '<span class="ex-term-pfx">'+prefix+'</span><span class="ex-term-txt">'+esc(line)+'</span>';
    inner.appendChild(div);
  });
  // cap buffer (keep last 500 lines to avoid runaway DOM)
  if(EX_IDE_LOG_LINES.length > 500){
    while(inner.children.length > 500) inner.removeChild(inner.firstChild);
  }
  // auto-scroll to bottom
  var log = el("ex-ide-log");
  if(log) log.scrollTop = log.scrollHeight;
}
// stream the raw ecs run.log: append only NEW lines since the last fetch
function exIdeStreamLog(rawLog){
  if(!rawLog || rawLog === EX_IDE_LAST_LOG) return;
  // find the new tail (lines after what we already showed)
  var prev = EX_IDE_LAST_LOG, curr = rawLog;
  var newPart;
  if(prev && curr.indexOf(prev) >= 0){
    newPart = curr.substring(prev.length);  // append-only: take the suffix
  } else {
    // log was truncated/rotated — show the whole thing as a refresh
    newPart = curr;
  }
  EX_IDE_LAST_LOG = curr;
  if(!newPart.trim()) return;
  exIdeTouch();  // heartbeat: log output arrived
  // classify each line: error/fail → red, warning → yellow, normal → plain
  newPart.split("\n").forEach(function(line){
    if(!line.trim()) return;
    var lc = line.toLowerCase();
    var type = "out";  // default: plain output
    if(lc.indexOf("error")>=0 || lc.indexOf("fail")>=0 || lc.indexOf("traceback")>=0 ||
       lc.indexOf("core dumped")>=0 || lc.indexOf("mismatch")>=0 || lc.indexOf("assert")>=0 ||
       lc.indexOf("incorrect")>=0 || lc.indexOf("abort")>=0 || lc.indexOf("exception")>=0){
      type = "err";
    } else if(lc.indexOf("warn")>=0 || lc.indexOf("no_dsl")>=0 || lc.indexOf("skip")>=0){
      type = "warn";
    } else if(lc.indexOf("pass")>=0 || lc.indexOf("done")>=0 || lc.indexOf("✓")>=0){
      type = "ok";
    }
    exIdeLog(line, type);
  });
}

function exIdeRun(b, mode, side){
  mode = mode || "run"; side = side || "both";
  if(EX_IDE_POLL){ return; }  // already running
  var k=b.kernel||"", cid=b.case_id||b.case||"";
  if(!k||!cid){ exIdeSetStatus("no kernel/case",0); return; }
  EX_IDE_MODE=mode;
  exIdeSetStatus((mode==="compile"?"compiling":"running")+"…",5);
  exIdeLog("Launching sandbox "+mode+" on ecs for "+k+" (side="+side+")…", "cmd");
  var btn=el(mode==="compile"?"ex-ide-compile":"ex-ide-run"); if(btn) btn.disabled=true;
  function launch(reuse, session){
    return fetch("/ide/run",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({kernel:k,case_id:cid,side:side,mode:mode,session:session,reuse:reuse})});
  }
  // 1) create sandbox + copy original source → returns session
  launch(false, undefined)
    .then(function(r){ return r.json(); })
    .then(function(d){
      if(d.error){ throw new Error(d.error); }
      EX_IDE_SESSION = d.session;
      exIdeStartElapsed();
      var expect = (mode==="compile") ? "~3s (compile only)" : "~30–130s (full sim)";
      exIdeSetStatus((mode==="compile"?"compiling":"running")+" (session "+d.session+")…",5);
      exIdeLog("Started "+new Date().toLocaleTimeString()+" — expected "+expect+", side="+side+".", "info");
      exIdeLog("Sandbox ready. Starting "+(mode==="compile"?"compile":"sim")+"…", "info");
      // 2) start the actual compile/run with --reuse
      return launch(true, d.session);
    })
    .then(function(r){ return r.json(); })
    .then(function(d2){
      if(d2.error){ throw new Error(d2.error); }
      exIdePoll();
    })
    .catch(function(e){ exIdeSetStatus("error",0); exIdeLog("Error: "+e.message, "err"); exIdeStopElapsed(); if(btn)btn.disabled=false; });
}

function exIdePoll(){
  if(!EX_IDE_SESSION) return;
  if(EX_IDE_POLL) clearInterval(EX_IDE_POLL);
  EX_IDE_DONE = false;   // reset for this run
  EX_IDE_PHASES = [];     // fresh phase summary for this run
  EX_IDE_CUR_PHASE = "";
  exIdeRenderSummary();
  // poll every 2s — stream the raw ecs run.log + progress until DONE
  EX_IDE_POLL = setInterval(function(){
  fetch("/ide/progress?session="+EX_IDE_SESSION)
    .then(function(r){return r.json();})
    .then(function(d){
      var pct=d.progress||0;
      var detailKey = (d.phase||"")+":"+(d.detail||"");
      if(detailKey !== EX_IDE_LAST_DETAIL){ EX_IDE_LAST_DETAIL = detailKey; exIdeTouch(); }
      exIdeSetStatus(d.phase+": "+d.detail, pct);
      // track run phases for the summary checklist
      var ph = d.phase || "";
      if(ph !== EX_IDE_CUR_PHASE){
        if(EX_IDE_CUR_PHASE){ var lp=EX_IDE_PHASES[EX_IDE_PHASES.length-1]; if(lp && lp.status==="running"){ lp.status="done"; lp.end=Date.now(); } }
        EX_IDE_CUR_PHASE = ph;
        EX_IDE_PHASES.push({phase:ph, status:"running", detail:d.detail||"", start:Date.now()});
        exIdeRenderSummary();
      } else if(EX_IDE_PHASES.length){
        EX_IDE_PHASES[EX_IDE_PHASES.length-1].detail = d.detail||"";
        exIdeRenderSummary();
      }
      // stream the raw ecs run.log (append-only new lines) on every poll
      fetch("/ide/log?session="+EX_IDE_SESSION).then(function(r){return r.text();}).then(function(t){ exIdeStreamLog(t); });
      // stuck detection: no progress + no log for a while → warn
      var idle = exIdeStuckSeconds();
      if(idle >= 60 && Date.now()-EX_IDE_LAST_WARN > 45000){
        EX_IDE_LAST_WARN = Date.now();
        exIdeLog("⚠ no new output for "+idle+"s — may be stuck. ⏹ stop is available (then retry).", "warn");
      }
      if(d.done){
        if(EX_IDE_DONE) return;  // already handled by a previous in-flight poll response
        EX_IDE_DONE = true;
        clearInterval(EX_IDE_POLL); EX_IDE_POLL=null;
        exIdeStopElapsed();
        var btn=el(EX_IDE_MODE==="compile"?"ex-ide-compile":"ex-ide-run"); if(btn) btn.disabled=false;
        var isFail = d.phase==="error"||(d.detail&&d.detail.indexOf("FAIL")>=0);
        if(EX_IDE_PHASES.length){ var lp=EX_IDE_PHASES[EX_IDE_PHASES.length-1]; lp.status = isFail ? "failed" : "done"; lp.end = Date.now(); exIdeRenderSummary(); }
        if(isFail){
          exIdeSetStatus("failed",100);
          var detail = d.detail || "unknown error";
          // fetch the final log tail first, then classify the failure from the full log
          fetch("/ide/log?session="+EX_IDE_SESSION).then(function(r){return r.text();}).then(function(t){
            exIdeStreamLog(t);
            exIdeShowFailBanner(detail);
          }).catch(function(){ exIdeShowFailBanner(detail); });
          exIdeLog("❌ "+detail, "err");
          EX_IDE_COMPILE_OK = false;
          EX_IDE_COMPILE_ERRORS = exIdeExtractErrors((d.detail||"") + "\n" + (EX_IDE_LAST_LOG||""));
          exIdeRenderGate();
        } else if(EX_IDE_MODE==="compile"){
          exIdeSetStatus("compile done ✓ — fetching updated IR…",100);
          EX_IDE_COMPILE_OK = true;
          EX_IDE_COMPILE_ERRORS = [];
          fetch("/ide/log?session="+EX_IDE_SESSION).then(function(r){return r.text();}).then(function(t){ exIdeStreamLog(t); });
          // fetch the updated MLIR + VPTO (MI IR) from the compile and inject into the bundle
          exIdeLoadCompiledIR();
        } else {
          exIdeSetStatus("reloading bundle…",100);
          fetch("/ide/log?session="+EX_IDE_SESSION).then(function(r){return r.text();}).then(function(t){ exIdeStreamLog(t); });
          // wait 1s before fetching perf (perf.json is written just before DONE,
          // but filesystem flush may lag the progress.json read)
          setTimeout(exIdeLoadBundle, 1000);
        }
      }
    })
    .catch(function(){ /* keep polling on transient errors */ });
  }, 2000);
}

// terminate the running sim/compile on ecs
function exIdeStop(){
  if(!EX_IDE_SESSION) return;
  exIdeLog("terminating run on ecs…", "warn");
  fetch("/ide/stop",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({session:EX_IDE_SESSION})})
    .then(function(r){return r.json();})
    .then(function(d){
      exIdeLog("✓ run terminated", "err");
      if(EX_IDE_POLL){ clearInterval(EX_IDE_POLL); EX_IDE_POLL=null; }
      exIdeStopElapsed();
      var btn=el(EX_IDE_MODE==="compile"?"ex-ide-compile":"ex-ide-run"); if(btn) btn.disabled=false;
      exIdeSetStatus("terminated",0);
    })
    .catch(function(e){ exIdeLog("stop failed: "+e.message, "err"); });
}

// Kill ALL running sandbox sims/compiles on ecs (with a confirmation popup).
function exIdeKillAll(){
  el("modal-title").textContent = "🧹 Kill all ecs running jobs?";
  var mb = el("modal-body");
  mb.innerHTML = '<p class="muted small">Checking running Kernel Lab IDE jobs on ecs…</p>';
  el("modal").classList.remove("hidden");
  var env = EX_IDE_ENV || {};
  var sideLabel = (EX_IDE_SIDE === "both") ? "both (CCE + VMI)" : (EX_IDE_SIDE || "both").toUpperCase();
  var toolchain = (env.ptoas ? 'ptoas <b>'+esc(env.ptoas)+'</b>' : '') +
                  (env.bisheng ? ' · CCE <b>'+esc(env.bisheng)+'</b>' : '') +
                  (env.cann ? ' · CANN '+esc(env.cann) : '') +
                  (env.soc ? ' · SOC '+esc(env.soc) : '');
  fetch("/ide/count").then(function(r){ return r.json(); }).then(function(d){
    var n = (d && d.count!=null) ? d.count : null;
    var body = '';
    body += '<div class="ex-kill-tools">🛠 Toolchain: '+(toolchain||'<span class="muted">unknown</span>')+'</div>';
    body += '<div class="ex-kill-tools">⚙ Compile side: <b>'+esc(sideLabel)+'</b></div>';
    if(n == null){
      body += '<p style="margin:8px 0"><strong style="color:var(--bad)">⚠ Warning:</strong> this terminates <strong>ALL</strong> running Kernel Lab compile/simulation jobs on ecs (144) — every IDE sandbox session, not just this kernel. The daily refresh and other users are <strong>never</strong> affected.</p>';
    } else if(n === 0){
      body += '<p style="margin:8px 0"><strong style="color:var(--good)">✅ No running Kernel Lab IDE jobs</strong> — count is <b>0</b>. Nothing to clean up.</p>';
    } else {
      body += '<p style="margin:8px 0"><strong style="color:var(--bad)">⚠ '+n+'</strong> running/orphaned Kernel Lab IDE job process(es) on ecs (144). This will terminate them all — not just this kernel.</p><p class="muted small">The daily refresh and other users are never affected.</p>';
    }
    body += '<div style="margin-top:12px;display:flex;gap:10px;justify-content:flex-end">'+
      '<button class="cov-clear" data-close>Cancel</button>'+
      '<button class="ex-confirm-ok" id="ex-killall-ok">'+(n ? 'Yes, kill all' : 'Kill all anyway')+'</button>'+
    '</div>';
    mb.innerHTML = body;
    var ok = el("ex-killall-ok");
    if(ok) ok.onclick = function(){
      el("modal").classList.add("hidden");
      exIdeDoKillAll();
    };
  }).catch(function(){
    mb.innerHTML = '<p style="margin:0 0 8px"><strong style="color:var(--bad)">⚠ Warning:</strong> this terminates <strong>ALL</strong> running Kernel Lab compile/simulation jobs on ecs (144).</p>'+
      '<div style="margin-top:14px;display:flex;gap:10px;justify-content:flex-end"><button class="cov-clear" data-close>Cancel</button><button class="ex-confirm-ok" id="ex-killall-ok">Yes, kill all</button></div>';
    var ok = el("ex-killall-ok");
    if(ok) ok.onclick = function(){ el("modal").classList.add("hidden"); exIdeDoKillAll(); };
  });
}
function exIdeDoKillAll(){
  exIdeLog("Killing ALL Kernel Lab sandbox jobs on ecs…", "warn");
  fetch("/ide/killall", {method:"POST", headers:{"Content-Type":"application/json"}, body:"{}"})
    .then(function(r){ return r.json(); })
    .then(function(d){
      if(d.error){ exIdeLog("killall error: "+d.error, "err"); exIdeSetStatus("killall failed",0); return; }
      var before = (d.before!=null ? d.before : "?");
      var after = (d.after!=null ? d.after : "?");
      if(after === 0){
        exIdeLog("✓ killed "+before+" → 0 remaining. All Kernel Lab IDE jobs cleaned up.", "ok");
        exIdeSetStatus("killed "+before+" → 0 remaining", 0);
      } else {
        exIdeLog("⚠ killed "+before+" but "+after+" still remaining — try again or ⏹ stop individually.", "warn");
        exIdeSetStatus("killed "+before+", "+after+" remaining", 0);
      }
      if(EX_IDE_POLL){ clearInterval(EX_IDE_POLL); EX_IDE_POLL = null; }
      exIdeStopElapsed();
      EX_IDE_SESSION = null;
      var rb = el("ex-ide-run"), cb = el("ex-ide-compile");
      if(rb) rb.disabled = false;
      if(cb) cb.disabled = false;
      exIdeUpdateJobCount();
    })
    .catch(function(e){ exIdeLog("killall failed: "+e.message, "err"); exIdeSetStatus("killall failed",0); });
}
// ---- live job monitor: poll /ide/count so running/orphaned jobs are always visible ----
var EX_PHASE_LABELS = {
  "sandbox":"preparing sandbox", "cce_compile":"compiling CCE", "vmi_compile":"compiling VMI",
  "cce_sim":"running CCE sim", "vmi_sim":"running VMI sim", "compile":"compiling",
  "sim":"running sim", "bundle":"rebuilding bundle", "rebuild":"rebuilding bundle",
  "done":"done", "error":"failed", "starting":"starting",
};
function exPhaseLabel(p){ return EX_PHASE_LABELS[p] || (p ? p.replace(/_/g, " ") : "starting"); }
function exIdeUpdateJobCount(){
  fetch("/ide/count").then(function(r){ return r.json(); }).then(function(d){
    var jobs = (d && d.jobs) ? d.jobs : [];
    var jc = el("ex-ide-jobcount"), tc = el("ex-ide-tab-badge");
    var total = jobs.length;
    // aggregate active jobs by friendly phase; count orphaned (stuck) separately
    var pc = {}, stuck = 0;
    jobs.forEach(function(j){
      if(j.active){ var L = exPhaseLabel(j.phase || "starting"); pc[L] = (pc[L]||0)+1; }
      else { stuck++; }
    });
    var parts = Object.keys(pc).sort().map(function(L){ return pc[L]+" "+L; });
    if(stuck>0) parts.push(stuck+" stuck");
    var breakdown = parts.join(" · ");
    var title = total+" job"+(total===1?"":"s")+(breakdown ? " · "+breakdown : "");
    var html = (total === 0)
      ? '<span class="ex-jc dot ok"></span> 0 jobs'
      : '<span class="ex-jc dot busy"></span> '+total+' job'+(total===1?"":"s")+(breakdown?' <span class="ex-jc-phase">· '+esc(breakdown)+'</span>':'');
    if(jc){ jc.innerHTML = html; jc.title = title; }
    if(tc) tc.innerHTML = (total>0) ? '· '+total+' job'+(total===1?'':'s')+(stuck>0?' ('+stuck+' stuck)':'') : '';
  }).catch(function(){ /* ignore transient errors */ });
}
function exIdeStartJobMonitor(){
  if(EX_IDE_COUNT_TIMER) return;
  exIdeUpdateJobCount();
  EX_IDE_COUNT_TIMER = setInterval(exIdeUpdateJobCount, 5000);
}

// After a compile: fetch the updated MLIR + VPTO (MI IR) from the sandbox and
// inject them into EX_BUNDLE so the IR panes refresh with the edited lowering.
function exIdeLoadCompiledIR(){
  if(!EX_BUNDLE||!EX_IDE_SESSION) return;
  var ses=EX_IDE_SESSION;
  // save current IR as baseline (only if not already set — the baseline should
  // persist as the ORIGINAL across multiple compile/run cycles; only re-baseline
  // should change it)
  if(EX_BUNDLE.layers && EX_BUNDLE.layers.vpto && EX_BUNDLE.layers.vpto.lines){
    if(!EX_IR_BASELINE["mi"]) EX_IR_BASELINE["mi"] = EX_BUNDLE.layers.vpto.lines.join("\n");
  }
  if(EX_BUNDLE.layers && EX_BUNDLE.layers.mlir && EX_BUNDLE.layers.mlir.lines){
    if(!EX_IR_BASELINE["ir"]) EX_IR_BASELINE["ir"] = EX_BUNDLE.layers.mlir.lines.join("\n");
  }
  exIdeLog("Fetching updated MLIR + MI IR from compile…", "info");
  var mlirP = fetch("/ide/ir?session="+ses+"&type=mlir").then(function(r){return r.text();});
  var vptoP = fetch("/ide/ir?session="+ses+"&type=vpto").then(function(r){return r.text();});
  Promise.all([mlirP, vptoP])
    .then(function(results){
      var mlirText=results[0], vptoText=results[1];
      var updated=false;
      if(mlirText && mlirText.trim()){
        EX_BUNDLE.layers.mlir = {lines: mlirText.split("\n"), file: "emit-mlir.txt", error: null};
        updated=true; exIdeLog("  MLIR updated ("+mlirText.split("\n").length+" lines)", "ok");
      }
      if(vptoText && vptoText.trim()){
        EX_BUNDLE.layers.vpto = {lines: vptoText.split("\n"), file: "emit-vpto.txt", error: null};
        updated=true; exIdeLog("  MI IR (VPTO) updated ("+vptoText.split("\n").length+" lines)", "ok");
      }
      if(!updated){ exIdeLog("no IR emitted (compile may have failed)", "warn"); return; }
      EX_IDE_LAST_SESSION=ses;
      // re-derive vpto_line correlation with the new MI IR
      renderExplorer();
      exIdeRenderDiff();
      EX_IDE_RUN_HISTORY.push({kernel:EX_BUNDLE.kernel||"", mode:"compile", time:new Date().toLocaleTimeString(), bundle:JSON.parse(JSON.stringify(EX_BUNDLE))});
      exIdeSetStatus("compile done ✓ — IR updated",100);
      exIdeUpdateState();
      exIdeLog("✓ IR panes refreshed with the edited lowering", "ok");
    })
    .catch(function(e){ exIdeLog("IR fetch failed: "+e.message, "err"); });
}

function exIdeLoadBundle(){
  if(!EX_BUNDLE||!EX_IDE_SESSION) return;
  var k=EX_BUNDLE.kernel||"", cid=EX_BUNDLE.case_id||EX_BUNDLE.case||"";
  // save current IR as baseline (only if not already set — preserve the original
  // across multiple run cycles; only re-baseline should change it)
  if(EX_BUNDLE.layers && EX_BUNDLE.layers.vpto && EX_BUNDLE.layers.vpto.lines){
    if(!EX_IR_BASELINE["mi"]) EX_IR_BASELINE["mi"] = EX_BUNDLE.layers.vpto.lines.join("\n");
  }
  if(EX_BUNDLE.layers && EX_BUNDLE.layers.mlir && EX_BUNDLE.layers.mlir.lines){
    if(!EX_IR_BASELINE["ir"]) EX_IR_BASELINE["ir"] = EX_BUNDLE.layers.mlir.lines.join("\n");
  }
  exIdeLog("Fetching rebuilt bundle + perf from ecs sandbox…", "info");
  // fetch perf FIRST (small, fast) so it shows even if the bundle fetch fails
  fetch("/ide/perf?session="+EX_IDE_SESSION)
    .then(function(r){return r.json();})
    .then(function(p){
      if(p && !p.error && p.rows){ EX_IDE_LAST_PERF=p; exIdeLog("✓ perf results loaded", "ok"); }
      else { exIdeLog("no perf.json for this run", "warn"); }
      // now fetch the bundle (large — may take longer)
      return fetch("/ide/bundle?session="+EX_IDE_SESSION+"&kernel="+encodeURIComponent(k)+"&case="+encodeURIComponent(cid));
    })
    .then(function(r){
      if(!r.ok){
        // try to read error, but don't crash if body isn't JSON
        return r.text().then(function(t){
          var msg=t; try{ msg=JSON.parse(t).error||t; }catch(e){}
          throw new Error("bundle: "+msg);
        });
      }
      return r.json();
    })
    .then(function(b){
      EX_BUNDLE=b; EX_SIDE=b.primary_side||"vmi";
      EX_BUNDLE_EDITED = true;   // this bundle was rebuilt from the edited sandbox source
      EX_IDE_LAST_SESSION=EX_IDE_SESSION;
      // delta badge vs baseline
      var nx=b.stats&&b.stats.rv_instr_count, nv=b.timeline&&b.timeline.vf_real;
      var dx = (nx!=null&&EX_IDE_BASELINE.ex!=null)?(nx-EX_IDE_BASELINE.ex):null;
      var dv = (nv!=null&&EX_IDE_BASELINE.vf_real!=null)?(nv-EX_IDE_BASELINE.vf_real):null;
      var msg="Bundle reloaded from sandbox run.";
      if(dx!=null) msg+=" ΔRV="+(dx>=0?"+":"")+dx+" ";
      if(dv!=null) msg+="Δvf_real="+(dv>=0?"+":"")+dv+"c";
      exIdeLog(msg, "ok");
      // render FIRST (rebuilds the panel DOM), THEN set status on the fresh elements
      renderExplorer();
      switchExTab("ide");   // land on the Edit & Simulate tab (where the results are)
      exIdeRenderDiff();
      exIdeRenderPerfDiff();
      exIdeLog("✓ run done — see 📊 My Edit vs Original for the diff", "ok");
      exIdeSelectRtab("diff");
      EX_IDE_RUN_HISTORY.push({kernel:EX_BUNDLE.kernel||"", mode:"run", time:new Date().toLocaleTimeString(),
        vf_real:EX_BUNDLE.timeline&&EX_BUNDLE.timeline.vf_real, ex:EX_BUNDLE.stats&&EX_BUNDLE.stats.rv_instr_count,
        bundle:JSON.parse(JSON.stringify(EX_BUNDLE))});
      exIdeSetStatus("done ✓",100);
      exIdeUpdateState();
      // re-derive the critical path for the edited CCE source (if any) and
      // refresh the ⛓ DAG tab to compare original vs edited
      fetch("/ide/criticalpath?session="+encodeURIComponent(EX_IDE_LAST_SESSION)+"&kernel="+encodeURIComponent(k)+"&case="+encodeURIComponent(cid))
        .then(function(r){return r.json();}).then(function(cp){
          EX_EDITED_CP = (cp && !cp.error) ? ({kernel:k, critical_path:cp.critical_path, depth:cp.depth, chain:cp.chain||[]}) : null;
          renderExplorerDag();
        }).catch(function(){});
    })
    .catch(function(e){
      exIdeLog("Could not load rebuilt bundle: "+e.message, "err");
      // still re-render to show the perf table (if perf loaded above)
      renderExplorer();
      exIdeRenderPerfDiff();
      exIdeSetStatus("bundle load failed",100);
    });
}

function exTimeline(tl, disasm){
  if(!tl || !tl.first_tick) return document.createElement("div");
  var div = document.createElement("div"); div.className = "ex-timeline";
  var first = tl.first_tick, last = tl.last_tick || (tl.vf_real+first);
  var span = last - first || 1;
  var stalls = tl.stalls || [];
  var html = '<div class="ex-tl-head">Tick timeline (vf_real='+(tl.vf_real||'?')+', stalls='+stalls.length+') <span class="muted small">· <span class="ex-tl-legend-dot"></span> red tick = stall (hover for gap)</span></div>';
  html += '<div class="ex-tl-bar" id="ex-tl-bar">';
  stalls.forEach(function(s){
    var pct = ((s.tick - first) / span) * 100;
    html += '<div class="ex-tl-stall" style="left:'+pct+'%" data-tick="'+s.tick+'" title="'+s.tick+': '+s.gap+'c '+s.from+'→'+s.to+'"></div>';
  });
  html += '</div>';
  html += '<div class="ex-tl-labels"><span>'+first+'</span><span>'+(first+Math.round(span/2))+'</span><span>'+last+'</span></div>';
  div.innerHTML = html;
  return div;
}

// P1: hover highlight — find correlated lines across all panes and add .hover
var clearHover = function(){
  document.querySelectorAll(".ex-line.hover").forEach(function(x){ x.classList.remove("hover"); });
};
var addHover = function(pane, lineNum){
  if(!lineNum) return;
  var tr = document.querySelector('.ex-line[data-pane="'+pane+'"][data-line="'+lineNum+'"]');
  if(tr && !tr.classList.contains("comment")){ tr.classList.add("hover"); }
};
var addHoverDisasm = function(instrIndices){
  instrIndices.forEach(function(i){
    var dtr = document.querySelector('.ex-disasm .ex-line[data-idx="'+i+'"]');
    if(dtr) dtr.classList.add("hover");
  });
};

function wireExplorer(disasm, tl){
  // IR tab switching
  document.querySelectorAll(".ex-irtab").forEach(function(t){
    t.onclick = function(e){ e.preventDefault(); EX_IR_TAB = t.dataset.irtab; renderExplorer(); };
  });

  // jump-to-compute: per-pane button (scoped to its own pane) — kept for 2-pane mode.
  // In 3-pane mode the single "show compute" button in the toolbar covers all panes
  // at once; individual per-pane buttons are hidden via CSS (.ex-3-pane .ex-jump-btn).
  document.querySelectorAll(".ex-jump-btn").forEach(function(btn){
    btn.onclick = function(e){
      e.stopPropagation();
      var target = btn.dataset.target;
      if(!target) return;
      var pane = btn.closest(".ex-pane");
      if(!pane) return;
      var row = pane.querySelector('.ex-line[data-line="'+target+'"]');
      if(row){
        document.querySelectorAll(".ex-line.hl").forEach(function(x){ x.classList.remove("hl"); });
        row.classList.add("hl");
        row.scrollIntoView({block:"center", behavior:"smooth"});
        setTimeout(function(){ row.classList.remove("hl"); }, 1800);
      }
    };
  });

  // P4: maximize buttons
  document.querySelectorAll(".ex-max-btn").forEach(function(btn){
    btn.onclick = function(e){
      e.stopPropagation();
      var pane = btn.dataset.pane;
      var grid = document.querySelector(".ex-grid");
      var target = document.querySelector(".ex-pane."+pane);
      if(!target || !grid) return;
      var isMax = target.classList.contains("maximized");
      if(isMax){
        target.classList.remove("maximized");
        grid.classList.remove("has-max");
        btn.textContent = "▢";
      } else {
        // un-maximize any other
        document.querySelectorAll(".ex-pane.maximized").forEach(function(p){ p.classList.remove("maximized"); });
        document.querySelectorAll(".ex-max-btn").forEach(function(b){ b.textContent="▢"; });
        target.classList.add("maximized");
        grid.classList.add("has-max");
        btn.textContent = "⬜";
      }
    };
  });

  // P5: filter + stalls-only
  var filterEl = document.getElementById("ex-filter");
  var stallsEl = document.getElementById("ex-stalls-only");
  if(filterEl){
    filterEl.oninput = function(){ EX_FILTER = filterEl.value; renderExplorer(); if(filterEl) filterEl.focus(); };
  }
  if(stallsEl){
    stallsEl.onchange = function(){ EX_STALLS_ONLY = stallsEl.checked; renderExplorer(); };
  }

  // P6: disasm view mode (trace vs unit·PC static)
  document.querySelectorAll(".ex-mode-btn[data-dismode]").forEach(function(btn){
    btn.onclick = function(e){
      e.stopPropagation();
      EX_DISASM_MODE = btn.dataset.dismode;
      try { localStorage.setItem("ex_disasm_mode", EX_DISASM_MODE); } catch(_){}
      renderExplorer();
    };
  });

  // P1: hover on source/IR lines → highlight correlated disasm + other panes
  document.querySelectorAll(".ex-line[data-pane]").forEach(function(tr){
    tr.onmouseenter = function(){
      var pane = tr.dataset.pane, line = tr.dataset.line;
      if(tr.classList.contains("comment")) return;
      clearHover();
      tr.classList.add("hover");
      // find correlated disasm instrs via reverse index
      if(EX_REVERSE_IDX && EX_REVERSE_IDX[pane] && EX_REVERSE_IDX[pane][line]){
        var idxs = EX_REVERSE_IDX[pane][line];
        addHoverDisasm(idxs);
        // cross-highlight other source panes
        var r = disasm[idxs[0]];
        if(r){
          if(pane!="cce" && r.cce_line) addHover("cce", r.cce_line);
          if(pane!="dsl" && r.dsl_line) addHover("dsl", r.dsl_line);
          if(pane!="ir" && r.mlir_line) addHover("ir", r.mlir_line);
          if(pane!="mi" && r.vpto_line) addHover("mi", r.vpto_line);
        }
      }
    };
    tr.onmouseleave = function(){ clearHover(); };
  });

  // P1: hover on disasm lines → highlight correlated source
  document.querySelectorAll(".ex-disasm .ex-line").forEach(function(dtr){
    dtr.onmouseenter = function(){
      clearHover();
      dtr.classList.add("hover");
      var cce=dtr.dataset.cce, dsl=dtr.dataset.dsl, ir=dtr.dataset.ir, mi=dtr.dataset.mi;
      if(cce) addHover("cce", cce);
      if(dsl) addHover("dsl", dsl);
      if(ir) addHover("ir", ir);
      if(mi) addHover("mi", mi);
      // also hover sibling disasm rows with same source line
      var myCce = cce, myDsl = dsl;
      document.querySelectorAll(".ex-disasm .ex-line").forEach(function(other){
        if(other!==dtr){
          if(myCce && other.dataset.cce===myCce) other.classList.add("hover");
        }
      });
    };
    dtr.onmouseleave = function(){ clearHover(); };
  });

  // source line click → highlight correlated disasm + other panes
  document.querySelectorAll(".ex-line[data-pane]").forEach(function(tr){
    tr.onclick = function(){
      var pane = tr.dataset.pane, line = tr.dataset.line;
      if(tr.classList.contains("comment")) return;
      highlightLine(pane, line);
      var hits = [];
      disasm.forEach(function(r, i){
        if((pane==="cce" && r.cce_line==line) || (pane==="dsl" && r.dsl_line==line) || (pane=="ir" && r.mlir_line==line) || (pane=="mi" && r.vpto_line==line)){
          hits.push(i);
        }
      });
      document.querySelectorAll(".ex-disasm .ex-line").forEach(function(dtr){ dtr.classList.remove("hl"); });
      hits.forEach(function(i){
        var dtr = document.querySelector('.ex-disasm .ex-line[data-idx="'+i+'"]');
        if(dtr){ dtr.classList.add("hl"); dtr.scrollIntoView({block:"nearest",behavior:"smooth"}); }
      });
      if(hits.length){
        var r = disasm[hits[0]];
        if(pane!="cce" && r.cce_line) highlightLine("cce", r.cce_line);
        if(pane!="dsl" && r.dsl_line) highlightLine("dsl", r.dsl_line);
        if(pane!="ir" && r.mlir_line) highlightLine("ir", r.mlir_line);
        if(pane!="mi" && r.vpto_line) highlightLine("mi", r.vpto_line);
      }
    };
  });

  // P6: disasm line click → highlight + scroll source to center
  document.querySelectorAll(".ex-disasm .ex-line").forEach(function(dtr){
    dtr.onclick = function(){
      document.querySelectorAll(".ex-line").forEach(function(x){ x.classList.remove("hl"); });
      dtr.classList.add("hl");
      var cce=dtr.dataset.cce, dsl=dtr.dataset.dsl, ir=dtr.dataset.ir, mi=dtr.dataset.mi;
      if(cce){ var tr=highlightLineCenter("cce", cce); }
      if(dsl){ highlightLineCenter("dsl", dsl); }
      if(ir){ highlightLineCenter("ir", ir); }
      if(mi){ highlightLineCenter("mi", mi); }
    };
  });

  // P6: timeline stall click → scroll disasm to that tick
  document.querySelectorAll(".ex-tl-stall").forEach(function(stall){
    stall.onclick = function(){
      var tick = stall.dataset.tick;
      var dtr = document.querySelector('.ex-disasm .ex-line[data-tick="'+tick+'"]');
      if(dtr){ dtr.scrollIntoView({block:"center",behavior:"smooth"}); dtr.classList.add("hl");
        setTimeout(function(){ dtr.classList.remove("hl"); }, 2000);
      }
    };
  });

  // P3: opcode tooltips — lazy load opcode_info.json, then attach mouse handlers
  loadOpcodeInfo(function(info){
    if(!info) return;
    document.querySelectorAll(".ex-mnem[data-mnemonic]").forEach(function(mn){
      var name = mn.dataset.mnemonic;
      var op = info.opcodes && info.opcodes[name];
      if(!op) return;
      var cat = info.categories && info.categories[op.cat];
      var txt = op.name + (cat ? " ["+cat.label+"]" : "") + "\\n" + op.sem +
                (cat ? "\\nLatency: "+cat.latency+"c, Throughput: "+cat.throughput+"c, EXU: "+cat.exu : "");
      mn.title = txt.replace(/\\n/g, "\\n");
      // also set a data-attr for custom tooltip styling
      mn.dataset.cat = op.cat;
      mn.dataset.tooltip = txt;
    });
    // custom tooltip div
    var tooltip = document.getElementById("ex-tooltip");
    if(!tooltip){
      tooltip = document.createElement("div");
      tooltip.id = "ex-tooltip"; tooltip.className = "ex-tooltip";
      document.body.appendChild(tooltip);
    }
    document.querySelectorAll(".ex-mnem[data-tooltip]").forEach(function(mn){
      mn.onmouseenter = function(e){
        tooltip.textContent = mn.dataset.tooltip;
        tooltip.style.display = "block";
        var cat = mn.dataset.cat;
        var info2 = EX_OPCODE_INFO.categories[cat];
        tooltip.style.borderColor = info2 ? info2.color : "var(--border)";
      };
      mn.onmousemove = function(e){
        tooltip.style.left = (e.clientX+12)+"px";
        tooltip.style.top = (e.clientY+12)+"px";
      };
      mn.onmouseleave = function(){ tooltip.style.display = "none"; };
    });
  });
}

function highlightLine(pane, line){
  document.querySelectorAll(".ex-line[data-pane='"+pane+"']").forEach(function(x){ x.classList.remove("hl"); });
  var tr = document.querySelector('.ex-line[data-pane="'+pane+'"][data-line="'+line+'"]');
  if(tr){ tr.classList.add("hl"); tr.scrollIntoView({block:"nearest",behavior:"smooth"}); }
}
// P6: scroll to center
function highlightLineCenter(pane, line){
  document.querySelectorAll(".ex-line[data-pane='"+pane+"']").forEach(function(x){ x.classList.remove("hl"); });
  var tr = document.querySelector('.ex-line[data-pane="'+pane+'"][data-line="'+line+'"]');
  if(tr){ tr.classList.add("hl"); tr.scrollIntoView({block:"center",behavior:"smooth"}); }
  return tr;
}

/* ---------------- VERSION SYSTEM ---------------- */
var VER_INDEX = null;
var VER_CURRENT = null;
function loadVersions(cb){
  if(VER_INDEX){ cb(VER_INDEX); return; }
  fetch("/data/versions/versions.json").then(function(r){return r.ok?r.json():null;}).then(function(v){
    VER_INDEX = v || {versions:[],current:null};
    cb(VER_INDEX);
  }).catch(function(){ VER_INDEX={versions:[],current:null}; cb(VER_INDEX); });
}
function verLabel(v){
  // clean 'ptoas vX.Y.Z' from the snapshot tag (vX.Y.Z_ptodsl...) or ptoas field
  var m = (v.tag||"").match(/^v([0-9]+(?:\.[0-9]+)+)/);
  var ver = m ? m[1] : String(v.ptoas||"?").replace(/^vmi\s+/i,"");
  return "ptoas v"+ver;
}
function initVersionSelector(){
  loadVersions(function(vi){
    var sel=el("ver-select"); if(!sel) return;
    if(!vi.versions.length){ sel.innerHTML='<option>no versions</option>'; return; }
    sel.innerHTML=vi.versions.map(function(v){
      var isCur = v.tag===vi.current;
      return '<option value="'+esc(v.tag)+'"'+(isCur?' selected':'')+
        ' title="'+esc(v.tag)+' · ptoas '+esc(v.ptoas||'?')+' · ptodsl '+esc(v.ptodsl||'?')+'">'+
        verLabel(v)+' ('+esc(v.date||'?')+')'+(isCur?' · current':'')+'</option>';
    }).join("");
    VER_CURRENT=vi.current;
    var cur = vi.versions.filter(function(v){return v.tag===vi.current;})[0];
    var info=el("ver-info");
    if(info) info.textContent = vi.versions.length+' version'+(vi.versions.length===1?'':'s')+' · current: '+(cur?verLabel(cur):'?');
    sel.onchange=function(){
      if(sel.value===vi.current){
        // default — reload page to get the embedded data.js
        location.reload();
      } else {
        // load version-specific report
        loadVersionData(sel.value);
      }
    };
  });
}
function loadVersionData(tag){
  fetch("/data/versions/"+tag+"/cce_vmi_ca_report_real.json").then(function(r){return r.ok?r.json():null;}).then(function(d){
    if(!d){ el("ver-info").textContent="load failed"; return; }
    R=d; ROWS=R.rows; META=R.meta||{}; SUM=R.summary||{};
    // version reports have matched_count (not matched_pairs in meta) — normalize
    if(!META.matched_pairs && R.matched_count) META.matched_pairs=R.matched_count;
    if(!META.cce_cases_total) META.cce_cases_total=ROWS.length;
    if(!META.cce_only_count) META.cce_only_count=ROWS.filter(function(r){return !(r.vmi&&r.vmi.ex!=null)&&!r.excluded;}).length;
    if(!META.vmi_cases_total) META.vmi_cases_total=R.vmi_cases_total||ROWS.filter(function(r){return r.vmi&&r.vmi.ex!=null;}).length;
    // version reports don't have summary — derive basic fields so Overview doesn't crash
    if(!SUM.a1_tally) SUM.a1_tally=[];
    if(!SUM.a2_vmi_ex) SUM.a2_vmi_ex=[];
    if(!SUM.a3_cce_ex) SUM.a3_cce_ex=[];
    if(!SUM.a4_vfreal) SUM.a4_vfreal=[];
    if(!SUM.a5_pred) SUM.a5_pred=[];
    if(!SUM.a7_conclusion) SUM.a7_conclusion=[];
    if(!SUM.outliers) SUM.outliers=[];
    if(!SUM.latency_inventory) SUM.latency_inventory=[];
    if(!SUM.unit_mapping) SUM.unit_mapping=[];
    if(!SUM.definitions) SUM.definitions={};
    if(!SUM.bottom_line) SUM.bottom_line="";
    MATCHED=ROWS.filter(function(r){return r.vmi&&r.vmi.ex!=null&&!r.excluded;});
    CCEONLY=ROWS.filter(function(r){return !(r.vmi&&r.vmi.ex!=null)&&!r.excluded;});
    EXCLUDED=ROWS.filter(function(r){return !!r.excluded;});
    el("hdr-matched").textContent=META.matched_pairs||R.matched_count||"?";
    var vm = String(tag).match(/^v([0-9]+(?:\.[0-9]+)+)/);
    el("ver-info").textContent="viewing ptoas v"+(vm?vm[1]:tag)+" · "+(META.matched_pairs||R.matched_count||"?")+" matched pairs";
    render(currentView||"overview");
  }).catch(function(e){ el("ver-info").textContent="error: "+e.message; });
}

/* ---------------- COMPARE VIEW ---------------- */
var CMP_DATA = {};
var CMP_TAG_A = "", CMP_TAG_B = "", CMP_DA = null, CMP_DB = null;
function loadVersionReport(tag, cb){
  if(CMP_DATA[tag]){ cb(CMP_DATA[tag]); return; }
  fetch("/data/versions/"+tag+"/cce_vmi_ca_report_real.json").then(function(r){return r.ok?r.json():null;}).then(function(d){
    CMP_DATA[tag]=d; cb(d);
  }).catch(function(){ cb(null); });
}
var RUN_STATUS_TIMER = null;
var CMP_LOCKED = false;
function cmpSetLocked(locked){
  CMP_LOCKED = locked;
  ["cmp-rel-run","cmp-rel-adopt","cmp-rel-adopt-refresh"].forEach(function(id){
    var b = el(id); if(b) b.disabled = locked;
  });
}
function pollRunBusy(){
  if(!el("cmp-release-banner")){ if(RUN_STATUS_TIMER){ clearInterval(RUN_STATUS_TIMER); RUN_STATUS_TIMER=null; } return; }
  fetch("/run/status").then(function(r){return r.json();}).then(function(s){
    if(!el("cmp-rel-run")){ if(RUN_STATUS_TIMER){ clearInterval(RUN_STATUS_TIMER); RUN_STATUS_TIMER=null; } return; }
    var busy = s && (s.status==="starting" || s.status==="running");
    cmpSetLocked(busy || CMP_LOCKED);
    // disable the upload zone too while a run is active
    var zone = el("cmp-upload-zone");
    if(zone) zone.classList.toggle("disabled", busy);
    var finp = el("cmp-file-input");
    if(finp) finp.disabled = busy;
    if(busy){
      var st = el("cmp-release-status");
      if(st && st.textContent.indexOf("full run")<0) st.textContent = "🔒 a full run is in progress — new runs are locked. Use ⏹ Stop in the run panel above to cancel.";
    }
  }).catch(function(){});
}

/* ---- run tracker (persists across page refresh) ---- */
var RUN_TRACK_TIMER = null;
var RUN_TRACK_INTERVAL = 0;
var RUN_BUSY = false;
function setRunPoll(ms){
  if(RUN_TRACK_TIMER) clearInterval(RUN_TRACK_TIMER);
  RUN_TRACK_INTERVAL = ms;
  RUN_TRACK_TIMER = setInterval(pollRunState, ms);
}
function startRunTracker(){
  pollRunState();
  setRunPoll(6000);
}
function pollRunState(){
  fetch("/run/status").then(function(r){return r.json();}).then(function(s){
    s = s || {status:"idle"};
    updateRunPill(s);
    updateRunPanel(s);
    // adaptive polling: fast while a run is active, slow when idle
    var active = s.status==="starting" || s.status==="running";
    RUN_BUSY = active;
    var want = active ? 6000 : 30000;
    if(want !== RUN_TRACK_INTERVAL) setRunPoll(want);
    if(s.status==="starting" || s.status==="running"){
      sessionStorage.removeItem("run_reloaded");
    } else if(s.status==="done" || s.status==="error" || s.status==="success" || s.status==="degraded" || s.status==="failed"){
      if(!sessionStorage.getItem("run_reloaded")){
        sessionStorage.setItem("run_reloaded","1");
        setTimeout(function(){ location.reload(); }, 3000);
      }
    }
  }).catch(function(){});
}
function runVersionLabel(s){
  if(s.version) return "vmi-v"+s.version;
  if(s.tag) return s.tag;
  return null;
}
function updateRunPill(s){
  var pill = el("run-pill"); if(!pill) return;
  var active = s.status==="starting" || s.status==="running";
  if(!active){ pill.hidden = true; pill.textContent=""; return; }
  pill.hidden = false;
  var v = runVersionLabel(s);
  var txt;
  if(s.status==="starting"){
    txt = s.kind==="snapshot" ? ("🔬 starting snapshot "+(v||esc(s.detail||"")))
        : s.kind==="refresh" ? ("⚡ adopting baseline "+(v||esc(s.detail||""))+" + refresh")
        : s.kind==="baseline" ? ("⭐ adopting baseline "+(v||esc(s.detail||"")))
        : ("🆕 starting — "+esc(s.detail||"preparing…"));
  } else {
    txt = s.kind==="refresh" ? ("⚡ baseline refresh "+(v||"")+" — "+(s.done_kernels||0)+"/"+(s.total_kernels||43))
        : s.kind==="snapshot" ? ("🔬 snapshot "+(v||esc(s.detail||""))+(s.progress!=null?" "+(s.progress||0)+"%":""))
        : s.kind==="baseline" ? ("⭐ baseline "+(v||""))
        : ("⏳ run — "+esc(s.detail||""));
  }
  pill.innerHTML = '<a href="#" id="run-pill-link">'+txt+'</a>';
  var a = el("run-pill-link");
  if(a) a.onclick = function(e){ e.preventDefault(); var t=document.querySelector('.tab[data-view="versions"]'); if(t) t.click(); };
}
function stopRun(){
  fetch("/run/stop", {method:"POST"}).then(function(r){return r.json();}).then(function(){
    pollRunState();
  }).catch(function(){ pollRunState(); });
}
function updateRunPanel(s){
  var host = el("run-panel"); if(!host) return;
  var active = s.status==="starting" || s.status==="running";
  if(!active){ host.hidden = true; host.innerHTML=""; return; }
  host.hidden = false;
  var v = runVersionLabel(s);
  var pct = null;
  if(s.status==="running"){
    if(s.kind==="snapshot" && s.progress!=null && s.progress>=0 && s.progress<100) pct = s.progress;
    else if(s.kind==="refresh" && s.done_kernels!=null) pct = Math.min(99, Math.round((s.done_kernels/(s.total_kernels||43))*100));
  }
  var bar = pct!=null ? '<div class="sim-progress-bar"><div class="sim-progress-fill" style="width:'+pct+'%"></div></div>' : "";
  var head, detail;
  if(s.status==="starting"){
    head = s.kind==="snapshot" ? "🔬 Starting snapshot run" : s.kind==="refresh" ? "⚡ Adopting baseline + refresh" : s.kind==="baseline" ? "⭐ Adopting baseline" : "🆕 Run starting";
    detail = v ? "running "+esc(v) : esc(s.detail||"preparing…");
  } else {
    head = s.kind==="refresh" ? "⚡ Baseline refresh" : s.kind==="snapshot" ? "🔬 Snapshot run" : s.kind==="baseline" ? "⭐ Baseline adopt" : "⏳ Run";
    detail = s.kind==="refresh" ? ((s.done_kernels||0)+"/"+(s.total_kernels||43)+" kernels") : (v ? "running "+esc(v) : esc(s.detail||""));
  }
  host.innerHTML = '<div class="run-panel-head">'+head+(v?' <span class="muted small">'+esc(v)+'</span>':'')+'</div>'+
    '<div class="muted small">'+detail+'</div>'+bar+
    '<button class="run-stop-btn" id="run-stop-btn" title="Stop this run (kills the sim on the host)">⏹ Stop</button>';
  var stopBtn = el("run-stop-btn");
  if(stopBtn) stopBtn.onclick = function(){ stopRun(); };
  if(s.kind==="snapshot"){
    fetch("/sim/log").then(function(r){return r.json();}).then(function(d){
      var lg = el("cmp-sim-log"), wrap = el("cmp-sim-log-wrap");
      if(lg && d && d.log){ if(wrap) wrap.style.display="block"; lg.textContent = d.log; lg.scrollTop = lg.scrollHeight; }
    }).catch(function(){});
  }
}
VIEWS.versions = function(){
  renderReleaseBanner();
  initUploadZone();
  renderVersionsCompare();
  renderVersionsManage();
  loadWhlList();
};

function renderReleaseBanner(){
  var host = el("cmp-release-banner"); if(!host) return;
  fetch("/ptoas/releases").then(function(r){return r.json();}).then(function(d){
    if(!d || (d.error && !(d.releases && d.releases.length))){ host.hidden = true; return; }
    var releases = d.releases || [];
    if(!releases.length){ host.hidden = true; return; }
    var baseline = d.baseline_version;
    var selOpts = releases.map(function(r){
      var isBase = r.version === baseline;
      return '<option value="'+esc(r.tag)+'"'+(isBase?' selected':'')+'>'+esc(r.tag)+(isBase?' · runs daily':'')+'</option>';
    }).join("");
    var html = '<div class="cmp-release-panel">'+
      '<div class="cmp-release-row">'+
        '<span class="cmp-rel-label">Daily baseline</span>'+
        '<select id="cmp-baseline-sel" class="cmp-baseline-sel">'+selOpts+'</select>'+
        (d.newer_available ? '<span class="cmp-rel-newtag" title="A GitHub release newer than your current baseline">🆕 newer: '+esc(d.latest.tag)+'</span>' : '<span class="cmp-rel-oktag" title="No GitHub release newer than your baseline">✓ up to date</span>')+
      '</div>'+
      '<div class="muted small" style="margin:2px 0 8px">📅 The <strong>daily refresh</strong> runs <strong>ptoas v'+esc(baseline||'?')+'</strong> — this is the version the dashboard shows by default and the header marks as “current”.</div>'+
      '<div class="cmp-release-actions">'+
        '<button class="cov-clear" id="cmp-rel-run" title="Run the selected version as a new comparison snapshot (baseline untouched)">🔬 Run as snapshot</button>'+
        '<button class="cov-clear" id="cmp-rel-adopt" title="Install the selected version as the daily baseline (next refresh uses it)">⭐ Set as baseline</button>'+
        '<button class="cov-clear" id="cmp-rel-adopt-refresh" title="Install the selected version AND run the daily refresh now">⚡ Set + refresh now</button>'+
      '</div>'+
      '<div id="cmp-release-status" class="muted small"></div>'+
    '</div>';
    host.innerHTML = html; host.hidden = false;
    var sel = el("cmp-baseline-sel");
    function selRelease(){ for(var i=0;i<releases.length;i++) if(releases[i].tag===sel.value) return releases[i]; return releases[0]; }
    el("cmp-rel-run").onclick = function(){ confirmReleaseRun(selRelease()); };
    el("cmp-rel-adopt").onclick = function(){ confirmReleaseAdopt(selRelease(), false); };
    el("cmp-rel-adopt-refresh").onclick = function(){ confirmReleaseAdopt(selRelease(), true); };
    cmpSetLocked(false);
    if(RUN_STATUS_TIMER){ clearInterval(RUN_STATUS_TIMER); }
    pollRunBusy();
    RUN_STATUS_TIMER = setInterval(pollRunBusy, 15000);
  }).catch(function(){ host.hidden = true; });
}

function confirmReleaseRun(latest){
  if(!confirm("Run PTOAS "+latest.tag+" as a new comparison snapshot?\n\nDownloads the whl + runs the full kernel sim (~30-40 min). Creates a new version entry; the baseline is untouched.")) return;
  cmpSetLocked(true);
  var st = el("cmp-release-status"); if(st) st.textContent = "⬇ downloading whl + starting sim…";
  fetch("/ptoas/releases/run", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({tag: latest.tag})})
    .then(function(r){return r.json();}).then(function(d){
      if(d.triggered){ if(st) st.textContent = "✅ run started — the new snapshot will appear in the version list when done."; pollRunState(); }
      else if(st) st.textContent = "⚠ "+(d.error||"failed to start");
    }).catch(function(e){ if(st) st.textContent = "⚠ "+e.message; });
}

function confirmReleaseAdopt(latest, refresh){
  var msg = "Set PTOAS "+latest.tag+" as the daily baseline"+(refresh?" and run the refresh now":"")+"?\n\nInstalls the whl into ~/.venv-ptoas312 on the sim host"+(refresh?" and then runs the full kernel refresh (~30-40 min)":"")+". The previous version is recorded and can be restored.";
  if(!confirm(msg)) return;
  cmpSetLocked(true);
  var st = el("cmp-release-status"); if(st) st.textContent = refresh ? "⬇ downloading + installing, then refreshing…" : "⬇ downloading + installing into baseline venv…";
  fetch("/ptoas/releases/adopt", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({tag: latest.tag, refresh: !!refresh})})
    .then(function(r){return r.json();}).then(function(d){
      if(d.adopted){
        if(d.already){
          if(st) st.textContent = "✅ "+latest.tag+" is already the daily baseline — nothing to install.";
          cmpSetLocked(false);
        } else if(d.refresh_started){
          if(st) st.textContent = "✅ "+latest.tag+" installed; daily refresh starting…";
          pollRunState();
        } else {
          if(st) st.textContent = "✅ "+latest.tag+" installed as baseline — next daily refresh will use it.";
        }
      } else if(st) st.textContent = "⚠ "+(d.error||"failed");
    }).catch(function(e){ if(st) st.textContent = "⚠ "+e.message; });
}

function renderVersionsManage(){
  var host = el("cmp-versions-manage"); if(!host) return;
  fetch("/data/versions/versions.json").then(function(r){return r.json();}).then(function(vi){
    var versions = vi.versions||[];
    if(!versions.length){ host.innerHTML='<p class="muted small">No versions available.</p>'; return; }
    var current = vi.current||"";
    var html = '<table class="whl-table"><thead><tr><th>Version</th><th>ptoas</th><th>ptodsl</th><th>Date</th><th></th></tr></thead><tbody>';
    versions.forEach(function(v){
      var isCurrent = v.tag===current;
      var actions = isCurrent ? '<span class="muted small">current</span>'
        : '<button class="whl-promote-btn" data-tag="'+esc(v.tag)+'" title="Make this the current baseline — copies its report into main data + rebuilds data.js (no re-sim)">★ promote</button> '+
          '<button class="whl-delete-btn" data-tag="'+esc(v.tag)+'" title="Remove this version">🗑</button>';
      html+='<tr><td class="whl-name">'+esc(v.tag)+(isCurrent?' <span class="whl-badge pending">current</span>':'')+'</td><td>'+esc(v.ptoas||'?')+'</td><td>'+esc(v.ptodsl||'?')+'</td><td>'+esc(v.date||'?')+'</td><td>'+actions+'</td></tr>';
    });
    html+='</tbody></table>';
    host.innerHTML = html;
    host.querySelectorAll(".whl-delete-btn[data-tag]").forEach(function(btn){
      btn.onclick = function(){
        var tag = btn.getAttribute("data-tag");
        if(!confirm("Remove version "+tag+"?\nAll comparison data for this version will be deleted.")) return;
        fetch("/version/delete/"+encodeURIComponent(tag)).then(function(r){return r.json();}).then(function(d){
          if(d.deleted){
            // invalidate caches + refresh every version surface in place
            VER_INDEX = null;
            CMP_DATA = {};
            var st = el("cmp-manage-status");
            if(st){ st.innerHTML = '<span class="whl-badge processed">✓ removed '+esc(tag)+'</span>'; setTimeout(function(){ if(st) st.innerHTML=''; }, 4000); }
            renderVersionsManage();
            initVersionSelector();
            renderVersionsCompare();
          } else {
            alert("Delete failed: "+(d.error||"unknown"));
          }
        }).catch(function(e){ alert("Delete failed: "+e.message); });
      };
    });
    // promote → current baseline
    host.querySelectorAll(".whl-promote-btn[data-tag]").forEach(function(btn){
      btn.onclick = function(){
        var tag = btn.getAttribute("data-tag");
        if(!confirm("Promote "+tag+" to the current baseline?\n\nCopies its report into the main dashboard data, rebuilds data.js, and reinstalls its whl into the daily-refresh venv (aborts if the whl is missing). No re-sim — about 10s, then the page reloads.")) return;
        var st = el("cmp-manage-status");
        if(st) st.innerHTML = '<span class="whl-badge pending">⏳ promoting '+esc(tag)+'…</span>';
        fetch("/version/promote", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({tag:tag})})
          .then(function(r){return r.json();}).then(function(d){
            if(d.promoted){
              if(st) st.innerHTML = '<span class="whl-badge processed">✓ '+esc(tag)+' is now current — reloading…</span>';
              setTimeout(function(){ location.reload(); }, 1500);
            } else {
              if(st) st.innerHTML='';
              alert("Promote failed: "+(d.error||"unknown"));
            }
          }).catch(function(e){ if(st) st.innerHTML=''; alert("Promote failed: "+e.message); });
      };
    });
  }).catch(function(){ host.innerHTML='<p class="muted small">Failed to load versions.</p>'; });
}

function renderVersionsCompare(){
  // --- Version comparison ---
  loadVersions(function(vi){
    var selA=el("cmp-ver-a"), selB=el("cmp-ver-b");
    if(!selA||!selB) return;
    var opts=vi.versions.map(function(v){return '<option value="'+esc(v.tag)+'">'+esc(v.tag)+'</option>';}).join("");
    selA.innerHTML=opts; selB.innerHTML=opts;
    var note=el("cmp-ver-count");
    if(note) note.textContent="("+vi.versions.length+" versions available)";
    if(vi.versions.length>=2){ selA.value=vi.versions[1].tag; selB.value=vi.versions[0].tag; }
    else if(vi.versions.length===1){ selA.value=vi.versions[0].tag; selB.value=vi.versions[0].tag; }
    function drawCompare(){
      var tagA=selA.value, tagB=selB.value;
      loadVersionReport(tagA, function(dA){
        loadVersionReport(tagB, function(dB){
          if(!dA||!dB){
            ["cmp-scatter-vfreal-vmi","cmp-scatter-ipc-vmi","cmp-scatter-exipc-vmi","cmp-scatter-ex-vmi"].forEach(function(id){
              var h=el(id); if(h) h.innerHTML='<p class="muted">Need at least 2 versions.</p>';
            });
            return;
          }
          // Store for compare modal
          CMP_TAG_A = tagA; CMP_TAG_B = tagB; CMP_DA = dA; CMP_DB = dB;
          // build per-kernel lookup for each version
          function buildMap(d, side, field){
            // Map by kernel name — keep FIRST matching case only (dedup)
            var m={};
            d.rows.forEach(function(r){
              if(r[side] && r[side][field]!=null && m[r.kernel]==null) m[r.kernel]=r[side][field];
            });
            return m;
          }
          function buildPairs(dB, mapA){
            var pts=[];
            var seen={}; // dedup by kernel name
            dB.rows.forEach(function(r){
              if(mapA[r.kernel]!=null && seen[r.kernel]==null){
                pts.push({kernel:r.kernel, case_id:r.case_id, x:mapA[r.kernel], y:r.cce.vf_real});
                seen[r.kernel]=true;
              }
            });
            return pts;
          }
          // render each scatter
          var charts=[
            {id:"cmp-scatter-vfreal-vmi", side:"vmi", field:"vf_real", labelA:"A vf_real", labelB:"B vf_real", lowerBetter:true},
            {id:"cmp-scatter-ipc-vmi", side:"vmi", field:"ipc", labelA:"A IPC", labelB:"B IPC", lowerBetter:false},
            {id:"cmp-scatter-exipc-vmi", side:"vmi", field:"ex_ipc", labelA:"A EX-IPC", labelB:"B EX-IPC", lowerBetter:false},
            {id:"cmp-scatter-ex-vmi", side:"vmi", field:"ex", labelA:"A EX", labelB:"B EX", lowerBetter:true}
          ];
          charts.forEach(function(ch){
            var mapA=buildMap(dA, ch.side, ch.field);
            var pts=[];
            var seen={}; // dedup per-chart
            dB.rows.forEach(function(r){
              if(r[ch.side] && r[ch.side][ch.field]!=null && mapA[r.kernel]!=null && seen[r.kernel]==null){
                pts.push({kernel:r.kernel, case_id:r.case_id, x:mapA[r.kernel], y:r[ch.side][ch.field]});
                seen[r.kernel]=true;
              }
            });
            drawCompareScatter(ch.id, pts, ch.labelA+" ("+tagA+")", ch.labelB+" ("+tagB+")", ch.lowerBetter);
          });
          // delta table (VMI vf_real — the side PTOAS actually changes)
          var mapVfA=buildMap(dA, "vmi", "vf_real");
          var tablePts=[];
          var tableSeen={};
          dB.rows.forEach(function(r){
            if(r.vmi && r.vmi.vf_real!=null && mapVfA[r.kernel]!=null && tableSeen[r.kernel]==null){
              tablePts.push({kernel:r.kernel, case_id:r.case_id, x:mapVfA[r.kernel], y:r.vmi.vf_real});
              tableSeen[r.kernel]=true;
            }
          });
          el("cmp-table-note").textContent="("+tablePts.length+" kernels)";
          var t=el("cmp-table");
          t.innerHTML=thead(["kernel","A ("+tagA+")","B ("+tagB+")","Δ cycles","Δ %","verdict"])+
            tablePts.map(function(p){
              var d=p.y-p.x, pct=Math.round(d/p.x*100);
              var v=pct>5?'<span class="gap-bad">B slower</span>':pct<-5?'<span class="gap-good">B faster</span>':'<span class="muted">~same</span>';
              return '<tr data-case="'+esc(p.case_id)+'"><td class="kernel clickable">'+esc(p.kernel)+'</td><td class="num">'+p.x+'</td><td class="num">'+p.y+'</td><td class="num">'+(d>0?"+":"")+d+'</td><td class="num">'+(pct>0?"+":"")+pct+'%</td><td>'+v+'</td></tr>';
            }).sort(function(a,b){return 0;}).join("");
          t.querySelectorAll('tr[data-case]').forEach(function(tr){tr.addEventListener("click",function(){openCompareModal(tr.dataset.case);});});
        });
      });
    }
    selA.onchange=drawCompare; selB.onchange=drawCompare;
    el("cmp-swap").onclick=function(){var t=selA.value;selA.value=selB.value;selB.value=t;drawCompare();};
    drawCompare();
  });
}

// Inline charts: no zoom/pan (only expand button + hint pointing to expand)
function enableZoomPanInline(host) {
  if(!host.querySelector(".zoom-hint-inline")) {
    var hint=document.createElement("div");
    hint.className="zoom-hint-inline";
    hint.textContent="Click ⤢ to expand & zoom";
    host.appendChild(hint);
  }
}

// Full zoom/pan — only used in expanded modal
function enableZoomPan(host) {
  var svgEl = host.querySelector("svg");
  if(!svgEl) return;
  var plotG = document.createElementNS("http://www.w3.org/2000/svg", "g");
  plotG.setAttribute("class", "zoom-layer");
  var children = [];
  for(var i=0; i<svgEl.children.length; i++) {
    if(svgEl.children[i].tagName !== "defs" && svgEl.children[i].tagName !== "style")
      children.push(svgEl.children[i]);
  }
  children.forEach(function(c){ plotG.appendChild(c); });
  svgEl.appendChild(plotG);
  var zoom=1, panX=0, panY=0, isDragging=false, startX=0, startY=0;
  function applyTransform(){
    plotG.setAttribute("transform","translate("+panX+","+panY+") scale("+zoom+")");
    // Scale points inversely so they stay constant screen size when zoomed
    var invScale = 1/zoom;
    plotG.querySelectorAll(".pt circle").forEach(function(c){
      var orig = parseFloat(c.getAttribute("data-r") || c.getAttribute("r") || 4);
      if(!c.getAttribute("data-r")) c.setAttribute("data-r", orig);
      c.setAttribute("r", (orig * invScale).toFixed(2));
    });
  }
  applyTransform();
  svgEl.style.cursor="grab";
  svgEl.addEventListener("wheel", function(e){
    e.preventDefault();
    var rect=svgEl.getBoundingClientRect();
    var mx=e.clientX-rect.left, my=e.clientY-rect.top;
    var delta=e.deltaY>0?0.9:1.1;
    var newZoom=Math.max(0.3, Math.min(10, zoom*delta));
    panX=mx-(mx-panX)*(newZoom/zoom);
    panY=my-(my-panY)*(newZoom/zoom);
    zoom=newZoom;
    applyTransform();
  }, {passive:false});
  svgEl.addEventListener("mousedown", function(e){
    if(e.target.closest(".pt-hit")||e.target.closest(".pt")) return;
    isDragging=true; startX=e.clientX-panX; startY=e.clientY-panY;
    svgEl.style.cursor="grabbing";
  });
  window.addEventListener("mousemove", function(e){
    if(!isDragging) return;
    panX=e.clientX-startX; panY=e.clientY-startY; applyTransform();
  });
  window.addEventListener("mouseup", function(){
    if(isDragging){ isDragging=false; svgEl.style.cursor="grab"; }
  });
  svgEl.addEventListener("dblclick", function(){
    zoom=1; panX=0; panY=0; applyTransform();
  });
}

function drawCompareScatter(hostId, pts, labelA, labelB, lowerBetter){
  var host=el(hostId); if(!host) return;
  if(!pts.length){ host.innerHTML='<p class="empty-state">no data</p>'; return; }
  var W=380,H=340,pad=40;
  var max=Math.max.apply(null, pts.map(function(p){return Math.max(p.x,p.y);}))*1.08;
  if(max===0) max=1;
  var sx=function(x){return pad+(x/max)*(W-pad-pad);};
  var sy=function(y){return H-pad-(y/max)*(H-pad-pad);};
  var s=svgOpen(W,H);
  for(var g=0;g<=4;g++){var v=max*g/4;s+='<g class="grid"><line x1="'+pad+'" x2="'+(W-pad)+'" y1="'+sy(v)+'" y2="'+sy(v)+'"/></g>';}
  s+='<g class="axis"><line x1="'+pad+'" y1="'+(H-pad)+'" x2="'+(W-pad)+'" y2="'+(H-pad)+'"/><line x1="'+pad+'" y1="'+pad+'" x2="'+pad+'" y2="'+(H-pad)+'"/></g>';
  s+='<line class="diag" x1="'+pad+'" y1="'+(H-pad)+'" x2="'+(W-pad)+'" y2="'+pad+'"/>';
  [0.75,0.9,1.1,1.25].forEach(function(r){
    var xb=max,yb=r*xb;
    if(yb>max){xb=max/r;yb=max;}
    s+='<line class="refln" x1="'+sx(0)+'" y1="'+sy(0)+'" x2="'+sx(xb)+'" y2="'+sy(yb)+'"/>';
    var pct=Math.round((r-1)*100);var lbl=(pct>0?"+":"")+pct+"%";
    s+='<text class="refln-lbl '+(r>1?"cce":"vmi")+'" x="'+sx(xb)+'" y="'+sy(yb)+'" text-anchor="end" dx="-3" dy="-3">'+lbl+'</text>';
  });
  pts.forEach(function(p){
    var delta=Math.round((p.y-p.x)/p.x*100);
    var better = lowerBetter ? delta<-5 : delta>5;
    var worse = lowerBetter ? delta>5 : delta<-5;
    var col=better?'var(--good)':worse?'var(--bad)':'var(--muted)';
    var tip=p.kernel+" | A="+p.x+" B="+p.y+" Δ="+(delta>0?"+":"")+delta+"%";
    s+='<g class="pt" data-case="'+esc(p.case_id)+'" data-tip="'+esc(tip)+'"><circle cx="'+sx(p.x)+'" cy="'+sy(p.y)+'" r="4" fill="'+col+'" opacity="0.8"/><circle cx="'+sx(p.x)+'" cy="'+sy(p.y)+'" r="9" fill="transparent"/></g>';
  });
  s+='<text class="axis-title" x="'+(W/2)+'" y="'+(H-6)+'" text-anchor="middle">'+esc(labelA)+'</text>';
  s+='<text class="axis-title" transform="rotate(-90 12 '+(H/2)+')" x="12" y="'+(H/2)+'" text-anchor="middle">'+esc(labelB)+'</text>';
  host.innerHTML=svgClose(s);
  enableZoomPanInline(host);
  if(!host.querySelector(".chart-expand")) {
    var btn2=document.createElement("button");
    btn2.className="chart-expand";
    btn2.innerHTML="⤢";
    btn2.title="Expand chart";
    btn2.onclick=function(){
      var modal=document.getElementById("modal");
      var body=document.getElementById("modal-body");
      var title=document.getElementById("modal-title");
      if(!modal||!body) return;
      title.textContent=hostId || "Chart";
      var clone=host.cloneNode(true);
      clone.style.width="100%";
      clone.style.height="auto";
      clone.querySelectorAll(".zoom-hint, .chart-expand").forEach(function(e){e.remove();});
      body.innerHTML="";
      body.appendChild(clone);
      enableZoomPan(clone);
      clone.querySelectorAll(".pt").forEach(function(pt){
        pt.style.cursor="pointer";
        pt.addEventListener("click", function(){
          var cid=pt.getAttribute("data-case");
          if(cid){
            document.getElementById("modal").classList.add("hidden");
            openModal(cid);
          }
        });
        pt.addEventListener("mouseenter", function(){
          var tipText=pt.getAttribute("data-tip");
          if(tipText){
            var t=clone.querySelector(".scatter-tip")||function(){
              var d=document.createElement("div");d.className="scatter-tip";
              clone.style.position="relative";clone.appendChild(d);return d;
            }();
            var cid=pt.getAttribute("data-case")||"";
            t.innerHTML='<div class="st-line">'+tipText+'</div>'+
              '<div class="st-actions"><a class="st-act" data-act="detail" data-case="'+esc(cid)+'">peek</a>'+
              '<a class="st-act st-explore" data-act="explore" data-case="'+esc(cid)+'">explore ↗</a></div>';
            t.classList.add("show");
            var rect=clone.getBoundingClientRect(),pr=pt.getBoundingClientRect();
            var left=pr.left-rect.left+12,top=pr.top-rect.top-6;
            if(left+180>clone.offsetWidth)left=pr.left-rect.left-180;
            if(top<4)top=pr.bottom-rect.top+8;
            t.style.left=left+"px";t.style.top=top+"px";
            t.querySelectorAll(".st-act").forEach(function(a){
              a.addEventListener("click", function(e){
                e.preventDefault(); e.stopPropagation();
                var act=a.getAttribute("data-act"),ac=a.getAttribute("data-case");
                t.classList.remove("show");
                document.getElementById("modal").classList.add("hidden");
                if(act==="explore") exploreKernel(ac);
                else openModal(ac);
              });
            });
          }
        });
        var hideT2=null;
        pt.addEventListener("mouseleave", function(){
          hideT2=setTimeout(function(){
            var t=clone.querySelector(".scatter-tip");
            if(t) t.classList.remove("show");
          },2000);
        });
      });
      var cloneTip2=clone.querySelector(".scatter-tip");
      if(cloneTip2){
        cloneTip2.addEventListener("mouseenter",function(){if(hideT2){clearTimeout(hideT2);hideT2=null;}});
        cloneTip2.addEventListener("mouseleave",function(){
          hideT2=setTimeout(function(){cloneTip2.classList.remove("show");},2000);
        });
      }
      modal.classList.remove("hidden");
    };
    host.appendChild(btn2);
  }
  // tooltip + click
  var tip=host.querySelector(".scatter-tip")||function(){var d=document.createElement("div");d.className="scatter-tip";host.style.position="relative";host.appendChild(d);return d;}();
  var hideTimer=null;
  function showTip(pt){ if(hideTimer){clearTimeout(hideTimer);hideTimer=null;}
    tip.innerHTML='<div class="st-line">'+pt.getAttribute("data-tip")+'</div><div class="st-actions"><a class="st-act" data-act="detail" data-case="'+pt.getAttribute("data-case")+'">peek</a><a class="st-act st-explore" data-act="explore" data-case="'+pt.getAttribute("data-case")+'">explore ↗</a></div>';
    tip.classList.add("show");var rect=host.getBoundingClientRect(),pr=pt.getBoundingClientRect();var left=pr.left-rect.left+12,top=pr.top-rect.top-6;if(left+180>host.offsetWidth)left=pr.left-rect.left-180;if(top<4)top=pr.bottom-rect.top+8;tip.style.left=left+"px";tip.style.top=top+"px"; }
  function hide(){ if(hideTimer)clearTimeout(hideTimer);hideTimer=setTimeout(function(){tip.classList.remove("show");hideTimer=null;},120); }
  host.querySelectorAll(".pt").forEach(function(pt){pt.style.cursor="pointer";pt.addEventListener("mouseenter",function(){showTip(pt);});pt.addEventListener("mouseleave",hide);pt.addEventListener("click",function(){openCompareModal(pt.getAttribute("data-case"));});});
  tip.addEventListener("mouseenter",function(){if(hideTimer)clearTimeout(hideTimer);hideTimer=null;});tip.addEventListener("mouseleave",hide);
  tip.addEventListener("click",function(e){var a=e.target.closest(".st-act");if(!a)return;e.preventDefault();e.stopPropagation();var act=a.getAttribute("data-act"),cid=a.getAttribute("data-case");tip.classList.remove("show");if(act==="explore")exploreKernel(cid);else openCompareModal(cid);});
}

function initUploadZone(){
  var zone=el("cmp-upload-zone"), input=el("cmp-file-input"), status=el("cmp-upload-status");
  if(!zone) return;
  function showStatus(msg, type){
    if(!status) return;
    status.innerHTML='<div class="upload-progress '+type+'">'+msg+'</div>';
  }
  function uploadFile(file){
    if(!file || !file.name.endsWith(".whl")){
      showStatus("⚠ File must be a .whl file", "error");
      return;
    }
    showStatus("⏳ Uploading "+esc(file.name)+" ("+(file.size/1048576).toFixed(1)+"MB)…", "uploading");
    var fd=new FormData();
    fd.append("whl", file);
    var xhr=new XMLHttpRequest();
    xhr.open("POST", "/upload");
    xhr.onload=function(){
      var r; try{ r=JSON.parse(xhr.responseText); }catch(e){ r={}; }
      if(xhr.status===200 && r.success){
        showStatus("✅ "+esc(r.filename)+" uploaded — run starting…", "success");
        startRunTracker();
      } else if(r.busy){
        showStatus("⏳ "+esc(r.error||"another run is already in progress"), "uploading");
      } else {
        showStatus("⚠ "+esc(r.error||("Upload failed (HTTP "+xhr.status+")")), "error");
      }
    };
    xhr.onerror=function(){ showStatus("⚠ Network error during upload", "error"); };
    xhr.send(fd);
  }
  zone.addEventListener("click", function(e){ if(e.target.tagName!=='LABEL') input.click(); });
  input.addEventListener("change", function(){ if(input.files[0]) uploadFile(input.files[0]); });
  zone.addEventListener("dragover", function(e){ e.preventDefault(); zone.classList.add("dragover"); });
  zone.addEventListener("dragleave", function(){ zone.classList.remove("dragover"); });
  zone.addEventListener("drop", function(e){
    e.preventDefault(); zone.classList.remove("dragover");
    if(e.dataTransfer.files[0]) uploadFile(e.dataTransfer.files[0]);
  });
}

function loadWhlList(){
  var host=el("cmp-whl-list");
  if(!host) return;
  fetch("/whl/list").then(function(r){return r.json();}).then(function(d){
    var files=d.whl_files||[];
    if(!files.length){
      host.innerHTML='<p class="muted small">No whl files on server.</p>';
      return;
    }
    var html='<table class="whl-table"><thead><tr><th>Filename</th><th>Size</th><th>Status</th><th></th></tr></thead><tbody>';
    files.forEach(function(f){
      var sizeStr = f.size > 1048576 ? (f.size/1048576).toFixed(1)+"MB" : (f.size/1024).toFixed(0)+"KB";
      var statusStr = f.processed ? '<span class="whl-badge processed">processed</span>' : '<span class="whl-badge pending">pending</span>';
      var delBtn = RUN_BUSY ? '<span class="muted small">locked</span>' : '<button class="whl-delete-btn" data-name="'+esc(f.name)+'" title="Delete">🗑</button>';
      html+='<tr><td class="whl-name">'+esc(f.name)+'</td><td class="whl-size">'+sizeStr+'</td><td>'+statusStr+'</td><td>'+delBtn+'</td></tr>';
    });
    html+='</tbody></table>';
    host.innerHTML=html;
    // Wire delete buttons
    host.querySelectorAll(".whl-delete-btn").forEach(function(btn){
      btn.addEventListener("click", function(){
        var name=btn.getAttribute("data-name");
        if(!confirm("Delete "+name+"?")) return;
        fetch("/whl/delete/"+encodeURIComponent(name)).then(function(r){return r.json();}).then(function(d){
          if(d.deleted){
            loadWhlList();
          } else {
            alert("Delete failed: "+(d.error||"unknown"));
          }
        });
      });
    });
  }).catch(function(){ host.innerHTML='<p class="muted small">Failed to load whl list.</p>'; });
}

/* ---------------- boot ---------------- */
initVersionSelector();
startRunTracker();
render("overview");
})();
