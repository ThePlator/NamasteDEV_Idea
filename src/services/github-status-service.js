
export const setCommitStatus = async ({
  repo,
  sha,
  state, 
  description,
  targetUrl,
  context = "Custom CI/CD Server",
}) => {
  const url = `https://api.github.com/repos/${repo}/statuses/${sha}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "custom-cicd-server",
    },
    body: JSON.stringify({
      state,
      description,
      target_url: targetUrl,
      context,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("GitHub status update failed:", text);
  }
};
