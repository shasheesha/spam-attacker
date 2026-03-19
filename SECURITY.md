# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.0.x   | ✅ Yes    |

---

## Reporting a Vulnerability

If you discover a security vulnerability in **Spam Attacker**, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

### How to Report

1. Email the maintainer directly with the subject line: `[SECURITY] Spam Attacker - <brief description>`
2. Include the following in your report:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (optional)

You will receive a response within **72 hours** acknowledging receipt.

---

## Responsible Disclosure Policy

We follow a **coordinated disclosure** process:

1. You report the vulnerability privately
2. We confirm and investigate within **72 hours**
3. We develop and test a fix within **14 days** (or agree on a timeline for complex issues)
4. A patched release is published
5. You may publicly disclose after the patch is released

We will credit you in the release notes unless you prefer to remain anonymous.

---

## Scope

The following are **in scope** for security reports:

- Command injection vulnerabilities in CLI argument handling
- Unintended data exposure in generated reports
- Dependencies with known critical CVEs
- Logic flaws that allow bypassing the built-in safety throttle

The following are **out of scope**:

- Vulnerabilities in target websites scanned by this tool
- Issues only reproducible on unsupported Node.js versions (< 14)
- Rate limiting of the tool itself by third-party servers (expected behavior)

---

## Ethical Use & Legal Notice

**Spam Attacker** is a security testing tool intended for authorized use only.

- You must have **explicit written permission** from the system owner before scanning any target
- Unauthorized use may violate laws including the CFAA (US), Computer Misuse Act (UK), and equivalent legislation in your jurisdiction
- The maintainers accept **no liability** for misuse of this tool

By using this tool, you agree to use it only on systems you own or have explicit authorization to test.

---

## Dependencies

This project uses the following third-party packages. Keep them up to date to avoid known vulnerabilities:

| Package     | Purpose                  |
|-------------|--------------------------|
| `axios`     | HTTP requests            |
| `cheerio`   | HTML parsing             |
| `commander` | CLI argument parsing     |
| `p-limit`   | Concurrency control      |
| `chalk`     | Terminal color output    |

Run the following to audit dependencies:

```bash
npm audit
npm audit fix
```

---

## Security Best Practices for Contributors

- Never commit secrets, API keys, or credentials
- Do not disable or weaken the built-in request throttle (10 req/s cap)
- Sanitize all user-supplied input before use in HTTP requests or file paths
- Keep dependencies up to date and run `npm audit` before submitting a PR
