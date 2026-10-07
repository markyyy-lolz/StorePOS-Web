import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm";

const SUPABASE_URL = "https://qgyzdoltjlryjthxxscw.supabase.co";
const SUPABASE_KEY = "sb_publishable_mCjtfE-W75s1yyUdw2NY2g_z6ic5DIc";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});

const esc = value => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

let cachedContext = null;
let overlay = null;
let mutationTimer = null;

function notify(message, type = "") {
  const root = document.querySelector("#toast-root");
  if (!root) return window.alert(message);
  const node = document.createElement("div");
  node.className = `toast ${type}`;
  node.textContent = message;
  root.appendChild(node);
  setTimeout(() => node.remove(), 4300);
}

async function getShopContext(force = false) {
  if (cachedContext && !force) return cachedContext;
  const { data: sessionData } = await supabase.auth.getSession();
  const user = sessionData?.session?.user;
  if (!user) throw new Error("Sign in to StorePOS first.");

  const { data, error } = await supabase
    .from("shop_members")
    .select("shop_id,role,is_active,shop:shops!inner(id,app_code)")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .eq("shop.app_code", "storepos")
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data?.shop_id) throw new Error("No StorePOS shop is available for this account.");
  cachedContext = { shopId: data.shop_id, role: String(data.role || "").toLowerCase() };
  return cachedContext;
}

function canManage(role) {
  return ["owner", "admin", "manager", "inventory"].includes(role);
}

async function loadCategories(shopId) {
  const [categoriesRes, productsRes] = await Promise.all([
    supabase.from("product_categories")
      .select("id,name,description,sort_order,is_active")
      .eq("shop_id", shopId)
      .order("sort_order")
      .order("name"),
    supabase.from("products")
      .select("id,category_id")
      .eq("shop_id", shopId)
  ]);
  if (categoriesRes.error) throw categoriesRes.error;
  if (productsRes.error) throw productsRes.error;
  const usage = new Map();
  (productsRes.data || []).forEach(product => {
    if (!product.category_id) return;
    usage.set(product.category_id, (usage.get(product.category_id) || 0) + 1);
  });
  return (categoriesRes.data || []).map(category => ({
    ...category,
    product_count: usage.get(category.id) || 0
  }));
}

function ensureStyles() {
  if (document.querySelector("#storepos-category-manager-style")) return;
  const style = document.createElement("style");
  style.id = "storepos-category-manager-style";
  style.textContent = `
    .category-overlay{position:fixed;inset:0;z-index:12000;background:rgba(3,9,18,.72);backdrop-filter:blur(8px);display:grid;place-items:center;padding:18px}
    .category-dialog{width:min(920px,96vw);max-height:90vh;overflow:auto;background:#0d1928;border:1px solid rgba(255,255,255,.11);border-radius:24px;box-shadow:0 26px 70px rgba(0,0,0,.42);padding:22px;color:#eef6ff}
    .category-dialog.narrow{width:min(520px,96vw)}
    .category-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:18px}
    .category-head h2{margin:0 0 5px}.category-head p{margin:0;color:#9fb0c4}
    .category-close{border:0;background:rgba(255,255,255,.08);color:#fff;width:40px;height:40px;border-radius:12px;cursor:pointer;font-size:20px}
    .category-toolbar{display:flex;gap:10px;flex-wrap:wrap;margin:0 0 16px}
    .category-form-grid{display:grid;grid-template-columns:1fr 1.4fr auto;gap:10px;align-items:end;margin-bottom:18px}
    .category-list{display:grid;gap:10px}
    .category-row{display:grid;grid-template-columns:minmax(160px,1.2fr) minmax(180px,1.6fr) 90px auto;gap:12px;align-items:center;padding:13px;border:1px solid rgba(255,255,255,.09);border-radius:16px;background:rgba(255,255,255,.035)}
    .category-row.inactive{opacity:.68}.category-name{font-weight:800}.category-meta{font-size:12px;color:#9fb0c4;margin-top:4px}
    .category-actions{display:flex;justify-content:flex-end;gap:6px;flex-wrap:wrap}.category-sort{display:flex;gap:5px;justify-content:center}
    .category-mini-btn{min-width:36px;height:34px;border-radius:10px;border:1px solid rgba(255,255,255,.13);background:rgba(255,255,255,.055);color:#eaf4ff;cursor:pointer}
    .category-empty{padding:26px;text-align:center;border:1px dashed rgba(255,255,255,.13);border-radius:16px;color:#9fb0c4}
    .category-inline-add{margin-top:8px!important;align-self:flex-start}
    @media(max-width:720px){.category-form-grid{grid-template-columns:1fr}.category-row{grid-template-columns:1fr}.category-actions,.category-sort{justify-content:flex-start}}
  `;
  document.head.appendChild(style);
}

function closeOverlay() {
  overlay?.remove();
  overlay = null;
}

function mountOverlay(html, narrow = false) {
  closeOverlay();
  ensureStyles();
  overlay = document.createElement("div");
  overlay.className = "category-overlay";
  overlay.innerHTML = `<section class="category-dialog ${narrow ? "narrow" : ""}">${html}</section>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", event => {
    if (event.target === overlay || event.target.closest("[data-category-close]")) closeOverlay();
  });
  return overlay;
}

async function createCategory(shopId, name, description = "") {
  const cleanName = String(name || "").trim();
  if (!cleanName) throw new Error("Category name is required.");

  const { data: existing, error: existingError } = await supabase
    .from("product_categories")
    .select("id,name,is_active")
    .eq("shop_id", shopId)
    .ilike("name", cleanName)
    .limit(1)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) throw new Error(`Category “${existing.name}” already exists${existing.is_active ? "" : " but is disabled"}.`);

  const { data: latest, error: sortError } = await supabase
    .from("product_categories")
    .select("sort_order")
    .eq("shop_id", shopId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (sortError) throw sortError;

  const { data, error } = await supabase.from("product_categories").insert({
    shop_id: shopId,
    name: cleanName,
    description: String(description || "").trim() || null,
    sort_order: Number(latest?.sort_order || 0) + 10,
    is_active: true
  }).select("id,name,description,sort_order,is_active").single();
  if (error) throw error;
  return data;
}

async function openQuickAdd(select) {
  const context = await getShopContext();
  if (!canManage(context.role)) return notify("Your role cannot manage product categories.", "error");

  const view = mountOverlay(`
    <div class="category-head">
      <div><h2>Add category</h2><p>Create a reusable inventory category for this StorePOS shop.</p></div>
      <button class="category-close" type="button" data-category-close>×</button>
    </div>
    <form id="quick-category-form" class="form">
      <div class="field"><label>Category name</label><input class="input" name="name" maxlength="80" required placeholder="Example: Beverages"></div>
      <div class="field"><label>Description <span class="help">Optional</span></label><textarea class="input" name="description" maxlength="240" placeholder="What belongs in this category?"></textarea></div>
      <div class="modal-actions"><button type="button" class="btn btn-secondary" data-category-close>Cancel</button><button type="submit" class="btn btn-primary">Save category</button></div>
    </form>
  `, true);

  view.querySelector("#quick-category-form")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const fd = new FormData(form);
    button.disabled = true;
    button.textContent = "Saving…";
    try {
      const category = await createCategory(context.shopId, fd.get("name"), fd.get("description"));
      const option = document.createElement("option");
      option.value = category.id;
      option.textContent = category.name;
      option.selected = true;
      select.appendChild(option);
      select.value = category.id;
      closeOverlay();
      notify(`Category “${category.name}” added and selected.`, "success");
    } catch (error) {
      notify(error?.message || "Unable to add category.", "error");
      button.disabled = false;
      button.textContent = "Save category";
    }
  });
}

async function normalizeOrder(shopId, categories) {
  for (let i = 0; i < categories.length; i += 1) {
    const { error } = await supabase.from("product_categories")
      .update({ sort_order: (i + 1) * 10 })
      .eq("id", categories[i].id)
      .eq("shop_id", shopId);
    if (error) throw error;
  }
}

async function openCategoryManager() {
  const context = await getShopContext(true);
  if (!canManage(context.role)) return notify("Your role cannot manage product categories.", "error");

  async function render() {
    const categories = await loadCategories(context.shopId);
    const view = mountOverlay(`
      <div class="category-head">
        <div><h2>Manage Categories</h2><p>Add, rename, reorder or disable inventory categories. Products keep their category when a category is disabled.</p></div>
        <button class="category-close" type="button" data-category-close>×</button>
      </div>
      <form id="category-create-form" class="category-form-grid">
        <div class="field"><label>New category</label><input class="input" name="name" maxlength="80" required placeholder="Category name"></div>
        <div class="field"><label>Description</label><input class="input" name="description" maxlength="240" placeholder="Optional description"></div>
        <button class="btn btn-primary" type="submit">+ Add category</button>
      </form>
      <div class="category-list">
        ${categories.length ? categories.map((category, index) => `
          <div class="category-row ${category.is_active ? "" : "inactive"}" data-category-id="${category.id}">
            <div><div class="category-name">${esc(category.name)}</div><div class="category-meta">${category.product_count} product(s) · ${category.is_active ? "Active" : "Disabled"}</div></div>
            <div>${esc(category.description || "No description")}</div>
            <div class="category-sort">
              <button class="category-mini-btn" type="button" data-category-up="${category.id}" ${index === 0 ? "disabled" : ""} title="Move up">↑</button>
              <button class="category-mini-btn" type="button" data-category-down="${category.id}" ${index === categories.length - 1 ? "disabled" : ""} title="Move down">↓</button>
            </div>
            <div class="category-actions">
              <button class="btn btn-secondary btn-sm" type="button" data-category-edit="${category.id}">Edit</button>
              <button class="btn ${category.is_active ? "btn-danger" : "btn-success"} btn-sm" type="button" data-category-toggle="${category.id}">${category.is_active ? "Disable" : "Enable"}</button>
            </div>
          </div>`).join("") : '<div class="category-empty">No categories yet. Add your first category above.</div>'}
      </div>
    `);

    view.querySelector("#category-create-form")?.addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('button[type="submit"]');
      const fd = new FormData(form);
      button.disabled = true;
      try {
        const category = await createCategory(context.shopId, fd.get("name"), fd.get("description"));
        notify(`Category “${category.name}” added.`, "success");
        await render();
      } catch (error) {
        notify(error?.message || "Unable to add category.", "error");
        button.disabled = false;
      }
    });

    view.querySelectorAll("[data-category-edit]").forEach(button => button.addEventListener("click", () => {
      const category = categories.find(item => item.id === button.dataset.categoryEdit);
      if (!category) return;
      const edit = mountOverlay(`
        <div class="category-head"><div><h2>Edit category</h2><p>${category.product_count} product(s) currently use this category.</p></div><button class="category-close" type="button" data-category-close>×</button></div>
        <form id="category-edit-form" class="form">
          <div class="field"><label>Category name</label><input class="input" name="name" maxlength="80" required value="${esc(category.name)}"></div>
          <div class="field"><label>Description</label><textarea class="input" name="description" maxlength="240">${esc(category.description || "")}</textarea></div>
          <div class="modal-actions"><button type="button" id="back-category-manager" class="btn btn-secondary">Back</button><button type="submit" class="btn btn-primary">Save changes</button></div>
        </form>
      `, true);
      edit.querySelector("#back-category-manager")?.addEventListener("click", render);
      edit.querySelector("#category-edit-form")?.addEventListener("submit", async event => {
        event.preventDefault();
        const fd = new FormData(event.currentTarget);
        const name = String(fd.get("name") || "").trim();
        if (!name) return;
        const duplicate = categories.find(item => item.id !== category.id && item.name.toLowerCase() === name.toLowerCase());
        if (duplicate) return notify(`Category “${duplicate.name}” already exists.`, "error");
        const { error } = await supabase.from("product_categories").update({
          name,
          description: String(fd.get("description") || "").trim() || null
        }).eq("id", category.id).eq("shop_id", context.shopId);
        if (error) return notify(error.message, "error");
        notify("Category updated.", "success");
        await render();
      });
    }));

    view.querySelectorAll("[data-category-toggle]").forEach(button => button.addEventListener("click", async () => {
      const category = categories.find(item => item.id === button.dataset.categoryToggle);
      if (!category) return;
      if (category.is_active && category.product_count > 0) {
        const ok = window.confirm(`Disable “${category.name}”? ${category.product_count} product(s) will keep this category, but it will no longer appear when assigning a category to new products.`);
        if (!ok) return;
      }
      const { error } = await supabase.from("product_categories")
        .update({ is_active: !category.is_active })
        .eq("id", category.id)
        .eq("shop_id", context.shopId);
      if (error) return notify(error.message, "error");
      notify(category.is_active ? "Category disabled." : "Category enabled.", "success");
      await render();
    }));

    async function move(id, offset) {
      const index = categories.findIndex(item => item.id === id);
      const next = index + offset;
      if (index < 0 || next < 0 || next >= categories.length) return;
      const reordered = [...categories];
      [reordered[index], reordered[next]] = [reordered[next], reordered[index]];
      try {
        await normalizeOrder(context.shopId, reordered);
        await render();
      } catch (error) {
        notify(error?.message || "Unable to reorder categories.", "error");
      }
    }

    view.querySelectorAll("[data-category-up]").forEach(button => button.addEventListener("click", () => move(button.dataset.categoryUp, -1)));
    view.querySelectorAll("[data-category-down]").forEach(button => button.addEventListener("click", () => move(button.dataset.categoryDown, 1)));
  }

  try { await render(); }
  catch (error) { notify(error?.message || "Unable to load categories.", "error"); }
}

function enhanceInventory() {
  const addProduct = document.querySelector("#add-product");
  if (addProduct && !document.querySelector("#manage-categories")) {
    const manage = document.createElement("button");
    manage.id = "manage-categories";
    manage.type = "button";
    manage.className = "btn btn-secondary";
    manage.textContent = "Manage categories";
    manage.addEventListener("click", openCategoryManager);
    addProduct.insertAdjacentElement("beforebegin", manage);
  }

  const categorySelect = document.querySelector('#product-form select[name="category_id"]');
  if (categorySelect && !document.querySelector("#quick-add-category")) {
    const field = categorySelect.closest(".field");
    const button = document.createElement("button");
    button.id = "quick-add-category";
    button.type = "button";
    button.className = "btn btn-secondary btn-sm category-inline-add";
    button.textContent = "+ Add category";
    button.addEventListener("click", () => openQuickAdd(categorySelect).catch(error => notify(error?.message || "Unable to open category manager.", "error")));
    field?.appendChild(button);
  }
}

ensureStyles();
const observer = new MutationObserver(() => {
  clearTimeout(mutationTimer);
  mutationTimer = setTimeout(enhanceInventory, 30);
});
observer.observe(document.body, { childList: true, subtree: true });
window.addEventListener("hashchange", () => {
  cachedContext = null;
  setTimeout(enhanceInventory, 50);
});
setTimeout(enhanceInventory, 50);
