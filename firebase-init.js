// ═══════════════════════════════════════════════════════════════
//  PUSHPAM BAR POS — Firebase Init & API Layer
// ═══════════════════════════════════════════════════════════════

firebase.initializeApp({
  apiKey: "AIzaSyByXtsxQkXMbVw-a7hqUyxjwDXJjOVdhQg",
  authDomain: "pushpam-bar-pos.firebaseapp.com",
  projectId: "pushpam-bar-pos",
  storageBucket: "pushpam-bar-pos.firebasestorage.app",
  messagingSenderId: "477169972182",
  appId: "1:477169972182:web:c92372bb2d8af057deaa77"
});

const db = firebase.firestore();
const GAS_URL = "/api/gas"; 

async function sendEmail(action, body) {
  let url = GAS_URL + "?action=" + action;
  if (body) url += "&body=" + encodeURIComponent(JSON.stringify(body));
  const res = await fetch(url);
  return res.json();
}

const LIQUOR_CATS = ["Liquor", "Beer"];

async function getNextCounter(collection) {
  const ref = db.doc("counters/" + collection);
  return db.runTransaction(function(t) {
    return t.get(ref).then(function(doc) {
      var c = doc.exists ? (doc.data().count || 0) : 0;
      if (doc.exists) t.update(ref, { count: c + 1 });
      else t.set(ref, { count: c + 1 });
      return c + 1;
    });
  });
}

function calcBottlePrice(p30, ml) { return Math.round(((+ml || 750) / 30) * +p30); }
function calcPer30ml(pBtl, ml) { return Math.round((+pBtl / ((+ml || 750) / 30)) * 100) / 100; }
function cartLineBottles(u, q, ml) { return u === "bottle" ? q : (q * (u === "large" ? 60 : 30)) / (ml || 750); }
function bottlesInCart(cart, id) { return cart.filter(c => c.itemId === id).reduce((s, c) => s + cartLineBottles(c.unit, c.qty, c.mlPerBottle || 750), 0); }
function calcBottlesUsed(item) { if (LIQUOR_CATS.includes(item.category)) return item.unit === "bottle" ? item.qty : (item.qty * (item.unit === "large" ? 60 : 30)) / (item.mlPerBottle || 750); return item.qty; }
function isLowStock(q, t) { return (+q || 0) <= (+t || 2); }
function bottlesToDisplay(q) { const n=+q||0; if(n===0) return "0 btl"; if(n<1) return (n*750).toFixed(0)+"ml"; return (n%1===0?n:n.toFixed(2))+" btl"; }

async function firebaseLogin(password) {
  const doc = await db.doc("settings/appPassword").get();
  return { valid: String(password) === String(doc.exists ? doc.data().value : "2121") };
}
async function firebaseVerifyPin(pin) {
  const doc = await db.doc("settings/managerPin").get();
  return { valid: String(pin) === String(doc.exists ? doc.data().value : "1234") };
}

async function getInventory() {
  return (await db.collection("inventory").where("active", "==", true).get()).docs.map(d => ({ id: d.id, _doc: d.data() }));
}
async function getInventoryByDateRange(start, end) {
  const s = firebase.firestore.Timestamp.fromDate(new Date(start));
  const eDt = new Date(end); eDt.setHours(23,59,59,999);
  const e = firebase.firestore.Timestamp.fromDate(eDt);
  return (await db.collection("inventory").where("createdAt", ">=", s).where("createdAt", "<=", e).orderBy("createdAt", "desc").get()).docs.map(d => ({ id: d.id, _doc: d.data() }));
}

async function addInventoryItem(item) {
  const ex = await db.collection("inventory").where("name", "==", item.name).where("active", "==", true).get();
  if (!ex.empty && !item.forceNew && !item.mergeIntoExisting) return { duplicate: true, existingId: ex.docs[0].id };
  if (!ex.empty && item.mergeIntoExisting) return updateInventoryItem(ex.docs[0].id, item);
  const pMap = { Liquor:"LQ", Beer:"BR", "Soft Drinks":"SD", Cocktails:"CK", Mocktails:"MK" };
  const id = (pMap[item.category]||"IT") + "-" + String(await getNextCounter("inventory")).padStart(4,"0");
  await db.doc("inventory/"+id).set({ itemId:id, name:item.name, category:item.category, imageUrl:item.imageUrl||"", price30ml:+item.price30ml||0, priceBottle:+item.priceBottle||0, mlPerBottle:+item.mlPerBottle||750, qtyAvailable:+item.qtyAvailable??1, lowStockThreshold:+item.lowStockThreshold??2, active:true, createdAt: firebase.firestore.FieldValue.serverTimestamp(), updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
  return { id };
}
async function updateInventoryItem(id, item) {
  const u = { updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
  ["name","category","imageUrl","price30ml","priceBottle","mlPerBottle","qtyAvailable","lowStockThreshold"].forEach(f => { if(item[f]!==undefined) u[f] = f==='name'||f==='category'||f==='imageUrl' ? item[f] : Number(item[f])||0; });
  await db.doc("inventory/"+id).update(u); return { updated: true };
}
async function deleteInventoryItem(id) { await db.doc("inventory/"+id).update({ active:false, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }); return { deleted:true }; }
async function adjustStock(id, delta) { const ref=db.doc("inventory/"+id); await ref.update({ qtyAvailable: firebase.firestore.FieldValue.increment(+delta), updatedAt: firebase.firestore.FieldValue.serverTimestamp() }); return { newQty: (await ref.get()).data().qtyAvailable }; }

async function getOrders() { return (await db.collection("orders").orderBy("createdAt","desc").get()).docs.map(d=>({id:d.id, _doc:d.data()})); }
async function saveOrder(orderData) {
  const { tableNumber, items, customerName, customerPhone } = orderData;
  const prevStock = {};
  if (tableNumber) {
    const old = (await db.collection("orders").where("tableNumber","==",String(tableNumber)).where("status","==","open").get()).docs;
    if(old.length) { const rb=db.batch(), db2=db.batch(); old.forEach(o=>{(o.data().items||[]).forEach(i=>{if(i.qty) rb.update(db.doc("inventory/"+i.itemId),{qtyAvailable:firebase.firestore.FieldValue.increment(calcBottlesUsed(i))});}); db2.delete(o.ref);}); await rb.commit(); await db2.commit(); }
    items.forEach(i=>{if(i.itemId && prevStock[i.itemId]===undefined) prevStock[i.itemId]=null;});
    for(let k in prevStock) { const d=(await db.doc("inventory/"+k).get()); if(d.exists) prevStock[k]=d.data().qtyAvailable||0; }
    if(items.length) { const b=db.batch(); items.forEach(i=>{if(i.qty) b.update(db.doc("inventory/"+i.itemId),{qtyAvailable:firebase.firestore.FieldValue.increment(-calcBottlesUsed(i)),updatedAt:firebase.firestore.FieldValue.serverTimestamp()});}); await b.commit(); }
  }
  const orderId = "ORD-"+String(await getNextCounter("orders")).padStart(4,"0");
  const sub = items.reduce((s,i)=>s+(i.lineTotal||0),0);
  await db.doc("orders/"+orderId).set({ orderId, tableNumber, customerName:customerName||"", customerPhone:customerPhone||"", items, status:"open", subtotal:sub, createdAt:firebase.firestore.FieldValue.serverTimestamp(), updatedAt:firebase.firestore.FieldValue.serverTimestamp() });
  
  const alerts = [];
  for(let j=0;j<items.length;j++) { const it=items[j]; if(!it.itemId||!it.qty) continue; const p=prevStock[it.itemId]??Infinity; const d=(await db.doc("inventory/"+it.itemId).get()).data(); if(d && d.qtyAvailable<=(d.lowStockThreshold||2) && p>(d.lowStockThreshold||2)) alerts.push({name:d.name,category:d.category,remainingBottles:d.qtyAvailable,threshold:d.lowStockThreshold||2}); }
  if(alerts.length) { try { const s=await getSettingsRaw(); await sendEmail("sendLowStockEmail",{alerts,barName:s.barName||"Pushpam A/C Bar"}); } catch(e){} }
  return { saved:true, orderId };
}
async function updateOrderStatus(tn, ns) { const s=(await db.collection("orders").where("tableNumber","==",String(tn)).where("status","==","open").get()); const b=db.batch(); s.docs.forEach(d=>b.update(d.ref,{status:ns,updatedAt:firebase.firestore.FieldValue.serverTimestamp()})); await b.commit(); return {updated:s.size}; }

async function getBills() { return (await db.collection("bills").orderBy("createdAt","desc").get()).docs.map(d=>({id:d.id, _doc:d.data()})); }
async function saveBill(bd) { const id="BILL-"+String(await getNextCounter("bills")).padStart(4,"0"); await db.doc("bills/"+id).set({...bd, billId:id, createdAt:firebase.firestore.FieldValue.serverTimestamp()}); return {saved:true, billId:id}; }

async function getSettings() { const s={}; (await db.collection("settings").get()).docs.forEach(d=>{s[d.id]=d.data().value;}); if(s.managerPin) s.managerPin="••••"; if(s.appPassword) s.appPassword="••••"; return s; }
async function getSettingsRaw() { const s={}; (await db.collection("settings").get()).docs.forEach(d=>{s[d.id]=d.data().value;}); return s; }
async function saveSettings(u) { const b=db.batch(); for(let k in u) { if(u[k]==="••••") continue; b.set(db.doc("settings/"+k),{key:k,value:u[k],updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true}); } await b.commit(); return {saved:true}; }