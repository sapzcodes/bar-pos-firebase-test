export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).end();
  }

  const { base64Content, itemId, fileType } = req.body || {};
  const { GITHUB_OWNER, GITHUB_REPO, GITHUB_TOKEN } = process.env;

  if (
    !base64Content ||
    !itemId ||
    !GITHUB_OWNER ||
    !GITHUB_REPO ||
    !GITHUB_TOKEN
  ) {
    return res
      .status(400)
      .json({ error: "Missing upload parameters or GitHub env vars" });
  }

  const ext = fileType?.includes("png") ? "png" : "jpg";
  const path = `images/${itemId}.${ext}`;

  let sha;
  try {
    const check = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`,
      {
        headers: { Authorization: `token ${GITHUB_TOKEN}` },
      },
    );

    if (check.ok) {
      const existing = await check.json();
      sha = existing.sha;
    }
  } catch (_) {}

  const payload = {
    message: `Upload image for ${itemId}`,
    content: base64Content,
  };

  if (sha) payload.sha = sha;

  const result = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`,
    {
      method: "PUT",
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  const json = await result.json();
  const imageUrl =
    json.content?.download_url ||
    `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/${path}`;

  res.status(200).json({ imageUrl });
}
