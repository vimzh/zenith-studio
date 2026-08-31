<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Frontend conventions

- Do not invent requirements, product claims, copy, data, or abstractions. If the repository does not establish something, ask before adding it.
- Before writing code, ask whether the code needs to exist. Reuse what is already present and keep basic features direct; never over-engineer them.
- Keep the codebase modular and organized around clear responsibilities. Preserve established boundaries, avoid oversized files, and commit coherent changes frequently so progress remains easy to review and recover.
- Keep user-visible copy in `src/data`. Pages and components import headings, subheadings, labels, descriptions, and other content from that folder instead of hardcoding it. Use `import()` only when runtime code-splitting is actually needed.
- Check `src/components/ui` first and use the existing shadcn component whenever it fits. Create a custom component only when shadcn does not provide the required component or behavior.
- Use restrained shadcn buttons with minimal corner radius for the starter landing page. Keep Smooth UI available, but use candy buttons only when a project explicitly calls for that direction.
- Do not imitate Windows- or macOS-specific native UI. Preserve semantic HTML and accessibility, but use the project’s shadcn visual language for product controls.
- Never define components inline or nest them inside pages or other components. Keep pages as composition files; put every component used by a page in its own module and import it.
- Use Founders Grotesk for interface and display text. Use DM Mono for code, technical values, and monospaced text.
