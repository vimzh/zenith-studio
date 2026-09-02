import { TOOL_GROUPS } from "../src/lib/webmcp/tools";
import { CHAT_TOOL_NAMES } from "../src/lib/webmcp/chat-tools";
const chat = new Set(CHAT_TOOL_NAMES);
for (const { group, tools } of TOOL_GROUPS) {
  console.log(`\n## ${group}`);
  for (const t of tools) {
    const flags = [
      `scope=${t.scope ?? "editor"}`,
      t.network === true ? "PAID" : "",
      t.readOnly === true ? "readOnly" : "",
      chat.has(t.name) ? "chat" : "",
    ].filter(Boolean).join(" ");
    console.log(`  ${t.name.padEnd(32)} ${flags}`);
  }
}
