# Lenovo Press MCP

A local [Model Context Protocol](https://modelcontextprotocol.io) server that pulls **public** [Lenovo Press](https://lenovopress.lenovo.com) documentation into an AI conversation.

It is a documentation server, not a configurator. Use it for product guides, datasheets, option tables, generation comparisons, change history, related publications, and OSIG OS-support rows. Live catalog, product rules, compatibility, sessions, and CSE / CFR / CFXML stay in the separate [x-config MCP](https://github.com/leuquim/xconfig-mcp).

If Press and x-config disagree on a SKU, believe x-config.

Authorized internal use. The server only fetches public Press pages (`entitled=0`, `drafts=0`). It does not log in as an employee and does not scrape the whole site.

## What it does

- Search Press by form ID, MTM, feature code, part number, or text.
- Resolve an identifier to the product guide, datasheet, or other candidates.
- Read document metadata (authors, last update, PDF URL).
- Fetch a table of contents, then one named section or table.
- Return dated change-history entries.
- List related publications and the product-family bundle.
- Look up a filtered OSIG OS-support page (never the multi-megabyte dump).
- HEAD a PDF for URL, size, and Last-Modified without ingesting PDF bytes.

Default retrieval is one search page or one document section. Full 60-page HTML and PDF bodies are never dumped into tool text.

## Requirements

- Node.js 22 or newer (developed on Node 24)
- Network access to `https://lenovopress.lenovo.com` for live answers
- An MCP client (Codex, Claude Desktop, Cursor, or any stdio client)

Windows is the developed platform. The server is stdio-only and has no Windows-specific runtime, so it can run elsewhere if Node 22+ is available.

## Setup

```powershell
git clone git@github.com:leuquim/lenovopress-mcp.git
cd lenovopress-mcp
npm ci
npm run build
```

`npm run build` emits `dist\index.js`. Point the MCP client at that file.

Optional:

```powershell
npm run verify
```

That typechecks, runs fixture unit tests against the saved LP2264 HTML, and launches the real stdio server through an MCP client.

## Connect an MCP client

Build first. Point the client at **your** clone.

### Codex

From the clone directory:

```powershell
codex mcp add lenovo-press -- node "$PWD\dist\index.js"
```

Optional cache directory:

```powershell
codex mcp add lenovo-press `
  --env "PRESS_CACHE_DIR=$PWD\.cache" `
  -- node "$PWD\dist\index.js"
```

### Claude Desktop, Cursor, and other JSON clients

Copy [examples/mcp.json](examples/mcp.json) and replace the absolute path:

```json
{
  "mcpServers": {
    "lenovo-press": {
      "command": "node",
      "args": ["C:\\absolute\\path\\to\\lenovopress-mcp\\dist\\index.js"],
      "env": {
        "PRESS_CACHE_DIR": "C:\\absolute\\path\\to\\lenovopress-mcp\\.cache"
      }
    }
  }
}
```

Restart or reconnect the client after changing this.

## Typical workflow

1. `press_resolve` with the product name, form ID (`LP2264`), slug, or MTM (`7DMKCTO1WW`).
2. `press_document_outline` to see sections and table captions.
3. `press_document_section` for the sections you need (`gpu-accelerators`, `network-adapters`, `power-supplies`, `comparing-the-sr680a-v4-to-the-sr680a-v3`).
4. `press_document_changes` with `latestOnly: true` when the question is "what landed in the last update?"
5. `press_osig_lookup` with `7DMK` or `SR680a V4` for certified OS rows.
6. Hand part numbers and feature codes to x-config if you need orderability or a configuration.

Example: "What are the SR680a V4 GPU options?" -> resolve LP2264 -> outline -> section `gpu-accelerators`. The table includes feature `CBAG` (HGX B300 NVL8). Confirm orderability in x-config.

## Tools

The server name is `lenovo-press`. Every tool is prefixed `press_`. All tools are read-only.

| Tool | What it does |
| --- | --- |
| `press_search` | Paginated public search. Query can be a form ID, MTM, feature, part, or text. |
| `press_resolve` | Ranked candidates for a URL, form ID, slug, MTM, feature, or part. Product guides rank first. |
| `press_document_meta` | Title, authors, updated date, resource type, PDF URL. |
| `press_document_outline` | Section list and table captions. Call this before fetching a section. |
| `press_document_section` | One section or table as markdown plus structured rows and identifiers. |
| `press_document_changes` | Dated change-history entries. `latestOnly` defaults to true. |
| `press_related` | Related publications, family links, and the family document bundle. |
| `press_osig_lookup` | Filtered OSIG rows (server, OS, support statement, availability). |
| `press_pdf_info` | PDF URL and HEAD metadata. Does not download PDF bytes. |

Prompts `press_options_brief` and `press_what_changed` are registered for the two most common architect jobs.

## Identifiers

These show up in both Press and x-config:

| Kind | Example |
| --- | --- |
| Form ID | `LP2264`, `DS0198`, `TIPS0259` |
| Slug | `lp2264-thinksystem-sr680a-v4-server` |
| MTM | `7DMK`, `7DMKCTO1WW` |
| Feature code | `CBAG`, `C5QY` |
| Part number | `4XB7A93127` |

Short tokens (`CX8`, `B300`) are full-text search and can over-match. Prefer a form ID, MTM, or `productFamily` such as `sr680a-v4-server` when you know it.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `PRESS_CACHE_DIR` | `<repo>/.cache` | Disk cache for live HTTP responses. |
| `PRESS_FIXTURE_DIR` | `<repo>/fixtures` when present | Offline HTML/JSON overlays used by tests. |
| `PRESS_RATE_LIMIT_MS` | `60000` | Minimum delay between live fetches (`robots.txt` crawl-delay). Cache hits do not wait. |
| `PRESS_OFFLINE` | unset | If `1`, never hit the network. Missing fixture/cache is an error. |
| `PRESS_REQUEST_TIMEOUT_MS` | `30000` | Per-request timeout. |
| `PRESS_MCP_ROOT` | Auto-detected | Override the project root if the layout is unusual. |

The server is stdio-only. It opens no port. stdout is MCP JSON-RPC; diagnostics go to stderr.

## Public-only and rate limits

- Search always sends `entitled=0` and `drafts=0`.
- There is no employee-login path.
- Live fetches honor a 60 second crawl-delay unless the response is already cached.
- OSIG lookups require a server term (`7DMK`, `SR680a V4`). The unfiltered OSIG XML/Excel export is refused.

## Layout

```
src/           MCP server, Press HTTP client, HTML/JSON parsers
fixtures/      LP2264 HTML plus recorded search/OSIG/PDF-HEAD responses
tests/unit     Parser and client tests against those fixtures
tests/e2e      Real stdio MCP client against dist/index.js
examples/      Sample client config
```

## Verify

```powershell
npm run verify
```

Acceptance fixture is [LP2264](https://lenovopress.lenovo.com/lp2264-thinksystem-sr680a-v4-server) (ThinkSystem SR680a V4). Unit tests parse the saved HTML. E2E launches `dist/index.js` over stdio and calls resolve, outline, section, changes, search, OSIG, and PDF info.
