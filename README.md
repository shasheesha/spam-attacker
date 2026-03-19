# Spam Attacker

> High-performance CLI tool for analyzing web form validation, response behavior, and performance weaknesses using safe, asynchronous testing techniques.

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
- [Project Structure](#project-structure)
- [User Guidelines & Ethics](#user-guidelines--ethics)

---

## Overview

**Spam Attacker** is a developer-focused security testing tool that helps identify weak or missing form validations, analyze server response behavior, detect missing rate limiting, and measure performance under controlled load.

It is **not** a destructive tool. All tests are safe, read-only, and throttled to avoid server overload.

---

## Features

| Feature                     | Description                                                     |
|-----------------------------|-----------------------------------------------------------------|
| Form Discovery              | Crawls a URL and extracts all `<form>` elements with field metadata |
| Input Validation Testing    | Tests invalid emails, empty fields, boundary values, unexpected types |
| Rate Limit Detection        | Detects HTTP 429, blocking, and basic captcha triggers          |
| Async Request Engine        | Parallel requests with configurable concurrency and throttling  |
| Response Analysis           | Tracks status codes, response times, and error messages         |
| Issue Classification        | Severity levels: Low / Medium / High                            |
| Recommendations Engine      | Actionable suggestions based on detected issues                 |
| Multi-format Reports        | JSON, TXT, and HTML reports generated after each scan           |

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

### Minimal example

```bash
node index.js --url=https://example.com
```

### Full example

```bash
node index.js --url=https://example.com --concurrency=20 --output=myreport --timeout=15000 --rate-limit-test --verbose
```

---

## CLI Options

| Option              | Type    | Default    | Description                                           |
|---------------------|---------|------------|-------------------------------------------------------|
| `--url`             | string  | *(required)* | Target URL to scan                                  |
| `--concurrency`     | number  | `10`       | Number of concurrent requests (1–100)                 |
| `--output`          | string  | `report`   | Filename prefix for generated reports                 |
| `--timeout`         | number  | `10000`    | Request timeout in milliseconds (1000–120000)         |
| `--rate-limit-test` | boolean | `false`    | Enable rate-limiting detection tests                  |
| `--verbose`         | boolean | `false`    | Enable detailed verbose logging                       |
| `--help`            | —       | —          | Show help information                                 |
| `--version`         | —       | —          | Show version number                                   |

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

**Using npm start:**
```bash
npm start -- --url=https://example.com --rate-limit-test
```

---

## Reports

After each scan, three report files are generated in the project root:

| File                 | Format | Description                              |
|----------------------|--------|------------------------------------------|
| `<prefix>.json`      | JSON   | Structured data — ideal for integrations |
| `<prefix>.txt`       | TXT    | Human-readable plain-text summary        |
| `<prefix>.html`      | HTML   | Visual report for sharing with clients   |

### Sample JSON structure

```json
{
  "target": "https://example.com",
  "scan_time": "2026-03-19T10:00:00.000Z",
  "summary": {
    "forms_found": 2,
    "fields_tested": 8,
    "issues_found": 3
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
      "issue": "Invalid email accepted",
      "field": "email",
      "form": "form-1",
      "severity": "medium"
    }
  ],
  "recommendations": []
}
```

---

## Project Structure

```
spam-attacker/
├── index.js                  # CLI entry point & orchestrator
├── package.json
├── src/
│   ├── core/
│   │   ├── formScanner.js    # Form discovery (axios + cheerio)
│   │   ├── requestEngine.js  # Async request engine (p-limit)
│   │   └── responseAnalyzer.js # Response classification & metrics
│   ├── tests/
│   │   ├── validationTests.js  # Input validation test cases
│   │   └── rateLimitTests.js   # Rate limit burst detection
│   ├── report/
│   │   ├── reportBuilder.js  # Assembles the full report object
│   │   ├── saveJSON.js       # Writes JSON report
│   │   ├── saveTXT.js        # Writes TXT report
│   │   └── saveHTML.js       # Writes HTML report
│   └── utils/
│       ├── logger.js         # Colored console output
│       └── helpers.js        # Shared utilities
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

> Misuse of this tool is solely the responsibility of the user. Always get written permission before testing any system you do not own.

---

## License

MIT
