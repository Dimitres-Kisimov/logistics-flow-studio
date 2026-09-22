/* =====================================================================
 * Logistics Flow Studio - run-ledger-selftest.js
 * THE VIEWER'S IN-BROWSER SELF-TEST (v3.39). INERT unless the page is
 * opened as run-ledger.html?selftest=1 - then it drives the real buttons
 * (load the recorded example, then example B), waits for the page's own
 * `rl:loaded` signal, and checks what a reader would check: every section
 * rendered, no error text, every SQL block complete, the flow drawn, the
 * cost cards, print and CSV controls, the memo, "Your case" reacting to
 * input, the compare section after B. Same contract as selftest.js:
 * console `WT-SELFTEST: PASS n/n`, a #wt-selftest element with
 * data-pass / data-total / data-ok (+ data-page="run-ledger"), and
 * window.__WT_SELFTEST_RESULT__. No eval, no inline script, no network
 * beyond the local example files.
 * ===================================================================== */
(function () {
  "use strict";
  if (!/[?&]selftest=1(?:&|$)/.test(window.location.search)) return;
  var results = [];
  var $ = function (id) { return document.getElementById(id); };
  function check(name, fn) {
    var ok = false, detail = "";
    try {
      var r = fn();
      if (r && typeof r === "object" && "ok" in r) { ok = !!r.ok; detail = r.detail || ""; } else { ok = !!r; }
    } catch (e) { ok = false; detail = e && e.message ? e.message : String(e); }
    results.push({ name: name, ok: ok, detail: detail });
    return ok;
  }
  function nextLoaded(side, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error("timeout waiting for rl:loaded " + side)); }, ms || 20000);
      document.addEventListener("rl:loaded", function h(ev) {
        if (!ev.detail || ev.detail.side !== side) return;
        document.removeEventListener("rl:loaded", h); clearTimeout(t); resolve(ev.detail);
      });
    });
  }
  function clickAndWait(id, side) { var p = nextLoaded(side); $(id).click(); return p; }
  function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  var SECTIONS = ["rlGlance", "rlRibbon", "rlFlow", "rlCycle", "rlTouches", "rlWait", "rlWip", "rlByOp", "rlCost", "rlDispatch", "rlPack", "rlOptimise", "rlYourCase", "rlTrace", "rlInvariants", "rlAppendix"];
  var BAD_TEXT = /\[FAIL\]|Could not|is not loaded|not a factory-run-ledger|\bNaN\b|\bundefined\b/;

  function runSuite() {
    var R = window.RunLedger;
    check("errors-boundary-installed", function () { return Array.isArray(window.__WT_ERRORS__); });
    check("no-errors-during-boot", function () { var e = window.__WT_ERRORS__ || []; return { ok: e.length === 0, detail: e.length ? e.map(function (x) { return x.message; }).join(" | ") : "clean" }; });
    check("model-and-generated-sql-present", function () {
      return { ok: !!R && typeof R.views === "function" && typeof R.model === "function" && typeof R.csv === "function" && typeof R.glance === "function" && R.SQL === window.RunLedgerSQL && Object.keys(R.SQL).length === 23,
        detail: R ? Object.keys(R.SQL).length + " SQL texts" : "no RunLedger" };
    });
    check("nav-anchors-resolve", function () {
      var as = $("rlNav").querySelectorAll('a[href^="#"]'), miss = [];
      for (var i = 0; i < as.length; i++) if (!$(as[i].getAttribute("href").slice(1))) miss.push(as[i].getAttribute("href"));
      return { ok: as.length >= 10 && miss.length === 0, detail: miss.length ? miss.join(",") : as.length + " anchors" };
    });
    check("csv-pure-rfc4180", function () { return R.csv([{ a: 1, b: 'x,"y"' }, { a: null, b: "z" }], ["a", "b"]) === 'a,b\n1,"x,""y"""\n,z\n' && R.csv([], ["a"]) === "a\n"; });
    return clickAndWait("rlDemo", "a").then(function (d) {
      var exp = R.current();
      check("example-a-loaded", function () { return { ok: !!exp && exp.run.id === d.run && exp.hus.length > 20, detail: d.run }; });
      check("focus-moved-to-glance", function () { return document.activeElement === $("rlGlance"); });
      check("every-section-non-empty", function () { var empty = SECTIONS.filter(function (id) { return !$(id) || !$(id).innerHTML.trim(); }); return { ok: empty.length === 0, detail: empty.length ? empty.join(",") : SECTIONS.length + " sections" }; });
      check("no-fail-or-error-text", function () { var m = BAD_TEXT.exec($("rlView").textContent); return { ok: !m, detail: m ? m[0] : "clean" }; });
      check("tables-rendered", function () { var n = $("rlView").querySelectorAll("table").length; return { ok: n >= 10, detail: n + " tables" }; });
      check("th-scope-col-everywhere", function () { var th = $("rlView").querySelectorAll("th"); for (var i = 0; i < th.length; i++) if (th[i].getAttribute("scope") !== "col") return { ok: false, detail: th[i].textContent }; return { ok: th.length > 0, detail: th.length + " headers" }; });
      check("sql-blocks-present-and-complete", function () {
        var pres = $("rlView").querySelectorAll("details.sql pre"), bad = 0;
        for (var i = 0; i < pres.length; i++) { var t = pres[i].textContent; if (t.length < 20 || t.indexOf("...") >= 0 || !/^(SELECT|WITH)\b/.test(t)) bad++; }
        return { ok: pres.length >= 16 && bad === 0, detail: pres.length + " blocks, " + bad + " bad" };
      });
      check("glance-flags-and-mix", function () {
        var g = R.glance(exp), txt = $("rlGlance").textContent;
        return { ok: g.flags.length >= 1 && txt.indexOf("NaN") < 0 && /%/.test(g.mix) && txt.indexOf(exp.run.id) >= 0, detail: g.flags.map(function (f) { return f.kind; }).join(",") + " · " + g.mix.slice(0, 40) };
      });
      check("flow-one-path-per-non-zero-link", function () {
        var links = R.model(exp).flowLinks.filter(function (l) { return l.units > 0; }).length, paths = $("rlFlowSvg").querySelectorAll("path").length;
        return { ok: paths === links && links > 5, detail: paths + " paths / " + links + " links" };
      });
      check("cost-cards-present", function () { return $("rlCost").querySelectorAll(".cards article").length >= 3; });
      check("print-and-csv-buttons", function () { var n = $("rlView").querySelectorAll("button.csv").length; return { ok: !!$("rlPrint") && n >= 10 && typeof window.print === "function", detail: n + " CSV buttons" }; });
      check("views-and-model-memoised", function () { return R.views(exp) === R.views(exp) && R.model(exp) === R.model(exp) && R.model(exp).views === R.views(exp); });
      check("derived-minutes-columns", function () { var n = $("rlWait").querySelectorAll("th.derived").length; return { ok: n === 2, detail: n + " derived columns in the wait table" }; });
      var out = $("rlYourCaseOut"), before = out.innerHTML, inp = $("rlYourCase").querySelector('[data-yc="l"]');
      inp.value = String(Number(inp.value) + 100);
      inp.dispatchEvent(new Event("input", { bubbles: true }));
      return wait(400).then(function () {
        check("your-case-reacts-to-input-debounced", function () { return { ok: out.innerHTML !== before && !BAD_TEXT.test(out.textContent), detail: "length " + before.length + " -> " + out.innerHTML.length }; });
        return clickAndWait("rlDemoB", "b");
      });
    }).then(function (d) {
      check("compare-renders-after-b", function () { var n = $("rlCompare").querySelectorAll("table").length; return { ok: !!window.RunLedger.currentB() && window.RunLedger.currentB().run.id === d.run && n === 6, detail: d.run + " · " + n + " tables" }; });
      check("all-23-sql-blocks-after-compare", function () {
        var seen = {}, els = $("rlView").querySelectorAll("details.sql[data-view]");
        for (var i = 0; i < els.length; i++) seen[els[i].getAttribute("data-view")] = 1;
        var miss = Object.keys(window.RunLedgerSQL).filter(function (k) { return !seen[k]; });
        return { ok: miss.length === 0, detail: miss.length ? "missing " + miss.join(",") : "23/23" };
      });
      check("no-errors-after-drive", function () { var e = window.__WT_ERRORS__ || []; return { ok: e.length === 0, detail: e.length ? e.map(function (x) { return x.message; }).join(" | ") : "clean" }; });
    });
  }

  function report_result() {
    var total = results.length;
    var passed = results.filter(function (r) { return r.ok; }).length;
    var failed = results.filter(function (r) { return !r.ok; });
    var line = failed.length === 0 ? "WT-SELFTEST: PASS " + passed + "/" + total
      : "WT-SELFTEST: FAIL " + passed + "/" + total + " :: " + failed.map(function (r) { return r.name; }).join(", ");
    var el = $("wt-selftest");
    if (!el) {
      el = document.createElement("div");
      el.id = "wt-selftest";
      el.style.position = "fixed"; el.style.left = "-99999px"; el.style.top = "0"; el.style.whiteSpace = "pre";
      (document.body || document.documentElement).appendChild(el);
    }
    el.textContent = line;
    el.setAttribute("data-pass", String(passed));
    el.setAttribute("data-total", String(total));
    el.setAttribute("data-ok", failed.length === 0 ? "1" : "0");
    el.setAttribute("data-page", "run-ledger");
    try {
      /* eslint-disable no-console */
      console.log(line);
      results.forEach(function (r) { console.log((r.ok ? "  [PASS] " : "  [FAIL] ") + r.name + (r.detail ? " - " + r.detail : "")); });
      /* eslint-enable no-console */
    } catch (_) { /* console may be unavailable */ }
    window.__WT_SELFTEST_RESULT__ = { line: line, passed: passed, total: total, ok: failed.length === 0, results: results, page: "run-ledger" };
  }
  function kick() {
    setTimeout(function () {
      runSuite().then(report_result, function (e) {
        results.push({ name: "selftest-runner", ok: false, detail: e && e.message ? e.message : String(e) });
        report_result();
      });
    }, 0);
  }
  if (document.readyState === "loading") window.addEventListener("DOMContentLoaded", kick); else kick();
})();
