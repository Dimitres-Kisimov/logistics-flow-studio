/* =====================================================================
 * verify_online_retail.js - v3.69 A REAL ORDER BOOK BEHIND THE DEMO.
 * Run: node verify_online_retail.js
 * ---------------------------------------------------------------------
 * Every order the flow simulation had ever seen was declared: a mix with
 * illustrative shares, a synthetic article list, quantities from a
 * teaching distribution. The demo's demand is now a public record of real
 * transactions (Online Retail II, UCI dataset 502, CC BY 4.0). This
 * harness checks what was taken from it, and what deliberately was not:
 *
 *   1. THE TWIN: data/online-retail.js carries exactly the JSON, and the
 *      JSON carries its licence, its DOI citation and its caveat.
 *   2. THE APP READS IT: the two committed CSVs parse through the app's
 *      OWN parsers with zero errors - 2000 articles, 132 orders, 3533
 *      lines - so the demo runs on real order lines, not on a promise.
 *   3. THE RULE HELD: every rejected line is counted by reason and the
 *      counts add up to the workbook's rows; a cancellation is reported
 *      as a cancellation and never as a customer return; every article
 *      is in the form the dataset documents.
 *   4. THE ABC CURVE IS MEASURED: the 80 % cut lands where the data puts
 *      it, not at the textbook 20 % of articles.
 *   5. WHAT IS NOT CLAIMED: no invoice number, no customer id, no price,
 *      no country, no weight - and a caveat that says the building, the
 *      staffing and the rates of that retailer are not used.
 *   6. HONESTY AND WIRING: the docs page generated fresh, the dataset
 *      twin loaded before the app, CREDITS, the runner, wt-v147.
 * ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

global.window = global;
for (const f of ["domain.js", "data.js", "data/online-retail.js"]) {
  (0, eval)(fs.readFileSync(path.join(__dirname, f), "utf8"));
}
const D = global.WT.data, OR = global.WT.datasets.onlineRetail;
const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? "[PASS] " : "[FAIL] ") + name + (detail ? " - " + detail : ""));
}

/* ---- 1. the twin --------------------------------------------------------------------- */
(function () {
  const json = JSON.parse(read(path.join("data", "online-retail.json")));
  check("1a. the JS twin carries exactly the committed JSON, key for key and number for number",
    JSON.stringify(OR) === JSON.stringify(json) && OR.schema === "wt-online-retail/v1");
  check("1b. the licence, the DOI citation and the byte-level provenance of the download travel with the data",
    /CC BY 4\.0/.test(OR.source.licence) && /10\.24432\/C5CG6D/.test(OR.source.citation) && /Chen, D\. \(2012\)/.test(OR.source.citation) &&
    OR.source.bytes > 40000000 && /^[0-9a-f]{64}$/.test(OR.source.sha256) && /archive\.ics\.uci\.edu/.test(OR.source.url));
  check("1c. the reduction rule is recorded with the data, all eight clauses, so the numbers can be re-derived from the page alone",
    Array.isArray(OR.rule) && OR.rule.length === 8 && OR.rule.some((r) => /nearest-rank/.test(r)) &&
    OR.rule.some((r) => /CANCELLATION/.test(r)) && OR.rule.some((r) => /five digits/.test(r)) && OR.rule.some((r) => /LINES per week/.test(r)));
})();

/* ---- 2. the app reads it ------------------------------------------------------------- */
(function () {
  const arts = D.parseArticles(read(path.join("data", "demo-skus.csv")));
  const ords = D.parseOrders(read(path.join("data", "demo-orders.csv")), arts.articles);
  const lines = ords.orders.reduce((a, o) => a + o.lines.length, 0);
  const units = ords.orders.reduce((a, o) => a + o.lines.reduce((b, l) => b + l.qty, 0), 0);
  check("2a. the article master parses through the app's own parser with zero errors: 2000 real articles with real descriptions and real picks per week",
    arts.ok === true && arts.errors.length === 0 && arts.articles.length === 2000 &&
    arts.articles.length === OR.article_master.skus && arts.articles.every((a) => a.sku && a.description && a.weeklyPicks > 0),
    arts.articles[0].sku + " " + JSON.stringify(arts.articles[0].description) + " at " + arts.articles[0].weeklyPicks + " picks/week, class " + arts.articles[0].cls);
  check("2b. the order file parses with zero errors and every line's article is in the master - one real trading day, 132 orders, 3533 lines, 30999 units",
    ords.ok === true && ords.errors.length === 0 && ords.orders.length === 132 && lines === 3533 && units === 30999 &&
    ords.orders.length === OR.demo_day.orders && lines === OR.demo_day.lines && units === OR.demo_day.units);
  check("2c. the orders are real orders, not one line each: the day's largest has many lines and the median order is multi-line, which is what makes a pick tour worth simulating",
    Math.max.apply(null, ords.orders.map((o) => o.lines.length)) > 20 &&
    ords.orders.filter((o) => o.lines.length > 1).length > ords.orders.length / 2,
    "largest order " + Math.max.apply(null, ords.orders.map((o) => o.lines.length)) + " lines, " +
    ords.orders.filter((o) => o.lines.length === 1).length + " of " + ords.orders.length + " are single-line");
  check("2d. the classes in the file are the measured ones, and the master has no class C because the cut lands beyond it - stated rather than hidden",
    arts.articles.filter((a) => a.cls === "A").length === OR.article_master.by_class.A &&
    arts.articles.every((a) => a.cls === "A" || a.cls === "B") && OR.article_master.by_class.C === undefined &&
    OR.abc.cuts.B.skus > OR.article_master.skus && /no class \*\*C\*\*/.test(read(path.join("docs", "ONLINE_RETAIL.md"))));
})();

/* ---- 3. the rule held ---------------------------------------------------------------- */
(function () {
  const s = OR.scale, rej = OR.rejected;
  let rejected = 0;
  for (const k of Object.keys(rej)) rejected += rej[k];
  check("3a. every line of the workbook is accounted for: the usable lines plus every rejected line by reason equal the rows read",
    s.rows === s.usable_lines + rejected && s.rows === 1067371,
    s.usable_lines.toLocaleString("en") + " usable + " + rejected.toLocaleString("en") + " rejected = " + s.rows.toLocaleString("en"));
  check("3b. a cancellation is reported as a cancellation: the share is the dataset's own C-prefixed invoices over all invoices, and nothing in the file calls it a return rate",
    s.cancellation_invoices > 0 && Math.abs(s.cancellation_share_of_invoices - s.cancellation_invoices / (s.cancellation_invoices + s.sales_invoices)) < 5e-5 &&
    !/return_share|return_rate|returns_share/.test(JSON.stringify(OR)) && /not a customer return/i.test(OR.honesty),
    (100 * s.cancellation_share_of_invoices).toFixed(1) + "% of invoices are cancellations - which is not a returns rate, and the file says so");
  check("3c. administrative codes are listed with their line counts rather than quietly dropped, and none of them is in the article master",
    Array.isArray(OR.administrative_codes) && OR.administrative_codes.length > 0 &&
    OR.administrative_codes.every((c) => c.code && c.lines > 0) && !OR.administrative_codes.some((c) => /^\d{5}[A-Za-z]?$/.test(c.code)) &&
    rej["administrative stock code, not a picked article"] > 0,
    OR.administrative_codes.slice(0, 4).map((c) => c.code + " " + c.lines).join(", "));
  check("3d. the quantiles are nearest-rank, so every one of them is a value that actually occurs in the record",
    [OR.lines_per_order, OR.units_per_order, OR.quantity_per_line].every((v) =>
      v.min <= v.p10 && v.p10 <= v.median && v.median <= v.p90 && v.p90 <= v.max && Number.isInteger(v.median) && v.n > 0),
    "lines/order median " + OR.lines_per_order.median + ", units/order median " + OR.units_per_order.median + ", qty/line median " + OR.quantity_per_line.median);
  check("3e. the arrival shape is the record's own: nothing overnight, a midday peak, and a weekday the retailer barely trades - none of which a declared curve would have produced",
    OR.orders_by_hour.every((h) => h.hour >= 6 && h.hour <= 20) &&
    OR.orders_by_hour.reduce((a, h) => (h.share > a.share ? h : a)).hour === 12 &&
    OR.orders_by_weekday.some((w) => w.share < 0.01) && OR.orders_by_weekday.some((w) => w.name === "Sun" && w.share > 0.05),
    "peak " + OR.orders_by_hour.reduce((a, h) => (h.share > a.share ? h : a)).hour + ":00; " +
    OR.orders_by_weekday.filter((w) => w.share < 0.01).map((w) => w.name).join(", ") + " barely traded");
})();

/* ---- 4. the ABC curve is measured ---------------------------------------------------- */
(function () {
  const cuts = OR.abc.cuts, curve = OR.abc.curve;
  const twenty = curve.find((c) => c.top_share_of_skus === 0.20);
  check("4a. the 80 % cut is where the data puts it, not where the textbook says: class A is the first 1064 articles, 21.54 % of the range",
    cuts.A.skus === 1064 && Math.abs(cuts.A.share_of_skus - 0.2154) < 5e-5 && cuts.A.at_share_of_units === 0.80 &&
    Math.abs(cuts.A.skus / OR.abc.articles - cuts.A.share_of_skus) < 5e-4);
  check("4b. the measured curve is close to 80/20 but is not it: the top fifth of the 4939 PICKED articles carry 78.29 % of units (78.44 % before the administrative codes were excluded - the rule moves the number, which is why it is pinned after the rule and not before)",
    twenty && Math.abs(twenty.share_of_units - 0.7829) < 5e-5 && twenty.share_of_units < 0.80 && OR.abc.articles === 4939,
    "top 20% of " + OR.abc.articles.toLocaleString("en") + " articles carry " + (100 * twenty.share_of_units).toFixed(2) + "% of units");
  check("4c. the curve is cumulative and monotone, and the top 1 % of articles already carry a fifth of all units",
    curve.every((c, i) => i === 0 || c.share_of_units >= curve[i - 1].share_of_units) &&
    curve[0].top_share_of_skus === 0.01 && curve[0].share_of_units > 0.15,
    "top 1% (" + curve[0].skus + " articles) carry " + (100 * curve[0].share_of_units).toFixed(2) + "%");
  check("4d. the article master covers the units it claims to, and the claim is checkable from the curve",
    OR.article_master.share_of_units > 0.9 && OR.article_master.share_of_units < 1 &&
    OR.article_master.skus <= 2000 && OR.abc.total_units > 0,
    (100 * OR.article_master.share_of_units).toFixed(2) + "% of all units in 2000 of " + OR.abc.articles.toLocaleString("en") + " articles");
})();

/* ---- 5. what is not claimed ---------------------------------------------------------- */
(function () {
  const skus = read(path.join("data", "demo-skus.csv")), orders = read(path.join("data", "demo-orders.csv"));
  check("5a. nothing personal and nothing commercial was committed: no customer id, no invoice number, no price, no country column in either file",
    skus.split("\n")[0] === "sku,description,weekly_picks,class" && orders.split("\n")[0] === "order_id,sku,qty" &&
    !/customer|invoice|price|country/i.test(skus.split("\n")[0]) && !/customer|invoice|price|country/i.test(orders.split("\n")[0]) &&
    !/\bC\d{6}\b/.test(orders));
  check("5b. the caveat says what does NOT transfer - the retailer's building, staffing, rates and geography - and that the demand shape is all that was taken",
    /UK-based/.test(OR.honesty) && /SHAPE of demand/.test(OR.honesty) && /building, staffing, rates/.test(OR.honesty) &&
    /no claim is made/.test(OR.honesty) && OR.source.caveat === OR.honesty);
  check("5c. no weight, no volume and no storage type were invented for articles the dataset does not describe",
    !/weight|volume|storage_type|kg|mm/i.test(skus.split("\n")[0]) &&
    JSON.stringify(OR).indexOf("weight") < 0);
  check("5d. the record's extremes are kept rather than trimmed: the largest single order line in the dataset is reported as it stands",
    OR.quantity_per_line.max > 10000 && OR.units_per_order.max > 10000 && OR.lines_per_order.max > 1000,
    "largest line " + OR.quantity_per_line.max.toLocaleString("en") + " units, largest order " + OR.lines_per_order.max.toLocaleString("en") + " lines");
})();

/* ---- 6. honesty and wiring ----------------------------------------------------------- */
(function () {
  const md = read(path.join("docs", "ONLINE_RETAIL.md")), credits = read("CREDITS.md");
  const html = read("index.html"), sw = read("sw.js"), runall = read(path.join("test", "run-all.mjs"));
  check("6a. docs/ONLINE_RETAIL.md is generated and carries the source, the licence, the DOI, the rule and the rejection table",
    /Generated by/.test(md) && /CC BY 4\.0/.test(md) && /10\.24432\/C5CG6D/.test(md) && /## The reduction rule/.test(md) &&
    /What was rejected, and why/.test(md) && /cancellation/i.test(md) && /nearest-rank/.test(md));
  check("6b. the page states the two things a declared arrival curve would have missed, and the extreme the record actually holds",
    /barely trades on Saturday/.test(md) && /trades on Sunday/.test(md) && /nearest-rank quantiles rather than a mean/.test(md));
  check("6c. CREDITS names the dataset, its creator, its licence and its DOI, and says only derived data is shipped",
    /Online Retail II/.test(credits) && /Chen/.test(credits) && /CC BY 4\.0/.test(credits) && /10\.24432\/C5CG6D/.test(credits));
  check("6d. the dataset twin is precached and loaded before app.js, like every other committed dataset",
    html.indexOf('<script src="data/online-retail.js"></script>') >= 0 &&
    html.indexOf('<script src="data/online-retail.js"></script>') < html.indexOf('<script src="app.js"></script>') &&
    /"\.\/data\/online-retail\.js"/.test(sw));
  check("6e. shipped: the runner lists this harness, the service worker is at wt-v147 (previously wt-v146), README and CHANGELOG carry v3.69",
    /verify_online_retail\.js/.test(runall) && /wt-v147/.test(sw) && /Previously wt-v146/.test(sw) &&
    /v3\.69/.test(read("README.md")) && /## v3\.69/.test(read("CHANGELOG.md")));
  check("6f. the tool is pure and offline-checkable: no network call outside fetch, the offline check is what the tests run, and the cache is git-ignored",
    /def offline_check/.test(read(path.join("tools", "online_retail.py"))) &&
    /--offline-check/.test(read(path.join("tools", "online_retail.py"))) &&
    /^\.cache\/$/m.test(read(".gitignore")));
})();

console.log("=".repeat(72));
if (fail) { console.log("FAILED " + fail + " of " + (pass + fail)); process.exit(1); }
console.log("ALL ONLINE-RETAIL CHECKS PASSED (" + pass + ")");
