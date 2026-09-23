/* =====================================================================
 * Logistics Flow Studio - run-ledger-selftest.js
 * THE VIEWER'S IN-BROWSER SELF-TEST (v3.39). INERT unless the page is
 * opened as run-ledger.html?selftest=1 - then it drives the real buttons
 * (load the recorded example, then example B), waits for the page's own
 * `rl:loaded` signal, and checks what a reader would check: every section
 * rendered, no error text, every SQL block complete, the flow drawn, the
 * cost cards, print and CSV controls, the memo, "Your case" reacting to
 * input, the compare section after B, then example C (v3.43: a library floor
 * whose stations serve at declared capacities - no floor-rate flag, and the
 * compare against B names the different scenario), then example D (v3.44: the
 * sample order file through the ledger - own data on the glance, dispatch by order). Same contract as selftest.js:
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
  var SECTIONS = ["rlGlance", "rlAskOut", "rlRibbon", "rlFlow", "rlCycle", "rlTouches", "rlWait", "rlWip", "rlStaffing", "rlQuality", "rlDelivery", "rlControl", "rlByOp", "rlCost", "rlDispatch", "rlPack", "rlOptimise", "rlYourCase", "rlTrace", "rlTracking", "rlReplications", "rlInvariants", "rlAppendix"];
  var BAD_TEXT = /\[FAIL\]|Could not|is not loaded|not a factory-run-ledger|\bNaN\b|\bundefined\b/;

  function runSuite() {
    var R = window.RunLedger;
    check("errors-boundary-installed", function () { return Array.isArray(window.__WT_ERRORS__); });
    check("no-errors-during-boot", function () { var e = window.__WT_ERRORS__ || []; return { ok: e.length === 0, detail: e.length ? e.map(function (x) { return x.message; }).join(" | ") : "clean" }; });
    check("model-and-generated-sql-present", function () {
      return { ok: !!R && typeof R.views === "function" && typeof R.model === "function" && typeof R.csv === "function" && typeof R.glance === "function" && R.SQL === window.RunLedgerSQL && Object.keys(R.SQL).length === 37,
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
      check("replications-section-needs-two-runs-and-the-twin-is-pure", function () {
        var el = $("rlReplications"), one = R.replications([exp]), two = R.replications([exp, exp]);
        return { ok: !!el && /Load two or more runs/.test(el.textContent) && el.querySelectorAll("details.sql[data-view]").length === 4 && one.groups.length === 1 && one.groups[0].n === 1 && one.groups[0].cycle.every(function (r) { return r.stdev === null && r.ci95_half === null; }) &&
          two.groups[0].n === 2 && two.groups[0].cycle.every(function (r) { return r.stdev === 0 && r.ci95_half === 0; }) && R.T975[2] === 4.303, detail: one.groups[0].cycle.length + " types" };
      });
      check("staffing-section-without-policy", function () { var el = $("rlStaffing"); return { ok: !!el && /No staffing policy in this run/.test(el.textContent) && !!el.querySelector('details.sql[data-view="v_staffing"]') && /declared stations only/.test($("rlGlance").textContent), detail: el ? el.textContent.slice(0, 60) : "missing" }; });
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
      check("cost-per-received-each-and-holding", function () { var t = $("rlCost").textContent; return { ok: $("rlCost").querySelectorAll(".cards article").length >= 4 && /Per received each/.test(t) && /holding/.test(t) && /eur_per_received_each/.test(t), detail: $("rlCost").querySelectorAll(".cards article").length + " cards" }; });
      check("print-and-csv-buttons", function () { var n = $("rlView").querySelectorAll("button.csv").length; return { ok: !!$("rlPrint") && n >= 10 && typeof window.print === "function", detail: n + " CSV buttons" }; });
      check("views-and-model-memoised", function () { return R.views(exp) === R.views(exp) && R.model(exp) === R.model(exp) && R.model(exp).views === R.views(exp); });
      check("derived-minutes-columns", function () { var n = $("rlWait").querySelectorAll("th.derived").length; return { ok: n === 2, detail: n + " derived columns in the wait table" }; });
      // v3.53: the tracking section (dwell per business step), the twins beside the trace, the invariant and the export shape
      check("tracking-section-bizstep-dwell-and-unit-history", function () {
        var T = window.WT && window.WT.tracking, v = R.views(exp), sec = $("rlTracking");
        if (!T) return { ok: false, detail: "no WT.tracking" };
        var doc = T.fromLedger(exp), hu = exp.hus[0].id, hist = T.historyOf(doc.events, hu), own = exp.events.filter(function (e) { return e.hu_id === hu; }).length;
        var rows = v.bizstepDwell || [], picking = rows.filter(function (r) { return r.biz_step === "picking"; })[0];
        return { ok: !!sec && sec.querySelectorAll("table").length === 2 && !!sec.querySelector('details.sql[data-view="v_bizstep_dwell"]') && !!sec.querySelector('details.sql[data-view="v_epcis_events"]') &&
          rows.length >= 10 && !!picking && picking.spans > 0 && hist.length === own && own > 0 && $("rlTrace").textContent.indexOf("biz_step") >= 0 && !!$("rlTrace").querySelector('details.sql[data-view="v_unit_history"]') && !BAD_TEXT.test(sec.textContent),
          detail: rows.length + " steps, unit history " + hist.length + "/" + own };
      });
      // v3.54: the quality section on a run without the what-if - every operation perfect, the SQL block, the glance card
      check("quality-section-without-errors", function () {
        var el = $("rlQuality"), rows = R.views(exp).quality || [];
        return { ok: !!el && /Every step was perfect/.test(el.textContent) && !!el.querySelector('details.sql[data-view="v_quality_by_step"]') && rows.length >= 5 &&
          rows.every(function (r) { return r.errors === 0 && r.first_pass_yield === 1 && r.rework_ratio === 0 && r.scrap_ratio === 0; }) && $("rlGlance").textContent.indexOf("every step perfect") >= 0, detail: rows.length + " operations" };
      });
      // v3.55: the delivery section on a run without windows - the note, both SQL blocks, the glance card, empty twins
      check("delivery-section-without-windows", function () {
        var el = $("rlDelivery"), v = R.views(exp);
        return { ok: !!el && /Instantaneous dock and carrier/.test(el.textContent) && !!el.querySelector('details.sql[data-view="v_otif"]') && !!el.querySelector('details.sql[data-view="v_inbound"]') &&
          Array.isArray(v.otif) && v.otif.length === 0 && Array.isArray(v.inbound) && v.inbound.length === 0 && $("rlGlance").textContent.indexOf("instantaneous dock and carrier") >= 0, detail: "no windows" };
      });
      // v3.56: the control-tower block on a run without decisions - the note, the SQL block, the glance card, an empty twin
      check("control-section-without-decisions", function () {
        var el = $("rlControl"), v = R.views(exp);
        return { ok: !!el && /No control-tower decision in this run/.test(el.textContent) && !!el.querySelector('details.sql[data-view="v_control"]') && Array.isArray(v.control) && v.control.length === 0 &&
          $("rlGlance").textContent.indexOf("no proposal decided") >= 0 && !!(window.WT && window.WT.control), detail: "no decisions" };
      });
      check("ask-section-answers-on-example-a", function () {
        var out = $("rlAskOut"), form = $("rlAskForm"), inp = $("rlAsk");
        if (!out || !form || !inp || !window.WT || !window.WT.ask) return { ok: false, detail: "missing" };
        var dflt = out.textContent;
        inp.value = "which step waits longest";
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        var t = out.textContent, a = window.WT.ask.answer("which step waits longest", { exp: exp, kb: window.WT.kb });
        var chip = $("rlAskChips").querySelector("button[data-ask]");
        if (chip) chip.click();
        var afterChip = out.textContent;
        return { ok: /v_run_summary/.test(dflt) && /stg/.test(t) && /122\.4/.test(t) && /v_station_wait/.test(t) && a.id === "wait" && a.numbers.location === "stg" && !!window.WT.kb && afterChip !== t && !BAD_TEXT.test(t) && $("rlAskChips").querySelectorAll("button[data-ask]").length === 11,
          detail: "wait -> " + (a.numbers ? a.numbers.location + "/" + a.numbers.op + " " + a.numbers.avg_wait_ticks : "-") };
      });
      check("tracking-invariant-and-export-shape", function () {
        var T = window.WT.tracking, v = R.views(exp), doc = T.fromLedger(exp);
        return { ok: v.invariants.v_tracking_gaps === 0 && doc.schema === "factory-tracking-events/v1" && doc.events.length === exp.events.length && doc.events.every(function (e) { return e.eventTime === null; }) &&
          !!$("rlInvariants").querySelector('details.sql[data-view="v_tracking_gaps"]') && $("rlInvariants").textContent.indexOf("v_tracking_gaps") >= 0, detail: doc.events.length + " twins, gaps " + v.invariants.v_tracking_gaps };
      });
      var out = $("rlYourCaseOut"), before = out.innerHTML, inp = $("rlYourCase").querySelector('[data-yc="l"]');
      inp.value = String(Number(inp.value) + 100);
      inp.dispatchEvent(new Event("input", { bubbles: true }));
      return wait(400).then(function () {
        check("your-case-reacts-to-input-debounced", function () { return { ok: out.innerHTML !== before && !BAD_TEXT.test(out.textContent), detail: "length " + before.length + " -> " + out.innerHTML.length }; });
        var gsel = $("rlYourCase").querySelector('[data-yc="grade"]');
        gsel.value = "ect32";
        gsel.dispatchEvent(new Event("change", { bubbles: true }));
        return wait(400).then(function () {
          check("grade-select-fills-ect-and-caliper", function () {
            var e = $("rlYourCase").querySelector('[data-yc="ect"]'), c = $("rlYourCase").querySelector('[data-yc="caliper"]');
            return { ok: Math.abs(Number(e.value) - 5.6041) < 1e-3 && Number(c.value) === 4 && /32 ECT/.test(out.textContent) && !BAD_TEXT.test(out.textContent), detail: e.value + " kN/m / " + c.value + " mm" };
          });
          return clickAndWait("rlDemoB", "b");
        });
      });
    }).then(function (d) {
      check("compare-renders-after-b", function () { var n = $("rlCompare").querySelectorAll("table").length; return { ok: !!window.RunLedger.currentB() && window.RunLedger.currentB().run.id === d.run && n === 6, detail: d.run + " · " + n + " tables" }; });
      check("all-37-sql-blocks-after-compare", function () {
        var seen = {}, els = $("rlView").querySelectorAll("details.sql[data-view]");
        for (var i = 0; i < els.length; i++) seen[els[i].getAttribute("data-view")] = 1;
        var miss = Object.keys(window.RunLedgerSQL).filter(function (k) { return !seen[k]; });
        return { ok: miss.length === 0, detail: miss.length ? "missing " + miss.join(",") : "37/37" };
      });
      check("no-errors-after-b", function () { var e = window.__WT_ERRORS__ || []; return { ok: e.length === 0, detail: e.length ? e.map(function (x) { return x.message; }).join(" | ") : "clean" }; });
      return clickAndWait("rlDemoC", "a");
    }).then(function (d) {
      var exp = R.current(), g = R.glance(exp);
      check("example-c-declared-capacities-no-floor-flag", function () {
        var unrounded = (exp.locations || []).some(function (l) { return l.service_ticks != null && l.service_ticks !== Math.round(l.service_ticks * 1e4) / 1e4; });
        var floor = g.flags.some(function (f) { return f.kind === "floor-rate"; });
        return { ok: exp.run.id === d.run && exp.run.scenario === "ecommerce-multichannel-fc" && g.stations === 8 && g.atFloor === 0 && !floor && unrounded && !BAD_TEXT.test($("rlGlance").textContent),
          detail: d.run + " · " + g.stations + " stations, " + g.atFloor + " at the floor rate, flags " + g.flags.map(function (f) { return f.kind; }).join(",") };
      });
      check("compare-after-c-names-the-different-scenario", function () {
        var c = R.compare(exp, R.currentB());
        return { ok: !!c && c.same_scenario === false && /different scenario or profile/.test($("rlCompare").textContent) && $("rlCompare").querySelectorAll("table").length === 6, detail: "same_scenario " + String(c && c.same_scenario) };
      });
      check("no-errors-after-c", function () { var e = window.__WT_ERRORS__ || []; return { ok: e.length === 0, detail: e.length ? e.map(function (x) { return x.message; }).join(" | ") : "clean" }; });
      return clickAndWait("rlDemoD", "a");
    }).then(function (d) {
      check("example-d-own-data-glance-and-dispatch-by-order", function () {
        var exp = R.current(), g = R.glance(exp), disp = $("rlDispatch");
        var rows = R.views(exp).dispatchByOrder || [];
        return { ok: exp.run.id === d.run && !!exp.run.dataset && exp.run.dataset.orders === 300 && /^own data: 300 orders \/ \d+ lines$/.test(g.dataset.text) && $("rlGlance").textContent.indexOf("own data: 300 orders") >= 0 &&
          disp.textContent.indexOf("Dispatch by order") >= 0 && !!disp.querySelector('details.sql[data-view="v_dispatch_by_order"]') && rows.length > 0 && rows.every(function (r) { return /^ORD-\d{4}$/.test(r.order_ref); }) && !BAD_TEXT.test(disp.textContent),
          detail: d.run + " · " + rows.length + " orders" };
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
