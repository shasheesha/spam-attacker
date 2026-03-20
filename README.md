# Spam Attacker

> High-performance CLI tool for analyzing web form validation, response behavior, and performance weaknesses using safe, asynchronous testing techniques.

![Version](https://img.shields.io/badge/version-1.2.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Node](https://img.shields.io/badge/node-%3E%3D14.0.0-brightgreen)

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Usage](#usage)
- [CLI Options](#cli-options)
- [Examples](#examples)
- [Reports](#reports)
- [Scan History](#scan-history)
- [Exit Codes](#exit-codes)
- [CI/CD Integration](#cicd-integration)
- [Project Structure](#project-structure)
- [User Guidelines & Ethics](#user-guidelines--ethics)
- [Changelog](#changelog)

---

## Overview

**Spam Attacker** is a developer-focused security testing tool that helps identify weak or missing form validations, analyze server response behavior, detect missing rate limiting, and measure performance under controlled load.

It is **not** a destructive tool. All tests are safe, read-only, and throttled to avoid server overload.

---

## Features

| Feature                     | Description                                                          |
|-----------------------------|----------------------------------------------------------------------|
| Form Discovery              | Crawls a URL and extracts all `<form>` elements with field metadata  |
| Input Validation Testing    | Tests invalid emails, empty fields, boundary values, unexpected types |
| Rate Limit Detection        | Detects HTTP 429, blocking, and basic captcha triggers               |
| Async Request Engine        | Parallel requests with configurable concurrency and throttling       |
| Response Analysis           | Tracks status codes, response times, and error messages              |
| Issue Classification        | Severity levels: Low / Medium / High                                 |
| Recommendations Engine      | Actionable suggestions based on detected issues                      |
| Selective Report Formats    | Generate only the formats you need: JSON, TXT, HTML                  |
| Domain Allow-list           | Restrict scanning to pre-approved domains for safety                 |
| Scan History                | Every scan is appended to `scan-history.json` for audit trails       |
| CI/CD-friendly Exit Codes   | Non-zero exit on High severity issues — works in pipelines           |

---

## Requirements

- **Node.js** v14.0.0 or higher
- **npm** v6 or higher

---

## Installation

```bash
# Clone the repository
git clone <repo-url>
cd spam-attacker

# Install dependencies
npm install
```

---

## Usage

```bash
node index.js --url=<target-url> [options]
```

### Interactive mode (no flags needed)

```bash
node index.js
```

Launches a guided TUI — prompts you for all options step by step.

### CLI mode

```bash
node index.js --url=https://example.com \
  --concurrency=20 \
  --output=myreport \
  --timeout=15000 \
  --format=json,html \
  --allow-list=example.com \
  --rate-limit-test \
  --verbose
```

---

## CLI Options

| Option              | Type    | Default          | Description                                                   |
|---------------------|---------|------------------|---------------------------------------------------------------|
| `--url`             | string  | *(required)*     | Target URL to scan                                            |
| `--concurrency`     | number  | `10`             | Number of concurrent requests (1–100)                         |
| `--output`          | string  | `report`         | Filename prefix for generated reports                         |
| `--timeout`         | number  | `10000`          | Request timeout in milliseconds (1000–120000)                 |
| `--format`          | string  | `json,txt,html`  | Comma-separated list of report formats to generate            |
| `--allow-list`      | string  | *(none)*         | Comma-separated allowed domains — blocks all others           |
| `--rate-limit-test` | boolean | `false`          | Enable rate-limiting detection tests                          |
| `--verbose`         | boolean | `false`          | Enable detailed verbose logging                               |
| `--help`            | —       | —                | Show help information                                         |
| `--version`         | —       | —                | Show version number                                           |

---

## Examples

**Basic scan:**
```bash
node index.js --url=https://example.com
```

**Scan with higher concurrency and verbose output:**
```bash
node index.js --url=https://example.com --concurrency=20 --verbose
```

**Full scan with rate-limit detection and custom output:**
```bash
node index.js --url=https://example.com --concurrency=15 --rate-limit-test --output=scan-results --timeout=20000
```

**Only generate JSON and HTML reports (skip TXT):**
```bash
node index.js --url=https://example.com --format=json,html
```

**Restrict scanning to allowed domains:**
```bash
node index.js --url=https://myapp.io --allow-list=myapp.io,staging.myapp.io
```

**Using npm start:**
```bash
npm start -- --url=https://example.com --rate-limit-test
```

---

## Reports

After each scan, report files are generated in the project root based on the `--format` flag:

| File                 | Format | Description                              |
|----------------------|--------|------------------------------------------|
| `<prefix>.json`      | JSON   | Structured data — ideal for integrations |
| `<prefix>.txt`       | TXT    | Human-readable plain-text summary        |
| `<prefix>.html`      | HTML   | Visual report for sharing with clients   |

By default all three are generated. Use `--format=json` to generate only JSON, etc.

### Sample JSON structure

```json
{
  "target": "https://example.com",
  "scan_date": "2026-03-20",
  "scan_time_seconds": 4.2,
  "summary": {
    "forms_found": 2,
    "fields_tested": 8,
    "issues_found": 3,
    "issues_high": 1,
    "issues_medium": 2,
    "issues_low": 0
  },
  "performance": {
    "average_response_time": 420,
    "max_response_time": 1100,
    "min_response_time": 210,
    "total_requests": 64,
    "success_rate": 97.5,
    "throughput_rps": 8.2
  },
  "issues": [
    {
      "type": "weak_validation",
      "severity": "Medium",
      "description": "Invalid email accepted without error",
      "form": "form-1",
      "field": "email",
      "recommendation": "Enforce server-side email validation"
    }
  ],
  "recommendations": []
}
```

---

## Scan History

Every completed scan is automatically appended to **`scan-history.json`** in the project root. This file acts as a lightweight audit trail so you can track results over time.

```json
[
  {
    "scan_date": "2026-03-20",
    "target": "https://example.com",
    "scan_time_seconds": 4.2,
    "summary": { "issues_found": 3, "issues_high": 1 },
    "overall_risk": "High"
  }
]
```

> `scan-history.json` is excluded from git via `.gitignore`.

---

## Exit Codes

Spam Attacker returns meaningful exit codes, making it suitable for CI/CD pipelines:

| Code | Meaning                                  |
|------|------------------------------------------|
| `0`  | Scan complete — no issues found          |
| `1`  | High severity issues detected            |
| `2`  | Medium or Low severity issues detected   |
| `3`  | Unexpected fatal error                   |

**Pipeline usage example:**
```bash
node index.js --url=https://myapp.io --format=json || echo "Issues found — failing build"
```

---

## CI/CD Integration

A GitHub Actions workflow is included at [.github/workflows/ci.yml](.github/workflows/ci.yml).

It runs on every push and pull request to `main`:

| Job           | What it does                                      |
|---------------|---------------------------------------------------|
| `audit`       | Runs `npm audit --audit-level=high`               |
| `lint`        | Checks all JS files for syntax errors             |
| `smoke-test`  | Scans `httpbin.org/forms/post` and verifies output |

---

## Project Structure

```
spam-attacker/
├── index.js                    # CLI entry point & orchestrator
├── package.json
├── LICENSE
├── SECURITY.md
├── scan-history.json           # Auto-generated audit trail (git-ignored)
├── .github/
│   ├── dependabot.yml          # Automated dependency updates
│   └── workflows/
│       └── ci.yml              # GitHub Actions CI pipeline
└── src/
    ├── core/
    │   ├── formScanner.js      # Form discovery (axios + cheerio)
    │   ├── requestEngine.js    # Async request engine (p-limit)
    │   └── responseAnalyzer.js # Response classification & metrics
    ├── tests/
    │   ├── validationTests.js  # Input validation test cases
    │   └── rateLimitTests.js   # Rate limit burst detection
    ├── report/
    │   ├── reportBuilder.js    # Assembles the full report object
    │   ├── saveJSON.js         # Writes JSON report
    │   ├── saveTXT.js          # Writes TXT report
    │   ├── saveHTML.js         # Writes HTML report
    │   └── saveHistory.js      # Appends to scan-history.json
    ├── ui/
    │   ├── prompts.js          # Interactive TUI prompts (inquirer)
    │   └── progress.js         # Spinners (ora) + progress bars (cli-progress)
    └── utils/
        ├── logger.js           # Colored console output
        └── helpers.js          # Shared utilities
```

---

## User Guidelines & Ethics

**This tool is intended strictly for:**

- Testing web applications you own or have developed
- Authorized security assessments with explicit written permission
- Educational and research purposes in controlled environments

**You must NOT use this tool to:**

- Test websites or applications without explicit authorization
- Attempt to overwhelm, crash, or disrupt any server
- Bypass security controls or exploit vulnerabilities maliciously
- Violate any applicable laws or regulations (e.g. CFAA, Computer Misuse Act)

**Built-in safety measures:**

- Maximum throughput is capped at **10 requests/second** regardless of concurrency setting
- All tests are **non-destructive** — no data is deleted or modified
- Rate-limit tests use a **controlled burst** of at most 50 requests per form
- `--allow-list` flag lets you lock the tool to pre-approved domains only

> Misuse of this tool is solely the responsibility of the user. Always get written permission before testing any system you do not own.

---

## Changelog

### v1.2.0
- Full `blessed` TUI (binsider-style) — dark theme, 5-tab navigation, bordered panels
- **Fixed**: Tab key input duplication (`keys:true` removed from textboxes; eliminated global-handler conflict)
- **Fixed**: Field navigation — Tab / Shift+Tab now advance/retreat correctly with single-fire per keypress
- Active field indicator `▶` with cyan highlight and per-field contextual tips in the status bar
- New `5:Info` tab — tool version, Node.js runtime, all CLI flags with usage examples, full dependency list
- `?` key opens a full help overlay with all keybindings and exit code reference
- `setSilent()` on logger prevents console output from bleeding into TUI rendering
- `npm audit` — 0 vulnerabilities
- New dependencies: `blessed`, `figlet`, `inquirer`, `ora`, `cli-progress`

### v1.1.0
- Added `--format` flag — selectively generate JSON, TXT, and/or HTML reports
- Added `--allow-list` flag — restrict scanning to approved domains
- Added scan history — every run appended to `scan-history.json`
- Added CI/CD-friendly exit codes (0 / 1 / 2 / 3)
- Added GitHub Actions CI workflow (audit + lint + smoke test)
- Added MIT `LICENSE` file

### v1.0.0
- Initial release
- Form discovery, input validation testing, rate limit detection
- Async request engine with configurable concurrency
- JSON, TXT, and HTML report generation
- Recommendations engine

---

## License

MIT — see [LICENSE](LICENSE)
