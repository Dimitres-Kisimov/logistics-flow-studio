/* =====================================================================
 * Logistics Flow Studio - ids.js
 * THE NUMBERING SYSTEM (v3.31). Deterministic, collision-free identities for
 * runs, orders, handling units and events, plus the GS1 identifiers real
 * supply chains print on their labels.
 * ---------------------------------------------------------------------
 * WHY. A simulated unit used to be an integer that lived for one run. A
 * ledger, an SQL query and a viewer need identities that (a) mean the same
 * thing in every layer, (b) come back identical when the same scenario,
 * seed and order mix are run again, and (c) never encode a fact that can
 * change (the archetype, the outcome, the location are attributes, not id
 * parts).
 *
 *   RUN-<scenario>-s<seed>-h<hash8>   one run; the hash covers the inputs
 *   ORD-<run>-<n:6>                   an order, numbered in spawn sequence
 *   HU-<order>-<k>                    a handling unit of that order
 *   EVT-<hu>-<version>                one event; version = operations passed
 *
 * GS1 (the real-world numbering, from the public GS1 General Specifications):
 *   GTIN-13  trade item (an each)      12 data digits + mod-10 check digit
 *   GTIN-14  trade item (a case)       indicator digit + GTIN-13 body + check
 *   SSCC     logistic unit (a pallet,  extension digit + company prefix +
 *            a parcel)                 serial reference (17 digits) + check
 *   GLN      a location                12 data digits + check digit
 *   The check digit is GS1's mod-10 with weights 3,1,3,1,... from the right.
 *
 * HONESTY. The company prefix used here (4012345) is the demonstration prefix
 * that appears in GS1 documentation; it is NOT a registered prefix and no
 * number produced here identifies a real product, pallet or site. The
 * extension-digit convention (3 = pallet, 0 = parcel / case) is this app's
 * own; GS1 leaves the extension digit to the company.
 *
 * DETERMINISM: no Date, no Math.random. Pure functions only.
 * ===================================================================== */
(function () {
  "use strict";
  const WT = (window.WT = window.WT || {});

  const DEMO_PREFIX = "4012345";
  const HONESTY =
    "Identities are deterministic functions of the run inputs. GS1 numbers use the " +
    "demonstration company prefix 4012345 from GS1 documentation - not a registered " +
    "prefix; nothing here identifies a real product, pallet or site.";

  // FNV-1a 32-bit over a string - a stable, dependency-free content hash.
  function fnv1a(str) {
    let h = 0x811c9dc5;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }
  function hex8(n) { return ("00000000" + (n >>> 0).toString(16)).slice(-8); }
  function pad(n, width) { let s = String(Math.max(0, Math.floor(n))); while (s.length < width) s = "0" + s; return s; }
  function slug(s) { return String(s || "layout").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "layout"; }

  /* ---------------- run / order / unit / event ---------------------- */
  // A stable hash of the run inputs: the layout's elements (id, type, geometry),
  // the seed and the order mix. Key order is fixed, so the same inputs hash the
  // same on every machine.
  // v3.44: an order pool is a run input too - its digest joins the hash ONLY when a
  // pool is present, so every run without one keeps the id it always had.
  function poolDigest(pool) {
    const rows = (pool || []).map((o) => [String(o.orderId), (Array.isArray(o.lines) ? o.lines : []).map((l) => [l.sku != null ? String(l.sku) : (l.skuIndex != null ? l.skuIndex : null), Math.round(Number(l.qty) || 0)])]);
    return hex8(fnv1a(JSON.stringify(rows)));
  }
  function inputHash(layout, seed, mix, pool, policy, errors, inbound, outbound, people) {
    const els = ((layout && layout.elements) || []).map((e) => [e.id, e.type, e.x, e.y, e.w, e.d, e.arc || null]);
    const m = mix == null ? null : (Array.isArray(mix) ? mix : Object.keys(mix).sort().map((k) => [k, mix[k]]));
    const parts = [(layout && layout.gridW) || 0, (layout && layout.gridH) || 0, els, seed >>> 0, m];
    if (Array.isArray(pool) && pool.length) parts.push(poolDigest(pool));
    // v3.45: the staffing what-if is a run input too (only when present)
    if (policy && policy.kind) parts.push(["policy", String(policy.kind), policy.threshold | 0, policy.maxServers | 0, policy.cooldownTicks | 0]);
    // v3.54: the error what-if is a run input too (only when present): the kinds with their effective shares and the levers.
    // v3.67: the levers enter as [name, value] pairs for the NON-NOMINAL ones only, so that a lever left at 1 never changes
    // a run id - which is what let the lever set grow from three to seven without moving any run that had not set one.
    if (errors && Array.isArray(errors.kinds) && errors.kinds.length) parts.push(["errors", errors.kinds.map((k) => [k.kind, k.effective]),
      errors.psf ? Object.keys(errors.psf).filter((k) => errors.psf[k] !== 1).map((k) => [k, errors.psf[k]]) : null]);
    // v3.55: the delivery what-if is a run input too (only when present)
    if (inbound && inbound.kind) parts.push(["inbound", inbound.periodTicks | 0, inbound.openTicks | 0, inbound.lateness || []]);
    if (outbound && outbound.kind) parts.push(["outbound", outbound.periodTicks | 0, outbound.promisedLeadTicks | 0, outbound.transit || []]);
    // v3.66: the learning / fatigue what-if is a run input too (only when present)
    if (people && people.kind) parts.push(["people", people.learning.rate, people.learning.floor, people.fatigue.maxUplift, people.fatigue.toPeakMinutes | 0, people.fatigue.breakEveryMinutes | 0, people.fatigue.breakMinutes | 0]);
    return hex8(fnv1a(JSON.stringify(parts)));
  }
  function runId(scenarioId, seed, layout, mix, pool, policy, errors, inbound, outbound, people) {
    return "RUN-" + slug(scenarioId) + "-s" + (seed >>> 0) + "-h" + inputHash(layout, seed, mix, pool, policy, errors, inbound, outbound, people);
  }
  function orderId(run, n) { return "ORD-" + run + "-" + pad(n, 6); }
  function huId(order, k) { return "HU-" + order + "-" + (k == null ? 1 : k); }
  function eventId(hu, version) { return "EVT-" + hu + "-" + (version | 0); }
  function parseRun(id) {
    const m = /^RUN-(.+)-s(\d+)-h([0-9a-f]{8})$/.exec(String(id || ""));
    return m ? { scenario: m[1], seed: Number(m[2]), hash: m[3] } : null;
  }

  /* ---------------- GS1 ----------------------------------------------- */
  // Mod-10 check digit: weights 3,1,3,1,... applied from the RIGHTMOST data digit.
  function gs1CheckDigit(digits) {
    const d = String(digits);
    if (!/^\d+$/.test(d)) throw new Error("GS1 check digit needs digits only");
    let sum = 0;
    for (let i = 0; i < d.length; i++) {
      const fromRight = d.length - 1 - i;
      sum += (d.charCodeAt(i) - 48) * (fromRight % 2 === 0 ? 3 : 1);
    }
    return (10 - (sum % 10)) % 10;
  }
  function withCheck(body) { return body + gs1CheckDigit(body); }
  function isValidGs1(code) {
    const s = String(code || "");
    return /^\d{8}$|^\d{12,14}$|^\d{18}$/.test(s) && gs1CheckDigit(s.slice(0, -1)) === Number(s.slice(-1));
  }
  // SSCC: extension (1) + company prefix + serial reference, 17 digits, + check.
  function sscc(extension, serial, prefix) {
    const p = String(prefix == null ? DEMO_PREFIX : prefix);
    const ext = String(extension == null ? 0 : extension).slice(-1);
    const width = 17 - 1 - p.length;
    if (width < 1) throw new Error("company prefix too long for an SSCC");
    return withCheck(ext + p + pad(serial, width).slice(-width));
  }
  // GTIN-13: company prefix + item reference to 12 digits, + check.
  function gtin13(itemRef, prefix) {
    const p = String(prefix == null ? DEMO_PREFIX : prefix);
    const width = 12 - p.length;
    if (width < 1) throw new Error("company prefix too long for a GTIN-13");
    return withCheck(p + pad(itemRef, width).slice(-width));
  }
  // GTIN-14: indicator digit (1-8 = packaging level) + the GTIN-13 without its
  // check digit, + a new check digit.
  function gtin14(indicator, gtin13Code) {
    const g = String(gtin13Code);
    if (!/^\d{13}$/.test(g)) throw new Error("GTIN-14 needs a GTIN-13");
    return withCheck(String(indicator).slice(-1) + g.slice(0, 12));
  }
  // GLN: company prefix + location reference to 12 digits, + check.
  function gln(locationRef, prefix) {
    const p = String(prefix == null ? DEMO_PREFIX : prefix);
    const width = 12 - p.length;
    return withCheck(p + pad(locationRef, width).slice(-width));
  }

  WT.ids = {
    HONESTY, DEMO_PREFIX,
    fnv1a, hex8, pad, slug,
    inputHash, runId, orderId, huId, eventId, parseRun,
    gs1CheckDigit, withCheck, isValidGs1, sscc, gtin13, gtin14, gln,
  };
})();
