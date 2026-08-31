# Repository conventions

- This repository is a reusable hackathon starter. Keep shared setup generic and add product-specific behavior only when a project requires it.
- Prefer SQLite through Bun’s built-in `bun:sqlite` module for prototype persistence. Do not introduce Docker or a remote database unless concrete requirements exceed SQLite’s concurrency, scale, or feature limits.
- Run `bun run setup` when initializing a fresh copy of the template.
- Before implementing a medium or large feature, review `docs/idea.md` when it contains a product brief so decisions reflect the product’s purpose. Skip this step for small, direct user requests and proceed with those as written.
