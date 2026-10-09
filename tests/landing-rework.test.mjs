import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const home = readFileSync(new URL("../web/landing-2026.html", import.meta.url), "utf8");
const shell = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
const index = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
const style = readFileSync(new URL("../web/landing-2026.css", import.meta.url), "utf8");

test("landing is an original StorePOS marketing page with accessible nav, CTA and pricing", () => {
  assert.match(home, /class="sp-landing"/);
  assert.match(home, /id="sp-features"/);
  assert.match(home, /id="sp-workflow"/);
  assert.match(home, /id="sp-platform"/);
  assert.match(home, /id="sp-pricing"/);
  assert.match(home, /id="pricing-grid"/);
  assert.match(home, /id="sp-mobile-nav"[^>]*hidden/);
  assert.match(home, /href="#\/login\?mode=signup"/);
  assert.match(home, /href="#\/resources"/);
  assert.match(home, /href="#\/manual"/);
  assert.match(home, /StorePOS Android v1\.7\.0/);
});

test("marketing rework loads without overwriting auth, customer portal or receipt routing", () => {
  assert.match(shell, /async function renderLanding\(\)/);
  assert.match(shell, /new URL\("\.\/landing-2026\.html", import\.meta\.url\)/);
  assert.match(shell, /else await renderLanding\(\);/);
  assert.match(shell, /renderAuth\(\)/);
  assert.match(shell, /renderManual\(\)/);
  assert.match(shell, /renderResources\(\)/);
  assert.match(shell, /renderCustomerPortal\(\)/);
  assert.match(shell, /renderDigitalReceipt\(/);
  assert.match(shell, /loadPublicPlans\(\);/);
});

test("new stylesheet loaded only after current StorePOS CSS and scoped to marketing shell", () => {
  assert.match(index, /landing-2026\.css/);
  assert.ok(index.indexOf("styles.css") < index.indexOf("landing-2026.css"));
  assert.match(style, /\.sp-landing\s*\{/);
  assert.match(style, /@media\(max-width:680px\)/);
  assert.match(style, /prefers-reduced-motion/);
  assert.doesNotMatch(style, /(?:^|\n)\s*(?:\.retail-app-shell|\.sidebar|\.auth-card)\s*\{/);
});

test("marketing is honest about payment methods and print verification", () => {
  assert.match(home, /Physical acceptance testing/);
  assert.match(home, /NFC card-present acceptance require separate payment-provider/);
  assert.match(home, /Concept preview · sample data/);
  assert.doesNotMatch(home, /\bcertified BIR\b|\bBIR accredited\b/);
});
