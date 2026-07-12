export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const config = {
    githubOwner: process.env.GITHUB_OWNER || "",
    githubRepo: process.env.GITHUB_REPO || "",
    githubToken: process.env.GITHUB_TOKEN || ""
  };

  res.status(200).json(config);
}