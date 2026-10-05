import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm";
import { pageRetail, renderDigitalReceipt } from "./retail.js?v=20261005-v130";
import { pageStoreOps } from "./ops13.js?v=20261005-v130";

const SUPABASE_URL = "https://qgyzdoltjlryjthxxscw.supabase.co";
const SUPABASE_KEY = "sb_publishable_mCjtfE-W75s1yyUdw2NY2g_z6ic5DIc";
const EMAIL_CONFIRM_GATE = "https://storepos.2023107337.workers.dev/#/confirm-email";
const EMAIL_CONFIRM_SUCCESS = "https://storepos.2023107337.workers.dev/?email-confirmed=1";
const TURNSTILE_SITE_KEY = "0x4AAAAAAFORduMdXxtZDB1o";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

const app = document.querySelector("#app");
const toastRoot = document.querySelector("#toast-root");
const modalRoot = document.querySelector("#modal-root");

const state = {
  session: null,
  user: null,
  membership: null,
  shop: null,
  isSystemAdmin: false,
  authMode: "signin",
  busy: false,
  turnstileToken: null,
  turnstileWidgetId: null,
  turnstileMountTimer: null,
  supportThreadId: null,
  supportChannel: null,
  entitlements: null
};

const money = value => new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 2
}).format(Number(value || 0));

const number = value => new Intl.NumberFormat("en-PH").format(Number(value || 0));
const peso = value => new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0
}).format(Number(value || 0));
const esc = value => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

function niceDate(value, withTime = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return esc(value);
  return date.toLocaleString("en-PH", withTime ? {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit"
  } : {
    month: "short", day: "numeric", year: "numeric"
  });
}

function trialRemaining(expiresAt) {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return { days: 0, label: "Trial expired" };
  const days = Math.ceil(ms / 86400000);
  return { days, label: `${days} day${days === 1 ? "" : "s"} remaining` };
}

function statusTone(status) {
  const s = String(status || "").toLowerCase();
  if (["active","completed","paid","released","ready"].includes(s)) return "green";
  if (["trial","waiting","inspection","repairing","testing","open","pending"].includes(s)) return "yellow";
  if (["suspended","expired","cancelled","voided","refunded"].includes(s)) return "red";
  if (["manager","admin","owner","pro","business"].includes(s)) return "blue";
  return "gray";
}

function pill(value) {
  return `<span class="pill ${statusTone(value)}">${esc(value || "—")}</span>`;
}

function toast(message, type = "") {
  const node = document.createElement("div");
  node.className = `toast ${type}`;
  node.textContent = message;
  toastRoot.appendChild(node);
  setTimeout(() => node.remove(), 4300);
}

function showModal(html) {
  modalRoot.innerHTML = `<div class="modal-backdrop"><div class="modal">${html}</div></div>`;
  modalRoot.querySelector(".modal-backdrop")?.addEventListener("click", e => {
    if (e.target.classList.contains("modal-backdrop")) closeModal();
  });
}

function closeModal() {
  modalRoot.innerHTML = "";
}

function setHash(path) {
  const next = "#/" + path.replace(/^\/+/, "");
  if (location.hash === next) route();
  else location.hash = next;
}

function currentPath() {
  return location.hash.replace(/^#\/?/, "") || "";
}

function rolePages(role) {
  const r = String(role || "").toLowerCase();
  const full = ["overview","sales","inventory","retail","control","customers","staff","suppliers","operations","branches","reports","support","license","devices","settings"];
  if (["owner","admin","manager"].includes(r)) return full;
  if (r === "cashier") return ["overview","sales","retail","control","customers","operations","support","license"];
  if (r === "inventory") return ["overview","inventory","retail","control","suppliers","operations","support","license"];
  if (r === "mechanic") return ["overview","sales","inventory","retail","control","customers","operations","support","license"];
  return ["overview","support","license"];
}

function navLabel(page) {
  return ({
    overview:"Overview", sales:"Sales", inventory:"Inventory", retail:"Retail Suite", control:"Retail Control", customers:"Customers",
    staff:"Staff", suppliers:"Suppliers", operations:"Operations", branches:"Branches", reports:"Reports",
    support:"Support Chat", license:"License", devices:"Devices", settings:"Settings"
  })[page] || page;
}

const FEATURE_LABELS = {
  pos: "Point of Sale",
  inventory: "Inventory",
  retail_suite: "Advanced Retail Suite",
  customers: "Customers",
  quotations: "Quotations",
  basic_reports: "Basic reports",
  reports: "Reports & analytics",
  advanced_reports: "Advanced reports",
  bluetooth_receipts: "Bluetooth receipts",
  service_jobs: "Service jobs",
  suppliers: "Suppliers & purchasing",
  staff: "Staff management",
  operations: "Cashier operations",
  warranties: "Warranties",
  receivables: "Customer receivables",
  inventory_counts: "Physical inventory counts",
  loyalty: "Loyalty & store credit",
  device_management: "Device management",
  multi_branch: "Multi-branch",
  stock_transfers: "Stock transfers",
  priority_support: "Priority support",
  support: "Support",
  paymongo_payments: "PayMongo automatic payments"
};

const PAGE_FEATURES = {
  sales: ["pos"],
  inventory: ["inventory"],
  retail: ["retail_suite","inventory","operations","pos"],
  control: ["retail_suite","inventory","operations","pos"],
  customers: ["customers"],
  staff: ["staff"],
  suppliers: ["suppliers"],
  operations: ["operations"],
  branches: ["multi_branch"],
  reports: ["basic_reports","reports","advanced_reports"],
  devices: ["device_management"]
};

const ALWAYS_AVAILABLE_PAGES = new Set(["license","support","settings"]);

function featureLabel(code) {
  return FEATURE_LABELS[code] || String(code || "").replaceAll("_"," ");
}

function entitlementFeatures() {
  return Array.isArray(state.entitlements?.features) ? state.entitlements.features : [];
}

function planAllowsPage(page) {
  if (ALWAYS_AVAILABLE_PAGES.has(page)) return true;
  if (!state.entitlements?.valid) return false;
  if (page === "overview") return true;
  const required = PAGE_FEATURES[page];
  if (!required?.length) return true;
  const features = entitlementFeatures();
  return required.some(feature => features.includes(feature));
}

function planPagesForRole(role) {
  return rolePages(role).filter(planAllowsPage);
}

function renderPlanLocked(root, page) {
  const e = state.entitlements || {};
  const required = PAGE_FEATURES[page] || [];
  const reason = !e.valid
    ? `Your StorePOS license is ${e.status || "inactive"}. Renew or activate a plan to continue using shop operations.`
    : `${navLabel(page)} is not included in your current ${e.plan_name || e.plan_code || "StorePOS"} plan.`;

  root.innerHTML = `
    ${head("Plan access required", navLabel(page))}
    <div class="card plan-lock-card">
      <span class="kicker">StorePOS entitlement</span>
      <h2>${esc(reason)}</h2>
      ${required.length ? `<p>Required entitlement: <strong>${esc(required.map(featureLabel).join(" or "))}</strong></p>` : ""}
      <div class="actions">
        <a class="btn btn-primary" href="#/dashboard/license">View license & plan</a>
        <a class="btn btn-secondary" href="#/dashboard/support">Contact support</a>
      </div>
    </div>
  `;
}

function recommendedLicenseDate(cycle) {
  const date = new Date();
  if (cycle === "monthly") date.setMonth(date.getMonth() + 1);
  else if (cycle === "annual") date.setFullYear(date.getFullYear() + 1);
  return date.toISOString().slice(0,10);
}

async function functionErrorDetails(error) {
  if (!error) return null;
  try {
    const response = error.context;
    if (response && typeof response.clone === "function") {
      const cloned = response.clone();
      const type = cloned.headers?.get?.("content-type") || "";
      if (type.includes("application/json")) return await cloned.json();
      const text = await cloned.text();
      if (text) return { error: text };
    }
  } catch (_) {}
  return null;
}

function friendlyError(error) {
  const raw = error?.message || String(error || "Something went wrong.");
  const lower = raw.toLowerCase();
  if (lower.includes("captcha") || lower.includes("turnstile")) return "Cloudflare verification failed or expired. Complete the security check and try again.";
  if (lower.includes("invalid login credentials")) return "Incorrect email or password.";
  if (lower.includes("email not confirmed")) return "Verify your email first, then sign in.";
  if (lower.includes("over_email_send_rate_limit") || lower.includes("email rate limit exceeded")) return "Verification email limit reached. Please try again later. For production sign-ups, StorePOS needs a custom SMTP email provider.";
  if (lower.includes("unexpected status code returned from hook: 405")) return "Account creation is temporarily unavailable because the email hook is misconfigured. Please contact StorePOS Support.";
  if (lower.includes("plan does not include")) return raw.split("\n")[0].slice(0,220);
  if (lower.includes("row-level security") || lower.includes("permission denied")) return "Your account does not have permission for that action.";
  if (lower.includes("email address not authorized")) return "This email cannot receive StorePOS verification mail from the current Supabase mail provider. Configure custom SMTP for public sign-ups.";
  if (lower.includes("rate limit") || lower.includes("too many requests")) return "Email sending is temporarily rate-limited. Wait before requesting another verification email.";
  if (lower.includes("network") || lower.includes("fetch")) return "Unable to reach StorePOS Cloud. Check your internet connection.";
  return raw.split("\n")[0].slice(0, 220);
}

function clearTurnstileMountTimer() {
  if (state.turnstileMountTimer) {
    clearTimeout(state.turnstileMountTimer);
    state.turnstileMountTimer = null;
  }
}

function destroyTurnstile() {
  clearTurnstileMountTimer();
  state.turnstileToken = null;
  if (state.turnstileWidgetId !== null && window.turnstile?.remove) {
    try { window.turnstile.remove(state.turnstileWidgetId); } catch (_) {}
  }
  state.turnstileWidgetId = null;
}

function resetTurnstile() {
  state.turnstileToken = null;
  if (state.turnstileWidgetId !== null && window.turnstile?.reset) {
    try { window.turnstile.reset(state.turnstileWidgetId); } catch (_) {}
  }
}

function mountTurnstile(attempt = 0) {
  const target = document.querySelector("#turnstile-widget");
  if (!target) return;

  if (window.turnstile?.render) {
    clearTurnstileMountTimer();
    if (state.turnstileWidgetId !== null && window.turnstile?.remove) {
      try { window.turnstile.remove(state.turnstileWidgetId); } catch (_) {}
    }
    state.turnstileToken = null;
    state.turnstileWidgetId = window.turnstile.render(target, {
      sitekey: TURNSTILE_SITE_KEY,
      theme: "dark",
      action: state.authMode === "signup" ? "storepos_signup" : "storepos_signin",
      callback: token => {
        state.turnstileToken = token;
      },
      "expired-callback": () => {
        state.turnstileToken = null;
      },
      "error-callback": () => {
        state.turnstileToken = null;
        toast("Cloudflare verification could not load. Refresh the page and try again.", "error");
      }
    });
    return;
  }

  if (attempt < 50) {
    clearTurnstileMountTimer();
    state.turnstileMountTimer = setTimeout(() => mountTurnstile(attempt + 1), 100);
    return;
  }

  target.innerHTML = '<div class="help turnstile-error">Cloudflare verification did not load. Refresh the page and try again.</div>';
}

function setupMotion(scope = document) {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  const items = scope.querySelectorAll?.(
    ".section-head, .feature-card, .price-card, .manual-section, .manual-intro-card"
  ) || [];

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -45px 0px" });

  items.forEach(item => {
    if (item.classList.contains("is-visible") || item.classList.contains("reveal-motion")) return;
    item.classList.add("reveal-motion");
    observer.observe(item);
  });
}

async function loadAccessContext() {
  state.user = state.session?.user || null;
  state.membership = null;
  state.shop = null;
  state.isSystemAdmin = false;
  state.entitlements = null;

  if (!state.user) return;

  const [memberRes, adminRes] = await Promise.all([
    supabase
      .from("shop_members")
      .select("id,shop_id,role,is_active,joined_at,shop:shops!inner(id,name,phone,email,address,currency_code,timezone,app_code,business_type)")
      .eq("user_id", state.user.id)
      .eq("is_active", true)
      .eq("shop.app_code", "storepos")
      .order("joined_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("system_admins")
      .select("user_id")
      .eq("user_id", state.user.id)
      .maybeSingle()
  ]);

  if (memberRes.error) console.warn("Membership load:", memberRes.error.message);
  state.membership = memberRes.data || null;
  state.shop = memberRes.data?.shop || null;
  state.isSystemAdmin = Boolean(adminRes.data);

  if (state.shop?.id) {
    const { data, error } = await supabase.rpc("get_shop_entitlements", { p_shop_id: state.shop.id });
    if (error) {
      console.warn("Entitlement load:", error.message);
      state.entitlements = { valid: false, status: "unavailable", features: [] };
    } else {
      state.entitlements = data || { valid: false, status: "unlicensed", features: [] };
    }
  }
}
function confirmationTokenFromHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  const queryIndex = raw.indexOf("?");
  if (queryIndex < 0) return "";
  return new URLSearchParams(raw.slice(queryIndex + 1)).get("token") || "";
}

function renderEmailConfirmationGate() {
  const token = confirmationTokenFromHash();
  const validToken = token.length >= 20 && !/\\s/.test(token);

  app.innerHTML = `
    <div class="setup">
      <div class="setup-card email-confirm-card">
        <div class="brand"><span class="brand-logo">S</span><span>StorePOS</span></div>
        <div class="verify-shield">✓</div>
        <span class="eyebrow">Email verification</span>
        <h1>${validToken ? "Confirm your email address" : "Verification link unavailable"}</h1>
        <p>${
          validToken
            ? "For your security, StorePOS does not verify the account just because an email scanner opened this page. Press the button below yourself to confirm your email address."
            : "This confirmation link is incomplete or invalid. Request a new verification email from the StorePOS sign-in page."
        }</p>
        <div class="verify-note">
          <strong>${validToken ? "One manual confirmation" : "Need another link?"}</strong>
          <span>${
            validToken
              ? "The one-time Supabase verification link is consumed only after you press Confirm email address."
              : "Enter your email on the sign-in page and choose Resend verification email."
          }</span>
        </div>
        <div class="form">
          ${
            validToken
              ? '<button class="btn btn-primary" type="button" id="confirm-email-now">Confirm email address</button>'
              : '<a class="btn btn-primary" href="#/login">Request a new verification email</a>'
          }
          <a class="btn btn-secondary" href="#/">Back to StorePOS website</a>
        </div>
      </div>
    </div>`;

  document.querySelector("#confirm-email-now")?.addEventListener("click", () => {
    const button = document.querySelector("#confirm-email-now");
    if (button) {
      button.disabled = true;
      button.textContent = "Confirming…";
    }

    const verifyUrl = new URL(SUPABASE_URL + "/auth/v1/verify");
    verifyUrl.searchParams.set("token", token);
    verifyUrl.searchParams.set("type", "email");
    verifyUrl.searchParams.set("redirect_to", EMAIL_CONFIRM_SUCCESS);
    window.location.assign(verifyUrl.toString());
  });
}

function renderEmailVerified() {
  const hashParams = new URLSearchParams(location.hash.replace(/^#/, ""));
  const errorDescription = hashParams.get("error_description");
  const failed = Boolean(hashParams.get("error") || hashParams.get("error_code"));

  app.innerHTML = `
    <div class="setup">
      <div class="setup-card">
        <div class="brand"><span class="brand-logo">S</span><span>StorePOS</span></div>
        <div style="height:14px"></div>
        <span class="eyebrow">${failed ? "Verification problem" : "Email verified"}</span>
        <h1>${failed ? "We couldn't verify that link" : "Email confirmed successfully"}</h1>
        <p>${
          failed
            ? esc(errorDescription || "The confirmation link may have expired or already been used.")
            : "Your StorePOS email is verified. You can return to the Android app and sign in, or continue to StorePOS Cloud here."
        }</p>
        <div class="form">
          ${failed
            ? '<a class="btn btn-primary" href="#/login?mode=signup">Create / resend from sign up</a>'
            : '<a class="btn btn-primary" href="#/login">Continue to StorePOS Cloud</a>'}
          <a class="btn btn-secondary" href="#/">Back to StorePOS website</a>
        </div>
      </div>
    </div>`;
}

function renderManual() {
  const sections = [
    ["01","Getting Started","Create your StorePOS account, verify your email, create a retail workspace, and begin the 7-day StorePOS Pro Trial."],
    ["02","Point of Sale","Scan a barcode or search products, adjust quantity, select an optional customer, apply allowed discounts, and complete payment."],
    ["03","Products & Inventory","Create SKUs/barcodes, categories, prices, units, reorder levels and stock adjustments. Inventory movements preserve an audit trail."],
    ["04","Customers & Loyalty","Maintain customer contact details, loyalty points and store-credit balances without motorcycle or workshop records."],
    ["05","Suppliers & Purchasing","Maintain supplier records and use purchasing/receiving workflows to replenish retail inventory."],
    ["06","Cashier Operations","Use cashier shifts, cash movements, returns, refunds and manager approval controls for daily store operations."],
    ["07","Reports","Review revenue, gross profit, transaction count, average ticket, expenses and top-selling products according to plan access."],
    ["08","Branches","Business plans can organize multiple retail branches and move stock between StorePOS locations."],
    ["09","Receipt Printing","StorePOS supports Bluetooth and USB/USB-OTG ESC/POS receipt printers. Test the printer in Settings before live selling."],
    ["10","Barcode Scanner","Use the Android camera scanner in POS and Inventory. A matched barcode selects the product immediately."],
    ["11","Offline Selling","When supported by the workflow, sales can be queued locally and synchronized after connectivity returns. Always verify pending sync before closing the day."],
    ["12","Licensing & Devices","Each StorePOS shop has its own StorePOS plan, device limit, staff limit and feature entitlements. MotoPOS licenses cannot be used on StorePOS shops."],
    ["13","Support","StorePOS Auto Support handles common guided troubleshooting first and can hand unresolved or sensitive requests to human support."],
    ["14","SUNMI V2","SUNMI V2 hardware is optional. Custom StorePOS software pricing and hardware quotations are kept separate, then combined in the suggested payment total when both are quoted."]
  ];

  app.innerHTML = `
    <div class="public-shell">
      <nav class="public-nav">
        <a href="#/" class="brand"><span class="brand-logo">S</span><span>StorePOS</span></a>
        <div class="nav-actions">
          <a class="btn btn-secondary" href="#/">Website</a>
          ${state.session && state.shop ? '<a class="btn btn-primary" href="#/dashboard/overview">Dashboard</a>' : '<a class="btn btn-primary" href="#/login">Sign in</a>'}
        </div>
      </nav>

      <main>
        <section class="hero compact-hero">
          <div class="hero-copy">
            <span class="kicker">StorePOS Help Center</span>
            <h1>Retail operations manual.</h1>
            <p>Practical guidance for owners, managers, cashiers and inventory staff using StorePOS Android and StorePOS Cloud.</p>
          </div>
        </section>

        <section class="section">
          <div class="section-head">
            <div><span class="kicker">Core workflow</span><h2>From setup to daily closing.</h2></div>
            <p>StorePOS is isolated from MotoPOS by <strong>app_code = storepos</strong> while sharing the same secure Supabase foundation.</p>
          </div>
          <div class="feature-grid">
            ${sections.map(([n,title,body])=>`
              <article class="feature-card">
                <span class="kicker">${n}</span>
                <h3>${esc(title)}</h3>
                <p>${esc(body)}</p>
              </article>
            `).join("")}
          </div>
        </section>

        <section class="section">
          <div class="card">
            <div class="card-title"><h3>Daily retail checklist</h3><span>Recommended</span></div>
            <div class="manual-table">
              <div><strong>Before opening</strong><span>Confirm internet, printer, scanner, active shift and low-stock alerts.</span></div>
              <div><strong>During sales</strong><span>Use individual staff accounts and verify discounts, payment method and change before confirming.</span></div>
              <div><strong>Receiving</strong><span>Record incoming stock through purchasing/stock adjustment so quantities stay auditable.</span></div>
              <div><strong>Returns</strong><span>Use StorePOS return/refund controls instead of manually changing completed sales.</span></div>
              <div><strong>Closing</strong><span>Review shift totals, sync status, cash movements, returns and reports before ending the business day.</span></div>
            </div>
          </div>
        </section>
      </main>

      <footer class="footer">
        <span>© 2026 StorePOS · Built by Mark Reymuel Pascual</span>
        <span><a href="#/">StorePOS Website</a> · Retail POS • Inventory • Reports • Licensing</span>
      </footer>
    </div>`;
}

function renderLanding() {
  app.innerHTML = `
    <div class="public-shell">
      <nav class="public-nav">
        <a href="#/" class="brand"><span class="brand-logo">S</span><span>StorePOS</span></a>
        <div class="nav-actions">
          <a class="btn btn-secondary" href="https://github.com/markyyy-lolz/StorePOS-Web" target="_blank" rel="noopener noreferrer">Resources</a>
          <a class="btn btn-secondary" href="#/manual">App Manual</a>
          <a class="btn btn-secondary" href="#/login">Sign in</a>
          <a class="btn btn-primary" href="#/login?mode=signup">Start free setup</a>
        </div>
      </nav>

      <main>
        <section class="hero">
          <div>
            <span class="eyebrow">Retail shop operating system</span>
            <h1>Parts, workshop and sales.<br><span class="gradient-text">One StorePOS Cloud.</span></h1>
            <p>Manage retail parts, customers, service jobs, staff access, receipts, devices and licensing from one cloud-connected system built for real shop operations.</p>
            <div class="hero-actions">
              <a class="btn btn-primary" href="#/login?mode=signup">Start 7-day Pro trial</a>
              <a class="btn btn-secondary" href="#/login">Open dashboard</a>
              <a class="btn btn-secondary" href="#/manual">Read the app manual</a>
              <a class="btn btn-secondary" href="https://github.com/markyyy-lolz/StorePOS-Web" target="_blank" rel="noopener noreferrer">Open Resources</a>
            </div>
            <div class="hero-trust">
              <span><b>Supabase</b> secured data</span>
              <span><b>Android</b> POS terminals</span>
              <span><b>7-day</b> Pro trial included</span>
              <span><b>GitHub</b> automated releases</span>
            </div>
          </div>

          <div class="mock-window" aria-hidden="true">
            <div class="mock-top"><i class="dot"></i><i class="dot"></i><i class="dot"></i></div>
            <div class="mock-body">
              <div class="mock-grid">
                <div class="mock-card"><span>Sales today</span><strong>₱28,450</strong></div>
                <div class="mock-card"><span>Active jobs</span><strong>8</strong></div>
                <div class="mock-card wide">
                  <span>Weekly performance</span>
                  <div class="bars">
                    <i style="height:32%"></i><i style="height:52%"></i><i style="height:43%"></i>
                    <i style="height:76%"></i><i style="height:61%"></i><i style="height:88%"></i><i style="height:69%"></i>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="section">
          <div class="section-head">
            <div><span class="kicker">Built for operations</span><h2>Everything your shop needs.</h2></div>
            <p>Android is your cashier terminal. StorePOS Cloud is the control center for owners and managers.</p>
          </div>
          <div class="feature-grid">
            ${[
              ["POS","Fast product lookup, checkout and receipt workflows."],
              ["Inventory","Stock levels, reorder alerts, cost and selling prices."],
              ["Workshop","Retail profiles, service history and job statuses."],
              ["Staff","Role-aware access for owners, managers and cashiers."],
              ["Reports","Sales, expenses, transactions and operating summaries."],
              ["Licensing","Plans, device limits, staff limits and remote suspension."]
            ].map((f,i)=>`<article class="feature-card"><div class="feature-icon">${String(i+1).padStart(2,"0")}</div><h3>${f[0]}</h3><p>${f[1]}</p></article>`).join("")}
          </div>
        </section>

        <section class="section">
          <div class="section-head">
            <div><span class="kicker">StorePOS plans</span><h2>Start small. Scale when needed.</h2></div>
            <p>License plans are controlled from the secure StorePOS developer console.</p>
          </div>
          <div id="pricing-grid" class="pricing-grid">
            <div class="loading-block"></div><div class="loading-block"></div><div class="loading-block"></div>
          </div>
        </section>

        <section class="section">
          <div class="section-head">
            <div><span class="kicker">StorePOS resources</span><h2>Official shared files.</h2></div>
            <p>Open the official StorePOS GitHub Resources folder for shared resources and files.</p>
          </div>
          <div class="founder-card reveal-motion is-visible">
            <div class="founder-mark">G</div>
            <div class="founder-copy">
              <span class="kicker">GitHub Resources</span>
              <h2>StorePOS Resources</h2>
              <p>Use this official shared folder to access StorePOS files provided through GitHub Resources.</p>
              <div class="founder-actions">
                <a class="btn btn-primary" href="https://github.com/markyyy-lolz/StorePOS-Web" target="_blank" rel="noopener noreferrer">Open GitHub Resources Folder</a>
                <a class="btn btn-secondary" href="#/manual">Read the StorePOS manual</a>
                <a class="btn btn-secondary" href="https://github.com/markyyy-lolz/StorePOS-Web" target="_blank" rel="noopener noreferrer">StorePOS Resources</a>
              </div>
            </div>
          </div>
        </section>

        <section class="section founder-section">
          <div class="founder-card reveal-motion is-visible">
            <div class="founder-mark">MR</div>
            <div class="founder-copy">
              <span class="kicker">Meet the developer</span>
              <h2>Hi, I’m Mark Reymuel Pascual.</h2>
              <p>I’m the developer behind StorePOS, building practical digital tools for real workflows. StorePOS is focused on helping retail shops manage sales, inventory, service jobs, staff access, customers, support, and cloud operations in one connected system.</p>
              <p class="founder-note">Have a question, suggestion, partnership idea, or need help with StorePOS? You can contact me directly on Facebook.</p>
              <div class="founder-actions">
                <a class="btn btn-primary" href="https://facebook.com/profile.php?id=61590474910314" target="_blank" rel="noopener noreferrer">Contact me on Facebook</a>
                <a class="btn btn-secondary" href="#/manual">Read the StorePOS manual</a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer class="footer"><span>© 2026 StorePOS Cloud · Built by Mark Reymuel Pascual</span><span><a href="#/manual">App Manual</a> · <a href="https://github.com/markyyy-lolz/StorePOS-Web" target="_blank" rel="noopener noreferrer">Resources</a> · <a href="https://facebook.com/profile.php?id=61590474910314" target="_blank" rel="noopener noreferrer">Facebook Contact</a> · Retail parts • Service • POS • Licensing</span></footer>
    </div>`;

  setupMotion();
  loadPublicPlans();
}

async function loadPublicPlans() {
  const root = document.querySelector("#pricing-grid");
  if (!root) return;
  const { data, error } = await supabase
    .from("license_plans")
    .select("code,name,description,default_max_devices,default_max_staff,default_offline_grace_days,monthly_price_php,annual_price_php,marketing_note,features,sort_order,app_code")
    .eq("app_code","storepos")
    .eq("is_active", true)
    .order("sort_order");

  if (error || !data?.length) {
    root.innerHTML = `<div class="empty" style="grid-column:1/-1"><strong>StorePOS plans</strong>Plan details are temporarily unavailable.</div>`;
    return;
  }

  root.innerHTML = data.map(plan => {
    const features = Array.isArray(plan.features) ? plan.features : [];
    const monthly = plan.monthly_price_php == null ? "Contact us" : peso(plan.monthly_price_php);
    const annual = plan.annual_price_php == null ? "" : `${peso(plan.annual_price_php)}/year`;

    return `
      <article class="price-card ${plan.code === "store_pro" ? "featured" : ""}">
        ${plan.code === "store_pro" ? '<div class="price-badge">Most popular</div>' : ""}
        <span class="kicker">${esc(plan.code)}</span>
        <h3>${esc(plan.name)}</h3>
        <div class="plan-price"><strong>${esc(monthly)}</strong>${plan.monthly_price_php != null ? "<span>/month</span>" : ""}</div>
        <div class="plan-annual">${esc(annual)}</div>
        <p>${esc(plan.description || "")}</p>
        <div class="plan-note">${esc(plan.marketing_note || "")}</div>
        <div class="price-meta">
          <strong>${number(plan.default_max_devices)}</strong> device(s)
          <span>·</span>
          <strong>${number(plan.default_max_staff)}</strong> staff
          <span>·</span>
          <strong>${number(plan.default_offline_grace_days)}</strong>-day offline grace
        </div>
        <div class="plan-feature-list">
          ${features.slice(0,7).map(feature => `<span>✓ ${esc(featureLabel(feature))}</span>`).join("")}
          ${features.length > 7 ? `<span class="muted">+${features.length - 7} more</span>` : ""}
        </div>
        <div class="trial-copy">New shops start with a free 7-day Pro Trial. No card required.</div>
        <a class="btn ${plan.code === "store_pro" ? "btn-primary" : "btn-secondary"}" href="#/login?mode=signup">Start free trial</a>
      </article>
    `;
  }).join("") + `
    <article class="price-card">
      <span class="kicker">custom</span>
      <h3>Custom StorePOS</h3>
      <div class="plan-price"><strong>₱699</strong><span>/month starting</span></div>
      <div class="plan-annual">Tailored quotation</div>
      <p>Build a StorePOS package around your actual shop requirements instead of fixed limits.</p>
      <div class="plan-note">Final pricing depends on devices, staff accounts, selected modules, branches and support requirements.</div>
      <div class="price-meta"><strong>Optional</strong> SUNMI V2 hardware</div>
      <div class="plan-feature-list">
        <span>✓ Custom device and staff limits</span>
        <span>✓ Select only the modules you need</span>
        <span>✓ Multi-branch and support options</span>
        <span>✓ SUNMI V2 units can be added to the order</span>
        <span>✓ Hardware is quoted separately from software</span>
      </div>
      <div class="trial-copy">Create your shop first, then submit a Custom License Order from StorePOS Cloud.</div>
      <a class="btn btn-secondary" href="#/login?mode=signup">Create account</a>
    </article>`;
  setupMotion(root);
}
function renderAuth() {
  destroyTurnstile();
  const signupFromUrl = location.hash.includes("mode=signup");
  if (signupFromUrl) state.authMode = "signup";
  const signup = state.authMode === "signup";

  app.innerHTML = `
    <div class="auth-wrap">
      <section class="auth-art">
        <a href="#/" class="brand"><span class="brand-logo">M</span><span>StorePOS Cloud</span></a>
        <div>
          <span class="eyebrow">Secure business access</span>
          <h1>Run the shop.<br><span class="gradient-text">Not the paperwork.</span></h1>
          <p>Sign in as an owner, manager or staff member. Permissions are enforced in the database—not just hidden in the interface.</p>
        </div>
        <div class="help">Protected by Supabase Auth + Row Level Security.</div>
      </section>
      <section class="auth-side">
        <div class="auth-card">
          <h2>${signup ? "Create owner account" : "Welcome back"}</h2>
          <p>${signup ? "Create your StorePOS identity, then set up your first shop." : "Sign in to your StorePOS workspace."}</p>

          <div class="segment">
            <button data-mode="signin" class="${!signup ? "active" : ""}">Sign in</button>
            <button data-mode="signup" class="${signup ? "active" : ""}">Create account</button>
          </div>

          <form id="auth-form" class="form">
            ${signup ? `<div class="field"><label>Display name</label><input class="input" name="display_name" autocomplete="name" required placeholder="Shop owner name"></div>` : ""}
            <div class="field"><label>Email address</label><input class="input" type="email" name="email" autocomplete="email" required placeholder="you@example.com"></div>
            <div class="field"><label>Password</label><input class="input" type="password" name="password" autocomplete="${signup ? "new-password" : "current-password"}" minlength="${signup ? 8 : 6}" required placeholder="${signup ? "Minimum 8 characters" : "Your password"}"></div>
            <div class="turnstile-wrap">
              <div id="turnstile-widget" aria-label="Cloudflare security verification"></div>
              <div class="help">Protected by Cloudflare Turnstile. Complete the security check before continuing.</div>
            </div>
            <button class="btn btn-primary" type="submit">${signup ? "Create StorePOS account" : "Sign in"}</button>
            <button class="btn btn-secondary" type="button" id="resend-confirmation">Resend verification email</button>
            <a href="#/" class="btn btn-secondary">Back to website</a>
            <div class="help">Already registered but no email arrived? Enter your email above, then use <strong>Resend verification email</strong>. Check Spam/Junk too.</div>
          </form>
        </div>
      </section>
    </div>`;

  document.querySelectorAll("[data-mode]").forEach(btn => {
    btn.addEventListener("click", () => {
      state.authMode = btn.dataset.mode;
      location.hash = state.authMode === "signup" ? "#/login?mode=signup" : "#/login";
      renderAuth();
    });
  });
  document.querySelector("#auth-form")?.addEventListener("submit", handleAuth);
  document.querySelector("#resend-confirmation")?.addEventListener("click", resendConfirmation);
  mountTurnstile();
}

async function resendConfirmation() {
  const form = document.querySelector("#auth-form");
  const emailInput = form?.querySelector('input[name="email"]');
  const email = String(emailInput?.value || "").trim();
  const button = document.querySelector("#resend-confirmation");
  const captchaToken = state.turnstileToken;

  if (!email) {
    toast("Enter your email address first.", "error");
    emailInput?.focus();
    return;
  }

  if (!captchaToken) {
    toast("Complete the Cloudflare security check first.", "error");
    mountTurnstile();
    return;
  }

  const original = button?.textContent || "Resend verification email";
  if (button) {
    button.disabled = true;
    button.textContent = "Sending…";
  }

  try {
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: {
        emailRedirectTo: EMAIL_CONFIRM_GATE,
        captchaToken
      }
    });
    if (error) throw error;
    toast("Verification email requested. Check Inbox and Spam/Junk.", "success");
  } catch (error) {
    toast(friendlyError(error), "error");
  } finally {
    resetTurnstile();
    if (button?.isConnected) {
      button.disabled = false;
      button.textContent = original;
    }
  }
}

async function handleAuth(event) {
  event.preventDefault();
  if (state.busy) return;

  const captchaToken = state.turnstileToken;
  if (!captchaToken) {
    toast("Complete the Cloudflare security check first.", "error");
    mountTurnstile();
    return;
  }

  state.busy = true;
  const form = new FormData(event.currentTarget);
  const email = String(form.get("email") || "").trim();
  const password = String(form.get("password") || "");
  const button = event.currentTarget.querySelector('button[type="submit"]');
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Please wait…";

  try {
    if (state.authMode === "signup") {
      const displayName = String(form.get("display_name") || "").trim();
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: displayName },
          emailRedirectTo: EMAIL_CONFIRM_GATE,
          captchaToken
        }
      });
      if (error) throw error;
      if (data.session) {
        state.session = data.session;
        await loadAccessContext();
        toast("Account created.", "success");
        setHash("dashboard/overview");
      } else {
        toast("Verification requested. If no email arrives, use Resend verification email.", "success");
        state.authMode = "signin";
        location.hash = "#/login";
        renderAuth();
      }
    } else {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
        options: { captchaToken }
      });
      if (error) throw error;
      state.session = data.session;
      await loadAccessContext();
      toast("Signed in.", "success");
      setHash(state.isSystemAdmin && !state.shop ? "admin" : "dashboard/overview");
    }
  } catch (error) {
    toast(friendlyError(error), "error");
  } finally {
    state.busy = false;
    if (!state.session) resetTurnstile();
    if (button?.isConnected) {
      button.disabled = false;
      button.textContent = original;
    }
  }
}

function renderSetup() {
  app.innerHTML = `
    <div class="setup">
      <div class="setup-card">
        <div class="brand"><span class="brand-logo">S</span><span>StorePOS</span></div>
        <h1>Finish your shop setup</h1>
        <p>Your owner account is authenticated. Create the first workspace that will belong to this account.</p>
        <div class="account-box"><strong>Signed-in owner</strong><span>${esc(state.user?.email || "Authenticated account")}</span></div>
        <form id="setup-form" class="form">
          <div class="field"><label>Shop name</label><input class="input" name="name" required placeholder="Example: 3A's Motorshop"></div>
          <div class="field"><label>Phone</label><input class="input" name="phone" placeholder="Optional"></div>
          <div class="field"><label>Address</label><textarea class="input" name="address" placeholder="Optional"></textarea></div>
          <button class="btn btn-primary" type="submit">Create StorePOS workspace</button>
          <button class="btn btn-secondary" type="button" id="switch-account">Use another account</button>
        </form>
      </div>
    </div>`;

  document.querySelector("#setup-form")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = "Creating workspace…";
    try {
      const { error } = await supabase.rpc("bootstrap_shop_v2", {
        p_name: String(form.get("name") || "").trim(),
        p_phone: String(form.get("phone") || "").trim() || null,
        p_address: String(form.get("address") || "").trim() || null,
        p_app_code: "storepos",
        p_business_type: "retail"
      });
      if (error) throw error;
      await loadAccessContext();
      toast("Workspace created.", "success");
      setHash("dashboard/overview");
    } catch (error) {
      toast(friendlyError(error), "error");
      button.disabled = false;
      button.textContent = "Create StorePOS workspace";
    }
  });

  document.querySelector("#switch-account")?.addEventListener("click", async () => {
    await supabase.auth.signOut();
    state.session = state.user = state.membership = state.shop = null;
    state.isSystemAdmin = false;
    state.entitlements = null;
    setHash("login");
  });
}

function renderShell(page) {
  const role = state.membership?.role || "staff";
  const roleAllowedPages = rolePages(role);
  const pages = planPagesForRole(role);
  if (!roleAllowedPages.includes(page)) page = "overview";

  const adminLink = state.isSystemAdmin
    ? `<a class="nav-item ${currentPath() === "admin" ? "active" : ""}" href="#/admin"><span>Developer Control</span><span class="nav-badge">ADMIN</span></a>`
    : "";

  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand"><span class="brand-logo">S</span><span>StorePOS</span></div>
        <div class="shop-chip"><strong>${esc(state.shop?.name || "StorePOS")}</strong><span>${esc(role)} · ${esc(state.entitlements?.plan_name || state.entitlements?.status || "No plan")}</span></div>
        <nav class="nav-list">
          ${pages.map(p => `<a class="nav-item ${p === page ? "active" : ""}" href="#/dashboard/${p}"><span>${navLabel(p)}</span></a>`).join("")}
          <a class="nav-item" href="#/manual"><span>App Manual</span><span class="nav-badge">HELP</span></a>
          ${adminLink}
        </nav>
        <div class="sidebar-bottom"><button id="sign-out" class="btn btn-secondary" style="width:100%">Sign out</button></div>
      </aside>

      <div class="main">
        <header class="topbar">
          <div class="topbar-title"><strong>${esc(state.shop?.name || "StorePOS Cloud")}</strong><span>Cloud operations dashboard</span></div>
          <div class="toolbar"><a class="btn btn-secondary btn-sm" href="#/manual">Manual</a><div class="user-pill"><div class="avatar">${esc((state.user?.email || "M").slice(0,1).toUpperCase())}</div><div class="user-copy"><strong style="font-size:12px">${esc(state.user?.email || "")}</strong><div class="help">${esc(role)}</div></div></div></div>
        </header>
        <main id="page-content" class="content"><div class="loading-block"></div></main>
      </div>

      <nav class="mobile-nav">
        ${pages.slice(0,4).map(p => `<a class="${p === page ? "active" : ""}" href="#/dashboard/${p}">${navLabel(p)}</a>`).join("")}
        ${state.isSystemAdmin ? `<a href="#/admin">Admin</a>` : pages.length > 4 ? `<a href="#/dashboard/license">More</a>` : ""}
      </nav>
    </div>`;

  document.querySelector("#sign-out")?.addEventListener("click", async () => {
    await supabase.auth.signOut();
    state.session = state.user = state.membership = state.shop = null;
    state.isSystemAdmin = false;
    state.entitlements = null;
    setHash("");
  });

  loadDashboardPage(page);
}

async function loadDashboardPage(page) {
  const root = document.querySelector("#page-content");
  if (!root || !state.shop) return;
  if (!planAllowsPage(page)) {
    renderPlanLocked(root, page);
    return;
  }
  try {
    switch (page) {
      case "overview": return await pageOverview(root);
      case "sales": return await pageSales(root);
      case "inventory": return await pageInventory(root);
      case "retail": return await pageRetail(root, retailContext());
      case "control": return await pageStoreOps(root, retailContext());
      case "customers": return await pageCustomers(root);
      case "staff": return await pageStaff(root);
      case "suppliers": return await pageSuppliers(root);
      case "operations": return await pageOperations(root);
      case "branches": return await pageBranches(root);
      case "reports": return await pageReports(root);
      case "support": return await pageSupport(root);
      case "license": return await pageLicense(root);
      case "devices": return await pageDevices(root);
      case "settings": return await pageSettings(root);
      default: return await pageOverview(root);
    }
  } catch (error) {
    root.innerHTML = `<div class="empty"><strong>Unable to load this page</strong>${esc(friendlyError(error))}</div>`;
  }
}

function head(title, subtitle, action = "") {
  return `<div class="page-head"><div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div>${action}</div>`;
}

function retailContext() {
  return { supabase, state, money, number, esc, niceDate, pill, head, toast, showModal, closeModal, friendlyError };
}

async function pageOverview(root) {
  const shopId = state.shop.id;
  const canFinance = ["owner","admin","manager"].includes(state.membership.role);
  const features = entitlementFeatures();
  const hasService = false;
  const hasOperations = features.includes("operations");

  const [salesRes, productRes, jobRes, expenseRes, alertRes] = await Promise.all([
    supabase.from("sales").select("id,total_amount,status,created_at,sale_number").eq("shop_id", shopId).order("created_at",{ascending:false}).limit(100),
    supabase.from("products").select("id,name,sku,stock_quantity,reorder_level,selling_price").eq("shop_id",shopId).eq("is_active",true),
    hasService
      ? supabase.from("job_orders").select("id,job_number,status,complaint,created_at").eq("shop_id",shopId).order("created_at",{ascending:false}).limit(30)
      : Promise.resolve({data:[],error:null}),
    canFinance && hasOperations
      ? supabase.from("expenses").select("id,amount,expense_date").eq("shop_id",shopId).order("expense_date",{ascending:false}).limit(100)
      : Promise.resolve({data:[],error:null}),
    supabase.rpc("get_shop_alerts",{p_shop_id:shopId})
  ]);
  for (const r of [salesRes,productRes,jobRes,expenseRes,alertRes]) if (r?.error) throw r.error;

  const sales = salesRes.data || [];
  const products = productRes.data || [];
  const jobs = jobRes.data || [];
  const expenses = expenseRes.data || [];
  const alerts = alertRes.data || [];

  const now = new Date();
  const sameDay = value => {
    const d = new Date(value);
    return d.getFullYear()===now.getFullYear() && d.getMonth()===now.getMonth() && d.getDate()===now.getDate();
  };
  const todaySales = sales.filter(s => s.status === "completed" && sameDay(s.created_at));
  const todayRevenue = todaySales.reduce((sum,s)=>sum+Number(s.total_amount||0),0);
  const todayExpense = expenses.filter(e=>sameDay(e.expense_date)).reduce((sum,e)=>sum+Number(e.amount||0),0);
  const lowStock = products.filter(p=>Number(p.stock_quantity)<=Number(p.reorder_level));
  const activeJobs = jobs.filter(j=>!["released","cancelled"].includes(j.status));

  root.innerHTML = `
    ${head("Overview","Live snapshot of your retail shop")}
    ${alerts.length ? `
      <section class="alert-center">
        <div class="card-title"><h3>Needs attention</h3><span>${alerts.length} current alert(s)</span></div>
        <div class="alert-grid">
          ${alerts.slice(0,8).map(a=>`
            <a class="alert-item ${esc(a.severity||"info")}" href="#/dashboard/${esc(a.action_page||"overview")}">
              <div><strong>${esc(a.title)}</strong><span>${esc(a.message)}</span></div>
              <small>${niceDate(a.created_at,true)}</small>
            </a>`).join("")}
        </div>
      </section>` : ""}
    <section class="metrics">
      <article class="metric"><div class="metric-label">Sales today</div><div class="metric-value">${money(todayRevenue)}</div><div class="metric-sub">${todaySales.length} completed transaction(s)</div></article>
      <article class="metric"><div class="metric-label">${hasService?"Active jobs":"Products"}</div><div class="metric-value">${number(hasService?activeJobs.length:products.length)}</div><div class="metric-sub">${hasService?"Workshop queue":"Active inventory items"}</div></article>
      <article class="metric"><div class="metric-label">Low stock</div><div class="metric-value">${number(lowStock.length)}</div><div class="metric-sub">At or below reorder level</div></article>
      <article class="metric"><div class="metric-label">${canFinance&&hasOperations ? "Net today" : "Plan"}</div><div class="metric-value">${canFinance&&hasOperations ? money(todayRevenue-todayExpense) : esc(state.entitlements?.plan_name||"StorePOS")}</div><div class="metric-sub">${canFinance&&hasOperations ? `Expenses ${money(todayExpense)}` : "Server-enforced entitlements"}</div></article>
    </section>
    <section class="grid-2">
      <div class="card">
        <div class="card-title"><h3>Recent sales</h3><a href="#/dashboard/sales">View all</a></div>
        <div class="stat-list">
          ${sales.slice(0,6).map(s=>`<div class="stat-row"><span>${esc(s.sale_number || "Sale")} · ${niceDate(s.created_at,true)}</span><strong>${money(s.total_amount)}</strong></div>`).join("") || '<div class="empty"><strong>No sales yet</strong>Your completed transactions will appear here.</div>'}
        </div>
      </div>
      <div class="card">
        <div class="card-title"><h3>${hasService?"Workshop queue":"Inventory attention"}</h3><a href="#/dashboard/${hasService?"service":"inventory"}">${hasService?"Open service":"Open inventory"}</a></div>
        <div class="stat-list">
          ${hasService
            ? (activeJobs.slice(0,6).map(j=>`<div class="stat-row"><span>${esc(j.job_number || "Job")} · ${esc(j.complaint || "Service job")}</span><strong>${pill(j.status)}</strong></div>`).join("") || '<div class="empty"><strong>No active jobs</strong>New service jobs will appear here.</div>')
            : (lowStock.slice(0,6).map(p=>`<div class="stat-row"><span>${esc(p.name)} · ${esc(p.sku)}</span><strong>${number(p.stock_quantity)}</strong></div>`).join("") || '<div class="empty"><strong>Stock looks good</strong>No products are below reorder level.</div>')}
        </div>
      </div>
    </section>`;
}

async function pageSales(root) {
  const [salesRes, detailsRes] = await Promise.all([
    supabase.from("sales")
      .select("id,sale_number,total_amount,subtotal,discount_amount,tax_amount,status,created_at,completed_at")
      .eq("shop_id",state.shop.id).order("created_at",{ascending:false}).limit(150),
    supabase.from("retail_sale_details")
      .select("sale_id,receipt_token")
      .eq("shop_id",state.shop.id).order("created_at",{ascending:false}).limit(250)
  ]);
  if (salesRes.error) throw salesRes.error;
  if (detailsRes.error) throw detailsRes.error;
  const data=salesRes.data||[];
  const tokenBySale=new Map((detailsRes.data||[]).map(x=>[x.sale_id,x.receipt_token]));
  root.innerHTML = `
    ${head("Sales","Recent POS transactions from all allowed terminals")}
    <div class="table-wrap"><table><thead><tr><th>Sale</th><th>Date</th><th>Status</th><th>Subtotal</th><th>Discount</th><th>Total</th><th>Receipt</th></tr></thead><tbody>
      ${data.map(s=>`<tr><td><strong>${esc(s.sale_number)}</strong></td><td>${niceDate(s.created_at,true)}</td><td>${pill(s.status)}</td><td>${money(s.subtotal)}</td><td>${money(s.discount_amount)}</td><td><strong>${money(s.total_amount)}</strong></td><td>${tokenBySale.get(s.id)?`<button class="btn btn-secondary btn-sm sales-reprint" data-id="${s.id}">Reprint</button>`:'<span class="help">Legacy receipt</span>'}</td></tr>`).join("") || '<tr><td colspan="7">No transactions yet.</td></tr>'}
    </tbody></table></div>`;

  root.querySelectorAll(".sales-reprint").forEach(btn=>btn.addEventListener("click",async()=>{
    const sale=data.find(x=>x.id===btn.dataset.id);
    const token=tokenBySale.get(btn.dataset.id);
    if(!sale||!token) return;
    const reason=window.prompt("Reason for receipt reprint:", "Customer requested another copy");
    if(reason===null) return;
    if(!reason.trim()) return toast("A reprint reason is required.","error");
    const log=await supabase.rpc("storepos_v13_action",{
      p_shop_id:state.shop.id,
      p_action:"receipt_reprint",
      p_data:{sale_id:sale.id,reason:reason.trim()}
    });
    if(log.error) return toast(friendlyError(log.error),"error");
    window.open(location.origin+location.pathname+"#/receipt/"+encodeURIComponent(token),"_blank","noopener");
    toast("Receipt reprint logged as copy #"+Number(log.data?.copy_no||1)+".","success");
  }));
}

async function pageInventory(root) {
  const canManage = ["owner","admin","manager","inventory"].includes(state.membership.role);
  const [productRes, categoryRes] = await Promise.all([
    supabase.from("products")
      .select("id,category_id,name,sku,barcode,brand,description,part_number,item_type,cost_price,selling_price,wholesale_price,stock_quantity,reorder_level,track_stock,unit,shelf_location,oem,warranty_days,is_active")
      .eq("shop_id",state.shop.id).order("name"),
    supabase.from("product_categories")
      .select("id,name,is_active")
      .eq("shop_id",state.shop.id).order("sort_order").order("name")
  ]);
  if (productRes.error) throw productRes.error;
  if (categoryRes.error) throw categoryRes.error;

  const products = productRes.data || [];
  const categories = categoryRes.data || [];
  const lowCount = products.filter(p=>p.is_active && Number(p.stock_quantity)<=Number(p.reorder_level)).length;
  const stockValue = products.filter(p=>p.is_active).reduce((sum,p)=>sum+(Number(p.stock_quantity||0)*Number(p.cost_price||0)),0);

  root.innerHTML = `
    ${head(
      "Inventory",
      "Add products, edit pricing, adjust stock and archive items",
      canManage ? '<button id="add-product" class="btn btn-primary">Add product</button>' : ""
    )}
    <section class="metrics">
      <article class="metric"><div class="metric-label">Products</div><div class="metric-value">${number(products.filter(p=>p.is_active).length)}</div><div class="metric-sub">Active catalog items</div></article>
      <article class="metric"><div class="metric-label">Low stock</div><div class="metric-value">${number(lowCount)}</div><div class="metric-sub">Need replenishment</div></article>
      <article class="metric"><div class="metric-label">Inventory cost</div><div class="metric-value">${money(stockValue)}</div><div class="metric-sub">Current stock × cost</div></article>
      <article class="metric"><div class="metric-label">Archived</div><div class="metric-value">${number(products.filter(p=>!p.is_active).length)}</div><div class="metric-sub">Hidden from normal selling</div></article>
    </section>
    <div class="table-wrap"><table><thead><tr><th>Product</th><th>SKU / Barcode</th><th>Stock</th><th>Cost</th><th>Selling</th><th>Status</th>${canManage?"<th>Manage</th>":""}</tr></thead><tbody>
      ${products.map(p=>`<tr>
        <td><strong>${esc(p.name)}</strong><div class="help">${esc(p.brand||p.part_number||p.item_type||"—")}</div></td>
        <td>${esc(p.sku)}<div class="help">${esc(p.barcode||"No barcode")}</div></td>
        <td><strong>${number(p.stock_quantity)} ${esc(p.unit||"pc")}</strong><div class="help">Reorder at ${number(p.reorder_level)}</div></td>
        <td>${money(p.cost_price)}</td>
        <td><strong>${money(p.selling_price)}</strong></td>
        <td>${!p.is_active ? pill("inactive") : Number(p.stock_quantity)<=Number(p.reorder_level)?pill("low stock"):pill("active")}</td>
        ${canManage?`<td><div class="inventory-actions">
          <button class="btn btn-secondary btn-sm edit-product" data-id="${p.id}">Edit</button>
          <button class="btn btn-secondary btn-sm adjust-stock" data-id="${p.id}">Stock</button>
          <button class="btn ${p.is_active?"btn-danger":"btn-success"} btn-sm toggle-product" data-id="${p.id}" data-active="${p.is_active?"0":"1"}">${p.is_active?"Archive":"Restore"}</button>
        </div></td>`:""}
      </tr>`).join("") || `<tr><td colspan="${canManage?7:6}">No products yet.</td></tr>`}
    </tbody></table></div>`;

  document.querySelector("#add-product")?.addEventListener("click",()=>openProductModal(root,null,categories));
  root.querySelectorAll(".edit-product").forEach(btn=>{
    const product=products.find(p=>p.id===btn.dataset.id);
    btn.addEventListener("click",()=>openProductModal(root,product,categories));
  });
  root.querySelectorAll(".adjust-stock").forEach(btn=>{
    const product=products.find(p=>p.id===btn.dataset.id);
    btn.addEventListener("click",()=>openStockModal(root,product));
  });
  root.querySelectorAll(".toggle-product").forEach(btn=>btn.addEventListener("click",async()=>{
    const active=btn.dataset.active==="1";
    const { error } = await supabase.from("products")
      .update({is_active:active,updated_at:new Date().toISOString()})
      .eq("id",btn.dataset.id)
      .eq("shop_id",state.shop.id);
    if(error) return toast(friendlyError(error),"error");
    toast(active?"Product restored.":"Product archived.","success");
    await pageInventory(root);
  }));
}

function openProductModal(root, product, categories) {
  showModal(`
    <h2>${product?"Edit product":"Add product"}</h2>
    <p>${product?"Update product information. Use Stock Adjustment for quantity changes.":"Create a new product in this shop's inventory."}</p>
    <form id="product-form" class="form">
      <div class="grid-2">
        <div class="field"><label>Product name</label><input class="input" name="name" required value="${esc(product?.name||"")}" placeholder="Example product"></div>
        <div class="field"><label>SKU</label><input class="input" name="sku" required value="${esc(product?.sku||"")}" placeholder="SKU-001"></div>
      </div>
      <div class="grid-2">
        <div class="field"><label>Barcode</label><input class="input" name="barcode" value="${esc(product?.barcode||"")}"></div>
        <div class="field"><label>Brand</label><input class="input" name="brand" value="${esc(product?.brand||"")}"></div>
      </div>
      <div class="grid-2">
        <div class="field"><label>Category</label><select class="input" name="category_id"><option value="">No category</option>${categories.filter(x=>x.is_active).map(x=>`<option value="${x.id}" ${product?.category_id===x.id?"selected":""}>${esc(x.name)}</option>`).join("")}</select></div>
        <div class="field"><label>Type</label><select class="input" name="item_type">
          ${["product","grocery","beverage","household","personal_care","clothing","electronics","other"].map(x=>`<option value="${x}" ${(product?.item_type||"product")===x?"selected":""}>${x.replace("_"," ")}</option>`).join("")}
        </select></div>
      </div>
      <div class="grid-2">
        <div class="field"><label>Cost price</label><input class="input" type="number" step="0.01" min="0" name="cost_price" value="${product?.cost_price??0}" required></div>
        <div class="field"><label>Selling price</label><input class="input" type="number" step="0.01" min="0" name="selling_price" value="${product?.selling_price??0}" required></div>
      </div>
      <div class="grid-2">
        <div class="field"><label>Reorder level</label><input class="input" type="number" step="0.01" min="0" name="reorder_level" value="${product?.reorder_level??5}" required></div>
        <div class="field"><label>Unit</label><input class="input" name="unit" value="${esc(product?.unit||"pc")}" required></div>
      </div>
      ${product?"":'<div class="field"><label>Opening stock</label><input class="input" type="number" step="0.01" min="0" name="opening_stock" value="0"></div>'}
      <div class="grid-2">
        <div class="field"><label>Part number</label><input class="input" name="part_number" value="${esc(product?.part_number||"")}"></div>
        <div class="field"><label>Shelf location</label><input class="input" name="shelf_location" value="${esc(product?.shelf_location||"")}"></div>
      </div>
      <div class="field"><label>Description</label><textarea class="input" name="description">${esc(product?.description||"")}</textarea></div>
      <div class="modal-actions"><button type="button" id="close-product" class="btn btn-secondary">Cancel</button><button type="submit" class="btn btn-primary">${product?"Save changes":"Add product"}</button></div>
    </form>`);
  document.querySelector("#close-product")?.addEventListener("click",closeModal);
  document.querySelector("#product-form")?.addEventListener("submit",async event=>{
    event.preventDefault();
    const fd=new FormData(event.currentTarget);
    const button=event.currentTarget.querySelector('button[type="submit"]');
    button.disabled=true; button.textContent="Saving…";
    const payload={
      shop_id:state.shop.id,
      category_id:String(fd.get("category_id")||"")||null,
      name:String(fd.get("name")||"").trim(),
      sku:String(fd.get("sku")||"").trim(),
      barcode:String(fd.get("barcode")||"").trim()||null,
      brand:String(fd.get("brand")||"").trim()||null,
      item_type:String(fd.get("item_type")||"product"),
      cost_price:Number(fd.get("cost_price")||0),
      selling_price:Number(fd.get("selling_price")||0),
      reorder_level:Number(fd.get("reorder_level")||0),
      unit:String(fd.get("unit")||"pc").trim()||"pc",
      part_number:String(fd.get("part_number")||"").trim()||null,
      shelf_location:String(fd.get("shelf_location")||"").trim()||null,
      description:String(fd.get("description")||"").trim()||null,
      updated_at:new Date().toISOString()
    };
    try{
      let saved;
      if(product){
        const res=await supabase.from("products").update(payload).eq("id",product.id).eq("shop_id",state.shop.id).select("id").single();
        if(res.error) throw res.error;
        saved=res.data;
      }else{
        const res=await supabase.from("products").insert({...payload,stock_quantity:0,is_active:true}).select("id").single();
        if(res.error) throw res.error;
        saved=res.data;
        const opening=Number(fd.get("opening_stock")||0);
        if(opening>0){
          const adj=await supabase.rpc("adjust_inventory_stock",{p_product_id:saved.id,p_quantity_delta:opening,p_reason:"opening",p_notes:"Opening stock"});
          if(adj.error) throw adj.error;
        }
      }
      closeModal(); toast(product?"Product updated.":"Product added.","success"); await pageInventory(root);
    }catch(error){
      toast(friendlyError(error),"error"); button.disabled=false; button.textContent=product?"Save changes":"Add product";
    }
  });
}

function openStockModal(root, product) {
  showModal(`
    <h2>Adjust stock</h2>
    <p><strong>${esc(product.name)}</strong> · Current stock: ${number(product.stock_quantity)} ${esc(product.unit||"pc")}</p>
    <form id="stock-form" class="form">
      <div class="field"><label>Quantity change</label><input class="input" type="number" step="0.01" name="delta" required placeholder="Use +10 to add or -2 to deduct"></div>
      <div class="field"><label>Reason</label><select class="input" name="reason"><option value="adjustment">Manual adjustment</option><option value="opening">Opening stock</option><option value="return">Customer/Supplier return</option><option value="damage">Damaged stock</option><option value="theft">Lost/Theft</option></select></div>
      <div class="field"><label>Notes</label><textarea class="input" name="notes" placeholder="Why is stock being adjusted?"></textarea></div>
      <div class="modal-actions"><button type="button" id="close-stock" class="btn btn-secondary">Cancel</button><button type="submit" class="btn btn-primary">Apply adjustment</button></div>
    </form>`);
  document.querySelector("#close-stock")?.addEventListener("click",closeModal);
  document.querySelector("#stock-form")?.addEventListener("submit",async event=>{
    event.preventDefault();
    const fd=new FormData(event.currentTarget);
    const delta=Number(fd.get("delta")||0);
    if(!delta) return toast("Enter a non-zero stock adjustment.","error");
    const {error}=await supabase.rpc("adjust_inventory_stock",{
      p_product_id:product.id,
      p_quantity_delta:delta,
      p_reason:String(fd.get("reason")||"adjustment"),
      p_notes:String(fd.get("notes")||"").trim()||null
    });
    if(error) return toast(friendlyError(error),"error");
    closeModal(); toast("Stock adjusted and movement recorded.","success"); await pageInventory(root);
  });
}


async function pageCustomers(root) {
  const { data, error } = await supabase.from("customers")
    .select("id,name,phone,email,address,loyalty_points,store_credit_balance,created_at")
    .eq("shop_id",state.shop.id).order("name").limit(300);
  if (error) throw error;
  const customers=data||[];
  root.innerHTML = `
    ${head("Customers","Customer directory, rewards, store credit and secure customer portal")}
    <div class="table-wrap"><table><thead><tr><th>Name</th><th>Phone</th><th>Loyalty</th><th>Store credit</th><th>Since</th><th>Manage</th></tr></thead><tbody>
      ${customers.map(c=>`<tr>
        <td><strong>${esc(c.name)}</strong><div class="help">${esc(c.email||c.address||"No extra contact info")}</div></td>
        <td>${esc(c.phone||"—")}</td>
        <td><strong>${number(c.loyalty_points||0)}</strong> pts</td>
        <td><strong>${money(c.store_credit_balance||0)}</strong></td>
        <td>${niceDate(c.created_at)}</td>
        <td><button class="btn btn-secondary btn-sm customer-tools" data-id="${c.id}">Customer tools</button></td>
      </tr>`).join("") || '<tr><td colspan="6">No customers yet.</td></tr>'}
    </tbody></table></div>`;

  root.querySelectorAll(".customer-tools").forEach(btn=>{
    const customer=customers.find(x=>x.id===btn.dataset.id);
    btn.addEventListener("click",()=>openCustomerTools(root,customer));
  });
}

function openCustomerTools(root, customer) {
  showModal(`
    <h2>${esc(customer.name)}</h2>
    <p>Manage loyalty, store credit, and secure portal access.</p>
    <div class="grid-2" style="margin-bottom:14px">
      <div class="card"><div class="metric-label">Loyalty points</div><div class="metric-value">${number(customer.loyalty_points||0)}</div></div>
      <div class="card"><div class="metric-label">Store credit</div><div class="metric-value">${money(customer.store_credit_balance||0)}</div></div>
    </div>
    <form id="rewards-form" class="form">
      <div class="grid-2">
        <div class="field"><label>Points adjustment</label><input class="input" type="number" name="points" value="0"></div>
        <div class="field"><label>Store credit adjustment</label><input class="input" type="number" step="0.01" name="credit" value="0"></div>
      </div>
      <div class="field"><label>Reason</label><input class="input" name="reason" value="Manual customer adjustment" required></div>
      <div class="modal-actions"><button type="submit" class="btn btn-secondary">Apply balance changes</button></div>
    </form>
    <div style="height:12px"></div>
    <div class="card">
      <div class="card-title"><h3>Customer Portal</h3><span>Secure expiring link</span></div>
      <div class="help">Generate a private 30-day link where the customer can view purchases, warranty coverage, loyalty and store credit.</div>
      <div class="modal-actions"><button id="generate-portal-link" class="btn btn-primary">Generate & copy portal link</button></div>
      <div id="portal-link-result"></div>
    </div>
    <div class="modal-actions"><button id="close-customer-tools" class="btn btn-secondary">Done</button></div>
  `);

  document.querySelector("#close-customer-tools")?.addEventListener("click",closeModal);

  document.querySelector("#rewards-form")?.addEventListener("submit",async e=>{
    e.preventDefault();
    const fd=new FormData(e.currentTarget);
    const points=Number(fd.get("points")||0);
    const credit=Number(fd.get("credit")||0);
    const reason=String(fd.get("reason")||"Manual adjustment").trim();

    if(points!==0){
      const r=await supabase.rpc("adjust_loyalty_points",{p_customer_id:customer.id,p_points:Math.trunc(points),p_reason:reason});
      if(r.error) return toast(friendlyError(r.error),"error");
    }
    if(credit!==0){
      const r=await supabase.rpc("adjust_store_credit",{p_customer_id:customer.id,p_amount:credit,p_reason:reason});
      if(r.error) return toast(friendlyError(r.error),"error");
    }
    toast("Customer balances updated.","success");
    closeModal();
    await pageCustomers(root);
  });

  document.querySelector("#generate-portal-link")?.addEventListener("click",async()=>{
    const r=await supabase.rpc("create_customer_portal_token",{p_customer_id:customer.id,p_days:30});
    if(r.error) return toast(friendlyError(r.error),"error");
    const token=String(r.data||"").replace(/^"|"$/g,"");
    const url=location.origin+location.pathname+"#/portal?token="+encodeURIComponent(token);
    try{ await navigator.clipboard.writeText(url); }catch(_){}
    const box=document.querySelector("#portal-link-result");
    if(box) box.innerHTML='<div class="key-box" style="margin-top:12px">'+esc(url)+'</div>';
    toast("Customer portal link generated and copied.","success");
  });
}

async function pageStaff(root) {
  const canManage = ["owner","admin"].includes(state.membership.role);
  const { data, error } = await supabase.from("shop_members")
    .select("id,user_id,role,is_active,joined_at,profile:user_profiles(display_name)")
    .eq("shop_id",state.shop.id).order("joined_at");
  if (error) throw error;

  root.innerHTML = `
    ${head(
      "Staff",
      "Role-based access for the people working in your shop",
      canManage ? '<button id="add-staff" class="btn btn-primary">Add staff account</button>' : ""
    )}
    <div class="card" style="margin-bottom:14px">
      <div class="help">Each staff member signs in with their own StorePOS account. Their Android screens are limited by the role assigned here.</div>
    </div>
    <div class="table-wrap"><table><thead><tr><th>Staff</th><th>Role</th><th>Status</th><th>Joined</th></tr></thead><tbody>
      ${(data||[]).map(m=>`<tr><td><strong>${esc(m.profile?.display_name || "StorePOS user")}</strong><div class="help">${esc(m.user_id.slice(0,8))}…</div></td><td>${pill(m.role)}</td><td>${pill(m.is_active?"active":"inactive")}</td><td>${niceDate(m.joined_at)}</td></tr>`).join("") || '<tr><td colspan="4">No staff memberships found.</td></tr>'}
    </tbody></table></div>`;

  document.querySelector("#add-staff")?.addEventListener("click", () => openStaffModal(root));
}

function openStaffModal(root) {
  showModal(`
    <h2>Create staff account</h2>
    <p>The staff member can immediately sign in to the StorePOS Android app using the email and temporary password you set here.</p>
    <form id="staff-form" class="form">
      <div class="field"><label>Full name</label><input class="input" name="display_name" required placeholder="Juan Dela Cruz"></div>
      <div class="field"><label>Email address</label><input class="input" type="email" name="email" required placeholder="cashier@example.com"></div>
      <div class="field"><label>Temporary password</label><input class="input" type="password" name="password" minlength="8" required placeholder="At least 8 characters"></div>
      <div class="field">
        <label>Role</label>
        <select class="input" name="role">
          <option value="cashier">Cashier</option>
          <option value="mechanic">Mechanic</option>
          <option value="inventory">Inventory Staff</option>
          <option value="manager">Manager</option>
          <option value="admin">Shop Admin</option>
        </select>
      </div>
      <div class="help">The shop's StorePOS license controls the maximum number of active staff accounts.</div>
      <div class="modal-actions">
        <button type="button" id="close-staff" class="btn btn-secondary">Cancel</button>
        <button type="submit" class="btn btn-primary">Create staff</button>
      </div>
    </form>`);

  document.querySelector("#close-staff")?.addEventListener("click", closeModal);
  document.querySelector("#staff-form")?.addEventListener("submit", event => createStaff(event, root));
}

async function createStaff(event, root) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = "Creating…";

  const { data, error } = await supabase.functions.invoke("invite-staff", {
    body: {
      shop_id: state.shop.id,
      display_name: String(form.get("display_name") || "").trim(),
      email: String(form.get("email") || "").trim(),
      password: String(form.get("password") || ""),
      role: String(form.get("role") || "cashier")
    }
  });

  if (error || data?.error) {
    const details = error ? await functionErrorDetails(error) : null;
    const message =
      data?.error ||
      details?.error ||
      details?.message ||
      details?.msg ||
      error;
    toast(friendlyError(message), "error");
    button.disabled = false;
    button.textContent = "Create staff";
    return;
  }

  closeModal();
  toast(`${data.display_name || "Staff account"} created as ${data.role}.`, "success");
  await pageStaff(root);
}

async function pageService(root) {
  const { data, error } = await supabase.from("job_orders")
    .select("id,job_number,status,priority,complaint,diagnosis,odometer_in,created_at")
    .eq("shop_id",state.shop.id).order("created_at",{ascending:false}).limit(150);
  if (error) throw error;
  root.innerHTML = `
    ${head("Service Jobs","Workshop queue and retail service progress")}
    <div class="table-wrap"><table><thead><tr><th>Job</th><th>Status</th><th>Priority</th><th>Complaint</th><th>Odometer</th><th>Created</th></tr></thead><tbody>
      ${(data||[]).map(j=>`<tr><td><strong>${esc(j.job_number)}</strong></td><td>${pill(j.status)}</td><td>${pill(j.priority)}</td><td>${esc(j.complaint||"—")}</td><td>${j.odometer_in?number(j.odometer_in)+" km":"—"}</td><td>${niceDate(j.created_at,true)}</td></tr>`).join("") || '<tr><td colspan="6">No job orders yet.</td></tr>'}
    </tbody></table></div>`;
}


async function pageQuotes(root) {
  const [quoteRes,customerRes,bikeRes,productRes] = await Promise.all([
    supabase.from("quotations").select("id,quote_number,customer_id,retail_id,status,subtotal,discount_amount,total_amount,valid_until,notes,created_at").eq("shop_id",state.shop.id).order("created_at",{ascending:false}).limit(100),
    supabase.from("customers").select("id,name").eq("shop_id",state.shop.id).eq("is_active",true).order("name"),
    supabase.from("retails").select("id,customer_id,make,model,plate_number").eq("shop_id",state.shop.id),
    supabase.from("products").select("id,name,sku,selling_price,is_active").eq("shop_id",state.shop.id).eq("is_active",true).order("name")
  ]);
  for(const r of [quoteRes,customerRes,bikeRes,productRes]) if(r.error) throw r.error;
  const quotes=quoteRes.data||[];
  const customers=customerRes.data||[];
  const bikes=bikeRes.data||[];
  const products=productRes.data||[];

  root.innerHTML=`
    ${head("Quotations","Create estimates for parts and service, then convert approved work into job orders",'<button id="new-quote" class="btn btn-primary">New quotation</button>')}
    <div class="table-wrap"><table><thead><tr><th>Quote</th><th>Customer</th><th>Retail</th><th>Status</th><th>Valid until</th><th>Total</th><th>Manage</th></tr></thead><tbody>
      ${quotes.map(q=>{
        const customer=customers.find(c=>c.id===q.customer_id);
        const bike=bikes.find(b=>b.id===q.retail_id);
        return `<tr><td><strong>${esc(q.quote_number)}</strong><div class="help">${niceDate(q.created_at,true)}</div></td><td>${esc(customer?.name||"Walk-in")}</td><td>${bike?esc(bike.make+" "+bike.model+(bike.plate_number?" • "+bike.plate_number:"")):"—"}</td><td>${pill(q.status)}</td><td>${esc(q.valid_until||"—")}</td><td><strong>${money(q.total_amount)}</strong></td><td>${q.status!=="converted"&&q.customer_id&&q.retail_id?'<button class="btn btn-secondary btn-sm convert-quote" data-id="'+q.id+'">Convert to Job</button>':""}</td></tr>`;
      }).join("")||'<tr><td colspan="7">No quotations yet.</td></tr>'}
    </tbody></table></div>`;

  document.querySelector("#new-quote")?.addEventListener("click",()=>{
    showModal(`
      <h2>New quotation</h2>
      <p>Create a quick parts estimate. Service/labor lines can also be entered manually.</p>
      <form id="quote-form" class="form">
        <div class="grid-2">
          <div class="field"><label>Customer</label><select class="input" name="customer"><option value="">Walk-in / none</option>${customers.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>').join("")}</select></div>
          <div class="field"><label>Retail</label><select class="input" name="bike"><option value="">None</option>${bikes.map(b=>'<option value="'+esc(b.id)+'" data-customer="'+esc(b.customer_id)+'">'+esc(b.make+" "+b.model+(b.plate_number?" • "+b.plate_number:""))+'</option>').join("")}</select></div>
        </div>
        <div class="field"><label>Inventory part</label><select class="input" name="product"><option value="">Manual line</option>${products.map(p=>'<option value="'+esc(p.id)+'" data-name="'+esc(p.name)+'" data-price="'+Number(p.selling_price||0)+'">'+esc(p.name)+' · '+esc(p.sku)+'</option>').join("")}</select></div>
        <div class="grid-2"><div class="field"><label>Description</label><input class="input" name="description" placeholder="Part / service / labor" required></div><div class="field"><label>Line type</label><select class="input" name="type"><option value="part">Part</option><option value="service">Service</option><option value="labor">Labor</option><option value="other">Other</option></select></div></div>
        <div class="grid-2"><div class="field"><label>Quantity</label><input class="input" type="number" name="qty" min="0.01" step="0.01" value="1" required></div><div class="field"><label>Unit price</label><input class="input" type="number" name="price" min="0" step="0.01" value="0" required></div></div>
        <div class="grid-2"><div class="field"><label>Discount</label><input class="input" type="number" name="discount" min="0" step="0.01" value="0"></div><div class="field"><label>Valid until</label><input class="input" type="date" name="valid_until"></div></div>
        <div class="field"><label>Notes</label><textarea class="input" name="notes"></textarea></div>
        <div class="help">This quick form creates one quote line. The Android app supports building multi-line quotations.</div>
        <div class="modal-actions"><button type="button" id="close-quote" class="btn btn-secondary">Cancel</button><button type="submit" class="btn btn-primary">Create quotation</button></div>
      </form>`);

    const form=document.querySelector("#quote-form");
    const productSelect=form?.querySelector('[name="product"]');
    productSelect?.addEventListener("change",()=>{
      const opt=productSelect.selectedOptions[0];
      if(!opt?.value) return;
      form.querySelector('[name="description"]').value=opt.dataset.name||"";
      form.querySelector('[name="price"]').value=opt.dataset.price||"0";
      form.querySelector('[name="type"]').value="part";
    });

    form?.querySelector('[name="customer"]')?.addEventListener("change",e=>{
      const customerId=e.target.value;
      const bikeSel=form.querySelector('[name="bike"]');
      [...bikeSel.options].forEach((opt,i)=>{ if(i>0) opt.hidden=Boolean(customerId)&&opt.dataset.customer!==customerId; });
      if(bikeSel.selectedOptions[0]?.hidden) bikeSel.value="";
    });

    document.querySelector("#close-quote")?.addEventListener("click",closeModal);
    form?.addEventListener("submit",async e=>{
      e.preventDefault(); const fd=new FormData(e.currentTarget);
      const productId=String(fd.get("product")||"")||null;
      const line={
        item_type:String(fd.get("type")||"other"),
        product_id:productId,
        description:String(fd.get("description")||"").trim(),
        quantity:Number(fd.get("qty")||1),
        unit_price:Number(fd.get("price")||0)
      };
      const r=await supabase.rpc("create_quotation_v2",{
        p_shop_id:state.shop.id,
        p_customer_id:String(fd.get("customer")||"")||null,
        p_retail_id:String(fd.get("bike")||"")||null,
        p_items:[line],
        p_discount_amount:Number(fd.get("discount")||0),
        p_valid_until:String(fd.get("valid_until")||"")||null,
        p_notes:String(fd.get("notes")||"").trim()||null
      });
      if(r.error) return toast(friendlyError(r.error),"error");
      closeModal(); toast("Quotation created.","success"); await pageQuotes(root);
    });
  });

  root.querySelectorAll(".convert-quote").forEach(btn=>btn.addEventListener("click",async()=>{
    if(!confirm("Convert this quotation into a job order?")) return;
    const r=await supabase.rpc("convert_quotation_to_job",{p_quotation_id:btn.dataset.id});
    if(r.error) return toast(friendlyError(r.error),"error");
    toast("Quotation converted to a job order.","success");
    await pageQuotes(root);
  }));
}

async function pageSuppliers(root) {
  const { data, error } = await supabase.from("suppliers")
    .select("id,name,contact_person,phone,email,address,is_active,created_at")
    .eq("shop_id",state.shop.id).order("name");
  if (error) throw error;
  root.innerHTML = `
    ${head("Suppliers","Parts suppliers and purchasing contacts")}
    <div class="table-wrap"><table><thead><tr><th>Supplier</th><th>Contact</th><th>Phone</th><th>Email</th><th>Status</th></tr></thead><tbody>
      ${(data||[]).map(s=>`<tr><td><strong>${esc(s.name)}</strong></td><td>${esc(s.contact_person||"—")}</td><td>${esc(s.phone||"—")}</td><td>${esc(s.email||"—")}</td><td>${pill(s.is_active?"active":"inactive")}</td></tr>`).join("") || '<tr><td colspan="5">No suppliers yet.</td></tr>'}
    </tbody></table></div>`;
}


async function pageOperations(root) {
  const shopId = state.shop.id;
  const managerRole = ["owner","admin","manager"].includes(state.membership.role);
  const [shiftRes,salesRes,appointmentRes,returnRes,warrantyRes,claimRes] = await Promise.all([
    supabase.from("cashier_shifts").select("id,user_id,started_at,ended_at,opening_cash,expected_cash,actual_cash,variance,status").eq("shop_id",shopId).order("started_at",{ascending:false}).limit(40),
    supabase.from("sales").select("id,sale_number,total_amount,status,created_at").eq("shop_id",shopId).order("created_at",{ascending:false}).limit(40),
    supabase.from("appointments").select("id,customer_name,phone,service_request,scheduled_at,status,source").eq("shop_id",shopId).order("scheduled_at",{ascending:true}).limit(50),
    supabase.from("sale_returns").select("id,return_number,total_amount,refund_method,reason,created_at").eq("shop_id",shopId).order("created_at",{ascending:false}).limit(20),
    supabase.from("warranties").select("id,description,warranty_type,status,starts_on,expires_on").eq("shop_id",shopId).order("starts_on",{ascending:false}).limit(50),
    supabase.from("warranty_claims").select("id,claim_number,issue,status,created_at").eq("shop_id",shopId).order("created_at",{ascending:false}).limit(30)
  ]);
  for(const r of [shiftRes,salesRes,appointmentRes,returnRes,warrantyRes,claimRes]) if(r.error) throw r.error;

  const shifts=shiftRes.data||[];
  const sales=(salesRes.data||[]).filter(s=>s.status==="completed");
  const appointments=appointmentRes.data||[];
  const returns=returnRes.data||[];
  const warranties=warrantyRes.data||[];
  const claims=claimRes.data||[];
  const openShift=shifts.find(s=>s.user_id===state.user.id && s.status==="open");
  const upcoming=appointments.filter(a=>!["completed","cancelled","no_show"].includes(a.status));

  root.innerHTML = `
    ${head("Operations","Cashier control, manager approvals, after-sales, bookings and warranty",
      '<div class="actions">'+
      (managerRole?'<button id="set-manager-pin" class="btn btn-secondary">Manager PIN</button>':'')+
      '<button id="new-appointment" class="btn btn-primary">New appointment</button></div>'
    )}
    <section class="metrics">
      <article class="metric"><div class="metric-label">Your shift</div><div class="metric-value">${openShift?"Open":"Closed"}</div><div class="metric-sub">${openShift?"Opening "+money(openShift.opening_cash):"Start a shift from the Android POS"}</div></article>
      <article class="metric"><div class="metric-label">Upcoming bookings</div><div class="metric-value">${number(upcoming.length)}</div><div class="metric-sub">Active appointment queue</div></article>
      <article class="metric"><div class="metric-label">Returns</div><div class="metric-value">${number(returns.length)}</div><div class="metric-sub">Recent refund records</div></article>
      <article class="metric"><div class="metric-label">Warranty claims</div><div class="metric-value">${number(claims.filter(x=>x.status!=="closed").length)}</div><div class="metric-sub">Open / active claims</div></article>
    </section>

    <section class="grid-2">
      <div class="card">
        <div class="card-title"><h3>Appointments</h3><span>Next 12</span></div>
        <div class="stat-list">
          ${upcoming.slice(0,12).map(a=>`<div class="stat-row"><span><strong>${esc(a.customer_name||"Customer")}</strong><br>${esc(a.service_request)} · ${niceDate(a.scheduled_at,true)}</span><strong>${pill(a.status)}</strong></div>`).join("")||'<div class="empty"><strong>No bookings</strong>New appointments will appear here.</div>'}
        </div>
      </div>
      <div class="card">
        <div class="card-title"><h3>Recent returns</h3><span>Protected by manager PIN</span></div>
        <div class="stat-list">
          ${returns.slice(0,10).map(r=>`<div class="stat-row"><span>${esc(r.return_number)} · ${esc(r.refund_method)}<br><small>${esc(r.reason)}</small></span><strong>${money(r.total_amount)}</strong></div>`).join("")||'<div class="empty"><strong>No returns</strong>Refund records will appear here.</div>'}
        </div>
      </div>
    </section>

    <div style="height:14px"></div>
    <section class="grid-2">
      <div class="card">
        <div class="card-title"><h3>Warranty coverage</h3><span>${warranties.length} record(s)</span></div>
        <div class="stat-list">
          ${warranties.slice(0,10).map(w=>`<div class="stat-row"><span>${esc(w.description)}<br><small>${esc(w.warranty_type)} · ${esc(w.expires_on||"No expiry")}</small></span><strong>${pill(w.status)}</strong></div>`).join("")||'<div class="empty"><strong>No warranties</strong>Warranty records will appear here.</div>'}
        </div>
      </div>
      <div class="card">
        <div class="card-title"><h3>Recent sales eligible for after-sales</h3><span>Use Android Operations for refund/void</span></div>
        <div class="stat-list">
          ${sales.slice(0,10).map(s=>`<div class="stat-row"><span>${esc(s.sale_number)} · ${niceDate(s.created_at,true)}</span><strong>${money(s.total_amount)}</strong></div>`).join("")||'<div class="empty"><strong>No completed sales</strong>Completed POS sales will appear here.</div>'}
        </div>
      </div>
    </section>`;

  document.querySelector("#set-manager-pin")?.addEventListener("click",()=>{
    showModal(`
      <h2>Set Manager Approval PIN</h2>
      <p>Use 4–8 digits. This PIN is required for void and refund approval.</p>
      <form id="manager-pin-form" class="form">
        <div class="field"><label>New PIN</label><input class="input" name="pin" inputmode="numeric" pattern="[0-9]{4,8}" minlength="4" maxlength="8" required></div>
        <div class="field"><label>Confirm PIN</label><input class="input" name="confirm" inputmode="numeric" pattern="[0-9]{4,8}" minlength="4" maxlength="8" required></div>
        <div class="modal-actions"><button type="button" id="close-manager-pin" class="btn btn-secondary">Cancel</button><button type="submit" class="btn btn-primary">Save PIN</button></div>
      </form>`);
    document.querySelector("#close-manager-pin")?.addEventListener("click",closeModal);
    document.querySelector("#manager-pin-form")?.addEventListener("submit",async e=>{
      e.preventDefault();
      const fd=new FormData(e.currentTarget); const pin=String(fd.get("pin")||""); const confirmPin=String(fd.get("confirm")||"");
      if(pin!==confirmPin) return toast("PIN confirmation does not match.","error");
      const {error}=await supabase.rpc("set_manager_pin",{p_shop_id:shopId,p_pin:pin});
      if(error) return toast(friendlyError(error),"error");
      closeModal(); toast("Manager PIN updated.","success");
    });
  });

  document.querySelector("#new-appointment")?.addEventListener("click",()=>{
    const tomorrow=new Date(Date.now()+86400000); const local=new Date(tomorrow.getTime()-tomorrow.getTimezoneOffset()*60000).toISOString().slice(0,16);
    showModal(`
      <h2>New appointment</h2>
      <form id="appointment-form" class="form">
        <div class="grid-2"><div class="field"><label>Customer name</label><input class="input" name="name" required></div><div class="field"><label>Phone</label><input class="input" name="phone"></div></div>
        <div class="field"><label>Service request</label><textarea class="input" name="service" required></textarea></div>
        <div class="field"><label>Date & time</label><input class="input" type="datetime-local" name="scheduled" value="${local}" required></div>
        <div class="field"><label>Notes</label><textarea class="input" name="notes"></textarea></div>
        <div class="modal-actions"><button type="button" id="close-appointment" class="btn btn-secondary">Cancel</button><button type="submit" class="btn btn-primary">Book appointment</button></div>
      </form>`);
    document.querySelector("#close-appointment")?.addEventListener("click",closeModal);
    document.querySelector("#appointment-form")?.addEventListener("submit",async e=>{
      e.preventDefault();
      const fd=new FormData(e.currentTarget); const dt=new Date(String(fd.get("scheduled")||""));
      const {error}=await supabase.from("appointments").insert({
        shop_id:shopId, customer_name:String(fd.get("name")||"").trim(), phone:String(fd.get("phone")||"").trim()||null,
        service_request:String(fd.get("service")||"").trim(), scheduled_at:dt.toISOString(), notes:String(fd.get("notes")||"").trim()||null,
        source:"staff",created_by:state.user.id
      });
      if(error) return toast(friendlyError(error),"error");
      closeModal(); toast("Appointment booked.","success"); await pageOperations(root);
    });
  });
}



async function pageBranches(root) {
  const [memberRes,groupRes,transferRes] = await Promise.all([
    supabase.from("shop_members")
      .select("shop_id,role,is_active,shop:shops(id,name,address,phone,app_code,business_type)")
      .eq("user_id",state.user.id).eq("is_active",true),
    supabase.from("shop_groups")
      .select("id,name,created_at,shops:shop_group_shops(shop_id,shop:shops(id,name,address))")
      .eq("owner_user_id",state.user.id).order("created_at",{ascending:false}),
    supabase.from("stock_transfers")
      .select("id,transfer_number,from_shop_id,to_shop_id,status,notes,created_at,shipped_at,received_at")
      .or("from_shop_id.eq."+state.shop.id+",to_shop_id.eq."+state.shop.id)
      .order("created_at",{ascending:false}).limit(50)
  ]);
  if(memberRes.error) throw memberRes.error;
  if(groupRes.error) throw groupRes.error;
  if(transferRes.error) throw transferRes.error;

  const memberships=(memberRes.data||[]).filter(m=>m.shop?.app_code==="storepos");
  const branches=memberships.map(m=>({...m.shop,role:m.role}));
  const groups=groupRes.data||[];
  const transfers=transferRes.data||[];
  const otherBranches=branches.filter(b=>b.id!==state.shop.id);
  const productsRes=await supabase.from("products").select("id,name,sku,stock_quantity,cost_price").eq("shop_id",state.shop.id).eq("is_active",true).order("name");
  if(productsRes.error) throw productsRes.error;
  const products=productsRes.data||[];

  root.innerHTML=`
    ${head("Branches & Stock Transfers","Centralized control for shops linked to your StorePOS account",
      '<div class="actions">'+
      (branches.length>1?'<button id="new-group" class="btn btn-secondary">Create branch group</button>':'')+
      (otherBranches.length?'<button id="new-transfer" class="btn btn-primary">New stock transfer</button>':'')+
      '</div>'
    )}
    <section class="metrics">
      <article class="metric"><div class="metric-label">Accessible branches</div><div class="metric-value">${number(branches.length)}</div><div class="metric-sub">Your active shop memberships</div></article>
      <article class="metric"><div class="metric-label">Branch groups</div><div class="metric-value">${number(groups.length)}</div><div class="metric-sub">Owner-managed groups</div></article>
      <article class="metric"><div class="metric-label">Open transfers</div><div class="metric-value">${number(transfers.filter(t=>!["received","cancelled"].includes(t.status)).length)}</div><div class="metric-sub">Inbound / outbound</div></article>
      <article class="metric"><div class="metric-label">Current branch</div><div class="metric-value" style="font-size:18px">${esc(state.shop.name)}</div><div class="metric-sub">Source for new transfers</div></article>
    </section>

    <section class="grid-2">
      <div class="card">
        <div class="card-title"><h3>Your branches</h3><span>${branches.length} accessible</span></div>
        <div class="stat-list">
          ${branches.map(b=>`<div class="stat-row"><span><strong>${esc(b.name)}</strong><br><small>${esc(b.address||"No address")}</small></span><strong>${pill(b.role)}</strong></div>`).join("")||'<div class="empty"><strong>No branches</strong>No shop memberships found.</div>'}
        </div>
      </div>
      <div class="card">
        <div class="card-title"><h3>Branch groups</h3><span>Centralized organization</span></div>
        <div class="stat-list">
          ${groups.map(g=>`<div class="stat-row"><span><strong>${esc(g.name)}</strong><br><small>${(g.shops||[]).map(x=>esc(x.shop?.name||"Branch")).join(" • ")}</small></span><strong>${number((g.shops||[]).length)} branch(es)</strong></div>`).join("")||'<div class="empty"><strong>No branch group yet</strong>Create one after your account has access to multiple shops.</div>'}
        </div>
      </div>
    </section>

    <div style="height:14px"></div>
    <div class="table-wrap"><table><thead><tr><th>Transfer</th><th>Direction</th><th>Status</th><th>Created</th><th>Manage</th></tr></thead><tbody>
      ${transfers.map(t=>{
        const from=branches.find(b=>b.id===t.from_shop_id)?.name||t.from_shop_id.slice(0,8);
        const to=branches.find(b=>b.id===t.to_shop_id)?.name||t.to_shop_id.slice(0,8);
        return `<tr><td><strong>${esc(t.transfer_number)}</strong><div class="help">${esc(t.notes||"")}</div></td><td>${esc(from)} → ${esc(to)}</td><td>${pill(t.status)}</td><td>${niceDate(t.created_at,true)}</td><td><div class="actions">${t.status==="requested"&&t.from_shop_id===state.shop.id?'<button class="btn btn-secondary btn-sm ship-transfer" data-id="'+t.id+'">Ship</button>':""}${t.status==="shipped"&&t.to_shop_id===state.shop.id?'<button class="btn btn-primary btn-sm receive-transfer" data-id="'+t.id+'">Receive</button>':""}</div></td></tr>`;
      }).join("")||'<tr><td colspan="5">No stock transfers yet.</td></tr>'}
    </tbody></table></div>`;

  document.querySelector("#new-group")?.addEventListener("click",()=>{
    showModal(`
      <h2>Create branch group</h2>
      <p>Groups make it easier to organize several shops under one owner account.</p>
      <form id="branch-group-form" class="form">
        <div class="field"><label>Group name</label><input class="input" name="name" required placeholder="StorePOS Main Group"></div>
        <div class="field"><label>Branches</label>
          ${branches.map(b=>'<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="shop" value="'+esc(b.id)+'" checked> '+esc(b.name)+'</label>').join("")}
        </div>
        <div class="modal-actions"><button type="button" id="close-group" class="btn btn-secondary">Cancel</button><button class="btn btn-primary" type="submit">Create group</button></div>
      </form>`);
    document.querySelector("#close-group")?.addEventListener("click",closeModal);
    document.querySelector("#branch-group-form")?.addEventListener("submit",async e=>{
      e.preventDefault(); const fd=new FormData(e.currentTarget); const ids=fd.getAll("shop").map(String);
      const r=await supabase.rpc("create_shop_group",{p_name:String(fd.get("name")||"").trim(),p_shop_ids:ids});
      if(r.error) return toast(friendlyError(r.error),"error");
      closeModal(); toast("Branch group created.","success"); await pageBranches(root);
    });
  });

  document.querySelector("#new-transfer")?.addEventListener("click",()=>{
    showModal(`
      <h2>New stock transfer</h2>
      <p>Move inventory from <strong>${esc(state.shop.name)}</strong> to another branch.</p>
      <form id="transfer-form" class="form">
        <div class="field"><label>Destination branch</label><select class="input" name="to_shop">${otherBranches.map(b=>'<option value="'+esc(b.id)+'">'+esc(b.name)+'</option>').join("")}</select></div>
        <div class="field"><label>Product</label><select class="input" name="product">${products.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+' · '+esc(p.sku)+' · stock '+number(p.stock_quantity)+'</option>').join("")}</select></div>
        <div class="field"><label>Quantity</label><input class="input" type="number" name="qty" min="0.01" step="0.01" value="1" required></div>
        <div class="field"><label>Notes</label><textarea class="input" name="notes"></textarea></div>
        <div class="help">Create one transfer per product from this quick form. Additional multi-line transfer editing can be added later without changing the backend.</div>
        <div class="modal-actions"><button type="button" id="close-transfer" class="btn btn-secondary">Cancel</button><button class="btn btn-primary" type="submit">Create transfer</button></div>
      </form>`);
    document.querySelector("#close-transfer")?.addEventListener("click",closeModal);
    document.querySelector("#transfer-form")?.addEventListener("submit",async e=>{
      e.preventDefault(); const fd=new FormData(e.currentTarget);
      const r=await supabase.rpc("create_stock_transfer",{
        p_from_shop_id:state.shop.id,
        p_to_shop_id:String(fd.get("to_shop")),
        p_items:[{from_product_id:String(fd.get("product")),quantity:Number(fd.get("qty")||0)}],
        p_notes:String(fd.get("notes")||"").trim()||null
      });
      if(r.error) return toast(friendlyError(r.error),"error");
      closeModal(); toast("Stock transfer created.","success"); await pageBranches(root);
    });
  });

  root.querySelectorAll(".ship-transfer").forEach(btn=>btn.addEventListener("click",async()=>{
    if(!confirm("Deduct source stock and mark this transfer shipped?")) return;
    const r=await supabase.rpc("ship_stock_transfer",{p_transfer_id:btn.dataset.id});
    if(r.error) return toast(friendlyError(r.error),"error");
    toast("Transfer shipped.","success"); await pageBranches(root);
  }));
  root.querySelectorAll(".receive-transfer").forEach(btn=>btn.addEventListener("click",async()=>{
    if(!confirm("Receive this transfer and add stock to the destination branch?")) return;
    const r=await supabase.rpc("receive_stock_transfer",{p_transfer_id:btn.dataset.id});
    if(r.error) return toast(friendlyError(r.error),"error");
    toast("Transfer received and inventory updated.","success"); await pageBranches(root);
  }));
}

async function pageReports(root) {
  const [analyticsRes,salesRes] = await Promise.all([
    supabase.rpc("analytics_summary",{p_shop_id:state.shop.id,p_days:30}),
    supabase.from("sales").select("sale_number,total_amount,status,created_at").eq("shop_id",state.shop.id).order("created_at",{ascending:false}).limit(30)
  ]);
  if(analyticsRes.error) throw analyticsRes.error;
  if(salesRes.error) throw salesRes.error;
  const a=analyticsRes.data||{};
  const revenue=Number(a.revenue||0);
  const profit=Number(a.gross_profit||0);
  const expenses=Number(a.expenses||0);
  const transactions=Number(a.transactions||0);
  const topProducts=Array.isArray(a.top_products)?a.top_products:[];

  root.innerHTML = `
    ${head("Reports","Advanced 30-day business analytics")}
    <section class="metrics">
      <article class="metric"><div class="metric-label">Revenue</div><div class="metric-value">${money(revenue)}</div><div class="metric-sub">Last 30 days</div></article>
      <article class="metric"><div class="metric-label">Gross profit</div><div class="metric-value">${money(profit)}</div><div class="metric-sub">Sales price minus item cost</div></article>
      <article class="metric"><div class="metric-label">Operating net</div><div class="metric-value">${money(revenue-expenses)}</div><div class="metric-sub">Revenue minus recorded expenses</div></article>
      <article class="metric"><div class="metric-label">Average ticket</div><div class="metric-value">${money(a.avg_ticket||0)}</div><div class="metric-sub">${number(transactions)} completed sale(s)</div></article>
    </section>
    <section class="grid-2">
      <div class="card">
        <div class="card-title"><h3>Top products</h3><span>By units sold</span></div>
        <div class="stat-list">
          ${topProducts.map((p,i)=>`<div class="stat-row"><span>#${i+1} · ${esc(p.name)}</span><strong>${number(p.qty)} units · ${money(p.sales)}</strong></div>`).join("")||'<div class="empty"><strong>No product sales yet</strong>Top sellers will appear after completed transactions.</div>'}
        </div>
      </div>
      <div class="card">
        <div class="card-title"><h3>Recent completed sales</h3><span>Cloud POS</span></div>
        <div class="stat-list">
          ${(salesRes.data||[]).filter(s=>s.status==="completed").slice(0,10).map(s=>`<div class="stat-row"><span>${esc(s.sale_number)} · ${niceDate(s.created_at,true)}</span><strong>${money(s.total_amount)}</strong></div>`).join("")||'<div class="empty"><strong>No completed sales</strong>Transactions will appear here.</div>'}
        </div>
      </div>
    </section>`;
}


async function pageSupport(root) {
  const { data: threads, error } = await supabase.from("support_threads")
    .select("id,subject,status,priority,last_message_at,created_at,ai_enabled,ai_handoff,ai_last_reply_at")
    .eq("shop_id",state.shop.id)
    .order("last_message_at",{ascending:false});
  if(error) throw error;
  const list=threads||[];
  if(!state.supportThreadId || !list.some(t=>t.id===state.supportThreadId)) state.supportThreadId=list[0]?.id||null;

  root.innerHTML=`
    ${head("Support Chat","StorePOS Auto Support guides common fixes instantly, with human handoff when needed",'<button id="new-support" class="btn btn-primary">New conversation</button>')}
    <div class="ai-support-note"><strong>StorePOS Auto Support</strong><span>API-free guided troubleshooting for common StorePOS problems. Billing, custom licensing, account/security and developer issues are handed to human support.</span></div>
    <div class="chat-layout">
      <div class="chat-list">
        ${list.map(t=>`<button class="chat-thread ${t.id===state.supportThreadId?"active":""}" data-thread="${t.id}"><strong>${esc(t.subject)}</strong><span>${esc(t.status)} · ${t.ai_handoff?"human handoff":t.ai_enabled?"Auto Support active":"Auto Support paused"} · ${niceDate(t.last_message_at,true)}</span></button>`).join("")||'<div class="empty"><strong>No conversations</strong>Start a support chat whenever you need help.</div>'}
      </div>
      <div id="support-chat-panel" class="chat-panel"></div>
    </div>`;

  document.querySelector("#new-support")?.addEventListener("click",()=>openNewSupportThread(root));
  root.querySelectorAll(".chat-thread").forEach(btn=>btn.addEventListener("click",async()=>{
    state.supportThreadId=btn.dataset.thread;
    await pageSupport(root);
  }));
  await renderSupportChatPanel(document.querySelector("#support-chat-panel"),state.supportThreadId,false);
}

async function invokeAutoSupport(threadId) {
  const {data,error}=await supabase.functions.invoke("support-auto-reply",{body:{thread_id:threadId}});
  if(error){
    const details=await functionErrorDetails(error);
    const message=String(details?.message||details?.error||error?.message||"");
    console.warn("StorePOS Auto Support:",message);
    toast("Message sent. Auto Support could not answer this time; human support can still reply.","");
    return null;
  }
  return data||null;
}

function openNewSupportThread(root) {
  showModal(`
    <h2>New support conversation</h2>
    <p>StorePOS Auto Support will try guided troubleshooting first. Sensitive or account-level requests are automatically handed to human support.</p>
    <form id="new-support-form" class="form">
      <div class="field"><label>Subject</label><input class="input" name="subject" minlength="3" maxlength="160" required placeholder="Example: Printer not connecting"></div>
      <div class="field"><label>Priority</label><select class="input" name="priority"><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option><option value="low">Low</option></select></div>
      <div class="field"><label>Message</label><textarea class="input" name="message" minlength="1" maxlength="4000" required placeholder="Tell us what happened…"></textarea></div>
      <div class="modal-actions"><button type="button" id="close-support-new" class="btn btn-secondary">Cancel</button><button type="submit" class="btn btn-primary">Start chat</button></div>
    </form>`);
  document.querySelector("#close-support-new")?.addEventListener("click",closeModal);
  document.querySelector("#new-support-form")?.addEventListener("submit",async event=>{
    event.preventDefault();
    const fd=new FormData(event.currentTarget);
    const {data:thread,error}=await supabase.from("support_threads").insert({
      shop_id:state.shop.id,
      created_by:state.user.id,
      subject:String(fd.get("subject")||"").trim(),
      priority:String(fd.get("priority")||"normal"),
      status:"open",
      ai_enabled:true,
      ai_handoff:false
    }).select("id").single();
    if(error) return toast(friendlyError(error),"error");
    const msg=await supabase.from("support_messages").insert({
      thread_id:thread.id,
      shop_id:state.shop.id,
      sender_id:state.user.id,
      sender_type:"customer",
      body:String(fd.get("message")||"").trim()
    });
    if(msg.error) return toast(friendlyError(msg.error),"error");
    state.supportThreadId=thread.id;
    closeModal();
    toast("Support conversation started.","success");
    const ai=await invokeAutoSupport(thread.id);
    if(ai?.handoff) toast("StorePOS Auto Support handed this conversation to human support.","");
    await pageSupport(root);
  });
}

async function renderSupportChatPanel(panel, threadId, adminMode) {
  if(state.supportChannel){
    await supabase.removeChannel(state.supportChannel);
    state.supportChannel=null;
  }
  if(!panel) return;
  if(!threadId){
    panel.innerHTML='<div class="empty" style="margin:auto"><strong>Select a conversation</strong>Messages will appear here.</div>';
    return;
  }

  const [threadRes,messageRes]=await Promise.all([
    supabase.from("support_threads").select("id,shop_id,subject,status,priority,last_message_at,ai_enabled,ai_handoff,ai_last_reply_at,shop:shops(name)").eq("id",threadId).single(),
    supabase.from("support_messages").select("id,body,sender_type,created_at,sender_id,ai_model").eq("thread_id",threadId).order("created_at")
  ]);
  if(threadRes.error){panel.innerHTML=`<div class="empty"><strong>Unable to load chat</strong>${esc(friendlyError(threadRes.error))}</div>`;return;}
  if(messageRes.error){panel.innerHTML=`<div class="empty"><strong>Unable to load messages</strong>${esc(friendlyError(messageRes.error))}</div>`;return;}
  const t=threadRes.data;
  const messages=messageRes.data||[];
  const aiState=t.ai_handoff?"Human handoff":t.ai_enabled?"Auto Support active":"Auto Support paused";

  panel.innerHTML=`
    <div class="chat-head">
      <div><strong>${esc(t.subject)}</strong><div class="help">${adminMode?esc(t.shop?.name||"Shop")+" · ":""}${esc(t.priority)} priority · ${esc(t.status)} · ${esc(aiState)}</div></div>
      <div class="chat-head-actions">
        ${adminMode?`<button id="support-ai-toggle" class="btn btn-secondary btn-sm">${t.ai_enabled&&!t.ai_handoff?"Pause Auto Support":"Resume Auto Support"}</button><select id="support-status" class="input" style="width:auto;height:38px"><option value="open" ${t.status==="open"?"selected":""}>Open</option><option value="pending" ${t.status==="pending"?"selected":""}>Pending</option><option value="closed" ${t.status==="closed"?"selected":""}>Closed</option></select>`:pill(t.ai_handoff?"human handoff":t.status)}
      </div>
    </div>
    <div class="chat-messages" id="support-message-list">
      ${messages.map(m=>{
        const isAi=m.sender_type==="ai";
        const mine=adminMode?m.sender_type==="support":m.sender_type==="customer";
        const label=isAi?"StorePOS Auto Support":m.sender_type==="support"?"StorePOS Support":adminMode?"Customer":"You";
        return `<div class="chat-bubble ${mine?"support":isAi?"ai":""}"><p>${esc(m.body)}</p><small>${esc(label)} · ${niceDate(m.created_at,true)}</small></div>`;
      }).join("")||'<div class="empty"><strong>No messages yet</strong>Send the first message below.</div>'}
    </div>
    <form id="support-compose" class="chat-compose">
      <input class="input" name="message" maxlength="4000" autocomplete="off" placeholder="${t.status==="closed"&&!adminMode?"Conversation closed":"Type a message…"}" ${t.status==="closed"&&!adminMode?"disabled":""}>
      <button class="btn btn-primary" type="submit" ${t.status==="closed"&&!adminMode?"disabled":""}>Send</button>
    </form>`;

  const list=panel.querySelector("#support-message-list");
  if(list) list.scrollTop=list.scrollHeight;

  panel.querySelector("#support-status")?.addEventListener("change",async e=>{
    const {error}=await supabase.from("support_threads").update({status:e.target.value,updated_at:new Date().toISOString()}).eq("id",threadId);
    if(error) return toast(friendlyError(error),"error");
    toast("Support status updated.","success");
  });

  panel.querySelector("#support-ai-toggle")?.addEventListener("click",async()=>{
    const resume=!t.ai_enabled||t.ai_handoff;
    const patch=resume
      ? {ai_enabled:true,ai_handoff:false,status:t.status==="closed"?"open":t.status,updated_at:new Date().toISOString()}
      : {ai_enabled:false,updated_at:new Date().toISOString()};
    const {error}=await supabase.from("support_threads").update(patch).eq("id",threadId);
    if(error) return toast(friendlyError(error),"error");
    toast(resume?"Auto Support resumed.":"Auto Support paused.","success");
    await renderSupportChatPanel(panel,threadId,adminMode);
  });

  panel.querySelector("#support-compose")?.addEventListener("submit",async event=>{
    event.preventDefault();
    const fd=new FormData(event.currentTarget);
    const body=String(fd.get("message")||"").trim();
    if(!body) return;
    const {error}=await supabase.from("support_messages").insert({
      thread_id:threadId,
      shop_id:t.shop_id,
      sender_id:state.user.id,
      sender_type:adminMode?"support":"customer",
      body
    });
    if(error) return toast(friendlyError(error),"error");
    event.currentTarget.reset();

    if(adminMode){
      await supabase.from("support_threads").update({ai_handoff:true,updated_at:new Date().toISOString()}).eq("id",threadId);
    }else if(t.ai_enabled&&!t.ai_handoff){
      const ai=await invokeAutoSupport(threadId);
      if(ai?.handoff) toast("StorePOS Auto Support handed this conversation to human support.","");
    }
    await renderSupportChatPanel(panel,threadId,adminMode);
  });

  state.supportChannel=supabase.channel(`support-${threadId}-${Date.now()}`)
    .on("postgres_changes",{event:"INSERT",schema:"public",table:"support_messages",filter:`thread_id=eq.${threadId}`},async()=> {
      if(document.body.contains(panel)) await renderSupportChatPanel(panel,threadId,adminMode);
    })
    .subscribe();
}



async function pageLicense(root) {
  const canManageLicense = ["owner","admin","manager"].includes(state.membership?.role);
  const [licenseRes, deviceRes, memberRes, historyRes, ordersRes, paymentsRes] = await Promise.all([
    supabase.from("shop_licenses")
      .select("id,plan_code,status,license_key_last4,starts_at,expires_at,max_devices,max_staff,offline_grace_days,billing_cycle,price_snapshot_php,feature_overrides,custom_label")
      .eq("shop_id",state.shop.id).maybeSingle(),
    supabase.from("device_sessions")
      .select("id,device_id,device_name,app_version,last_seen_at,is_active")
      .eq("shop_id",state.shop.id).order("last_seen_at",{ascending:false}),
    supabase.from("shop_members").select("id").eq("shop_id",state.shop.id).eq("is_active",true),
    canManageLicense
      ? supabase.from("license_events")
          .select("id,event_type,plan_code,billing_cycle,amount_php,starts_at,expires_at,max_devices,max_staff,details,created_at")
          .eq("shop_id",state.shop.id).order("created_at",{ascending:false}).limit(8)
      : Promise.resolve({data:[],error:null}),
    canManageLicense
      ? supabase.from("license_order_requests")
          .select("id,status,requested_plan,billing_cycle,desired_devices,desired_staff,desired_features,budget_php,notes,quoted_price_php,sunmi_v2_quantity,hardware_quote_php,admin_notes,created_at,updated_at")
          .eq("shop_id",state.shop.id).order("created_at",{ascending:false}).limit(8)
      : Promise.resolve({data:[],error:null}),
    canManageLicense
      ? supabase.from("license_payment_submissions")
          .select("id,order_request_id,amount_php,payment_method,reference_number,status,notes,admin_notes,created_at,updated_at")
          .eq("shop_id",state.shop.id).order("created_at",{ascending:false}).limit(8)
      : Promise.resolve({data:[],error:null})
  ]);
  for(const r of [licenseRes,deviceRes,memberRes,historyRes,ordersRes,paymentsRes]) if(r?.error) throw r.error;

  const license = licenseRes.data;
  const ent = state.entitlements || {};
  const devices = (deviceRes.data||[]).filter(d=>d.is_active);
  const staffCount = memberRes.data?.length || 0;
  const history = historyRes.data || [];
  const orders = ordersRes.data || [];
  const payments = paymentsRes.data || [];
  const features = entitlementFeatures();
  const trial = license?.status === "trial" ? trialRemaining(license.expires_at) : null;
  const effectiveStatus = ent.status || (
    license?.status === "trial" && trial?.days === 0 ? "expired" : license?.status
  );
  const cycleLabel = license?.billing_cycle
    ? license.billing_cycle.charAt(0).toUpperCase() + license.billing_cycle.slice(1)
    : "Custom";
  const billing = license?.status === "trial"
    ? "Free 7-day Pro Trial"
    : `${cycleLabel}${license?.price_snapshot_php != null ? ` · ${peso(license.price_snapshot_php)}` : ""}`;

  root.innerHTML = `
    ${head("License","StorePOS plan, entitlements, billing and custom-order requests",canManageLicense?'<div class="actions"><button id="submit-license-payment" class="btn btn-secondary">Submit payment</button><button id="request-custom-license" class="btn btn-primary">Request custom plan</button></div>':"")}
    ${license ? `
      ${license.status === "trial" ? `
        <div class="card" style="margin-bottom:14px;border-color:rgba(59,130,246,.28)">
          <div class="card-title"><h3>7-day Pro Trial</h3>${pill(effectiveStatus)}</div>
          <div class="help">
            ${trial?.days > 0
              ? `Your full StorePOS Pro trial is active. <strong style="color:var(--text)">${esc(trial.label)}</strong>. No license key is required during the trial.`
              : "Your StorePOS trial has expired. Choose a paid plan or request a custom build."}
          </div>
        </div>
      ` : ""}
      <section class="metrics">
        <article class="metric"><div class="metric-label">Plan</div><div class="metric-value" style="text-transform:capitalize">${esc(ent.plan_name || license.custom_label || license.plan_code || "—")}</div><div class="metric-sub">${esc(billing)}</div></article>
        <article class="metric"><div class="metric-label">Status</div><div class="metric-value" style="text-transform:capitalize">${esc(effectiveStatus || "unknown")}</div><div class="metric-sub">${license.expires_at ? `Expires · ${niceDate(license.expires_at)}` : "No expiration set"}</div></article>
        <article class="metric"><div class="metric-label">Devices</div><div class="metric-value">${devices.length}/${license.max_devices}</div><div class="metric-sub">Active registered devices</div></article>
        <article class="metric"><div class="metric-label">Staff</div><div class="metric-value">${staffCount}/${license.max_staff}</div><div class="metric-sub">${license.offline_grace_days}-day offline grace</div></article>
      </section>
      <div class="card">
        <div class="card-title"><h3>Included in your plan</h3><span class="pill blue">${features.length} entitlements</span></div>
        <div class="entitlement-grid">${features.length ? features.map(feature => `<span class="entitlement-chip">✓ ${esc(featureLabel(feature))}</span>`).join("") : '<span class="help">Licensed modules are unavailable until the plan is active.</span>'}</div>
      </div>
    ` : `<div class="empty"><strong>Preparing your free trial</strong>A new shop without a paid license automatically receives a 7-day StorePOS Pro trial.</div>`}

    ${canManageLicense ? `
      <div class="card custom-license-card" style="margin-top:14px">
        <div class="card-title"><div><h3>Custom License Orders</h3><span>Starts at ₱699/month. Final pricing depends on devices, staff, modules, branches, support, and optional SUNMI V2 hardware.</span></div><button id="request-custom-license-card" class="btn btn-secondary btn-sm">New custom order</button></div>
        <div class="custom-order-list">
          ${orders.length ? orders.map(order=>`
            <div class="custom-order-row">
              <div>
                <strong>${esc(order.requested_plan)} · ${esc(order.billing_cycle)}</strong>
                <span>${number(order.desired_devices)} devices · ${number(order.desired_staff)} staff · ${Array.isArray(order.desired_features)?order.desired_features.length:0} modules${Number(order.sunmi_v2_quantity||0)>0?` · SUNMI V2 ×${number(order.sunmi_v2_quantity)}`:""}</span>
              </div>
              <div>
                <strong>${order.quoted_price_php!=null?`Software ${peso(order.quoted_price_php)}`:order.budget_php!=null?`Budget ${peso(order.budget_php)}`:"Awaiting quote"}</strong>
                <span>${order.hardware_quote_php!=null?`SUNMI V2 hardware ${peso(order.hardware_quote_php)} · `:""}${pill(order.status)} · ${niceDate(order.created_at,true)}</span>
              </div>
            </div>`).join("") : '<div class="help">No custom orders yet.</div>'}
        </div>
      </div>

      <div class="card" style="margin-top:14px">
        <div class="card-title"><div><h3>Payment & renewal submissions</h3><span>Manual GCash, Maya, bank, cash or other payment references.</span></div><button id="submit-license-payment-card" class="btn btn-secondary btn-sm">Submit payment</button></div>
        <div class="custom-order-list">
          ${payments.length ? payments.map(p=>`
            <div class="custom-order-row">
              <div><strong>${peso(p.amount_php)} · ${esc(p.payment_method.toUpperCase())}</strong><span>Ref: ${esc(p.reference_number)} · ${niceDate(p.created_at,true)}</span></div>
              <div><strong>${pill(p.status)}</strong><span>${esc(p.admin_notes||p.notes||"Awaiting review")}</span></div>
            </div>`).join("") : '<div class="help">No payment references submitted yet.</div>'}
        </div>
      </div>

      <div class="card" style="margin-top:14px">
        <div class="card-title"><h3>License history</h3><span class="help">Latest ${history.length} event(s)</span></div>
        <div class="stat-list">
          ${history.length ? history.map(event => `
            <div class="stat-row"><span><strong>${esc(String(event.event_type || "license").replace("license.","").replaceAll("_"," "))}</strong><small>${niceDate(event.created_at,true)}</small></span><strong>${esc(event.plan_code || "—")} · ${esc(event.billing_cycle || "—")}${event.amount_php != null ? ` · ${peso(event.amount_php)}` : ""}</strong></div>
          `).join("") : '<div class="help">No paid license events yet.</div>'}
        </div>
      </div>
    ` : ""}
  `;

  const openRequest=()=>openCustomLicenseRequest(root);
  const openPayment=()=>openLicensePaymentSubmission(root,orders,license);
  document.querySelector("#request-custom-license")?.addEventListener("click",openRequest);
  document.querySelector("#request-custom-license-card")?.addEventListener("click",openRequest);
  document.querySelector("#submit-license-payment")?.addEventListener("click",openPayment);
  document.querySelector("#submit-license-payment-card")?.addEventListener("click",openPayment);
}

function openLicensePaymentSubmission(root, orders, license) {
  const payableOrders=(orders||[]).filter(o=>["quoted","approved","reviewing","pending"].includes(o.status));
  const orderTotal=o=>{
    const software=Number(o?.quoted_price_php||0);
    const hardware=Number(o?.hardware_quote_php||0);
    return software+hardware || null;
  };
  const firstQuoted=payableOrders.find(o=>orderTotal(o)!=null);
  const defaultAmount=firstQuoted?orderTotal(firstQuoted):(license?.price_snapshot_php ?? "");
  showModal(`
    <h2>Submit license payment</h2>
    <p>Submit the payment reference for manual StorePOS verification. For custom orders, the suggested total includes the software license plus any quoted SUNMI V2 hardware. Never send PINs, OTPs or passwords.</p>
    <form id="license-payment-form" class="form">
      <div class="field"><label>Related custom order (optional)</label><select class="input" name="order_id" id="license-payment-order"><option value="">Renewal / fixed plan</option>${payableOrders.map(o=>{
        const total=orderTotal(o);
        const hardware=Number(o.hardware_quote_php||0);
        return `<option value="${esc(o.id)}">${esc(o.requested_plan)} · ${esc(o.billing_cycle)} · ${esc(o.status)}${total!=null?` · Total ${peso(total)}`:""}${hardware>0?` (includes SUNMI V2 ${peso(hardware)})`:""}</option>`;
      }).join("")}</select></div>
      <div class="grid-2">
        <div class="field"><label>Amount paid (₱)</label><input class="input" id="license-payment-amount" type="number" min="0.01" step="0.01" name="amount" value="${esc(defaultAmount)}" required><div class="help">Custom-order amount = software quote + hardware quote, when both are available.</div></div>
        <div class="field"><label>Payment method</label><select class="input" name="method"><option value="gcash">GCash</option><option value="maya">Maya</option><option value="bank">Bank transfer</option><option value="cash">Cash</option><option value="other">Other</option></select></div>
      </div>
      <div class="field"><label>Reference number</label><input class="input" name="reference" minlength="3" maxlength="160" required placeholder="Transaction/reference number"></div>
      <div class="field"><label>Notes (optional)</label><textarea class="input" name="notes" maxlength="2000" placeholder="Payment date, sender name, or other useful details"></textarea></div>
      <div class="modal-actions"><button type="button" id="close-license-payment" class="btn btn-secondary">Cancel</button><button type="submit" class="btn btn-primary">Submit for review</button></div>
    </form>`);

  const orderSelect=document.querySelector("#license-payment-order");
  const amountInput=document.querySelector("#license-payment-amount");
  if(firstQuoted && orderSelect) orderSelect.value=firstQuoted.id;
  orderSelect?.addEventListener("change",()=>{
    const selected=payableOrders.find(o=>o.id===orderSelect.value);
    const suggested=selected?orderTotal(selected):Number(license?.price_snapshot_php||0);
    if(amountInput) amountInput.value=suggested?String(suggested):"";
  });

  document.querySelector("#close-license-payment")?.addEventListener("click",closeModal);
  document.querySelector("#license-payment-form")?.addEventListener("submit",async event=>{
    event.preventDefault();
    const fd=new FormData(event.currentTarget);
    const orderId=String(fd.get("order_id")||"").trim();
    const {error}=await supabase.from("license_payment_submissions").insert({
      shop_id:state.shop.id,
      order_request_id:orderId||null,
      submitted_by:state.user.id,
      amount_php:Number(fd.get("amount")||0),
      payment_method:String(fd.get("method")||"other"),
      reference_number:String(fd.get("reference")||"").trim(),
      notes:String(fd.get("notes")||"").trim()||null
    });
    if(error) return toast(friendlyError(error),"error");
    closeModal();
    toast("Payment reference submitted for StorePOS review.","success");
    await pageLicense(root);
  });
}

async function openCustomLicenseRequest(root) {
  const {data:plans,error}=await supabase.from("license_plans")
    .select("code,name,default_max_devices,default_max_staff,features,sort_order,app_code")
    .eq("app_code","storepos")
    .eq("is_active",true).order("sort_order");
  if(error||!plans?.length) return toast(friendlyError(error||new Error("No active plans found.")),"error");

  const planMap=Object.fromEntries(plans.map(p=>[p.code,p]));
  const customOnlyFeatures=["paymongo_payments"];
  const allFeatures=[...new Set([...plans.flatMap(p=>Array.isArray(p.features)?p.features:[]),...customOnlyFeatures])];

  showModal(`
    <h2>Request a custom StorePOS license</h2>
    <p><strong>Custom StorePOS licenses start at ₱699/month.</strong> Final pricing depends on devices, staff accounts, selected modules, branches, support requirements, and optional hardware such as the SUNMI V2.</p>
    <div class="verify-note"><strong>Software + hardware</strong><span>SUNMI V2 hardware is optional and quoted separately from the StorePOS software license.</span></div>
    <form id="custom-license-request-form" class="form">
      <div class="grid-2">
        <div class="field"><label>Base plan</label><select class="input" name="plan" id="custom-order-plan">${plans.map(p=>`<option value="${esc(p.code)}" ${p.code==="store_pro"?"selected":""}>${esc(p.name)}</option>`).join("")}</select></div>
        <div class="field"><label>Billing term</label><select class="input" name="cycle"><option value="monthly">Monthly</option><option value="annual" selected>Annual</option><option value="custom">Custom term</option></select></div>
      </div>
      <div class="grid-2">
        <div class="field"><label>Devices needed</label><input class="input" type="number" min="1" max="500" name="devices" id="custom-order-devices" required></div>
        <div class="field"><label>Staff accounts needed</label><input class="input" type="number" min="1" max="5000" name="staff" id="custom-order-staff" required></div>
      </div>
      <div class="grid-2">
        <div class="field"><label>Target software budget (₱, optional)</label><input class="input" type="number" min="0" step="0.01" name="budget" placeholder="Starts at ₱699/month"></div>
        <div class="field"><label>SUNMI V2 units (optional)</label><input class="input" type="number" min="0" max="100" step="1" name="sunmi_v2_quantity" value="0"><div class="help">Hardware price is quoted separately.</div></div>
      </div>
      <div class="field"><label>Modules</label><div class="feature-picker" id="custom-order-features">
        ${allFeatures.map(code=>`<label><input type="checkbox" name="feature" value="${esc(code)}"><span>${esc(featureLabel(code))}${code==="paymongo_payments"?' <small class="help">Custom add-on</small>':""}</span></label>`).join("")}
      </div><div class="help">PayMongo automatic payments is a custom add-on. Each StorePOS client connects their own PayMongo merchant account and receives payments directly into that account.</div></div>
      <div class="field"><label>Special requirements</label><textarea class="input" name="notes" maxlength="4000" placeholder="Example: 5 POS tablets, 15 staff, service + inventory + multi-branch only, custom annual billing…"></textarea></div>
      <div class="modal-actions"><button type="button" id="close-custom-order" class="btn btn-secondary">Cancel</button><button type="submit" class="btn btn-primary">Submit custom order</button></div>
    </form>`);

  const planSelect=document.querySelector("#custom-order-plan");
  const deviceInput=document.querySelector("#custom-order-devices");
  const staffInput=document.querySelector("#custom-order-staff");
  function applyPlan(){
    const p=planMap[planSelect?.value]||plans[0];
    if(deviceInput) deviceInput.value=p.default_max_devices;
    if(staffInput) staffInput.value=p.default_max_staff;
    const selected=new Set(Array.isArray(p.features)?p.features:[]);
    document.querySelectorAll('#custom-order-features input[name="feature"]').forEach(el=>{el.checked=selected.has(el.value);});
  }
  planSelect?.addEventListener("change",applyPlan);
  applyPlan();

  document.querySelector("#close-custom-order")?.addEventListener("click",closeModal);
  document.querySelector("#custom-license-request-form")?.addEventListener("submit",async event=>{
    event.preventDefault();
    const fd=new FormData(event.currentTarget);
    const features=[...event.currentTarget.querySelectorAll('input[name="feature"]:checked')].map(x=>x.value);
    const budgetRaw=String(fd.get("budget")||"").trim();
    const {error}=await supabase.from("license_order_requests").insert({
      shop_id:state.shop.id,
      requested_by:state.user.id,
      status:"pending",
      requested_plan:String(fd.get("plan")||"pro"),
      billing_cycle:String(fd.get("cycle")||"annual"),
      desired_devices:Number(fd.get("devices")||1),
      desired_staff:Number(fd.get("staff")||1),
      desired_features:features,
      budget_php:budgetRaw?Number(budgetRaw):null,
      sunmi_v2_quantity:Number(fd.get("sunmi_v2_quantity")||0),
      notes:String(fd.get("notes")||"").trim()||null
    });
    if(error) return toast(friendlyError(error),"error");
    closeModal();
    toast("Custom license request submitted.","success");
    await pageLicense(root);
  });
}


async function pageDevices(root) {
  const { data, error } = await supabase.from("device_sessions")
    .select("id,device_id,device_name,app_version,last_seen_at,is_active,created_at")
    .eq("shop_id",state.shop.id).order("last_seen_at",{ascending:false});
  if (error) throw error;
  root.innerHTML = `
    ${head("Devices","Android POS terminals and authenticated device sessions")}
    <div class="table-wrap"><table><thead><tr><th>Device</th><th>ID</th><th>App</th><th>Status</th><th>Last seen</th></tr></thead><tbody>
      ${(data||[]).map(d=>`<tr><td><strong>${esc(d.device_name||"StorePOS device")}</strong></td><td>${esc(d.device_id)}</td><td>${esc(d.app_version||"—")}</td><td>${pill(d.is_active?"active":"inactive")}</td><td>${niceDate(d.last_seen_at,true)}</td></tr>`).join("") || '<tr><td colspan="5">No registered devices yet.</td></tr>'}
    </tbody></table></div>`;
}

async function fetchAllShopRows(table) {
  const rows=[];
  let from=0;
  const pageSize=1000;
  while(true){
    const {data,error}=await supabase.from(table).select("*").eq("shop_id",state.shop.id).range(from,from+pageSize-1);
    if(error) throw error;
    rows.push(...(data||[]));
    if(!data || data.length<pageSize) break;
    from+=pageSize;
  }
  return rows;
}

function csvCell(value){
  if(value==null) return "";
  const text=typeof value==="object"?JSON.stringify(value):String(value);
  return '"' + text.replaceAll('"','""') + '"';
}

function downloadTextFile(name,text,type="text/plain;charset=utf-8"){
  const blob=new Blob([text],{type});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),500);
}

async function exportShopCsv(table,fileName){
  const rows=await fetchAllShopRows(table);
  if(!rows.length) return toast("No records to export.","");
  const keys=[...new Set(rows.flatMap(row=>Object.keys(row)))];
  const csv=[keys.map(csvCell).join(","),...rows.map(row=>keys.map(k=>csvCell(row[k])).join(","))].join("\r\n");
  downloadTextFile(fileName,csv,"text/csv;charset=utf-8");
  toast(`${rows.length} record(s) exported.`,"success");
}

async function exportFullBackup(){
  const tables=[
    "products","product_categories","customers","retails","sales","sale_items","payments",
    "inventory_movements","quotations","quotation_items","job_orders","job_order_parts","job_order_services",
    "suppliers","purchase_orders","purchase_order_items","expenses","warranties","appointments",
    "service_reminders","customer_receivables","receivable_payments","license_events"
  ];
  const backup={format:"StorePOS Shop Backup",version:"2.2.0",exported_at:new Date().toISOString(),shop:state.shop,data:{}};
  for(const table of tables){
    try{backup.data[table]=await fetchAllShopRows(table);}
    catch(error){backup.data[table]={unavailable:friendlyError(error)};}
  }
  downloadTextFile(`StorePOS-${String(state.shop.name||"Shop").replace(/[^a-z0-9]+/gi,"-")}-backup-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(backup,null,2),"application/json");
  toast("Full StorePOS backup exported.","success");
}

async function pageSettings(root) {
  const paymongoAllowed=entitlementFeatures().includes("paymongo_payments");
  let paymongo=null;
  if(paymongoAllowed){
    const {data,error}=await supabase.from("paymongo_integrations")
      .select("shop_id,enabled,mode,secret_key_last4,webhook_secret_last4,webhook_id,webhook_status,payment_method_types,pass_on_fees,send_email_receipt,connected_at,updated_at")
      .eq("shop_id",state.shop.id).maybeSingle();
    if(error) throw error;
    paymongo=data||null;
  }

  root.innerHTML = `
    ${head("Settings","Shop identity, backup and export tools")}
    <div class="grid-2">
      <div class="card">
        <form id="shop-settings" class="form">
          <div class="card-title"><h3>Shop identity</h3><span>Cloud profile</span></div>
          <div class="field"><label>Shop name</label><input class="input" name="name" value="${esc(state.shop.name||"")}" required></div>
          <div class="grid-2">
            <div class="field"><label>Phone</label><input class="input" name="phone" value="${esc(state.shop.phone||"")}"></div>
            <div class="field"><label>Email</label><input class="input" type="email" name="email" value="${esc(state.shop.email||"")}"></div>
          </div>
          <div class="field"><label>Address</label><textarea class="input" name="address">${esc(state.shop.address||"")}</textarea></div>
          <button class="btn btn-primary" type="submit">Save shop settings</button>
        </form>
      </div>
      <div class="card">
        <div class="card-title"><h3>Backup & Export</h3><span>Owner-controlled data portability</span></div>
        <p class="help">Exports respect your shop access and current StorePOS entitlements. JSON backup contains every accessible record group; CSV exports are spreadsheet-ready.</p>
        <div class="export-grid">
          <button class="btn btn-secondary export-data" data-table="sales" data-file="StorePOS-sales.csv">Sales CSV</button>
          <button class="btn btn-secondary export-data" data-table="products" data-file="StorePOS-inventory.csv">Inventory CSV</button>
          <button class="btn btn-secondary export-data" data-table="customers" data-file="StorePOS-customers.csv">Customers CSV</button>
          <button id="export-full-backup" class="btn btn-primary">Full JSON Backup</button>
        </div>
        <div class="verify-note"><strong>Cloud safety</strong><span>Supabase also maintains platform database backups. This export is an additional shop-owned portable copy.</span></div>
      </div>
    </div>
    ${paymongoAllowed?`
      <div class="card" style="margin-top:14px">
        <div class="card-title">
          <div>
            <h3>PayMongo Automatic Payments</h3>
            <span>Custom integration · this shop uses its own PayMongo merchant account.</span>
          </div>
          ${paymongo?.enabled?pill("active"):pill("not connected")}
        </div>
        <div class="verify-note">
          <strong>Per-client merchant account</strong>
          <span>StorePOS never shares one PayMongo account across clients. Your secret key is sent only to the secure StorePOS server and stored encrypted in Supabase Vault; it is never displayed again.</span>
        </div>
        ${paymongo?.enabled?`
          <div class="stat-list" style="margin-bottom:14px">
            <div class="stat-row"><span>Environment</span><strong>${esc(String(paymongo.mode||"test").toUpperCase())}</strong></div>
            <div class="stat-row"><span>PayMongo secret key</span><strong>••••${esc(paymongo.secret_key_last4||"")}</strong></div>
            <div class="stat-row"><span>Webhook signing secret</span><strong>••••${esc(paymongo.webhook_secret_last4||"")}</strong></div>
            <div class="stat-row"><span>Webhook</span><strong>${esc(paymongo.webhook_status||"enabled")}</strong></div>
            <div class="stat-row"><span>Connected</span><strong>${niceDate(paymongo.connected_at,true)}</strong></div>
          </div>
        `:""}
        <form id="paymongo-settings-form" class="form">
          <div class="field">
            <label>${paymongo?.enabled?"Replace / rotate PayMongo Secret Key":"PayMongo Secret Key"}</label>
            <input class="input" type="password" name="secret_key" autocomplete="new-password" placeholder="sk_test_... or sk_live_..." required>
            <div class="help">Use the secret key from this client's own PayMongo dashboard. Never use StorePOS developer credentials here.</div>
          </div>
          <div class="field">
            <label>Accepted methods</label>
            <div class="feature-picker">
              ${[
                ["gcash","GCash"],
                ["paymaya","Maya"],
                ["qrph","QR Ph"],
                ["card","Card"]
              ].map(([code,label])=>`<label><input type="checkbox" name="paymongo_method" value="${code}" ${(!paymongo||!Array.isArray(paymongo.payment_method_types)||paymongo.payment_method_types.includes(code))?"checked":""}><span>${label}</span></label>`).join("")}
            </div>
          </div>
          <div class="grid-2">
            <label style="display:flex;gap:9px;align-items:center"><input type="checkbox" name="send_email_receipt" ${paymongo?.send_email_receipt?"checked":""}> <span>PayMongo email receipt</span></label>
            <label style="display:flex;gap:9px;align-items:center"><input type="checkbox" name="pass_on_fees" ${paymongo?.pass_on_fees?"checked":""}> <span>Pass supported fees to customer</span></label>
          </div>
          <div class="modal-actions" style="justify-content:flex-start">
            <button class="btn btn-primary" type="submit">${paymongo?.enabled?"Update PayMongo connection":"Connect PayMongo"}</button>
            ${paymongo?.enabled?'<button class="btn btn-secondary" type="button" id="disconnect-paymongo">Disconnect</button>':""}
          </div>
        </form>
      </div>
    `:`
      <div class="card" style="margin-top:14px">
        <div class="card-title"><h3>PayMongo Automatic Payments</h3><span>Custom StorePOS add-on</span></div>
        <p class="help">This integration is available when <strong>PayMongo automatic payments</strong> is included in the shop's custom StorePOS license. Each client connects their own merchant account.</p>
        <button class="btn btn-secondary" type="button" id="request-paymongo-addon">Request in Custom License</button>
      </div>
    `}
  `;
  document.querySelector("#shop-settings")?.addEventListener("submit", async event => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const { data, error } = await supabase.from("shops").update({
      name:String(f.get("name")||"").trim(),
      phone:String(f.get("phone")||"").trim()||null,
      email:String(f.get("email")||"").trim()||null,
      address:String(f.get("address")||"").trim()||null
    }).eq("id",state.shop.id).select("id,name,phone,email,address,currency_code,timezone").single();
    if (error) return toast(friendlyError(error),"error");
    state.shop = data;
    toast("Shop settings saved.","success");
    pageSettings(root);
  });
  root.querySelectorAll(".export-data").forEach(btn=>btn.addEventListener("click",async()=>{
    btn.disabled=true;
    try{await exportShopCsv(btn.dataset.table,btn.dataset.file);}
    catch(error){toast(friendlyError(error),"error");}
    btn.disabled=false;
  }));
  document.querySelector("#export-full-backup")?.addEventListener("click",async event=>{
    const btn=event.currentTarget;btn.disabled=true;btn.textContent="Preparing…";
    try{await exportFullBackup();}catch(error){toast(friendlyError(error),"error");}
    btn.disabled=false;btn.textContent="Full JSON Backup";
  });

  document.querySelector("#request-paymongo-addon")?.addEventListener("click",()=>{
    setHash("dashboard/license");
    setTimeout(()=>document.querySelector("#request-custom-license-card")?.click(),80);
  });

  document.querySelector("#paymongo-settings-form")?.addEventListener("submit",async event=>{
    event.preventDefault();
    const form=event.currentTarget;
    const fd=new FormData(form);
    const methods=[...form.querySelectorAll('input[name="paymongo_method"]:checked')].map(x=>x.value);
    if(!methods.length) return toast("Choose at least one PayMongo payment method.","error");
    const button=form.querySelector('button[type="submit"]');
    const original=button.textContent;
    button.disabled=true;button.textContent="Connecting securely…";
    try{
      const {data,error}=await supabase.functions.invoke("storepos-paymongo-admin",{
        body:{
          action:"connect",
          shop_id:state.shop.id,
          secret_key:String(fd.get("secret_key")||"").trim(),
          payment_method_types:methods,
          pass_on_fees:fd.get("pass_on_fees")==="on",
          send_email_receipt:fd.get("send_email_receipt")==="on"
        }
      });
      if(error) throw error;
      if(data?.error) throw new Error(data.error);
      toast("PayMongo merchant account connected. Webhook verification is active.","success");
      await pageSettings(root);
    }catch(error){
      toast(friendlyError(error),"error");
      button.disabled=false;button.textContent=original;
    }
  });

  document.querySelector("#disconnect-paymongo")?.addEventListener("click",async()=>{
    if(!confirm("Disconnect PayMongo automatic payments for this shop? Existing payment history will be kept.")) return;
    const {data,error}=await supabase.functions.invoke("storepos-paymongo-admin",{
      body:{action:"disconnect",shop_id:state.shop.id}
    });
    if(error||data?.error) return toast(friendlyError(error||new Error(data.error)),"error");
    toast("PayMongo disconnected for this shop.","success");
    await pageSettings(root);
  });
}

async function renderAdmin() {
  if (!state.isSystemAdmin) {
    app.innerHTML = `<div class="setup"><div class="setup-card"><h1>Access denied</h1><p>This area is restricted to StorePOS system administrators.</p><a class="btn btn-secondary" href="#/dashboard/overview">Return to dashboard</a></div></div>`;
    return;
  }

  const path=currentPath();
  const section=path==="admin/users"?"users":path==="admin/support"?"support":path==="admin/health"?"health":"clients";

  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand"><span class="brand-logo">S</span><span>StorePOS</span></div>
        <div class="shop-chip"><strong>Developer Control</strong><span>System administrator</span></div>
        <nav class="nav-list">
          <a class="nav-item ${section==="clients"?"active":""}" href="#/admin"><span>Clients & Licenses</span><span class="nav-badge">ADMIN</span></a>
          <a class="nav-item ${section==="users"?"active":""}" href="#/admin/users"><span>Users & Emails</span></a>
          <a class="nav-item ${section==="support"?"active":""}" href="#/admin/support"><span>Support Inbox</span></a>
          <a class="nav-item ${section==="health"?"active":""}" href="#/admin/health"><span>System Health & Billing</span><span class="nav-badge">v2.2</span></a>
          <a class="nav-item" href="#/manual"><span>App Manual</span><span class="nav-badge">HELP</span></a>
          ${state.shop ? '<a class="nav-item" href="#/dashboard/overview"><span>My Shop</span></a>' : ""}
        </nav>
        <div class="sidebar-bottom"><button id="admin-sign-out" class="btn btn-secondary" style="width:100%">Sign out</button></div>
      </aside>
      <div class="main">
        <header class="topbar"><div class="topbar-title"><strong>StorePOS Control Center</strong><span>Users, licenses, support and clients</span></div><div class="user-pill"><div class="avatar">A</div><div class="user-copy"><strong style="font-size:12px">${esc(state.user?.email||"")}</strong><div class="help">system admin</div></div></div></header>
        <main id="admin-content" class="content"><div class="loading-block"></div></main>
      </div>
    </div>`;

  document.querySelector("#admin-sign-out")?.addEventListener("click", async()=>{
    await supabase.auth.signOut(); state.session=state.user=null; setHash("");
  });

  if(section==="users") await loadAdminUsers();
  else if(section==="support") await loadAdminSupport();
  else if(section==="health") await loadAdminHealth();
  else await loadAdminClients();
}



async function loadAdminHealth() {
  const root=document.querySelector("#admin-content");
  if(!root) return;
  const [healthRes,paymentRes]=await Promise.all([
    supabase.rpc("admin_system_health_v2"),
    supabase.from("license_payment_submissions")
      .select("id,shop_id,order_request_id,amount_php,payment_method,reference_number,status,notes,admin_notes,created_at,shop:shops!inner(name,app_code),order:license_order_requests(requested_plan,billing_cycle)")
      .eq("shop.app_code","storepos")
      .order("created_at",{ascending:false}).limit(150)
  ]);
  if(healthRes.error){root.innerHTML=`<div class="empty"><strong>System Health unavailable</strong>${esc(friendlyError(healthRes.error))}</div>`;return;}
  if(paymentRes.error){root.innerHTML=`<div class="empty"><strong>Billing queue unavailable</strong>${esc(friendlyError(paymentRes.error))}</div>`;return;}
  const h=healthRes.data||{};
  const payments=paymentRes.data||[];

  root.innerHTML=`
    ${head("System Health & Billing","Production telemetry, attention queues and manual payment verification")}
    <section class="metrics">
      <article class="metric"><div class="metric-label">Users / Shops</div><div class="metric-value">${number(h.auth_users||0)} / ${number(h.shops||0)}</div><div class="metric-sub">Registered cloud accounts</div></article>
      <article class="metric"><div class="metric-label">Licensed</div><div class="metric-value">${number((h.active_licenses||0)+(h.active_trials||0))}</div><div class="metric-sub">${number(h.active_trials||0)} trial · ${number(h.expired_or_suspended||0)} blocked</div></article>
      <article class="metric"><div class="metric-label">Devices</div><div class="metric-value">${number(h.active_devices||0)}</div><div class="metric-sub">${number(h.outdated_devices||0)} not on ${esc(h.latest_app_version||"latest")}</div></article>
      <article class="metric"><div class="metric-label">Support</div><div class="metric-value">${number(h.open_support||0)}</div><div class="metric-sub">${number(h.human_handoffs||0)} human handoff(s)</div></article>
    </section>
    <section class="metrics">
      <article class="metric"><div class="metric-label">Pending payments</div><div class="metric-value">${number(h.pending_payments||0)}</div><div class="metric-sub">Need verification</div></article>
      <article class="metric"><div class="metric-label">Custom orders</div><div class="metric-value">${number(h.pending_custom_orders||0)}</div><div class="metric-sub">Open quote/order queue</div></article>
      <article class="metric"><div class="metric-label">Low stock</div><div class="metric-value">${number(h.low_stock_products||0)}</div><div class="metric-sub">Across client shops</div></article>
      <article class="metric"><div class="metric-label">Overdue A/R</div><div class="metric-value">${number(h.overdue_receivables||0)}</div><div class="metric-sub">${number(h.service_due_7d||0)} service reminders due</div></article>
    </section>

    <div class="card">
      <div class="card-title"><h3>License payment verification queue</h3><span>${payments.length} recent submission(s)</span></div>
      <div class="table-wrap compact-table"><table><thead><tr><th>Shop</th><th>Payment</th><th>Reference</th><th>Order</th><th>Status</th><th>Action</th></tr></thead><tbody>
        ${payments.map(p=>`<tr>
          <td><strong>${esc(p.shop?.name||"Shop")}</strong><div class="help">${niceDate(p.created_at,true)}</div></td>
          <td><strong>${peso(p.amount_php)}</strong><div class="help">${esc(String(p.payment_method||"").toUpperCase())}</div></td>
          <td>${esc(p.reference_number)}</td>
          <td>${esc(p.order?.requested_plan||"Renewal")}${p.order?.billing_cycle?` · ${esc(p.order.billing_cycle)}`:""}</td>
          <td>${pill(p.status)}</td>
          <td><button class="btn btn-secondary btn-sm review-license-payment" data-id="${p.id}">Review</button></td>
        </tr>`).join("")||'<tr><td colspan="6">No payment submissions yet.</td></tr>'}
      </tbody></table></div>
    </div>
    <div class="verify-note" style="margin-top:14px"><strong>Generated ${niceDate(h.generated_at,true)}</strong><span>System Health uses live StorePOS database state. Supabase platform-level infrastructure logs remain in the Supabase Dashboard.</span></div>`;

  root.querySelectorAll(".review-license-payment").forEach(btn=>{
    const payment=payments.find(p=>p.id===btn.dataset.id);
    btn.addEventListener("click",()=>openLicensePaymentReview(payment));
  });
}

function openLicensePaymentReview(payment){
  if(!payment) return;
  showModal(`
    <h2>Review license payment</h2>
    <p><strong>${esc(payment.shop?.name||"Shop")}</strong> · ${peso(payment.amount_php)} · ${esc(String(payment.payment_method||"").toUpperCase())}</p>
    <div class="key-box">${esc(payment.reference_number)}</div>
    ${payment.notes?`<div class="verify-note"><strong>Client notes</strong><span>${esc(payment.notes)}</span></div>`:""}
    <form id="license-payment-review-form" class="form">
      <div class="field"><label>Status</label><select class="input" name="status">
        ${["pending","verified","rejected","applied"].map(s=>`<option value="${s}" ${payment.status===s?"selected":""}>${s}</option>`).join("")}
      </select></div>
      <div class="field"><label>Admin notes</label><textarea class="input" name="notes" maxlength="2000">${esc(payment.admin_notes||"")}</textarea></div>
      <div class="help">“Verified” confirms the reference. Use Clients & Licenses to issue/renew the license, then mark this payment “Applied”.</div>
      <div class="modal-actions"><button id="close-payment-review" type="button" class="btn btn-secondary">Close</button><button type="submit" class="btn btn-primary">Save review</button></div>
    </form>`);
  document.querySelector("#close-payment-review")?.addEventListener("click",closeModal);
  document.querySelector("#license-payment-review-form")?.addEventListener("submit",async event=>{
    event.preventDefault();
    const fd=new FormData(event.currentTarget);
    const {error}=await supabase.from("license_payment_submissions").update({
      status:String(fd.get("status")||"pending"),
      admin_notes:String(fd.get("notes")||"").trim()||null,
      reviewed_by:state.user.id,
      reviewed_at:new Date().toISOString(),
      updated_at:new Date().toISOString()
    }).eq("id",payment.id);
    if(error) return toast(friendlyError(error),"error");
    closeModal();toast("Payment review saved.","success");await loadAdminHealth();
  });
}

async function loadAdminClients() {
  const root = document.querySelector("#admin-content");
  if (!root) return;

  const [clientRes,orderRes]=await Promise.all([
    supabase.rpc("admin_client_overview_v3",{p_app_code:"storepos"}),
    supabase.from("license_order_requests")
      .select("id,shop_id,status,requested_plan,billing_cycle,desired_devices,desired_staff,desired_features,budget_php,notes,quoted_price_php,sunmi_v2_quantity,hardware_quote_php,admin_notes,created_at,shop:shops!inner(name,app_code)")
      .eq("shop.app_code","storepos")
      .order("created_at",{ascending:false})
      .limit(100)
  ]);

  if (clientRes.error) {
    root.innerHTML = `<div class="empty"><strong>Unable to load clients</strong>${esc(friendlyError(clientRes.error))}</div>`;
    return;
  }
  if(orderRes.error){
    root.innerHTML = `<div class="empty"><strong>Unable to load custom license orders</strong>${esc(friendlyError(orderRes.error))}</div>`;
    return;
  }

  const clients = clientRes.data || [];
  const orders = orderRes.data || [];
  const active = clients.filter(c=>["active","trial"].includes(c.license_status)).length;
  const devices = clients.reduce((sum,c)=>sum+Number(c.device_count||0),0);
  const openOrders=orders.filter(o=>!["fulfilled","declined","cancelled"].includes(o.status));

  root.innerHTML = `
    ${head("Clients & Licenses","Central control for StorePOS shops, fixed plans and custom license orders")}
    <section class="metrics">
      <article class="metric"><div class="metric-label">Client shops</div><div class="metric-value">${number(clients.length)}</div><div class="metric-sub">Registered workspaces</div></article>
      <article class="metric"><div class="metric-label">Active licenses</div><div class="metric-value">${number(active)}</div><div class="metric-sub">Active or trial</div></article>
      <article class="metric"><div class="metric-label">Active devices</div><div class="metric-value">${number(devices)}</div><div class="metric-sub">Across all clients</div></article>
      <article class="metric"><div class="metric-label">Custom orders</div><div class="metric-value">${number(openOrders.length)}</div><div class="metric-sub">Need review / quote</div></article>
    </section>

    <div class="card" style="margin-bottom:14px">
      <div class="card-title"><h3>Custom license orders</h3><span>Tailored modules, limits and pricing</span></div>
      <div class="table-wrap compact-table"><table><thead><tr><th>Shop</th><th>Request</th><th>Modules</th><th>Budget / quote</th><th>Status</th><th>Actions</th></tr></thead><tbody>
        ${orders.map(o=>`<tr>
          <td><strong>${esc(o.shop?.name||"Shop")}</strong><div class="help">${niceDate(o.created_at,true)}</div></td>
          <td>${esc(o.requested_plan)} · ${esc(o.billing_cycle)}<div class="help">${number(o.desired_devices)} devices · ${number(o.desired_staff)} staff${Number(o.sunmi_v2_quantity||0)>0?` · SUNMI V2 ×${number(o.sunmi_v2_quantity)}`:""}</div></td>
          <td>${Array.isArray(o.desired_features)?number(o.desired_features.length):0}<div class="help">${Array.isArray(o.desired_features)?esc(o.desired_features.slice(0,3).map(featureLabel).join(", ")):""}${Array.isArray(o.desired_features)&&o.desired_features.length>3?"…":""}</div></td>
          <td>
            ${o.quoted_price_php!=null?`<strong>Software ${peso(o.quoted_price_php)}</strong>`:o.budget_php!=null?`Budget ${peso(o.budget_php)}`:"—"}
            ${o.hardware_quote_php!=null?`<div class="help">Hardware ${peso(o.hardware_quote_php)}</div>`:""}
          </td>
          <td>${pill(o.status)}</td>
          <td><div class="actions"><button class="btn btn-secondary btn-sm review-custom-order" data-id="${o.id}">Review</button>${!["fulfilled","declined","cancelled"].includes(o.status)?`<button class="btn btn-primary btn-sm issue-custom-order" data-id="${o.id}">Issue</button>`:""}</div></td>
        </tr>`).join("")||'<tr><td colspan="6">No custom license orders yet.</td></tr>'}
      </tbody></table></div>
    </div>

    <div class="table-wrap"><table><thead><tr><th>Shop</th><th>Owner</th><th>Plan</th><th>License</th><th>Devices</th><th>Staff</th><th>Expires</th><th>Actions</th></tr></thead><tbody>
      ${clients.map(c=>`
        <tr>
          <td><strong>${esc(c.shop_name)}</strong><div class="help">${esc(String(c.shop_id).slice(0,8))}…</div></td>
          <td>${esc(c.owner_email||"—")}</td>
          <td>${c.plan_code?pill(c.plan_code):"—"}${c.billing_cycle?`<div class="help">${esc(c.billing_cycle)}${c.price_snapshot_php!=null?` · ${peso(c.price_snapshot_php)}`:""}</div>`:""}</td>
          <td>${pill(c.license_status)}${c.license_key_last4?`<div class="help">••••${esc(c.license_key_last4)}</div>`:""}</td>
          <td>${number(c.device_count)}/${c.max_devices??"—"}</td>
          <td>${number(c.member_count)}/${c.max_staff??"—"}</td>
          <td>${c.license_status === "trial" && c.expires_at ? `<strong>${esc(trialRemaining(c.expires_at)?.label || "Trial")}</strong><div class="help">${niceDate(c.expires_at)}</div>` : niceDate(c.expires_at)}</td>
          <td><div class="actions">
            <button class="btn btn-primary btn-sm issue-license" data-shop="${esc(c.shop_id)}" data-name="${esc(c.shop_name)}">Issue</button>
            ${c.license_status!=="unlicensed" ? `<button class="btn ${c.license_status==="suspended"?"btn-success":"btn-danger"} btn-sm status-license" data-shop="${esc(c.shop_id)}" data-status="${c.license_status==="suspended"?"active":"suspended"}">${c.license_status==="suspended"?"Reactivate":"Suspend"}</button>` : ""}
            <button class="btn btn-secondary btn-sm reset-devices" data-shop="${esc(c.shop_id)}">Reset devices</button>
          </div></td>
        </tr>`).join("") || '<tr><td colspan="8">No client shops found.</td></tr>'}
    </tbody></table></div>`;

  root.querySelectorAll(".issue-license").forEach(btn=>btn.addEventListener("click",()=>openLicenseModal(btn.dataset.shop,btn.dataset.name)));
  root.querySelectorAll(".status-license").forEach(btn=>btn.addEventListener("click",()=>setLicenseStatus(btn.dataset.shop,btn.dataset.status)));
  root.querySelectorAll(".reset-devices").forEach(btn=>btn.addEventListener("click",()=>resetDevices(btn.dataset.shop)));
  root.querySelectorAll(".review-custom-order").forEach(btn=>{
    const order=orders.find(o=>o.id===btn.dataset.id);
    btn.addEventListener("click",()=>openCustomOrderReview(order));
  });
  root.querySelectorAll(".issue-custom-order").forEach(btn=>{
    const order=orders.find(o=>o.id===btn.dataset.id);
    btn.addEventListener("click",()=>openLicenseModal(order.shop_id,order.shop?.name||"Shop",order));
  });
}

function openCustomOrderReview(order){
  if(!order) return;
  const features=Array.isArray(order.desired_features)?order.desired_features:[];
  showModal(`
    <h2>Review custom license order</h2>
    <p><strong>${esc(order.shop?.name||"Shop")}</strong> requested ${number(order.desired_devices)} devices, ${number(order.desired_staff)} staff accounts and ${number(features.length)} modules${Number(order.sunmi_v2_quantity||0)>0?`, plus ${number(order.sunmi_v2_quantity)} SUNMI V2 unit(s)`:""}.</p>
    <div class="verify-note"><strong>Pricing guide</strong><span>Custom StorePOS starts at ₱699/month. Quote the software license separately from optional SUNMI V2 hardware.</span></div>
    <div class="entitlement-grid compact">${features.map(code=>`<span class="entitlement-chip">✓ ${esc(featureLabel(code))}</span>`).join("")||'<span class="help">No custom modules selected.</span>'}</div>
    ${order.notes?`<div class="verify-note"><strong>Client notes</strong><span>${esc(order.notes)}</span></div>`:""}
    <form id="custom-order-review-form" class="form">
      <div class="grid-2">
        <div class="field"><label>Status</label><select class="input" name="status">${["pending","reviewing","quoted","approved","declined","fulfilled","cancelled"].map(s=>`<option value="${s}" ${order.status===s?"selected":""}>${s}</option>`).join("")}</select></div>
        <div class="field"><label>Software license quote (₱)</label><input class="input" type="number" min="0" step="0.01" name="quote" value="${esc(order.quoted_price_php??"")}" placeholder="Custom license starts at ₱699/month"></div>
      </div>
      <div class="grid-2">
        <div class="field"><label>SUNMI V2 requested</label><input class="input" value="${number(order.sunmi_v2_quantity||0)} unit(s)" disabled></div>
        <div class="field"><label>SUNMI V2 hardware quote (₱)</label><input class="input" type="number" min="0" step="0.01" name="hardware_quote" value="${esc(order.hardware_quote_php??"")}" placeholder="${Number(order.sunmi_v2_quantity||0)>0?"Enter total hardware quote":"No hardware requested"}" ${Number(order.sunmi_v2_quantity||0)>0?"":"disabled"}></div>
      </div>
      <div class="field"><label>Admin notes</label><textarea class="input" name="admin_notes" maxlength="4000">${esc(order.admin_notes||"")}</textarea></div>
      <div class="modal-actions"><button type="button" id="close-order-review" class="btn btn-secondary">Close</button><button type="button" id="issue-order-now" class="btn btn-secondary">Issue custom license</button><button type="submit" class="btn btn-primary">Save review</button></div>
    </form>`);

  document.querySelector("#close-order-review")?.addEventListener("click",closeModal);
  document.querySelector("#issue-order-now")?.addEventListener("click",()=>{
    closeModal();
    openLicenseModal(order.shop_id,order.shop?.name||"Shop",order);
  });
  document.querySelector("#custom-order-review-form")?.addEventListener("submit",async event=>{
    event.preventDefault();
    const fd=new FormData(event.currentTarget);
    const quoteRaw=String(fd.get("quote")||"").trim();
    const hardwareQuoteRaw=String(fd.get("hardware_quote")||"").trim();
    const {error}=await supabase.from("license_order_requests").update({
      status:String(fd.get("status")||"reviewing"),
      quoted_price_php:quoteRaw?Number(quoteRaw):null,
      hardware_quote_php:hardwareQuoteRaw?Number(hardwareQuoteRaw):null,
      admin_notes:String(fd.get("admin_notes")||"").trim()||null,
      reviewed_by:state.user.id,
      reviewed_at:new Date().toISOString(),
      updated_at:new Date().toISOString()
    }).eq("id",order.id);
    if(error) return toast(friendlyError(error),"error");
    closeModal();
    toast("Custom order updated.","success");
    await loadAdminClients();
  });
}


async function loadAdminUsers() {
  const root=document.querySelector("#admin-content");
  if(!root) return;
  const {data,error}=await supabase.functions.invoke("admin-users",{body:{action:"list"}});
  if(error||data?.error){
    root.innerHTML=`<div class="empty"><strong>Unable to load users</strong>${esc(friendlyError(data?.error||error))}</div>`;
    return;
  }
  const users=data?.users||[];
  root.innerHTML=`
    ${head("Users & Emails","Manage StorePOS Auth accounts safely")}
    <div class="card danger-zone" style="margin-bottom:14px"><div class="help"><strong style="color:var(--text)">Permanent Delete</strong> removes an Auth account only when it has no protected business history. <strong style="color:var(--text)">Remove Email & Disable</strong> is the safe option for accounts linked to old sales or service records.</div></div>
    <div class="table-wrap"><table><thead><tr><th>User</th><th>Email</th><th>Membership</th><th>Email</th><th>Status</th><th>Actions</th></tr></thead><tbody>
      ${users.map(u=>{
        const membership=(u.memberships||[]).filter(m=>m.is_active).map(m=>`${m.shop?.name||"Shop"} · ${m.role}`).join(", ");
        const banned=u.banned_until && new Date(u.banned_until)>new Date();
        return `<tr>
          <td><strong>${esc(u.display_name||"StorePOS User")}</strong><div class="help">${esc(u.id.slice(0,8))}… ${u.is_system_admin?"· SYSTEM ADMIN":""}</div></td>
          <td>${esc(u.email||"—")}</td>
          <td>${esc(membership||"No active shop")}</td>
          <td>${pill(u.email_confirmed_at?"verified":"unverified")}</td>
          <td>${pill(banned||u.profile_active===false?"disabled":"active")}</td>
          <td><div class="actions">
            ${u.is_system_admin?'<span class="help">Protected admin</span>':`
              <button class="btn btn-secondary btn-sm user-ban" data-id="${u.id}" data-ban="${banned?"0":"1"}">${banned?"Enable":"Disable"}</button>
              <button class="btn btn-danger btn-sm user-anonymize" data-id="${u.id}" data-email="${esc(u.email||"")}">Remove Email & Disable</button>
              <button class="btn btn-danger btn-sm user-delete" data-id="${u.id}" data-email="${esc(u.email||"")}">Delete</button>
            `}
          </div></td>
        </tr>`;
      }).join("")||'<tr><td colspan="6">No users found.</td></tr>'}
    </tbody></table></div>`;

  root.querySelectorAll(".user-ban").forEach(btn=>btn.addEventListener("click",()=>adminUserAction(btn.dataset.id,btn.dataset.ban==="1"?"ban":"unban")));
  root.querySelectorAll(".user-anonymize").forEach(btn=>btn.addEventListener("click",async()=>{
    if(!confirm(`Remove the original email ${btn.dataset.email} and permanently disable login? Business history will be preserved.`)) return;
    await adminUserAction(btn.dataset.id,"disable_anonymize");
  }));
  root.querySelectorAll(".user-delete").forEach(btn=>btn.addEventListener("click",async()=>{
    if(!confirm(`Permanently delete ${btn.dataset.email}? This only works when the account has no protected business history.`)) return;
    await adminUserAction(btn.dataset.id,"delete");
  }));
}

async function adminUserAction(userId,action){
  const {data,error}=await supabase.functions.invoke("admin-users",{body:{action,user_id:userId}});
  const details = error ? await functionErrorDetails(error) : null;
  const result = data || details;

  if(error || result?.error){
    if(action==="delete" && result?.can_anonymize){
      showModal(`
        <h2>Permanent deletion blocked</h2>
        <p>This account is linked to existing StorePOS business history. Permanently deleting the Auth user could break old sales, shop ownership, service records, inventory history or audit logs.</p>
        ${Array.isArray(result.last_owner_shops) && result.last_owner_shops.length ? `
          <div class="card danger-zone" style="margin:14px 0">
            <div class="help"><strong style="color:var(--text)">Last owner of</strong><br>${result.last_owner_shops.map(x=>esc(x)).join("<br>")}</div>
          </div>` : ""}
        ${Array.isArray(result.references) && result.references.length ? `
          <div class="card danger-zone" style="margin:14px 0">
            <div class="help"><strong style="color:var(--text)">Linked records</strong><br>${result.references.map(x=>esc(x)).join("<br>")}</div>
          </div>` : ""}
        <p><strong>Recommended:</strong> remove the original email and disable the account. Historical transactions stay intact, but the person can no longer sign in.</p>
        <div class="modal-actions">
          <button id="cancel-safe-delete" class="btn btn-secondary">Cancel</button>
          <button id="safe-delete-user" class="btn btn-danger">Remove Email & Disable</button>
        </div>`);
      document.querySelector("#cancel-safe-delete")?.addEventListener("click",closeModal);
      document.querySelector("#safe-delete-user")?.addEventListener("click",async()=>{
        closeModal();
        await adminUserAction(userId,"disable_anonymize");
      });
      return;
    }

    toast(result?.error || friendlyError(error),"error");
    return;
  }

  toast(
    action==="delete"?"User permanently deleted.":
    action==="disable_anonymize"?"Original email removed and account disabled. Business history was preserved.":
    action==="ban"?"User disabled.":"User enabled.",
    "success"
  );
  await loadAdminUsers();
}

async function loadAdminSupport() {
  const root=document.querySelector("#admin-content");
  if(!root) return;
  const {data,error}=await supabase.from("support_threads")
    .select("id,shop_id,subject,status,priority,last_message_at,created_at,ai_enabled,ai_handoff,shop:shops!inner(name,app_code)")
    .eq("shop.app_code","storepos")
    .order("last_message_at",{ascending:false})
    .limit(200);
  if(error){
    root.innerHTML=`<div class="empty"><strong>Unable to load support inbox</strong>${esc(friendlyError(error))}</div>`;
    return;
  }
  const threads=data||[];
  if(!state.supportThreadId || !threads.some(t=>t.id===state.supportThreadId)) state.supportThreadId=threads[0]?.id||null;
  root.innerHTML=`
    ${head("Support Inbox","Live conversations from StorePOS client shops")}
    <section class="metrics">
      <article class="metric"><div class="metric-label">Open</div><div class="metric-value">${number(threads.filter(t=>t.status==="open").length)}</div><div class="metric-sub">Need attention</div></article>
      <article class="metric"><div class="metric-label">Pending</div><div class="metric-value">${number(threads.filter(t=>t.status==="pending").length)}</div><div class="metric-sub">Waiting / in progress</div></article>
      <article class="metric"><div class="metric-label">Urgent</div><div class="metric-value">${number(threads.filter(t=>t.priority==="urgent"&&t.status!=="closed").length)}</div><div class="metric-sub">High priority queue</div></article>
      <article class="metric"><div class="metric-label">Closed</div><div class="metric-value">${number(threads.filter(t=>t.status==="closed").length)}</div><div class="metric-sub">Resolved conversations</div></article>
    </section>
    <div class="chat-layout">
      <div class="chat-list">${threads.map(t=>`<button class="chat-thread ${t.id===state.supportThreadId?"active":""}" data-thread="${t.id}"><strong>${esc(t.shop?.name||"Shop")} · ${esc(t.subject)}</strong><span>${esc(t.priority)} · ${esc(t.status)} · ${t.ai_handoff?"human":t.ai_enabled?"auto":"manual"} · ${niceDate(t.last_message_at,true)}</span></button>`).join("")||'<div class="empty"><strong>No support requests</strong>Client chats will appear here.</div>'}</div>
      <div id="admin-support-panel" class="chat-panel"></div>
    </div>`;
  root.querySelectorAll(".chat-thread").forEach(btn=>btn.addEventListener("click",async()=>{
    state.supportThreadId=btn.dataset.thread;
    await loadAdminSupport();
  }));
  await renderSupportChatPanel(document.querySelector("#admin-support-panel"),state.supportThreadId,true);
}


async function openLicenseModal(shopId, shopName, order = null) {
  const { data: plans, error } = await supabase
    .from("license_plans")
    .select("code,name,description,default_max_devices,default_max_staff,default_offline_grace_days,monthly_price_php,annual_price_php,marketing_note,features,sort_order,app_code")
    .eq("app_code","storepos")
    .eq("is_active",true)
    .order("sort_order");

  if (error || !plans?.length) {
    toast(friendlyError(error || new Error("No active plans found.")),"error");
    return;
  }

  const planMap = Object.fromEntries(plans.map(plan => [plan.code, plan]));
  const initialPlan=planMap[order?.requested_plan]?order.requested_plan:(planMap.store_pro?"store_pro":plans[0].code);
  const customOnlyFeatures=["paymongo_payments"];
  const allFeatures=[...new Set([...plans.flatMap(p=>Array.isArray(p.features)?p.features:[]),...customOnlyFeatures])];
  const initialFeatures=new Set(order&&Array.isArray(order.desired_features)?order.desired_features:(planMap[initialPlan]?.features||[]));
  const initialCycle=order?.billing_cycle||"annual";

  showModal(`
    <h2>${order?"Issue custom StorePOS license":"Issue / renew StorePOS license"}</h2>
    <p>${esc(shopName)} · ${order?"This form is prefilled from the client's custom order. Review before generating the key.":"Plan defaults load automatically. You can enable custom feature overrides for special contracts."}</p>
    <form id="license-form" class="form">
      <input type="hidden" name="shop_id" value="${esc(shopId)}">
      <input type="hidden" name="order_request_id" value="${esc(order?.id||"")}">
      <div class="grid-2">
        <div class="field"><label>Base plan</label><select class="input" name="plan" id="license-plan">
          ${plans.map(plan => `<option value="${esc(plan.code)}" ${plan.code===initialPlan?"selected":""}>${esc(plan.name)}</option>`).join("")}
        </select></div>
        <div class="field"><label>Billing cycle</label><select class="input" name="cycle" id="license-cycle">
          <option value="monthly" ${initialCycle==="monthly"?"selected":""}>Monthly</option>
          <option value="annual" ${initialCycle==="annual"?"selected":""}>Annual</option>
          <option value="custom" ${initialCycle==="custom"?"selected":""}>Custom term</option>
        </select></div>
      </div>
      <div id="license-plan-preview" class="license-plan-preview"></div>
      <div class="field"><label>Custom plan label (optional)</label><input class="input" name="custom_label" value="${esc(order?`Custom ${shopName}`:"")}" placeholder="Example: StorePOS Custom Business"></div>
      <div class="grid-2">
        <div class="field"><label>Expiration date</label><input class="input" type="date" name="expires" id="license-expires"></div>
        <div class="field"><label>Contract price (₱, optional)</label><input class="input" type="number" min="0" step="0.01" name="custom_price" value="${esc(order?.quoted_price_php??"")}" placeholder="Uses plan price if blank"></div>
      </div>
      <div class="grid-2">
        <div class="field"><label>Max devices</label><input class="input" type="number" min="1" name="devices" id="license-devices" value="${esc(order?.desired_devices??"")}"></div>
        <div class="field"><label>Max staff</label><input class="input" type="number" min="1" name="staff" id="license-staff" value="${esc(order?.desired_staff??"")}"></div>
      </div>
      <label class="custom-toggle"><input type="checkbox" id="license-use-custom-features" name="use_custom_features" ${order?"checked":""}><span>Use custom module selection for this license</span></label>
      <div class="feature-picker" id="license-feature-picker">
        ${allFeatures.map(code=>`<label><input type="checkbox" name="license_feature" value="${esc(code)}" ${initialFeatures.has(code)?"checked":""} ${order?"":"disabled"}><span>${esc(featureLabel(code))}</span></label>`).join("")}
      </div>
      <div class="help">Custom feature overrides are stored on this license only. The base plan remains for compatibility, pricing defaults and offline-grace rules.</div>
      <div class="modal-actions"><button type="button" id="close-license" class="btn btn-secondary">Cancel</button><button type="submit" class="btn btn-primary">Generate license</button></div>
    </form>`);

  const planSelect = document.querySelector("#license-plan");
  const cycleSelect = document.querySelector("#license-cycle");
  const expiresInput = document.querySelector("#license-expires");
  const devicesInput = document.querySelector("#license-devices");
  const staffInput = document.querySelector("#license-staff");
  const preview = document.querySelector("#license-plan-preview");
  const useCustom=document.querySelector("#license-use-custom-features");
  const featureInputs=[...document.querySelectorAll('#license-feature-picker input[name="license_feature"]')];

  function applyFeatureSet(features){
    const set=new Set(features||[]);
    featureInputs.forEach(input=>{input.checked=set.has(input.value);});
  }

  function refreshPlan(resetLimits = false, resetFeatures = false) {
    const plan = planMap[planSelect?.value] || plans[0];
    const cycle = cycleSelect?.value || "annual";
    if (resetLimits) {
      if (devicesInput) devicesInput.value = plan.default_max_devices;
      if (staffInput) staffInput.value = plan.default_max_staff;
    }
    if (resetFeatures && !useCustom?.checked) applyFeatureSet(plan.features||[]);
    if (expiresInput && cycle !== "custom") expiresInput.value = recommendedLicenseDate(cycle);

    const price = cycle === "monthly"
      ? plan.monthly_price_php
      : cycle === "annual"
        ? plan.annual_price_php
        : null;
    const features = Array.isArray(plan.features) ? plan.features : [];

    if (preview) preview.innerHTML = `
      <div><strong>${esc(plan.name)}</strong><span>${esc(plan.description || "")}</span></div>
      <div><strong>${price == null ? "Custom billing" : peso(price)}</strong><span>${number(plan.default_max_devices)} devices · ${number(plan.default_max_staff)} staff · ${number(plan.default_offline_grace_days)}-day offline grace</span></div>
      <div class="entitlement-grid compact">${features.map(feature => `<span class="entitlement-chip">✓ ${esc(featureLabel(feature))}</span>`).join("")}</div>
    `;
  }

  planSelect?.addEventListener("change",()=>refreshPlan(true,true));
  cycleSelect?.addEventListener("change",()=>refreshPlan(false,false));
  useCustom?.addEventListener("change",()=>{
    featureInputs.forEach(input=>input.disabled=!useCustom.checked);
    if(!useCustom.checked) applyFeatureSet(planMap[planSelect?.value]?.features||[]);
  });
  document.querySelector("#close-license")?.addEventListener("click",closeModal);
  document.querySelector("#license-form")?.addEventListener("submit",issueLicense);
  refreshPlan(!order,false);
  if(order){
    if(devicesInput) devicesInput.value=order.desired_devices;
    if(staffInput) staffInput.value=order.desired_staff;
    applyFeatureSet(order.desired_features||[]);
    featureInputs.forEach(input=>input.disabled=false);
  }
}

async function issueLicense(event) {
  event.preventDefault();
  const f = new FormData(event.currentTarget);
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled=true; button.textContent="Generating…";
  const expiresRaw = String(f.get("expires")||"");
  const expiresAt = expiresRaw ? new Date(expiresRaw+"T23:59:59+08:00").toISOString() : null;
  const cycle = String(f.get("cycle")||"annual");
  const useCustom=Boolean(event.currentTarget.querySelector("#license-use-custom-features")?.checked);
  const featureOverrides=useCustom
    ? [...event.currentTarget.querySelectorAll('input[name="license_feature"]:checked')].map(x=>x.value)
    : null;
  const customPriceRaw=String(f.get("custom_price")||"").trim();
  const orderId=String(f.get("order_request_id")||"").trim();

  const { data, error } = await supabase.rpc("admin_issue_license_v3", {
    p_shop_id:String(f.get("shop_id")),
    p_plan_code:String(f.get("plan")),
    p_billing_cycle:cycle,
    p_expires_at:expiresAt,
    p_max_devices:Number(f.get("devices"))||null,
    p_max_staff:Number(f.get("staff"))||null,
    p_feature_overrides:featureOverrides,
    p_custom_price_php:customPriceRaw?Number(customPriceRaw):null,
    p_custom_label:String(f.get("custom_label")||"").trim()||null,
    p_order_request_id:orderId||null
  });

  if (error) {
    toast(friendlyError(error),"error"); button.disabled=false; button.textContent="Generate license"; return;
  }

  const result = data || {};
  showModal(`
    <h2>License generated</h2>
    <p>Copy this key now. StorePOS stores only its cryptographic hash, so the full key is not retrievable later.</p>
    <div class="key-box" id="issued-key">${esc(result.license_key||"")}</div>
    <div class="stat-list" style="margin-top:13px">
      <div class="stat-row"><span>Plan</span><strong>${esc(result.plan_name||result.plan_code||"")}${result.custom?" · Custom":""}</strong></div>
      <div class="stat-row"><span>Billing</span><strong>${esc(result.billing_cycle||"")}${result.amount_php!=null?` · ${peso(result.amount_php)}`:""}</strong></div>
      <div class="stat-row"><span>Devices</span><strong>${esc(result.max_devices||"")}</strong></div>
      <div class="stat-row"><span>Staff</span><strong>${esc(result.max_staff||"")}</strong></div>
      <div class="stat-row"><span>Modules</span><strong>${Array.isArray(result.features)?number(result.features.length):0}</strong></div>
      <div class="stat-row"><span>Offline grace</span><strong>${esc(result.offline_grace_days||"")} days</strong></div>
      <div class="stat-row"><span>Expires</span><strong>${niceDate(result.expires_at)}</strong></div>
    </div>
    <div class="modal-actions"><button id="copy-key" class="btn btn-primary">Copy key</button><button id="done-key" class="btn btn-secondary">Done</button></div>`);
  document.querySelector("#copy-key")?.addEventListener("click", async()=>{
    await navigator.clipboard.writeText(result.license_key||"");
    toast("License key copied.","success");
  });
  document.querySelector("#done-key")?.addEventListener("click",async()=>{closeModal();await loadAdminClients();});
}


async function setLicenseStatus(shopId, status) {
  if (!confirm(`${status==="suspended"?"Suspend":"Reactivate"} this StorePOS license?`)) return;
  const { error } = await supabase.rpc("admin_set_license_status",{p_shop_id:shopId,p_status:status});
  if (error) return toast(friendlyError(error),"error");
  toast(`License ${status}.`,"success");
  await loadAdminClients();
}

async function resetDevices(shopId) {
  if (!confirm("Deactivate all registered devices for this shop? They will need to activate again.")) return;
  const { data, error } = await supabase.rpc("admin_reset_devices",{p_shop_id:shopId});
  if (error) return toast(friendlyError(error),"error");
  toast(`${data||0} device(s) reset.`,"success");
  await loadAdminClients();
}


function portalTokenFromPath() {
  const path = currentPath();
  const query = path.includes("?") ? path.slice(path.indexOf("?") + 1) : "";
  return new URLSearchParams(query).get("token") || "";
}

function portalStatus(value) {
  return pill(value || "—");
}

async function renderCustomerPortal() {
  const token = portalTokenFromPath();

  if (!token) {
    app.innerHTML = [
      '<div class="portal-shell">',
        '<div class="portal-wrap">',
          '<div class="portal-brand"><span class="brand-logo">M</span><span>StorePOS Customer Portal</span></div>',
          '<div class="portal-card portal-error-card">',
            '<span class="eyebrow">Private customer access</span>',
            '<h1>Portal link required</h1>',
            '<p>This page needs the secure customer link issued by the retail shop.</p>',
            '<a class="btn btn-secondary" href="#/">Back to StorePOS</a>',
          '</div>',
        '</div>',
      '</div>'
    ].join("");
    return;
  }

  app.innerHTML = [
    '<div class="portal-shell">',
      '<div class="portal-wrap">',
        '<div class="portal-brand"><span class="brand-logo">M</span><span>StorePOS Customer Portal</span></div>',
        '<div class="portal-card">',
          '<div class="portal-loading"><span class="spinner"></span><strong>Loading your service records…</strong></div>',
        '</div>',
      '</div>',
    '</div>'
  ].join("");

  const result = await supabase.rpc("portal_customer_snapshot", { p_token: token });
  if (result.error) {
    app.innerHTML = [
      '<div class="portal-shell">',
        '<div class="portal-wrap">',
          '<div class="portal-brand"><span class="brand-logo">M</span><span>StorePOS Customer Portal</span></div>',
          '<div class="portal-card portal-error-card">',
            '<span class="eyebrow">Secure link</span>',
            '<h1>Link unavailable</h1>',
            '<p>', esc(friendlyError(result.error)), '</p>',
            '<p class="muted">The link may be invalid, expired, or revoked. Request a new customer portal link from your shop.</p>',
          '</div>',
        '</div>',
      '</div>'
    ].join("");
    return;
  }

  const snapshot = result.data || {};
  const shop = snapshot.shop || {};
  const customer = snapshot.customer || {};
  const retails = Array.isArray(snapshot.retails) ? snapshot.retails : [];
  const jobs = Array.isArray(snapshot.jobs) ? snapshot.jobs : [];
  const warranties = Array.isArray(snapshot.warranties) ? snapshot.warranties : [];
  const bookings = Array.isArray(snapshot.bookings) ? snapshot.bookings : [];

  const retailOptions = retails.length
    ? retails.map(function (bike) {
        const label = [bike.make, bike.model, bike.variant, bike.plate_number].filter(Boolean).join(" • ");
        return '<option value="' + esc(bike.id) + '">' + esc(label || "Retail") + '</option>';
      }).join("")
    : '<option value="">No retail on file</option>';

  const retailCards = retails.length
    ? retails.map(function (bike) {
        return [
          '<div class="portal-list-item">',
            '<div>',
              '<strong>', esc([bike.make, bike.model].filter(Boolean).join(" ") || "Retail"), '</strong>',
              '<span>', esc([bike.variant, bike.model_year, bike.plate_number].filter(Boolean).join(" • ") || "No plate details"), '</span>',
            '</div>',
            '<b>', esc(bike.odometer_km != null ? number(bike.odometer_km) + " km" : "—"), '</b>',
          '</div>'
        ].join("");
      }).join("")
    : '<div class="portal-empty">No retail records yet.</div>';

  const jobCards = jobs.length
    ? jobs.map(function (job) {
        return [
          '<div class="portal-list-item portal-list-stack">',
            '<div class="portal-row">',
              '<div>',
                '<strong>', esc(job.job_number || "Job order"), '</strong>',
                '<span>', esc(niceDate(job.created_at, true)), '</span>',
              '</div>',
              portalStatus(job.status),
            '</div>',
            '<p>', esc(job.complaint || "No complaint / service note recorded."), '</p>',
            job.estimated_completion ? '<small>Estimated completion: ' + esc(niceDate(job.estimated_completion, true)) + '</small>' : '',
          '</div>'
        ].join("");
      }).join("")
    : '<div class="portal-empty">No service job history yet.</div>';

  const warrantyCards = warranties.length
    ? warranties.map(function (warranty) {
        return [
          '<div class="portal-list-item portal-list-stack">',
            '<div class="portal-row">',
              '<div>',
                '<strong>', esc(warranty.description || "Warranty"), '</strong>',
                '<span>', esc((warranty.warranty_type || "warranty") + " • " + (warranty.starts_on || "—") + " to " + (warranty.expires_on || "No expiry")), '</span>',
              '</div>',
              portalStatus(warranty.status),
            '</div>',
          '</div>'
        ].join("");
      }).join("")
    : '<div class="portal-empty">No warranty records available.</div>';

  const bookingCards = bookings.length
    ? bookings.map(function (booking) {
        return [
          '<div class="portal-list-item">',
            '<div>',
              '<strong>', esc(niceDate(booking.requested_at, true)), '</strong>',
              '<span>', esc(booking.service_notes || "Service appointment"), '</span>',
            '</div>',
            portalStatus(booking.status),
          '</div>'
        ].join("");
      }).join("")
    : '<div class="portal-empty">No bookings yet.</div>';

  app.innerHTML = [
    '<div class="portal-shell">',
      '<div class="portal-wrap">',
        '<header class="portal-header">',
          '<div class="portal-brand"><span class="brand-logo">M</span><span>StorePOS Customer Portal</span></div>',
          '<div class="portal-shop">',
            '<strong>', esc(shop.name || "StorePOS Shop"), '</strong>',
            '<span>', esc([shop.phone, shop.email].filter(Boolean).join(" • ") || "Customer service portal"), '</span>',
          '</div>',
        '</header>',

        '<section class="portal-hero-card">',
          '<div>',
            '<span class="eyebrow">Private service dashboard</span>',
            '<h1>Hello, ', esc(customer.name || "Rider"), '</h1>',
            '<p>Review your retail records, service progress, warranty coverage and appointments in one place.</p>',
          '</div>',
          '<div class="portal-wallet">',
            '<div><span>Loyalty points</span><strong>', esc(number(customer.loyalty_points || 0)), '</strong></div>',
            '<div><span>Store credit</span><strong>', esc(money(customer.store_credit_balance || 0)), '</strong></div>',
          '</div>',
        '</section>',

        '<div class="portal-grid">',
          '<section class="portal-card">',
            '<div class="portal-section-head"><div><span class="eyebrow">Garage</span><h2>Your retails</h2></div></div>',
            retailCards,
          '</section>',

          '<section class="portal-card">',
            '<div class="portal-section-head"><div><span class="eyebrow">Workshop</span><h2>Service history</h2></div></div>',
            jobCards,
          '</section>',

          '<section class="portal-card">',
            '<div class="portal-section-head"><div><span class="eyebrow">Coverage</span><h2>Warranty</h2></div></div>',
            warrantyCards,
          '</section>',

          '<section class="portal-card">',
            '<div class="portal-section-head"><div><span class="eyebrow">Appointments</span><h2>Bookings</h2></div></div>',
            bookingCards,
          '</section>',
        '</div>',

        '<section class="portal-card portal-booking-card">',
          '<div class="portal-section-head">',
            '<div><span class="eyebrow">Book a visit</span><h2>Request service</h2></div>',
            '<span class="portal-private">Secure customer link</span>',
          '</div>',
          '<div class="portal-form-grid">',
            '<label><span>Retail</span><select id="portal-bike">', retailOptions, '</select></label>',
            '<label><span>Preferred date & time</span><input id="portal-booking-at" type="datetime-local" /></label>',
            '<label class="portal-full"><span>Requested service / concern</span><textarea id="portal-booking-notes" rows="4" placeholder="Example: change oil, check front brake, tune-up…"></textarea></label>',
          '</div>',
          '<div class="portal-form-actions">',
            '<span id="portal-booking-message" class="muted">The shop will review and confirm your request.</span>',
            '<button id="portal-booking-submit" class="btn btn-primary" type="button">Request booking</button>',
          '</div>',
        '</section>',

        '<footer class="portal-footer">',
          '<span>Powered by StorePOS</span>',
          '<span>', esc(shop.address || "Retail parts & service management"), '</span>',
        '</footer>',
      '</div>',
    '</div>'
  ].join("");

  const dateInput = document.querySelector("#portal-booking-at");
  if (dateInput) {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset() + 60);
    dateInput.min = now.toISOString().slice(0, 16);
  }

  document.querySelector("#portal-booking-submit")?.addEventListener("click", async function () {
    const button = document.querySelector("#portal-booking-submit");
    const message = document.querySelector("#portal-booking-message");
    const retailId = document.querySelector("#portal-bike")?.value || null;
    const localDate = document.querySelector("#portal-booking-at")?.value || "";
    const notes = document.querySelector("#portal-booking-notes")?.value?.trim() || "";

    if (!localDate) {
      if (message) message.textContent = "Choose your preferred date and time.";
      return;
    }

    const parsed = new Date(localDate);
    if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
      if (message) message.textContent = "Please choose a future appointment time.";
      return;
    }

    if (button) {
      button.disabled = true;
      button.textContent = "Sending…";
    }
    if (message) message.textContent = "Sending booking request…";

    const booking = await supabase.rpc("portal_create_booking", {
      p_token: token,
      p_retail_id: retailId || null,
      p_requested_at: parsed.toISOString(),
      p_service_notes: notes || null
    });

    if (booking.error) {
      if (message) message.textContent = friendlyError(booking.error);
      if (button) {
        button.disabled = false;
        button.textContent = "Request booking";
      }
      return;
    }

    toast("Booking request sent.", "success");
    await renderCustomerPortal();
  });
}

async function route() {
  const path = currentPath();

  if (new URLSearchParams(location.search).get("email-confirmed") === "1") {
    renderEmailVerified();
    return;
  }

  if (path === "confirm-email" || path.startsWith("confirm-email?")) {
    renderEmailConfirmationGate();
    return;
  }

  if (path === "manual") {
    renderManual();
    return;
  }

  if (path.startsWith("receipt/")) {
    const token = path.slice("receipt/".length).split("?")[0].trim();
    await renderDigitalReceipt(app, retailContext(), token);
    return;
  }

  if (path === "portal" || path.startsWith("portal?")) {
    await renderCustomerPortal();
    return;
  }

  if (!state.session) {
    if (path.startsWith("login")) renderAuth();
    else renderLanding();
    return;
  }

  if (path === "admin" || path.startsWith("admin/")) {
    await renderAdmin();
    return;
  }

  if (!state.membership || !state.shop) {
    if (state.isSystemAdmin && (path === "admin" || path.startsWith("admin/"))) await renderAdmin();
    else renderSetup();
    return;
  }

  const page = path.startsWith("dashboard/") ? path.split("/")[1] : "overview";
  renderShell(page || "overview");
}

async function init() {
  const { data } = await supabase.auth.getSession();
  state.session = data.session;
  await loadAccessContext();

  supabase.auth.onAuthStateChange(async (_event, session) => {
    state.session = session;
    await loadAccessContext();
    route();
  });

  window.addEventListener("hashchange", route);
  route();
}

init().catch(error => {
  console.error(error);
  app.innerHTML = `<div class="setup"><div class="setup-card"><h1>StorePOS Cloud</h1><p>${esc(friendlyError(error))}</p><button class="btn btn-primary" onclick="location.reload()">Reload</button></div></div>`;
});
