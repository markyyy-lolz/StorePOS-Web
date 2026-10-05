
function safeQty(value) {
  const n = Number(value || 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/,"").replace(/\.$/,"");
}

async function opsAction(ctx, action, data = {}) {
  const result = await ctx.supabase.rpc("storepos_v13_action", {
    p_shop_id: ctx.state.shop.id,
    p_action: action,
    p_data: data
  });
  if (result.error) throw result.error;
  return result.data;
}

function healthCount(health) {
  return ["duplicate_barcodes","negative_stock","missing_cost","expired_batches","stale_scheduled_prices"]
    .reduce((sum,key)=>sum+(Array.isArray(health?.[key])?health[key].length:0),0);
}

function healthRows(ctx, health) {
  const groups = [
    ["Duplicate barcodes","duplicate_barcodes", x => x.barcode + " · " + x.count + " products"],
    ["Negative stock","negative_stock", x => x.name + " · " + safeQty(x.stock_quantity)],
    ["Missing cost","missing_cost", x => x.name + " · selling " + ctx.money(x.selling_price)],
    ["Expired batches","expired_batches", x => x.name + " · " + x.batch_number + " · " + x.expires_on],
    ["Stale scheduled prices","stale_scheduled_prices", x => x.name + " · " + ctx.money(x.price)]
  ];
  return groups.map(([label,key,format]) => {
    const items = Array.isArray(health?.[key]) ? health[key] : [];
    return '<div class="card"><div class="card-title"><h3>'+ctx.esc(label)+'</h3><span>'+ctx.number(items.length)+'</span></div>' +
      (items.slice(0,8).map(x=>'<div class="stat-row"><span>'+ctx.esc(format(x))+'</span><strong>'+ctx.pill("check")+'</strong></div>').join("") ||
      '<div class="help">No issue detected.</div>') + '</div>';
  }).join("");
}

function openReconcile(ctx, reload) {
  const today = new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Manila"});
  ctx.showModal(
    '<h2>E-wallet reconciliation</h2><p>Compare StorePOS payment totals with the actual merchant wallet/bank total.</p>'+
    '<form id="ops-reconcile-form" class="form">'+
      '<div class="grid-2"><div class="field"><label>Date</label><input class="input" type="date" name="business_date" value="'+today+'" required></div>'+
      '<div class="field"><label>Channel</label><select class="input" name="method"><option value="gcash">GCash</option><option value="maya">Maya</option><option value="card">Card</option><option value="bank">Bank transfer</option><option value="other">Other</option></select></div></div>'+
      '<div class="field"><label>Actual provider total</label><input class="input" type="number" min="0" step="0.01" name="actual_amount" required></div>'+
      '<div class="field"><label>Statement / batch reference</label><input class="input" name="reference" placeholder="Optional"></div>'+
      '<div class="field"><label>Notes</label><textarea class="input" name="notes"></textarea></div>'+
      '<div class="modal-actions"><button type="button" id="ops-reconcile-close" class="btn btn-secondary">Cancel</button><button type="submit" class="btn btn-primary">Reconcile</button></div>'+
    '</form>'
  );
  document.querySelector("#ops-reconcile-close")?.addEventListener("click",ctx.closeModal);
  document.querySelector("#ops-reconcile-form")?.addEventListener("submit",async event=>{
    event.preventDefault();
    const fd=new FormData(event.currentTarget);
    try {
      const row=await opsAction(ctx,"reconcile_payment",{
        business_date:String(fd.get("business_date")||""),
        method:String(fd.get("method")||"gcash"),
        actual_amount:Number(fd.get("actual_amount")||0),
        reference:String(fd.get("reference")||"").trim(),
        notes:String(fd.get("notes")||"").trim()
      });
      ctx.closeModal();
      ctx.toast("Reconciliation saved. Variance: "+ctx.money(row?.variance||0),Number(row?.variance||0)===0?"success":"error");
      await reload();
    } catch(error) { ctx.toast(ctx.friendlyError(error),"error"); }
  });
}

function openApprovalRequest(ctx, reload) {
  ctx.showModal(
    '<h2>Request manager approval</h2><p>Cashiers can queue an exception for manager review without sharing the manager PIN.</p>'+
    '<form id="ops-approval-form" class="form">'+
      '<div class="field"><label>Approval type</label><select class="input" name="approval_type">'+
        '<option value="discount">Large discount</option><option value="price_override">Price override</option><option value="negative_stock">Negative-stock sale</option>'+
        '<option value="void">Void</option><option value="refund">Refund</option><option value="cash_drawer">Cash drawer</option><option value="other">Other</option>'+
      '</select></div>'+
      '<div class="field"><label>Reason</label><textarea class="input" name="reason" required placeholder="Explain why approval is needed"></textarea></div>'+
      '<div class="field"><label>Details</label><textarea class="input" name="details" placeholder="Optional transaction/product details"></textarea></div>'+
      '<div class="modal-actions"><button type="button" id="ops-approval-close" class="btn btn-secondary">Cancel</button><button type="submit" class="btn btn-primary">Send request</button></div>'+
    '</form>'
  );
  document.querySelector("#ops-approval-close")?.addEventListener("click",ctx.closeModal);
  document.querySelector("#ops-approval-form")?.addEventListener("submit",async event=>{
    event.preventDefault();
    const fd=new FormData(event.currentTarget);
    try {
      await opsAction(ctx,"request_approval",{
        approval_type:String(fd.get("approval_type")||"other"),
        reason:String(fd.get("reason")||"").trim(),
        request_payload:{details:String(fd.get("details")||"").trim()}
      });
      ctx.closeModal(); ctx.toast("Approval request sent.","success"); await reload();
    } catch(error) { ctx.toast(ctx.friendlyError(error),"error"); }
  });
}

function openXReport(ctx, shifts) {
  const open = shifts.filter(s=>s.status==="open");
  ctx.showModal(
    '<h2>X Report</h2><p>Live shift snapshot. This does not close the register or create a Z report.</p>'+
    '<form id="ops-x-form" class="form">'+
      '<div class="field"><label>Open shift</label><select class="input" name="shift_id"><option value="">My current shift</option>'+
        open.map(s=>'<option value="'+s.id+'">'+ctx.esc(s.user_id.slice(0,8))+'… · '+ctx.esc(ctx.niceDate(s.started_at,true))+'</option>').join("")+
      '</select></div>'+
      '<div class="modal-actions"><button type="button" id="ops-x-close" class="btn btn-secondary">Close</button><button type="submit" class="btn btn-primary">Generate X report</button></div>'+
      '<div id="ops-x-result"></div>'+
    '</form>'
  );
  document.querySelector("#ops-x-close")?.addEventListener("click",ctx.closeModal);
  document.querySelector("#ops-x-form")?.addEventListener("submit",async event=>{
    event.preventDefault();
    const fd=new FormData(event.currentTarget);
    try {
      const x=await opsAction(ctx,"x_report",{shift_id:String(fd.get("shift_id")||"")});
      const payments=x?.payment_breakdown||{};
      const box=document.querySelector("#ops-x-result");
      if(box) box.innerHTML=
        '<div class="stat-list" style="margin-top:16px">'+
        '<div class="stat-row"><span>Transactions</span><strong>'+ctx.number(x.transaction_count)+'</strong></div>'+
        '<div class="stat-row"><span>Gross sales</span><strong>'+ctx.money(x.gross_sales)+'</strong></div>'+
        '<div class="stat-row"><span>Cash sales</span><strong>'+ctx.money(x.cash_sales)+'</strong></div>'+
        '<div class="stat-row"><span>Non-cash</span><strong>'+ctx.money(x.noncash_sales)+'</strong></div>'+
        '<div class="stat-row"><span>Expected cash</span><strong>'+ctx.money(x.expected_cash)+'</strong></div>'+
        Object.entries(payments).map(([k,v])=>'<div class="stat-row"><span>'+ctx.esc(k.toUpperCase())+'</span><strong>'+ctx.money(v)+'</strong></div>').join("")+
        '</div>';
    } catch(error) { ctx.toast(ctx.friendlyError(error),"error"); }
  });
}

function openQuickPo(ctx, item, suppliers, reload) {
  const options=(item.suppliers||[]);
  const fallbackSupplier=suppliers[0];
  ctx.showModal(
    '<h2>Create suggested PO</h2><p><strong>'+ctx.esc(item.name)+'</strong> · stock '+ctx.number(item.stock_quantity)+' · reorder '+ctx.number(item.reorder_level)+'</p>'+
    '<form id="ops-po-form" class="form">'+
      '<div class="field"><label>Supplier</label><select class="input" name="supplier" required>'+
        (options.length
          ? options.map(x=>'<option value="'+x.supplier_id+'" data-cost="'+Number(x.unit_cost||0)+'">'+ctx.esc(x.supplier_name)+' · '+ctx.money(x.unit_cost)+'</option>').join("")
          : suppliers.map(x=>'<option value="'+x.id+'" data-cost="'+Number(item.cost_price||0)+'">'+ctx.esc(x.name)+' · default cost '+ctx.money(item.cost_price||0)+'</option>').join(""))+
      '</select></div>'+
      '<div class="grid-2"><div class="field"><label>Quantity</label><input class="input" name="quantity" type="number" min="0.001" step="0.001" value="'+Math.max(1,Number(item.reorder_level||0)*2-Number(item.stock_quantity||0))+'" required></div>'+
      '<div class="field"><label>Unit cost</label><input class="input" name="unit_cost" type="number" min="0" step="0.01" value="'+Number(options[0]?.unit_cost??item.cost_price??0)+'" required></div></div>'+
      '<div class="field"><label>Notes</label><input class="input" name="notes" value="StorePOS v1.3 reorder suggestion"></div>'+
      '<div class="modal-actions"><button type="button" id="ops-po-close" class="btn btn-secondary">Cancel</button><button type="submit" class="btn btn-primary">Create draft PO</button></div>'+
    '</form>'
  );
  const supplier=document.querySelector('#ops-po-form select[name="supplier"]');
  supplier?.addEventListener("change",()=>{
    const option=supplier.selectedOptions[0];
    const cost=document.querySelector('#ops-po-form input[name="unit_cost"]');
    if(cost && option?.dataset.cost) cost.value=option.dataset.cost;
  });
  document.querySelector("#ops-po-close")?.addEventListener("click",ctx.closeModal);
  document.querySelector("#ops-po-form")?.addEventListener("submit",async event=>{
    event.preventDefault();
    const fd=new FormData(event.currentTarget);
    const supplierId=String(fd.get("supplier")||"");
    if(!supplierId) return ctx.toast("Add a supplier first.","error");
    const res=await ctx.supabase.rpc("create_purchase_order_v2",{
      p_shop_id:ctx.state.shop.id,
      p_supplier_id:supplierId,
      p_items:[{product_id:item.product_id,quantity:Number(fd.get("quantity")||0),unit_cost:Number(fd.get("unit_cost")||0)}],
      p_notes:String(fd.get("notes")||"").trim()||null,
      p_expected_at:null
    });
    if(res.error) return ctx.toast(ctx.friendlyError(res.error),"error");
    ctx.closeModal(); ctx.toast("Draft purchase order created.","success"); await reload();
  });
}

export async function pageStoreOps(root, ctx) {
  const shopId=ctx.state.shop.id;
  const role=String(ctx.state.membership.role||"").toLowerCase();
  const manager=["owner","admin","manager"].includes(role);
  const purchasing=manager||role==="inventory";

  const responses=await Promise.all([
    ctx.supabase.from("products").select("id,name,sku,barcode,cost_price,selling_price,stock_quantity,reorder_level,unit,is_active,track_stock").eq("shop_id",shopId).order("name"),
    ctx.supabase.from("inventory_counts").select("*").eq("shop_id",shopId).order("created_at",{ascending:false}).limit(15),
    ctx.supabase.from("cashier_shifts").select("*").eq("shop_id",shopId).order("started_at",{ascending:false}).limit(30),
    ctx.supabase.from("z_reports").select("*").eq("shop_id",shopId).order("generated_at",{ascending:false}).limit(20),
    ctx.supabase.from("retail_manager_approvals").select("*").eq("shop_id",shopId).order("created_at",{ascending:false}).limit(40),
    ctx.supabase.from("retail_payment_reconciliations").select("*").eq("shop_id",shopId).order("business_date",{ascending:false}).limit(40),
    ctx.supabase.from("retail_receipt_reprints").select("*").eq("shop_id",shopId).order("printed_at",{ascending:false}).limit(40),
    ctx.supabase.from("suppliers").select("id,name,is_active").eq("shop_id",shopId).eq("is_active",true).order("name"),
    purchasing ? opsAction(ctx,"supplier_prices") : Promise.resolve([]),
    purchasing ? opsAction(ctx,"data_health") : Promise.resolve({})
  ]);
  responses.slice(0,8).forEach(r=>{if(r.error) throw r.error;});

  const products=responses[0].data||[];
  const counts=responses[1].data||[];
  const shifts=responses[2].data||[];
  const zReports=responses[3].data||[];
  const approvals=responses[4].data||[];
  const reconciliations=responses[5].data||[];
  const reprints=responses[6].data||[];
  const suppliers=responses[7].data||[];
  const supplierPrices=Array.isArray(responses[8])?responses[8]:[];
  const health=responses[9]||{};
  const productById=new Map(products.map(p=>[p.id,p]));
  const lowStock=supplierPrices.filter(p=>Number(p.stock_quantity)<=Number(p.reorder_level));
  const pending=approvals.filter(a=>a.status==="pending"&&new Date(a.expires_at)>new Date());
  const investigate=reconciliations.filter(x=>x.status==="investigate");
  const issues=healthCount(health);

  root.innerHTML=[
    ctx.head("Retail Control Center","Price checking, stocktake, purchasing, e-wallet reconciliation, approvals, X/Z reports and audit controls",
      '<div class="actions"><button id="ops-approval-request" class="btn btn-secondary">Request approval</button>'+(manager?'<button id="ops-reconcile" class="btn btn-primary">Reconcile e-wallet</button>':'' )+'</div>'),
    '<section class="metrics">',
      '<article class="metric"><div class="metric-label">Data health</div><div class="metric-value">'+ctx.number(issues)+'</div><div class="metric-sub">Issue(s) requiring review</div></article>',
      '<article class="metric"><div class="metric-label">Pending approvals</div><div class="metric-value">'+ctx.number(pending.length)+'</div><div class="metric-sub">Manager queue</div></article>',
      '<article class="metric"><div class="metric-label">Wallet variance</div><div class="metric-value">'+ctx.number(investigate.length)+'</div><div class="metric-sub">Reconciliation(s) to investigate</div></article>',
      '<article class="metric"><div class="metric-label">Receipt reprints</div><div class="metric-value">'+ctx.number(reprints.length)+'</div><div class="metric-sub">Recent audited copies</div></article>',
    '</section>',
    '<div class="card"><div class="card-title"><h3>Price checker</h3><span>Scan/search without adding to cart</span></div>',
      '<div class="field"><input id="ops-price-search" class="input" placeholder="Barcode, SKU, product or brand"></div><div id="ops-price-results" class="stat-list"></div>',
    '</div>',
    '<section class="grid-2" style="margin-top:14px">',
      '<div class="card"><div class="card-title"><h3>Inventory count</h3><span>'+ctx.number(counts.length)+' recent</span></div>',
        '<div class="help">StorePOS Android already supports barcode-assisted physical stocktake and manager approval.</div>',
        '<div class="modal-actions"><button id="ops-start-count" class="btn btn-secondary" '+(purchasing?"":"disabled")+'>Start / resume stocktake</button><a class="btn btn-secondary" href="#/dashboard/inventory">Open inventory</a></div>',
        '<div class="stat-list">'+counts.slice(0,6).map(c=>'<div class="stat-row"><span>'+ctx.esc(c.count_number)+' · '+ctx.niceDate(c.created_at,true)+'</span><strong>'+ctx.pill(c.status)+'</strong></div>').join("")+'</div>',
      '</div>',
      '<div class="card"><div class="card-title"><h3>X / Z reports</h3><span>Register accountability</span></div>',
        '<div class="modal-actions"><button id="ops-x-report" class="btn btn-primary">Generate X report</button></div>',
        '<div class="stat-list">'+zReports.slice(0,6).map(z=>'<div class="stat-row"><span>'+ctx.niceDate(z.generated_at,true)+' · '+ctx.number(z.transaction_count)+' tx</span><strong>'+ctx.money(z.gross_sales)+'</strong></div>').join("")+'</div>',
      '</div>',
    '</section>',
    purchasing?'<div class="card" style="margin-top:14px"><div class="card-title"><h3>Reorder → Purchase Order</h3><span>Latest supplier cost comparison</span></div>'+
      '<div class="table-wrap"><table><thead><tr><th>Product</th><th>Stock</th><th>Suggested</th><th>Best supplier</th><th>Last cost</th><th></th></tr></thead><tbody>'+
      lowStock.slice(0,30).map(p=>{const best=(p.suppliers||[])[0];return '<tr><td><strong>'+ctx.esc(p.name)+'</strong><div class="help">'+ctx.esc(p.sku)+'</div></td><td>'+ctx.number(p.stock_quantity)+'</td><td>'+ctx.number(Math.max(1,Number(p.reorder_level||0)*2-Number(p.stock_quantity||0)))+'</td><td>'+ctx.esc(best?.supplier_name||"No price history")+'</td><td>'+ctx.money(best?.unit_cost??productById.get(p.product_id)?.cost_price??0)+'</td><td><button class="btn btn-secondary btn-sm ops-create-po" data-id="'+p.product_id+'">Create PO</button></td></tr>';}).join("")+
      (lowStock.length?"":'<tr><td colspan="6">No products currently require reorder.</td></tr>')+'</tbody></table></div></div>':"",
    '<section class="grid-2" style="margin-top:14px">',
      '<div class="card"><div class="card-title"><h3>Manager approvals</h3><span>'+ctx.number(pending.length)+' pending</span></div><div class="stat-list">'+
        approvals.slice(0,12).map(a=>'<div class="stat-row"><span><strong>'+ctx.esc(a.approval_type.replaceAll("_"," "))+'</strong><small class="help" style="display:block">'+ctx.esc(a.reason)+' · '+ctx.niceDate(a.created_at,true)+'</small></span><span>'+ctx.pill(a.status)+(manager&&a.status==="pending"?'<div class="actions" style="margin-top:4px"><button class="btn btn-success btn-sm ops-approve" data-id="'+a.id+'">Approve</button><button class="btn btn-danger btn-sm ops-reject" data-id="'+a.id+'">Reject</button></div>':'')+'</span></div>').join("")+
        (approvals.length?"":'<div class="help">No approval requests.</div>')+'</div></div>',
      '<div class="card"><div class="card-title"><h3>E-wallet reconciliation</h3><span>GCash / Maya / card / bank</span></div><div class="stat-list">'+
        reconciliations.slice(0,10).map(r=>'<div class="stat-row"><span>'+ctx.esc(r.method.toUpperCase())+' · '+ctx.esc(r.business_date)+'<small class="help" style="display:block">Expected '+ctx.money(r.expected_amount)+' · actual '+ctx.money(r.actual_amount)+'</small></span><strong class="'+(Number(r.variance)===0?"":"danger-text")+'">'+ctx.money(r.variance)+'</strong></div>').join("")+
        (reconciliations.length?"":'<div class="help">No reconciliations yet.</div>')+'</div></div>',
    '</section>',
    purchasing?'<div style="margin-top:14px">'+healthRows(ctx,health)+'</div>':"",
    '<div class="card" style="margin-top:14px"><div class="card-title"><h3>Receipt reprint audit</h3><span>Every extra copy is numbered</span></div><div class="stat-list">'+
      reprints.slice(0,15).map(r=>'<div class="stat-row"><span>Copy #'+ctx.number(r.copy_no)+' · '+ctx.niceDate(r.printed_at,true)+'<small class="help" style="display:block">'+ctx.esc(r.reason)+'</small></span><strong>'+ctx.esc(r.sale_id.slice(0,8))+'…</strong></div>').join("")+
      (reprints.length?"":'<div class="help">No receipt reprints logged yet.</div>')+'</div></div>'
  ].join("");

  const reload=async()=>pageStoreOps(root,ctx);
  const search=document.querySelector("#ops-price-search");
  const results=document.querySelector("#ops-price-results");
  function refreshPrice(){
    const q=String(search?.value||"").trim().toLowerCase();
    const matches=(q?products.filter(p=>p.is_active&&[p.name,p.sku,p.barcode].some(v=>String(v||"").toLowerCase().includes(q))).slice(0,12):[]);
    if(results) results.innerHTML=matches.map(p=>'<div class="stat-row"><span><strong>'+ctx.esc(p.name)+'</strong><small class="help" style="display:block">'+ctx.esc(p.sku)+(p.barcode?' · '+ctx.esc(p.barcode):'')+' · stock '+ctx.number(p.stock_quantity)+' '+ctx.esc(p.unit||"pc")+'</small></span><strong>'+ctx.money(p.selling_price)+'</strong></div>').join("") || (q?'<div class="help">No matching product.</div>':'<div class="help">Enter or scan a barcode/SKU to check the price.</div>');
  }
  search?.addEventListener("input",refreshPrice); refreshPrice();

  document.querySelector("#ops-approval-request")?.addEventListener("click",()=>openApprovalRequest(ctx,reload));
  document.querySelector("#ops-reconcile")?.addEventListener("click",()=>openReconcile(ctx,reload));
  document.querySelector("#ops-x-report")?.addEventListener("click",()=>openXReport(ctx,shifts));
  document.querySelector("#ops-start-count")?.addEventListener("click",async()=>{
    const r=await ctx.supabase.rpc("start_inventory_count",{p_shop_id:shopId});
    if(r.error) return ctx.toast(ctx.friendlyError(r.error),"error");
    ctx.toast("Stocktake started/resumed. Open Inventory to enter physical counts.","success");
    await reload();
  });
  root.querySelectorAll(".ops-create-po").forEach(btn=>btn.addEventListener("click",()=>{
    const item=supplierPrices.find(p=>p.product_id===btn.dataset.id);
    if(item) openQuickPo(ctx,{...item,cost_price:productById.get(item.product_id)?.cost_price||0},suppliers,reload);
  }));
  async function review(id,decision){
    try{await opsAction(ctx,"review_approval",{id,decision,notes:"Reviewed in StorePOS Control Center"});ctx.toast("Request "+decision+".","success");await reload();}
    catch(error){ctx.toast(ctx.friendlyError(error),"error");}
  }
  root.querySelectorAll(".ops-approve").forEach(btn=>btn.addEventListener("click",()=>review(btn.dataset.id,"approved")));
  root.querySelectorAll(".ops-reject").forEach(btn=>btn.addEventListener("click",()=>review(btn.dataset.id,"rejected")));
}
