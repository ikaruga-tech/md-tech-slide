# Security Policy

## Supported Versions

Only the latest release candidate and stable release receive security updates.

| Version         | Supported          |
| --------------- | ------------------ |
| 0.1.x (RC / GA) | :white_check_mark: |
| < 0.1.0         | :x:                |

## Reporting a Vulnerability

We take the security of md-tech-slide seriously. If you believe you have found a security vulnerability, please follow the guidelines below:

### Reporting Channel

Please report potential security vulnerabilities privately through GitHub Private Vulnerability Reporting:

1. Navigate to the Security tab of this repository: <https://github.com/ikaruga-tech/md-tech-slide/security>
2. Click on "Report a vulnerability" to open an advisory draft.
3. Fill in the details outlined below and submit the report.

Do NOT open public issues, discussions, or pull requests for security vulnerabilities.

### What to Include in Your Report

To help us investigate and remediate the issue quickly, please include:

- A description of the vulnerability and its potential impact.
- Step-by-step instructions or a minimal reproducible Markdown example.
- The affected component (e.g., Markdown parser, Webview CSP, Mermaid SVG sanitizer, PDF export).
- Your environment details (OS, VS Code version, Node.js version).

### What NOT to Include

- Do not attach real production secrets, API tokens, passwords, or personal data.
- Avoid attaching unfiltered debug logs containing internal environment variables.

### Response Timeline

- Acknowledgement: Within 72 hours of report receipt.
- Assessment & Triage: Within 7 business days.
- Patch Release: Handled according to severity and coordination with the reporter.
