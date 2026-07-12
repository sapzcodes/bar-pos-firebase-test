const admin = require("firebase-admin");
const serviceAccount = require("./service-account-key.json");
const data = require("./exported-data.json");

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function migrateSettings() {
  console.log("Migrating settings...");
  for (const [key, value] of Object.entries(data.settings || {})) {
    await db.doc(`settings/${key}`).set({ key, value: String(value), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  }
  console.log("  Done settings");
}

async function migrateInventory() {
  console.log("Migrating inventory...");
  let batch = db.batch(), count = 0;
  for (const item of data.inventory || []) {
    const id = item["Item ID"]; if (!id) continue;
    batch.set(db.doc(`inventory/${id}`), {
      itemId: id, name: String(item["Item Name"]||""), category: String(item["Category"]||""),
      imageUrl: String(item["Image URL"]||""), price30ml: Number(item["Price 30ml"])||0,
      priceBottle: Number(item["Price Bottle"])||0, mlPerBottle: Number(item["ML per Bottle"])||750,
      qtyAvailable: Number(item["Qty Available"])||0, lowStockThreshold: Number(item["Low Stock Threshold"])||2,
      active: item["Active"] !== false && item["Active"] !== "FALSE",
      createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    if (++count % 400 === 0) { await batch.commit(); batch = db.batch(); }
  }
  if (count % 400 !== 0) await batch.commit();
  console.log(`  Done ${count} inventory items`);
}

async function migrateOrders() {
  console.log("Migrating orders...");
  const grouped = {};
  for (const o of data.orders || []) {
    const id = o["Order ID"]; if (!id) continue;
    if (!grouped[id]) grouped[id] = { orderId: id, tableNumber: String(o["Table Number"]||""), customerName: String(o["Customer Name"]||""), customerPhone: String(o["Customer Phone"]||""), items: [], status: String(o["Status"]||"open"), subtotal: 0 };
    grouped[id].items.push({ itemId: o["Item ID"], itemName: o["Item Name"], qty: Number(o["Qty"])||0, unit: o["Unit"], unitPrice: Number(o["Unit Price"])||0, lineTotal: Number(o["Line Total"])||0, category: "", mlPerBottle: 750 });
    grouped[id].subtotal += Number(o["Line Total"])||0;
  }
  let batch = db.batch(), count = 0;
  for (const id in grouped) {
    batch.set(db.doc(`orders/${id}`), { ...grouped[id], createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    if (++count % 400 === 0) { await batch.commit(); batch = db.batch(); }
  }
  if (count % 400 !== 0) await batch.commit();
  console.log(`  Done ${count} orders`);
}

async function migrateBills() {
  console.log("Migrating bills...");
  let batch = db.batch(), count = 0;
  for (const b of data.bills || []) {
    const id = b["Bill ID"]; if (!id) continue;
    let items = []; try { items = typeof b["Items JSON"] === "string" ? JSON.parse(b["Items JSON"]) : (b["Items JSON"]||[]); } catch(e) {}
    batch.set(db.doc(`bills/${id}`), { billId: id, tableNumber: String(b["Table Number"]||""), customerName: String(b["Customer Name"]||""), customerPhone: String(b["Customer Phone"]||""), items, subtotal: Number(b["Subtotal"])||0, gstAmount: Number(b["GST Amount"])||0, total: Number(b["Total"])||0, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    if (++count % 400 === 0) { await batch.commit(); batch = db.batch(); }
  }
  if (count % 400 !== 0) await batch.commit();
  console.log(`  Done ${count} bills`);
}

async function setCounters() {
  const invC = (data.inventory || []).length;
  const ordC = new Set((data.orders || []).map(o => o["Order ID"]).filter(Boolean)).size;
  const bilC = (data.bills || []).length;
  await db.doc("counters/inventory").set({ count: invC });
  await db.doc("counters/orders").set({ count: ordC });
  await db.doc("counters/bills").set({ count: bilC });
  console.log(`Counters set: inv=${invC}, ord=${ordC}, bil=${bilC}`);
}

async function main() {
  console.log("Starting Migration...");
  await migrateSettings();
  await migrateInventory();
  await migrateOrders();
  await migrateBills();
  await setCounters();
  console.log("MIGRATION COMPLETE! Delete service-account-key.json and exported-data.json now.");
  process.exit(0);
}

main().catch(e => { console.error("FAIL:", e); process.exit(1); });