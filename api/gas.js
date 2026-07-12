// Velvet Barrel — GAS Proxy
// Hides the real Google Apps Script URL from the browser.
// Set GAS_URL as an environment variable in Vercel dashboard.

export default async function handler(req, res) {
  // Only allow GET
  if (req.method !== "GET") {
    return res
      .status(405)
      .json({ success: false, message: "Method not allowed" });
  }

  const GAS_URL = process.env.GAS_URL;
  if (!GAS_URL) {
    return res
      .status(500)
      .json({ success: false, message: "GAS_URL not configured" });
  }

  const { action, body } = req.query;

  if (!action) {
    return res
      .status(400)
      .json({ success: false, message: "action is required" });
  }

  const ALLOWED_ACTIONS = [
    "getInventory",
    "getOrders",
    "getBills",
    "getSettings",
    "verifyPin",
    "addInventoryItem",
    "updateInventoryItem",
    "deleteInventoryItem",
    "adjustStock",
    "saveOrder",
    "updateOrderStatus",
    "saveBill",
    "sendResetPin",
    "saveSettings",
    "fixOrdersHeaders",
    "fixInventoryHeaders",
    "verifyAppPassword",
    "sendAppPasswordOtp",
    "resetAppPassword",
  ];
  if (!ALLOWED_ACTIONS.includes(action)) {
    return res
      .status(403)
      .json({ success: false, message: "Action not permitted" });
  }

  // Build the upstream GAS URL
  let upstreamUrl = `${GAS_URL}?action=${encodeURIComponent(action)}`;
  if (body) {
    // body arrives decoded by Node — re-encode before forwarding
    upstreamUrl += `&body=${encodeURIComponent(body)}`;
  }

  try {
    const upstream = await fetch(upstreamUrl, {
      headers: { "User-Agent": "VelvetBarrel-Proxy/1.0" },
      redirect: "follow",
    });

    const data = await upstream.json();
    return res.status(200).json(data);
  } catch (err) {
    console.error("GAS proxy error:", err.message);
    return res.status(502).json({ success: false, message: "Upstream error" });
  }
}
