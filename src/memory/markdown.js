/**
 * Build the GM-readable markdown memory file from structured preference data.
 */
export function renderMemoryMarkdown({ worldName = "World", updatedAt = Date.now(), likes = {}, dislikes = {}, banned = [], events = [], path = "" } = {}) {
  const lines = [
    "# Agentic DJ Memory",
    "",
    `- World: ${worldName}`,
    `- Updated: ${new Date(updatedAt).toISOString()}`,
    `- File: ${path || "worlds/<world>/agentic-dj/memory.md"}`,
    "",
    "This file is written when the GM plays, skips, or bans a cue. The Director reads the structured copy in world settings and uses it on the next suggestion.",
    "",
    "## Learned likes",
    ...renderMoodMap(likes, "No liked cues yet."),
    "",
    "## Learned avoids",
    ...renderMoodMap(dislikes, "No skipped cues yet."),
    "",
    "## Banned",
    banned.length ? banned.map(row => `- ${row.name || row.soundId} (${row.soundId})`).join("\n") : "- None",
    "",
    "## Recent actions",
    "",
    "| When (UTC) | Action | Track | Mood | Scene | Note |",
    "| --- | --- | --- | --- | --- | --- |",
    ...(events.slice(0, 80).map(event => {
      const when = new Date(event.at).toISOString().replace("T", " ").slice(0, 19);
      return `| ${when} | ${event.action} | ${event.name || event.soundId} | ${event.mood || ""} | ${event.scene || ""} | ${String(event.why || "").replaceAll("|", "/")} |`;
    }))
  ];
  if (!events.length) lines.push("| — | — | — | — | — | — |");
  return `${lines.join("\n")}\n`;
}

function renderMoodMap(map, empty) {
  const moods = Object.keys(map || {});
  if (!moods.length) return ["", empty];
  const out = [""];
  for (const mood of moods.sort()) {
    out.push(`### ${mood}`);
    const entries = Object.entries(map[mood] || {}).sort((a, b) => (b[1].count ?? 0) - (a[1].count ?? 0));
    if (!entries.length) out.push("- None");
    for (const [id, row] of entries) {
      out.push(`- ${row.name || id} ×${row.count ?? 1} (\`${id}\`)`);
    }
    out.push("");
  }
  return out;
}
