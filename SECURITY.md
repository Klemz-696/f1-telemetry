# 🛡️ Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 2.x     | :white_check_mark: |
| < 2.0   | :x:                |

---

## 🔒 Reporting a Vulnerability

We take the security of F1 Telemetry seriously. If you believe you have found a security vulnerability in any part of the project (backend, proxy, Docker setup, or frontend), please report it responsibly.

### How to Report
- **DO NOT** open a public issue on GitHub.
- Submit a report via GitHub Private Vulnerability Reporting or contact the maintainers directly through a private message.
- Include:
  - Description of the vulnerability.
  - Steps to reproduce or proof-of-concept.
  - Affected components and versions.
  - Possible mitigations or fixes.

### Response Commitment
- We will acknowledge receipt of your report within 48 hours.
- We will provide regular updates on our progress in fixing the issue.
- Once a fix is released, you will be credited for the discovery (unless you prefer to remain anonymous).

---

## ⚠️ Security Guidelines for Deployments

1. **Environment Secrets**: Always generate strong random passwords for `INFLUX_PASSWORD`, `INFLUX_TOKEN`, and `FLUSH_TOKEN` using `python setup.py --env-only`.
2. **CORS Restrictions**: In production environments, set `ALLOWED_ORIGINS` and `API_ALLOWED_ORIGINS` to your exact domain name instead of leaving wildcard access.
3. **Firewall**: Ensure InfluxDB port `8086` and internal FastAPI port `8000` are NOT publicly exposed to the internet. Only Nginx ports (`80` / `443`) should be exposed.
4. **HTTPS / TLS**: Always enable HTTPS in production using Certbot companion (`docker-compose.proxy.yml`) or an external reverse proxy like Cloudflare or Traefik.
