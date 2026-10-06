
function row(label, value, help) {
  return '<div class="stat-row"><span>' + label + (help ? '<small class="help" style="display:block">' + help + '</small>' : '') + '</span><strong>' + value + '</strong></div>';
}

function localIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseSkuLines(text, products) {
  const bySku = new Map(products.map(function (p) { return [String(p.sku || '').toLowerCase(), p]; }));
  const out = [];
  String(text || '').split(/\r?\n/).forEach(function (line, index) {
    if (!line.trim()) return;
    const parts = line.split(',');
    const sku = String(parts[0] || '').trim();
    const quantity = Number(parts[1] || 1);
    const product = bySku.get(sku.toLowerCase());
    if (!product) throw new Error('Unknown SKU on line ' + (index + 1) + ': ' + sku);
    if (!(quantity > 0)) throw new Error('Quantity must be greater than zero on line ' + (index + 1) + '.');
    out.push({ product_id: product.id, quantity: quantity });
  });
  if (!out.length) throw new Error('Enter at least one SKU.');
  return out;
}

async function retailAction(ctx, action, data) {
  const result = await ctx.supabase.rpc('storepos_retail_action', {
    p_shop_id: ctx.state.shop.id,
    p_action: action,
    p_data: data || {}
  });
  if (result.error) throw result.error;
  return result.data;
}

function productOptions(products, selected) {
  return products.map(function (p) {
    return '<option value="' + p.id + '" ' + (p.id === selected ? 'selected' : '') + '>' +
      p.name.replaceAll('&','&amp;').replaceAll('<','&lt;') + ' · ' +
      p.sku.replaceAll('&','&amp;').replaceAll('<','&lt;') + '</option>';
  }).join('');
}

function qty(value) {
  const numberValue = Number(value || 0);
  return Number.isInteger(numberValue) ? String(numberValue) : numberValue.toFixed(3).replace(/0+$/,'').replace(/\.$/,'');
}

function margin(cost, price) {
  const c = Number(cost || 0);
  const p = Number(price || 0);
  return p > 0 ? ((p - c) / p) * 100 : 0;
}

function printLabel(ctx, product) {
  const value = String(product.barcode || product.sku || '').trim();
  if (!value) {
    ctx.toast('This product has no SKU or barcode.', 'error');
    return;
  }
  const win = window.open('', '_blank', 'width=520,height=700');
  if (!win) {
    ctx.toast('Allow pop-ups to print a shelf label.', 'error');
    return;
  }
  const safeName = ctx.esc(product.name);
  const safeValue = ctx.esc(value);
  const safeShop = ctx.esc(ctx.state.shop.name || 'StorePOS');
  const safePrice = ctx.esc(ctx.money(product.selling_price));
  win.document.write([
    '<!doctype html><html><head><meta charset="utf-8"><title>StorePOS Label</title>',
    '<style>body{font-family:Arial,sans-serif;margin:0;padding:18px;background:#fff;color:#000}.label{width:76mm;min-height:42mm;border:1px solid #bbb;border-radius:8px;padding:7mm;box-sizing:border-box;text-align:center}.shop{font-size:12px;font-weight:700}.name{font-size:18px;font-weight:800;margin:7px 0 2px}.price{font-size:25px;font-weight:900;margin:3px 0}.sku{font-size:11px;margin-top:4px}svg{max-width:100%;height:60px}@media print{body{padding:0}.label{border:0;border-radius:0;width:76mm}}</style>',
    '<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>',
    '</head><body><div class="label"><div class="shop">', safeShop, '</div><div class="name">', safeName, '</div><div class="price">', safePrice, '</div><svg id="barcode"></svg><div class="sku">', safeValue, '</div></div>',
    '<script>window.addEventListener("load",function(){try{JsBarcode("#barcode",', JSON.stringify(value), ',{format:"CODE128",displayValue:false,height:54,margin:0});setTimeout(function(){window.print()},250)}catch(e){document.querySelector("#barcode").outerHTML="<div>Barcode unavailable</div>"}})<\/script>',
    '</body></html>'
  ].join(''));
  win.document.close();
}

function openProfitCalculator(ctx) {
  ctx.showModal([
    '<h2>Price & profit calculator</h2>',
    '<p>Quickly calculate gross profit, margin and markup before changing a selling price.</p>',
    '<form id="retail-profit-form" class="form">',
      '<div class="grid-2"><div class="field"><label>Cost</label><input class="input" type="number" step="0.01" min="0" name="cost" value="0"></div>',
      '<div class="field"><label>Selling price</label><input class="input" type="number" step="0.01" min="0" name="price" value="0"></div></div>',
      '<div id="retail-profit-result" class="verify-note"><strong>Gross profit ₱0.00</strong><span>Margin 0% · Markup 0%</span></div>',
      '<div class="modal-actions"><button type="button" id="retail-profit-close" class="btn btn-primary">Done</button></div>',
    '</form>'
  ].join(''));
  const form = document.querySelector('#retail-profit-form');
  function refresh() {
    const data = new FormData(form);
    const cost = Number(data.get('cost') || 0);
    const price = Number(data.get('price') || 0);
    const gross = price - cost;
    const m = price > 0 ? gross / price * 100 : 0;
    const markup = cost > 0 ? gross / cost * 100 : 0;
    const box = document.querySelector('#retail-profit-result');
    if (box) box.innerHTML = '<strong>Gross profit ' + ctx.money(gross) + '</strong><span>Margin ' + m.toFixed(2) + '% · Markup ' + markup.toFixed(2) + '%</span>';
  }
  form?.addEventListener('input', refresh);
  document.querySelector('#retail-profit-close')?.addEventListener('click', ctx.closeModal);
  refresh();
}

function openCashCounter(ctx) {
  const denoms = [1000,500,200,100,50,20,10,5,1,0.25];
  ctx.showModal([
    '<h2>Cash denomination counter</h2><p>Count the drawer before opening or closing a cashier shift.</p>',
    '<form id="retail-cash-form" class="form">',
    denoms.map(function (d) {
      return '<div class="grid-2"><div class="field"><label>' + ctx.money(d) + '</label><input class="input cash-count" data-denom="' + d + '" type="number" step="1" min="0" value="0"></div><div class="field"><label>Subtotal</label><input class="input cash-subtotal" data-denom="' + d + '" value="' + ctx.money(0) + '" disabled></div></div>';
    }).join(''),
    '<div class="verify-note"><strong id="retail-cash-total">Counted cash ' + ctx.money(0) + '</strong><span>Use this total when opening or closing the shift.</span></div>',
    '<div class="modal-actions"><button type="button" id="retail-cash-close" class="btn btn-primary">Done</button></div></form>'
  ].join(''));
  function refresh() {
    let total = 0;
    document.querySelectorAll('.cash-count').forEach(function (input) {
      const d = Number(input.dataset.denom || 0);
      const count = Number(input.value || 0);
      const subtotal = d * count;
      total += subtotal;
      const out = document.querySelector('.cash-subtotal[data-denom="' + input.dataset.denom + '"]');
      if (out) out.value = ctx.money(subtotal);
    });
    const totalNode = document.querySelector('#retail-cash-total');
    if (totalNode) totalNode.textContent = 'Counted cash ' + ctx.money(total);
  }
  document.querySelector('#retail-cash-form')?.addEventListener('input', refresh);
  document.querySelector('#retail-cash-close')?.addEventListener('click', ctx.closeModal);
}

function openRetailProduct(ctx, product, products, reload) {
  const bases = products.filter(function (p) { return !p.retail_parent_id && p.id !== product.id; });
  ctx.showModal([
    '<h2>Retail settings</h2><p><strong>',ctx.esc(product.name),'</strong> · ',ctx.esc(product.sku),'</p>',
    '<form id="retail-product-form" class="form">',
      '<div class="grid-2">',
        '<div class="field"><label>Pack / tingi parent</label><select class="input" name="parent"><option value="">Base / tingi SKU</option>',productOptions(bases, product.retail_parent_id),'</select></div>',
        '<div class="field"><label>Base units per selling unit</label><input class="input" type="number" min="0.0001" step="0.0001" name="multiplier" value="',String(product.retail_multiplier || 1),'"></div>',
      '</div>',
      '<div class="grid-2">',
        '<div class="field"><label>Wholesale price</label><input class="input" type="number" min="0" step="0.01" name="wholesale" value="',String(product.wholesale_price ?? ''),'"></div>',
        '<div class="field"><label>Wholesale minimum</label><input class="input" type="number" min="0" step="0.01" name="wholesale_min" value="',String(product.wholesale_min || 0),'"></div>',
      '</div>',
      '<div class="grid-2"><div class="field"><label>Variant group</label><input class="input" name="group" value="',ctx.esc(product.variant_group || ''),'"></div><div class="field"><label>Variant name</label><input class="input" name="variant" value="',ctx.esc(product.variant_name || ''),'"></div></div>',
      '<div class="field"><label>Selling unit</label><input class="input" name="unit" value="',ctx.esc(product.unit || 'pc'),'"></div>',
      '<label class="check-row"><input type="checkbox" name="weighed" ',product.is_weighed ? 'checked' : '','> Weighed / decimal quantity</label>',
      '<label class="check-row"><input type="checkbox" name="batch" ',product.batch_tracked ? 'checked' : '','> Batch and expiry tracking</label>',
      '<label class="check-row"><input type="checkbox" name="serial" ',product.serial_tracked ? 'checked' : '','> Serial number tracking</label>',
      '<div class="modal-actions"><button type="button" id="retail-product-close" class="btn btn-secondary">Cancel</button><button type="submit" class="btn btn-primary">Save retail settings</button></div>',
    '</form>'
  ].join(''));
  document.querySelector('#retail-product-close')?.addEventListener('click', ctx.closeModal);
  document.querySelector('#retail-product-form')?.addEventListener('submit', async function (event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await retailAction(ctx,'product',{
        product_id: product.id,
        parent_id: String(form.get('parent') || '') || null,
        multiplier: Number(form.get('multiplier') || 1),
        wholesale_price: String(form.get('wholesale') || '').trim() === '' ? null : Number(form.get('wholesale')),
        wholesale_min: Number(form.get('wholesale_min') || 0),
        variant_group: String(form.get('group') || '').trim() || null,
        variant_name: String(form.get('variant') || '').trim() || null,
        unit: String(form.get('unit') || 'pc').trim() || 'pc',
        is_weighed: form.get('weighed') === 'on',
        batch_tracked: form.get('batch') === 'on',
        serial_tracked: form.get('serial') === 'on'
      });
      ctx.closeModal(); ctx.toast('Retail product settings saved.','success'); await reload();
    } catch (error) { ctx.toast(ctx.friendlyError(error),'error'); }
  });
}

function openCsvImport(ctx, reload) {
  ctx.showModal([
    '<h2>Bulk CSV import</h2><p>Paste up to 1,000 rows. Header: <strong>sku,name,barcode,cost_price,selling_price,unit,reorder_level,opening_stock</strong></p>',
    '<form id="retail-import-form" class="form"><div class="field"><label>CSV data</label><textarea class="input" name="csv" rows="12">sku,name,barcode,cost_price,selling_price,unit,reorder_level,opening_stock\nSKU-001,Sample Product,480000000001,25,35,pc,5,10</textarea></div>',
    '<div class="modal-actions"><button type="button" id="retail-import-close" class="btn btn-secondary">Cancel</button><button type="submit" class="btn btn-primary">Import products</button></div></form>'
  ].join(''));
  document.querySelector('#retail-import-close')?.addEventListener('click',ctx.closeModal);
  document.querySelector('#retail-import-form')?.addEventListener('submit',async function(event){
    event.preventDefault();
    const text=String(new FormData(event.currentTarget).get('csv')||'');
    const lines=text.split(/\r?\n/).filter(function(line){return line.trim();});
    if(lines.length<2) return ctx.toast('Add a CSV header and at least one row.','error');
    const headers=lines[0].split(',').map(function(x){return x.trim().toLowerCase();});
    const index=function(name){return headers.indexOf(name);};
    if(index('sku')<0||index('name')<0) return ctx.toast('CSV must include sku and name.','error');
    const rows=[];
    for(let i=1;i<lines.length&&rows.length<1000;i++){
      const v=lines[i].split(',');
      const cell=function(name){const j=index(name);return j>=0?String(v[j]||'').trim():'';};
      if(!cell('sku')||!cell('name')) return ctx.toast('Row '+(i+1)+' needs SKU and name.','error');
      rows.push({
        sku:cell('sku'),name:cell('name'),barcode:cell('barcode')||null,
        cost_price:Number(cell('cost_price')||0),selling_price:Number(cell('selling_price')||0),
        unit:cell('unit')||'pc',reorder_level:Number(cell('reorder_level')||5),opening_stock:Number(cell('opening_stock')||0)
      });
    }
    try{await retailAction(ctx,'import',{rows:rows});ctx.closeModal();ctx.toast(rows.length+' product(s) imported.','success');await reload();}
    catch(error){ctx.toast(ctx.friendlyError(error),'error');}
  });
}

function openBatch(ctx, products, reload) {
  ctx.showModal([
    '<h2>Receive batch / expiry stock</h2><form id="retail-batch-form" class="form">',
    '<div class="field"><label>Product</label><select class="input" name="product">',productOptions(products.filter(function(p){return !p.retail_parent_id;}),''),'</select></div>',
    '<div class="grid-2"><div class="field"><label>Batch / lot number</label><input class="input" name="batch" required></div><div class="field"><label>Expiry</label><input class="input" type="date" name="expiry"></div></div>',
    '<div class="field"><label>Quantity</label><input class="input" type="number" min="0.001" step="0.001" name="quantity" required></div>',
    '<label class="check-row"><input type="checkbox" name="receive" checked> Add quantity to physical stock</label>',
    '<div class="modal-actions"><button type="button" id="retail-batch-close" class="btn btn-secondary">Cancel</button><button type="submit" class="btn btn-primary">Save batch</button></div></form>'
  ].join(''));
  document.querySelector('#retail-batch-close')?.addEventListener('click',ctx.closeModal);
  document.querySelector('#retail-batch-form')?.addEventListener('submit',async function(event){
    event.preventDefault(); const f=new FormData(event.currentTarget);
    try{
      await retailAction(ctx,'batch',{product_id:String(f.get('product')),batch_number:String(f.get('batch')||'').trim(),expires_on:String(f.get('expiry')||'')||null,quantity:Number(f.get('quantity')||0),receive_stock:f.get('receive')==='on'});
      ctx.closeModal();ctx.toast('Batch saved.','success');await reload();
    }catch(error){ctx.toast(ctx.friendlyError(error),'error');}
  });
}

function openSerials(ctx, products, reload) {
  ctx.showModal([
    '<h2>Register serial numbers</h2><form id="retail-serial-form" class="form">',
    '<div class="field"><label>Product</label><select class="input" name="product">',productOptions(products.filter(function(p){return !p.retail_parent_id;}),''),'</select></div>',
    '<div class="field"><label>One serial per line</label><textarea class="input" rows="10" name="serials" required></textarea></div>',
    '<div class="modal-actions"><button type="button" id="retail-serial-close" class="btn btn-secondary">Cancel</button><button type="submit" class="btn btn-primary">Register serials</button></div></form>'
  ].join(''));
  document.querySelector('#retail-serial-close')?.addEventListener('click',ctx.closeModal);
  document.querySelector('#retail-serial-form')?.addEventListener('submit',async function(event){
    event.preventDefault(); const f=new FormData(event.currentTarget);
    const serials=[...new Set(String(f.get('serials')||'').split(/\r?\n/).map(function(x){return x.trim();}).filter(Boolean))];
    if(!serials.length)return ctx.toast('Enter at least one serial.','error');
    try{await retailAction(ctx,'serial',{product_id:String(f.get('product')),serials:serials});ctx.closeModal();ctx.toast('Serials registered.','success');await reload();}
    catch(error){ctx.toast(ctx.friendlyError(error),'error');}
  });
}

function openPriceSchedule(ctx, products, reload) {
  ctx.showModal([
    '<h2>Schedule selling price</h2><form id="retail-price-form" class="form">',
    '<div class="field"><label>Product</label><select class="input" name="product">',productOptions(products,''),'</select></div>',
    '<div class="grid-2"><div class="field"><label>New price</label><input class="input" type="number" min="0" step="0.01" name="price" required></div><div class="field"><label>Effective at</label><input class="input" type="datetime-local" name="effective" required></div></div>',
    '<div class="modal-actions"><button type="button" id="retail-price-close" class="btn btn-secondary">Cancel</button><button type="submit" class="btn btn-primary">Schedule price</button></div></form>'
  ].join(''));
  document.querySelector('#retail-price-close')?.addEventListener('click',ctx.closeModal);
  document.querySelector('#retail-price-form')?.addEventListener('submit',async function(event){
    event.preventDefault(); const f=new FormData(event.currentTarget); const at=localIso(String(f.get('effective')||''));
    if(!at)return ctx.toast('Enter a valid effective date/time.','error');
    try{await retailAction(ctx,'schedule',{product_id:String(f.get('product')),price:Number(f.get('price')||0),effective_at:at});ctx.closeModal();ctx.toast('Price change scheduled.','success');await reload();}
    catch(error){ctx.toast(ctx.friendlyError(error),'error');}
  });
}

function openPromo(ctx, products, reload) {
  ctx.showModal([
    '<h2>Create promotion / bundle</h2><form id="retail-promo-form" class="form">',
    '<div class="grid-2"><div class="field"><label>Name</label><input class="input" name="name" required></div><div class="field"><label>Type</label><select class="input" name="kind"><option value="percent">Percentage discount</option><option value="bogo">Buy / get</option><option value="bundle">Bundle price</option></select></div></div>',
    '<div class="field"><label>Items (one per line: SKU,quantity)</label><textarea class="input" rows="6" name="items" placeholder="SKU-001,1\nSKU-002,2" required></textarea></div>',
    '<div class="grid-2"><div class="field"><label>Discount %</label><input class="input" type="number" step="0.01" min="0" name="discount" value="10"></div><div class="field"><label>Bundle price</label><input class="input" type="number" step="0.01" min="0" name="bundle" value="0"></div></div>',
    '<div class="grid-2"><div class="field"><label>Buy qty</label><input class="input" type="number" step="0.01" min="0.01" name="buy" value="1"></div><div class="field"><label>Free qty</label><input class="input" type="number" step="0.01" min="0.01" name="free" value="1"></div></div>',
    '<div class="grid-2"><div class="field"><label>Starts</label><input class="input" type="datetime-local" name="starts" required></div><div class="field"><label>Ends</label><input class="input" type="datetime-local" name="ends" required></div></div>',
    '<div class="modal-actions"><button type="button" id="retail-promo-close" class="btn btn-secondary">Cancel</button><button type="submit" class="btn btn-primary">Create promo</button></div></form>'
  ].join(''));
  document.querySelector('#retail-promo-close')?.addEventListener('click',ctx.closeModal);
  document.querySelector('#retail-promo-form')?.addEventListener('submit',async function(event){
    event.preventDefault(); const f=new FormData(event.currentTarget);
    try{
      const items=parseSkuLines(f.get('items'),products);
      const starts=localIso(String(f.get('starts')||'')); const ends=localIso(String(f.get('ends')||''));
      if(!starts||!ends)throw new Error('Enter valid promo dates.');
      await retailAction(ctx,'promo',{name:String(f.get('name')||'').trim(),kind:String(f.get('kind')||'percent'),items:items,discount_percent:Number(f.get('discount')||0),buy_qty:Number(f.get('buy')||1),free_qty:Number(f.get('free')||1),bundle_price:Number(f.get('bundle')||0),starts_at:starts,ends_at:ends});
      ctx.closeModal();ctx.toast('Promotion created.','success');await reload();
    }catch(error){ctx.toast(ctx.friendlyError(error),'error');}
  });
}

function openReserve(ctx, products, customers, reload) {
  ctx.showModal([
    '<h2>Reserve / order for pickup</h2><form id="retail-reserve-form" class="form">',
    '<div class="field"><label>Customer</label><select class="input" name="customer">',customers.map(function(c){return '<option value="'+c.id+'">'+ctx.esc(c.name)+'</option>';}).join(''),'</select></div>',
    '<div class="field"><label>Items (one per line: SKU,quantity)</label><textarea class="input" rows="6" name="items" placeholder="SKU-001,2" required></textarea></div>',
    '<div class="grid-2"><div class="field"><label>Deposit</label><input class="input" type="number" min="0" step="0.01" name="deposit" value="0"></div><div class="field"><label>Deposit method</label><select class="input" name="method"><option>cash</option><option>gcash</option><option>maya</option><option>card</option><option>bank</option><option>other</option></select></div></div>',
    '<div class="field"><label>Pickup due</label><input class="input" type="datetime-local" name="due"></div><div class="field"><label>Notes</label><textarea class="input" name="notes"></textarea></div>',
    '<div class="modal-actions"><button type="button" id="retail-reserve-close" class="btn btn-secondary">Cancel</button><button type="submit" class="btn btn-primary">Reserve stock</button></div></form>'
  ].join(''));
  document.querySelector('#retail-reserve-close')?.addEventListener('click',ctx.closeModal);
  document.querySelector('#retail-reserve-form')?.addEventListener('submit',async function(event){
    event.preventDefault();const f=new FormData(event.currentTarget);
    try{
      const items=parseSkuLines(f.get('items'),products);
      await retailAction(ctx,'reserve',{customer_id:String(f.get('customer')),items:items,deposit:Number(f.get('deposit')||0),deposit_method:String(f.get('method')||'cash'),due_at:localIso(String(f.get('due')||'')),notes:String(f.get('notes')||'').trim()||null});
      ctx.closeModal();ctx.toast('Reservation created.','success');await reload();
    }catch(error){ctx.toast(ctx.friendlyError(error),'error');}
  });
}

function openStockLoss(ctx, products, reload) {
  ctx.showModal([
    '<h2>Damage, theft or personal use</h2><form id="retail-loss-form" class="form">',
    '<div class="field"><label>Product</label><select class="input" name="product">',productOptions(products.filter(function(p){return !p.retail_parent_id;}),''),'</select></div>',
    '<div class="grid-2"><div class="field"><label>Quantity</label><input class="input" type="number" min="0.001" step="0.001" name="quantity" required></div><div class="field"><label>Reason</label><select class="input" name="reason"><option value="damage">Damage</option><option value="theft">Theft / lost</option><option value="personal_use">Personal use</option></select></div></div>',
    '<div class="field"><label>Notes</label><textarea class="input" name="notes"></textarea></div>',
    '<div class="help">For batch/serial-tracked products, use the Android Retail Suite so the exact batch or serial can be selected.</div>',
    '<div class="modal-actions"><button type="button" id="retail-loss-close" class="btn btn-secondary">Cancel</button><button type="submit" class="btn btn-primary">Record adjustment</button></div></form>'
  ].join(''));
  document.querySelector('#retail-loss-close')?.addEventListener('click',ctx.closeModal);
  document.querySelector('#retail-loss-form')?.addEventListener('submit',async function(event){
    event.preventDefault();const f=new FormData(event.currentTarget);
    const product=products.find(function(p){return p.id===String(f.get('product'));});
    if(product && (product.batch_tracked||product.serial_tracked)) return ctx.toast('Use Android Retail Suite for tracked stock loss so batch/serial details are preserved.','error');
    try{await retailAction(ctx,'stock_loss',{product_id:String(f.get('product')),quantity:Number(f.get('quantity')||0),reason:String(f.get('reason')||'damage'),notes:String(f.get('notes')||'').trim()||null,serials:[]});ctx.closeModal();ctx.toast('Stock adjustment recorded.','success');await reload();}
    catch(error){ctx.toast(ctx.friendlyError(error),'error');}
  });
}

function openSupplierReturn(ctx, products, suppliers, reload) {
  ctx.showModal([
    '<h2>Supplier return</h2><form id="retail-supplier-return-form" class="form">',
    '<div class="grid-2"><div class="field"><label>Supplier</label><select class="input" name="supplier">',suppliers.map(function(s){return '<option value="'+s.id+'">'+ctx.esc(s.name)+'</option>';}).join(''),'</select></div><div class="field"><label>Product</label><select class="input" name="product">',productOptions(products.filter(function(p){return !p.retail_parent_id;}),''),'</select></div></div>',
    '<div class="grid-2"><div class="field"><label>Quantity</label><input class="input" type="number" min="0.001" step="0.001" name="quantity" required></div><div class="field"><label>Expected credit</label><input class="input" type="number" min="0" step="0.01" name="credit" value="0"></div></div>',
    '<div class="field"><label>Reason</label><input class="input" name="reason" required></div><div class="help">For batch/serial-tracked products, use the Android Retail Suite to choose exact tracked stock.</div>',
    '<div class="modal-actions"><button type="button" id="retail-supplier-return-close" class="btn btn-secondary">Cancel</button><button type="submit" class="btn btn-primary">Return stock</button></div></form>'
  ].join(''));
  document.querySelector('#retail-supplier-return-close')?.addEventListener('click',ctx.closeModal);
  document.querySelector('#retail-supplier-return-form')?.addEventListener('submit',async function(event){
    event.preventDefault();const f=new FormData(event.currentTarget);const product=products.find(function(p){return p.id===String(f.get('product'));});
    if(product && (product.batch_tracked||product.serial_tracked)) return ctx.toast('Use Android Retail Suite for tracked supplier returns.','error');
    try{await retailAction(ctx,'supplier_return',{supplier_id:String(f.get('supplier')),product_id:String(f.get('product')),quantity:Number(f.get('quantity')||0),credit_amount:Number(f.get('credit')||0),reason:String(f.get('reason')||'').trim(),serials:[]});ctx.closeModal();ctx.toast('Supplier return recorded.','success');await reload();}
    catch(error){ctx.toast(ctx.friendlyError(error),'error');}
  });
}

function openCreditTerms(ctx, customers, receivables, reload) {
  ctx.showModal([
    '<h2>Customer credit / utang</h2><form id="retail-credit-form" class="form">',
    '<div class="field"><label>Customer</label><select class="input" name="customer"><option value="">Choose customer</option>',customers.map(function(c){return '<option value="'+c.id+'" data-limit="'+Number(c.credit_limit||0)+'">'+ctx.esc(c.name)+'</option>';}).join(''),'</select></div>',
    '<div class="field"><label>Credit limit</label><input class="input" type="number" min="0" step="0.01" name="limit" value="0"></div>',
    '<div class="field"><label>Open receivable (optional)</label><select class="input" name="receivable"><option value="">Credit limit only</option>',receivables.filter(function(r){return ['open','partial'].includes(r.status);}).map(function(r){return '<option value="'+r.id+'" data-customer="'+r.customer_id+'">'+ctx.money(r.balance)+' · '+ctx.esc(r.due_date||'no due date')+'</option>';}).join(''),'</select></div>',
    '<div class="field"><label>New due date</label><input class="input" type="date" name="due"></div>',
    '<div class="modal-actions"><button type="button" id="retail-credit-close" class="btn btn-secondary">Cancel</button><button type="submit" class="btn btn-primary">Save credit terms</button></div></form>'
  ].join(''));
  document.querySelector('#retail-credit-close')?.addEventListener('click',ctx.closeModal);
  const customerSelect=document.querySelector('#retail-credit-form [name="customer"]');
  customerSelect?.addEventListener('change',function(){
    const opt=customerSelect.selectedOptions[0]; const limit=document.querySelector('#retail-credit-form [name="limit"]');
    if(limit) limit.value=opt?.dataset.limit||'0';
    const rid=document.querySelector('#retail-credit-form [name="receivable"]');
    if(rid){[...rid.options].forEach(function(o,i){if(i>0)o.hidden=Boolean(customerSelect.value)&&o.dataset.customer!==customerSelect.value;});if(rid.selectedOptions[0]?.hidden)rid.value='';}
  });
  document.querySelector('#retail-credit-form')?.addEventListener('submit',async function(event){
    event.preventDefault();const f=new FormData(event.currentTarget);if(!f.get('customer'))return ctx.toast('Choose a customer.','error');
    try{await retailAction(ctx,'credit_terms',{customer_id:String(f.get('customer')),credit_limit:Number(f.get('limit')||0),receivable_id:String(f.get('receivable')||'')||null,due_date:String(f.get('due')||'')||null});ctx.closeModal();ctx.toast('Credit terms updated.','success');await reload();}
    catch(error){ctx.toast(ctx.friendlyError(error),'error');}
  });
}

function openChecklist(ctx, kind, reload) {
  const items=kind==='opening'
    ? [['register_ready','Register and POS device ready'],['cash_counted','Opening cash counted'],['printer_ready','Receipt printer checked'],['stock_alerts','Low-stock / expiry alerts reviewed']]
    : [['cash_counted','Closing cash counted'],['pending_sales','Offline / pending sales synced'],['returns_checked','Returns and voids reviewed'],['register_secured','Register and devices secured']];
  ctx.showModal([
    '<h2>',kind==='opening'?'Opening checklist':'Closing checklist','</h2><form id="retail-checklist-form" class="form">',
    items.map(function(x){return '<label class="check-row"><input type="checkbox" name="'+x[0]+'" required> '+ctx.esc(x[1])+'</label>';}).join(''),
    '<div class="modal-actions"><button type="button" id="retail-checklist-close" class="btn btn-secondary">Cancel</button><button type="submit" class="btn btn-primary">Save completed</button></div></form>'
  ].join(''));
  document.querySelector('#retail-checklist-close')?.addEventListener('click',ctx.closeModal);
  document.querySelector('#retail-checklist-form')?.addEventListener('submit',async function(event){
    event.preventDefault();const checks={};items.forEach(function(x){checks[x[0]]=true;});
    try{await retailAction(ctx,'checklist',{kind:kind,checks:checks});ctx.closeModal();ctx.toast((kind==='opening'?'Opening':'Closing')+' checklist saved.','success');await reload();}
    catch(error){ctx.toast(ctx.friendlyError(error),'error');}
  });
}

export async function pageRetail(root, ctx) {
  const shopId=ctx.state.shop.id;
  const canManage=['owner','admin','manager','inventory'].includes(String(ctx.state.membership.role||'').toLowerCase());
  const responses=await Promise.all([
    ctx.supabase.from('products').select('id,name,sku,barcode,cost_price,selling_price,wholesale_price,retail_parent_id,retail_multiplier,wholesale_min,variant_group,variant_name,is_weighed,batch_tracked,serial_tracked,stock_quantity,reorder_level,track_stock,unit,is_active').eq('shop_id',shopId).order('name'),
    ctx.supabase.from('retail_batches').select('*').eq('shop_id',shopId).order('expires_on',{ascending:true,nullsFirst:false}).limit(100),
    ctx.supabase.from('retail_serials').select('*').eq('shop_id',shopId).order('created_at',{ascending:false}).limit(100),
    ctx.supabase.from('retail_price_schedule').select('*').eq('shop_id',shopId).order('effective_at',{ascending:false}).limit(50),
    ctx.supabase.from('retail_price_history').select('*').eq('shop_id',shopId).order('created_at',{ascending:false}).limit(50),
    ctx.supabase.from('retail_promos').select('*').eq('shop_id',shopId).order('starts_at',{ascending:false}).limit(100),
    ctx.supabase.from('retail_orders').select('*').eq('shop_id',shopId).order('created_at',{ascending:false}).limit(100),
    ctx.supabase.from('retail_supplier_returns').select('*').eq('shop_id',shopId).order('created_at',{ascending:false}).limit(50),
    ctx.supabase.from('retail_checklists').select('*').eq('shop_id',shopId).order('created_at',{ascending:false}).limit(50),
    ctx.supabase.from('customers').select('id,name,credit_limit,is_active').eq('shop_id',shopId).eq('is_active',true).order('name'),
    ctx.supabase.from('suppliers').select('id,name,is_active').eq('shop_id',shopId).eq('is_active',true).order('name'),
    ctx.supabase.from('customer_receivables').select('id,customer_id,balance,due_date,status').eq('shop_id',shopId).order('created_at',{ascending:false}).limit(100),
    ctx.supabase.rpc('storepos_retail_insights',{p_shop_id:shopId,p_days:30})
  ]);
  responses.forEach(function(r){if(r.error)throw r.error;});
  const products=responses[0].data||[];
  const batches=responses[1].data||[];
  const serials=responses[2].data||[];
  const schedules=responses[3].data||[];
  const history=responses[4].data||[];
  const promos=responses[5].data||[];
  const orders=responses[6].data||[];
  const supplierReturns=responses[7].data||[];
  const checklists=responses[8].data||[];
  const customers=responses[9].data||[];
  const suppliers=responses[10].data||[];
  const receivables=responses[11].data||[];
  const insights=responses[12].data||{reorder:[],fast_movers:[],dead_stock:[]};
  const productById=new Map(products.map(function(p){return [p.id,p];}));
  const customerById=new Map(customers.map(function(c){return [c.id,c];}));
  const today=new Date(); today.setHours(0,0,0,0);
  const in30=new Date(today); in30.setDate(in30.getDate()+30);
  const expiring=batches.filter(function(b){if(!b.expires_on)return false;const d=new Date(b.expires_on+'T00:00:00');return d>=today&&d<=in30;});
  const overdue=receivables.filter(function(r){return ['open','partial'].includes(r.status)&&r.due_date&&new Date(r.due_date+'T00:00:00')<today;});
  const stockCost=products.filter(function(p){return p.is_active;}).reduce(function(sum,p){return sum+Number(p.stock_quantity||0)*Number(p.cost_price||0);},0);
  const activePromos=promos.filter(function(p){return p.is_active;});
  const reserved=orders.filter(function(o){return o.status==='reserved';});

  root.innerHTML=[
    ctx.head('Retail Suite','Packs/tingi, wholesale, variants, expiry, serials, promos, reservations, credit, labels and closing controls',
      canManage ? '<div class="actions"><button id="retail-import" class="btn btn-secondary">CSV import</button><button id="retail-profit" class="btn btn-secondary">Profit calculator</button><button id="retail-cash" class="btn btn-primary">Cash counter</button></div>' : ''),
    '<section class="metrics">',
      '<article class="metric"><div class="metric-label">Reorder</div><div class="metric-value">',ctx.number((insights.reorder||[]).length),'</div><div class="metric-sub">Suggested replenishment</div></article>',
      '<article class="metric"><div class="metric-label">Expiring ≤30d</div><div class="metric-value">',ctx.number(expiring.length),'</div><div class="metric-sub">FEFO batch stock</div></article>',
      '<article class="metric"><div class="metric-label">Reserved orders</div><div class="metric-value">',ctx.number(reserved.length),'</div><div class="metric-sub">Pickup / deposits</div></article>',
      '<article class="metric"><div class="metric-label">Overdue utang</div><div class="metric-value">',ctx.number(overdue.length),'</div><div class="metric-sub">Open customer balances</div></article>',
    '</section>',
    '<section class="grid-2">',
      '<div class="card"><div class="card-title"><h3>Retail actions</h3><span>Cloud-managed advanced stock</span></div><div class="actions" style="flex-wrap:wrap">',
        canManage?'<button id="retail-batch" class="btn btn-secondary btn-sm">Receive batch</button><button id="retail-serial" class="btn btn-secondary btn-sm">Register serials</button><button id="retail-price" class="btn btn-secondary btn-sm">Schedule price</button><button id="retail-promo" class="btn btn-secondary btn-sm">New promo</button><button id="retail-loss" class="btn btn-secondary btn-sm">Damage / loss</button><button id="retail-supplier-return" class="btn btn-secondary btn-sm">Supplier return</button>':'',
        '<button id="retail-reserve" class="btn btn-secondary btn-sm">Reservation</button><button id="retail-credit" class="btn btn-secondary btn-sm">Utang terms</button><button id="retail-opening" class="btn btn-secondary btn-sm">Opening checklist</button><button id="retail-closing" class="btn btn-secondary btn-sm">Closing checklist</button>',
      '</div></div>',
      '<div class="card"><div class="card-title"><h3>Inventory value</h3><span>Current cost basis</span></div>',
        row('Stock cost',ctx.money(stockCost),'Active product stock × unit cost'),
        row('Active promos',ctx.number(activePromos.length),'Percentage, buy/get and bundles'),
        row('Available serials',ctx.number(serials.filter(function(s){return s.status==='available';}).length),'Serialized inventory ready to sell'),
        row('Supplier returns',ctx.number(supplierReturns.length),'Recent return records'),
      '</div>',
    '</section>',
    '<div class="card" style="margin-top:14px"><div class="card-title"><h3>Reorder & movement intelligence</h3><span>30-day view</span></div><div class="grid-2">',
      '<div><h4>Reorder suggestions</h4><div class="stat-list">',(insights.reorder||[]).slice(0,10).map(function(x){return row(ctx.esc(x.name),ctx.number(x.suggested_quantity)+' '+ctx.esc(x.unit||'pc'),'Stock '+ctx.number(x.stock_quantity)+' · '+ctx.esc(x.sku));}).join('')||'<div class="help">No items below reorder point.</div>','</div></div>',
      '<div><h4>Fast movers / dead stock</h4><div class="stat-list">',(insights.fast_movers||[]).slice(0,5).map(function(x){return row(ctx.esc(x.name),ctx.number(x.quantity)+' sold',ctx.money(x.revenue));}).join('')||'<div class="help">No recent movement.</div>',
      (insights.dead_stock||[]).slice(0,5).map(function(x){return row(ctx.esc(x.name),ctx.number(x.stock_quantity)+' on hand','Dead stock · '+(x.last_sold_at?ctx.niceDate(x.last_sold_at):'never sold'));}).join(''),'</div></div>',
    '</div></div>',
    '<div class="table-wrap" style="margin-top:14px"><table><thead><tr><th>Product</th><th>Retail setup</th><th>Stock</th><th>Cost / price</th><th>Margin</th><th>Actions</th></tr></thead><tbody>',
      products.map(function(p){
        const setup=[p.retail_parent_id?'PACK '+qty(p.retail_multiplier)+'×':'BASE',p.variant_name?ctx.esc((p.variant_group||'Variant')+' · '+p.variant_name):'',p.is_weighed?'WEIGHED':'',p.batch_tracked?'BATCH':'',p.serial_tracked?'SERIAL':''].filter(Boolean).join(' · ');
        return '<tr><td><strong>'+ctx.esc(p.name)+'</strong><div class="help">'+ctx.esc(p.sku)+(p.barcode?' · '+ctx.esc(p.barcode):'')+'</div></td><td>'+setup+'<div class="help">'+ctx.esc(p.unit||'pc')+(p.wholesale_price!=null?' · wholesale '+ctx.money(p.wholesale_price)+' @ '+qty(p.wholesale_min)+'+':'')+'</div></td><td><strong>'+ctx.number(p.stock_quantity)+' '+ctx.esc(p.unit||'pc')+'</strong><div class="help">Reorder '+ctx.number(p.reorder_level)+'</div></td><td>'+ctx.money(p.cost_price)+' / <strong>'+ctx.money(p.selling_price)+'</strong></td><td>'+margin(p.cost_price,p.selling_price).toFixed(1)+'%</td><td><div class="actions">'+(canManage?'<button class="btn btn-secondary btn-sm retail-product" data-id="'+p.id+'">Settings</button>':'')+'<button class="btn btn-secondary btn-sm retail-label" data-id="'+p.id+'">Print label</button></div></td></tr>';
      }).join('')||'<tr><td colspan="6">No products yet.</td></tr>',
    '</tbody></table></div>',
    '<section class="grid-2" style="margin-top:14px">',
      '<div class="card"><div class="card-title"><h3>Batch & expiry</h3><span>',ctx.number(batches.length),' tracked lot(s)</span></div><div class="stat-list">',
        batches.slice(0,12).map(function(b){const p=productById.get(b.product_id);return row(ctx.esc(p?.name||'Product'),ctx.number(b.quantity),ctx.esc(b.batch_number)+' · '+(b.expires_on||'no expiry'));}).join('')||'<div class="help">No batches recorded.</div>',
      '</div></div>',
      '<div class="card"><div class="card-title"><h3>Scheduled pricing</h3><span>Audit + future changes</span></div><div class="stat-list">',
        schedules.slice(0,7).map(function(s){const p=productById.get(s.product_id);return row(ctx.esc(p?.name||'Product'),ctx.money(s.price),(s.applied_at?'Applied ':'Effective ')+ctx.niceDate(s.applied_at||s.effective_at,true));}).join('')||'<div class="help">No scheduled prices.</div>',
        history.slice(0,5).map(function(h){const p=productById.get(h.product_id);return row(ctx.esc(p?.name||'Product'),ctx.money(h.new_price),(h.old_price==null?'Initial':ctx.money(h.old_price)+' →')+' · '+ctx.niceDate(h.created_at,true));}).join(''),
      '</div></div>',
      '<div class="card"><div class="card-title"><h3>Promos & bundles</h3><span>',ctx.number(activePromos.length),' active</span></div><div class="stat-list">',
        promos.slice(0,10).map(function(p){let value=p.kind==='percent'?qty(p.discount_percent)+'% off':p.kind==='bogo'?'Buy '+qty(p.buy_qty)+' get '+qty(p.free_qty):'Bundle '+ctx.money(p.bundle_price);return row(ctx.esc(p.name),ctx.esc(value),ctx.niceDate(p.starts_at)+' → '+ctx.niceDate(p.ends_at));}).join('')||'<div class="help">No promotions yet.</div>',
      '</div></div>',
      '<div class="card"><div class="card-title"><h3>Reservations / utang</h3><span>Pickup and customer credit</span></div><div class="stat-list">',
        orders.slice(0,8).map(function(o){const c=customerById.get(o.customer_id);return row(ctx.esc(c?.name||'Customer'),ctx.money(o.quoted_total),ctx.esc(o.status)+' · deposit '+ctx.money(o.deposit)+(o.due_at?' · '+ctx.niceDate(o.due_at,true):''));}).join('')||'<div class="help">No reservations.</div>',
        overdue.slice(0,5).map(function(r){const c=customerById.get(r.customer_id);return row(ctx.esc(c?.name||'Customer'),ctx.money(r.balance),'OVERDUE · '+ctx.esc(r.due_date));}).join(''),
      '</div></div>',
    '</section>',
    '<div class="card" style="margin-top:14px"><div class="card-title"><h3>Opening / closing history</h3><span>Cashier accountability</span></div><div class="stat-list">',
      checklists.slice(0,12).map(function(c){return row(ctx.esc(c.kind.charAt(0).toUpperCase()+c.kind.slice(1)),ctx.esc(c.day),ctx.niceDate(c.created_at,true));}).join('')||'<div class="help">No completed checklists yet.</div>',
    '</div></div>'
  ].join('');

  const reload=async function(){await pageRetail(root,ctx);};
  document.querySelector('#retail-import')?.addEventListener('click',function(){openCsvImport(ctx,reload);});
  document.querySelector('#retail-profit')?.addEventListener('click',function(){openProfitCalculator(ctx);});
  document.querySelector('#retail-cash')?.addEventListener('click',function(){openCashCounter(ctx);});
  document.querySelector('#retail-batch')?.addEventListener('click',function(){openBatch(ctx,products,reload);});
  document.querySelector('#retail-serial')?.addEventListener('click',function(){openSerials(ctx,products,reload);});
  document.querySelector('#retail-price')?.addEventListener('click',function(){openPriceSchedule(ctx,products,reload);});
  document.querySelector('#retail-promo')?.addEventListener('click',function(){openPromo(ctx,products,reload);});
  document.querySelector('#retail-reserve')?.addEventListener('click',function(){openReserve(ctx,products,customers,reload);});
  document.querySelector('#retail-loss')?.addEventListener('click',function(){openStockLoss(ctx,products,reload);});
  document.querySelector('#retail-supplier-return')?.addEventListener('click',function(){openSupplierReturn(ctx,products,suppliers,reload);});
  document.querySelector('#retail-credit')?.addEventListener('click',function(){openCreditTerms(ctx,customers,receivables,reload);});
  document.querySelector('#retail-opening')?.addEventListener('click',function(){openChecklist(ctx,'opening',reload);});
  document.querySelector('#retail-closing')?.addEventListener('click',function(){openChecklist(ctx,'closing',reload);});
  root.querySelectorAll('.retail-product').forEach(function(btn){btn.addEventListener('click',function(){const p=products.find(function(x){return x.id===btn.dataset.id;});if(p)openRetailProduct(ctx,p,products,reload);});});
  root.querySelectorAll('.retail-label').forEach(function(btn){btn.addEventListener('click',function(){const p=products.find(function(x){return x.id===btn.dataset.id;});if(p)printLabel(ctx,p);});});
}

export async function renderDigitalReceipt(app, ctx, token) {
  if (!token) {
    app.innerHTML='<div class="setup"><div class="setup-card"><h1>Receipt link required</h1><p>This digital receipt link is incomplete.</p><a class="btn btn-secondary" href="#/">StorePOS</a></div></div>';
    return;
  }

  app.innerHTML='<div class="setup"><div class="setup-card"><h1>Loading digital receipt…</h1><p>Please wait while the receipt is verified.</p></div></div>';
  const result=await ctx.supabase.rpc('storepos_receipt',{p_token:token});

  if(result.error||!result.data){
    app.innerHTML='<div class="setup"><div class="setup-card"><h1>Receipt unavailable</h1><p>'+ctx.esc(ctx.friendlyError(result.error||new Error('Receipt not found.')))+'</p><p class="help">Please contact the store if you need another copy.</p><div style="height:14px"></div><div class="help">Powered by StorePOS</div></div></div>';
    return;
  }

  const r=result.data;
  if(r.expired){
    app.innerHTML=[
      '<div class="setup"><div class="setup-card" style="max-width:620px;text-align:center">',
        '<span class="eyebrow">Digital receipt</span>',
        '<h1>This digital receipt has expired.</h1>',
        '<p>For privacy and security, StorePOS digital receipts are available for 3 days after purchase.</p>',
        r.expires_at?'<div class="verify-note"><strong>Expired</strong><span>'+ctx.esc(ctx.niceDate(r.expires_at,true))+'</span></div>':'',
        '<p class="help" style="margin-top:18px">Please contact the store if you need another receipt copy.</p>',
        '<div style="margin-top:24px;padding-top:16px;border-top:1px solid var(--line,#e5e7eb)" class="help">Powered by <strong>StorePOS</strong> · Retail Management & POS System</div>',
      '</div></div>'
    ].join('');
    return;
  }

  const items=Array.isArray(r.items)?r.items:[];
  const charges=Array.isArray(r.charges)?r.charges:[];
  const payments=Array.isArray(r.payments)?r.payments:[];

  app.innerHTML=[
    '<div class="setup"><div class="setup-card" style="max-width:680px">',
      '<div style="text-align:center">',
        '<span class="eyebrow">Verified digital receipt</span>',
        '<h1 style="margin-bottom:6px">',ctx.esc(r.shop||'Retail Store'),'</h1>',
        r.address?'<p style="margin-top:0">'+ctx.esc(r.address)+'</p>':'',
      '</div>',
      '<div class="verify-note" style="margin-top:18px"><strong>',ctx.esc(r.sale_number||'Sale'),'</strong><span>',ctx.esc(ctx.niceDate(r.created_at,true)),' · ',ctx.esc(String(r.status||'completed').toUpperCase()),'</span></div>',

      '<div class="stat-list" style="margin-top:18px">',
        items.map(function(i){return row(ctx.esc(i.name||'Item'),ctx.money(i.line_total),qty(i.quantity)+' '+ctx.esc(i.unit||'pc')+' × '+ctx.money(i.unit_price));}).join(''),
        charges.map(function(ch){return row(ctx.esc(ch.name||'Charge'),ctx.money(ch.amount),'Additional charge');}).join(''),
      '</div>',

      '<div class="stat-list" style="margin-top:16px">',
        row('Subtotal',ctx.money(r.subtotal),''),
        Number(r.discount||0)?row('Discount','− '+ctx.money(r.discount),''):'',
        Number(r.tax||0)?row('Tax',ctx.money(r.tax),''):'',
        row('TOTAL',ctx.money(r.total),''),
        Number(r.change||0)>0?row('Change',ctx.money(r.change),''):'',
      '</div>',

      payments.length?[
        '<div class="card" style="margin-top:18px;padding:16px">',
          '<span class="eyebrow">Payment details</span>',
          '<div class="stat-list" style="margin-top:10px">',
            payments.map(function(p){
              return row(
                ctx.esc(p.method||'PAYMENT'),
                ctx.money(p.amount),
                ctx.esc((p.status||'PAID')+(p.reference?' · Ref '+p.reference:''))
              );
            }).join(''),
          '</div>',
        '</div>'
      ].join(''):'',

      '<div class="verify-note" style="margin-top:18px"><strong>Digital receipt availability</strong><span>Available until ',ctx.esc(ctx.niceDate(r.expires_at,true)),'</span></div>',
      '<p class="help" style="margin-top:10px">This secure digital receipt is available for 3 days from the original purchase time.</p>',

      '<div class="modal-actions" style="margin-top:20px"><button class="btn btn-primary" id="receipt-print">Print receipt</button></div>',

      '<div style="margin-top:26px;padding-top:16px;border-top:1px solid var(--line,#e5e7eb);text-align:center" class="help">',
        'Powered by <strong>StorePOS</strong> · Retail Management & POS System',
      '</div>',
    '</div></div>'
  ].join('');

  document.querySelector('#receipt-print')?.addEventListener('click',function(){window.print();});
}
