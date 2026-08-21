# 🤝 Contributing to F1 Telemetry

Thank you for your interest in contributing to **F1 Telemetry**! We welcome contributions from developers, F1 enthusiasts, designers, and data scientists.

---

## 📋 Table of Contents
- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
  - [Reporting Bugs](#reporting-bugs)
  - [Suggesting Features](#suggesting-features)
  - [Pull Requests](#pull-requests)
- [Development Setup](#development-setup)
- [Code Style & Conventions](#code-style--conventions)
- [Testing](#testing)

---

## 📜 Code of Conduct
This project adheres to the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

---

## 🛠️ How Can I Contribute?

### 🐛 Reporting Bugs
Before submitting a bug report, please check existing issues to see if the problem has already been reported:
- Clearly describe the bug and steps to reproduce it.
- Include your operating system, browser, Docker version, and any relevant logs (`docker compose logs api`).
- Include screenshots if it is a UI/rendering issue.

### 💡 Suggesting Features
Feature requests are always welcome!
- Provide a clear, detailed explanation of the proposed feature.
- Explain the use case and why it would benefit other users.

### 🔀 Pull Requests
1. **Fork** the repository and create your branch from `main`:
   ```bash
   git checkout -b feature/amazing-f1-feature
   ```
2. **Make your changes**: Ensure clean code, proper comments, and updated documentation where necessary.
3. **Run tests**: Ensure all unit tests pass before submitting.
4. **Commit with descriptive messages**:
   ```bash
   git commit -m "feat(telemetry): add delta sector comparison graph"
   ```
5. **Push to your fork** and open a Pull Request against `main`.

---

## 💻 Development Setup

For local development without Docker, check out the comprehensive [Local Development Guide](docs/DEVELOPMENT.md).

Quick summary:
```bash
# 1. Setup backend virtualenv
cd backend
python -m venv .venv
source .venv/bin/activate  # or .venv\Scripts\activate on Windows
pip install -r requirements.txt

# 2. Run backend
uvicorn main:app --reload --port 8000

# 3. In another terminal, run proxy
cd proxy-server
node server.js
```

---

## 🎨 Code Style & Conventions

- **Python**: Follow PEP 8 guidelines. Format code using `black` or `ruff`. Ensure type annotations on FastAPI models and endpoints.
- **JavaScript**: Use clean ES6+ modern JavaScript with modular component design. No heavy framework dependencies unless explicitly agreed upon.
- **CSS**: Vanilla CSS using custom properties (variables) defined in `:root`. Maintain dark-mode first design and responsive breakpoints.
- **Security**: Never commit credentials, private API keys, or personal tokens. Always use `.env.example` placeholders.

---

## 🧪 Testing

Ensure all tests pass before creating a pull request:
```bash
# Python backend tests
pytest tests/ -v

# JavaScript syntax validation
node --check proxy-server/server.js
node --check frontend/js/app.js
```

Thank you for helping make F1 Telemetry the best open-source F1 dashboard in the world! 🏎️
