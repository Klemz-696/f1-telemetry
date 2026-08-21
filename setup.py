#!/usr/bin/env python3
"""
==============================================================================
F1 Telemetry & Dashboard — Universal Setup & Deployment Manager
==============================================================================
Cross-platform CLI installer and orchestrator for Windows, Linux, and macOS.
Requires Python 3.10+ standard library only (no pip dependencies needed).

Usage:
  python setup.py                # Interactive setup menu
  python setup.py --quick        # One-shot plug & play auto setup & start
  python setup.py --check        # Run pre-flight system diagnostics
  python setup.py --env-only     # Generate secure .env file only
  python setup.py --start        # Build and start all Docker services
  python setup.py --stop         # Stop all Docker services
  python setup.py --status       # Check container health and status
  python setup.py --logs         # View real-time service logs
  python setup.py --clean        # Purge proxy cache and temporary files
==============================================================================
"""

import argparse
import os
import platform
import secrets
import shutil
import socket
import subprocess
import sys
import time
import urllib.request

# Ensure UTF-8 output across all platforms/consoles
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
if hasattr(sys.stderr, "reconfigure"):
    try:
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# ANSI Colors for terminal output
class Colors:
    HEADER = "\033[95m"
    BLUE = "\033[94m"
    CYAN = "\033[96m"
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    RED = "\033[91m"
    BOLD = "\033[1m"
    UNDERLINE = "\033[4m"
    DIM = "\033[2m"
    RESET = "\033[0m"

# Disable colors on Windows if ANSI is not supported
if platform.system() == "Windows" and not os.environ.get("WT_SESSION") and not os.environ.get("ANSICON"):
    try:
        import ctypes
        kernel32 = ctypes.windll.kernel32
        kernel32.SetConsoleMode(kernel32.GetStdHandle(-11), 7)
    except Exception:
        # Fallback to no colors if enable fails
        for key in dir(Colors):
            if not key.startswith("__"):
                setattr(Colors, key, "")

BANNER = f"""{Colors.RED}{Colors.BOLD}
  ███████╗ ██╗    ████████╗███████╗██╗     ███████╗███╗   ███╗███████╗████████╗██████╗ ██╗   ██╗
  ██╔════╝███║    ╚══██╔══╝██╔════╝██║     ██╔════╝████╗ ████║██╔════╝╚══██╔══╝██╔══██╗╚██╗ ██╔╝
  █████╗  ╚██║       ██║   █████╗  ██║     █████╗  ██╔████╔██║█████╗     ██║   ██████╔╝ ╚████╔╝ 
  ██╔══╝   ██║       ██║   ██╔══╝  ██║     ██╔══╝  ██║╚██╔╝██║██╔══╝     ██║   ██╔══██╗  ╚██╔╝  
  ██║      ██║       ██║   ███████╗███████╗███████╗██║ ╚═╝ ██║███████╗   ██║   ██║  ██║   ██║   
  ╚═╝      ╚═╝       ╚═╝   ╚══════╝╚══════╝╚══════╝╚═╝     ╚═╝╚══════╝   ╚═╝   ╚═╝  ╚═╝   ╚═╝   
{Colors.CYAN}       🏎️  Formula 1 Live Telemetry, Timing, Analytics & Simulation Hub — Season 2026{Colors.RESET}
"""

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ENV_FILE = os.path.join(BASE_DIR, ".env")
ENV_EXAMPLE = os.path.join(BASE_DIR, ".env.example")
CACHE_DIR = os.path.join(BASE_DIR, "proxy-server", "cache")


def print_header(title: str):
    print(f"\n{Colors.CYAN}{Colors.BOLD}═══ {title} ═══{Colors.RESET}\n")


def check_command(cmd: list[str]) -> tuple[bool, str]:
    """Execute a command and return (success, output)."""
    try:
        res = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=15,
            cwd=BASE_DIR,
        )
        return (res.returncode == 0, res.stdout.strip())
    except FileNotFoundError:
        return (False, "Commande non trouvée")
    except Exception as e:
        return (False, str(e))


def is_port_available(port: int) -> bool:
    """Check if a TCP port is open for binding."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(1.0)
        try:
            s.bind(("0.0.0.0", port))
            return True
        except OSError:
            return False


def check_api_reachability(url: str, name: str) -> bool:
    """Check if external HTTP API is reachable."""
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "F1-Telemetry-Setup-Check/1.0"},
        )
        with urllib.request.urlopen(req, timeout=5) as response:
            return response.status in (200, 301, 302, 404)
    except Exception:
        return False


def run_diagnostics() -> bool:
    """Run comprehensive system diagnostics."""
    print_header("🔍 Diagnostic Système Pré-Vol")
    all_ok = True

    # 1. Docker
    docker_ok, docker_ver = check_command(["docker", "--version"])
    if docker_ok:
        print(f"  {Colors.GREEN}✔{Colors.RESET} Docker Engine        : {Colors.BOLD}{docker_ver}{Colors.RESET}")
    else:
        print(f"  {Colors.RED}✖{Colors.RESET} Docker Engine        : {Colors.RED}Non détecté ou non démarré{Colors.RESET}")
        all_ok = False

    # 2. Docker Compose
    dc_ok, dc_ver = check_command(["docker", "compose", "version"])
    if not dc_ok:
        dc_ok, dc_ver = check_command(["docker-compose", "--version"])
    if dc_ok:
        print(f"  {Colors.GREEN}✔{Colors.RESET} Docker Compose       : {Colors.BOLD}{dc_ver}{Colors.RESET}")
    else:
        print(f"  {Colors.RED}✖{Colors.RESET} Docker Compose       : {Colors.RED}Non détecté (Compose v2 requis){Colors.RESET}")
        all_ok = False

    # 3. Ports 80 & 443
    p80_free = is_port_available(80)
    p443_free = is_port_available(443)
    p3001_free = is_port_available(3001)

    if p80_free:
        print(f"  {Colors.GREEN}✔{Colors.RESET} Port 80 (HTTP)       : {Colors.GREEN}Disponible{Colors.RESET}")
    else:
        print(f"  {Colors.YELLOW}⚠{Colors.RESET} Port 80 (HTTP)       : {Colors.YELLOW}Occupé (peut être remappé via HTTP_PORT dans .env){Colors.RESET}")

    if p443_free:
        print(f"  {Colors.GREEN}✔{Colors.RESET} Port 443 (HTTPS)     : {Colors.GREEN}Disponible{Colors.RESET}")
    else:
        print(f"  {Colors.YELLOW}⚠{Colors.RESET} Port 443 (HTTPS)     : {Colors.YELLOW}Occupé (peut être remappé via HTTPS_PORT dans .env){Colors.RESET}")

    # 4. External APIs
    jolpica_ok = check_api_reachability("https://api.jolpi.ca/ergast/f1/2026.json", "Jolpica F1 API")
    openf1_ok = check_api_reachability("https://api.openf1.org/v1/meetings?year=2026", "OpenF1 API")

    if jolpica_ok:
        print(f"  {Colors.GREEN}✔{Colors.RESET} API Jolpica / Ergast : {Colors.GREEN}En ligne{Colors.RESET}")
    else:
        print(f"  {Colors.YELLOW}⚠{Colors.RESET} API Jolpica / Ergast : {Colors.YELLOW}Injoignable (mode dégradé / cache actif){Colors.RESET}")

    if openf1_ok:
        print(f"  {Colors.GREEN}✔{Colors.RESET} API OpenF1           : {Colors.GREEN}En ligne{Colors.RESET}")
    else:
        print(f"  {Colors.YELLOW}⚠{Colors.RESET} API OpenF1           : {Colors.YELLOW}Injoignable (mode dégradé / simulation actif){Colors.RESET}")

    # 5. .env presence
    if os.path.exists(ENV_FILE):
        print(f"  {Colors.GREEN}✔{Colors.RESET} Fichier .env         : {Colors.GREEN}Présent et configuré{Colors.RESET}")
    else:
        print(f"  {Colors.YELLOW}⚠{Colors.RESET} Fichier .env         : {Colors.YELLOW}Non généré (sera créé automatiquement){Colors.RESET}")

    print("")
    return all_ok


def generate_env(force: bool = False) -> bool:
    """Generate or update the .env file with secure cryptographically random secrets."""
    print_header("🔐 Configuration des Variables d'Environnement (.env)")

    if os.path.exists(ENV_FILE) and not force:
        print(f"  {Colors.YELLOW}Le fichier .env existe déjà.{Colors.RESET}")
        resp = input(f"  Voulez-vous régénérer les secrets aléatoires ? ({Colors.BOLD}o/N{Colors.RESET}) : ").strip().lower()
        if resp not in ("o", "oui", "y", "yes"):
            print(f"  {Colors.GREEN}Configuration existante conservée.{Colors.RESET}")
            return True

    # Generate high-entropy secrets
    influx_pass = secrets.token_urlsafe(20)
    influx_token = secrets.token_urlsafe(40)
    flush_token = secrets.token_urlsafe(24)

    # Check if user had an existing F1_AUTH_TOKEN
    existing_f1_token = ""
    if os.path.exists(ENV_FILE):
        try:
            with open(ENV_FILE, "r", encoding="utf-8") as f:
                for line in f:
                    if line.startswith("F1_AUTH_TOKEN=") and not "CHANGEME" in line:
                        existing_f1_token = line.split("=", 1)[1].strip()
        except Exception:
            pass

    content = f"""# ==============================================================================
# F1 Telemetry & Dashboard — Variables d'Environnement
# Généré automatiquement le {time.strftime('%Y-%m-%d %H:%M:%S')} par setup.py
# IMPORTANT : NE JAMAIS COMMETTRE CE FICHIER DANS GIT
# ==============================================================================

# ── InfluxDB v2 ───────────────────────────────────────────────────────────────
INFLUX_USER=f1admin
INFLUX_PASSWORD={influx_pass}
INFLUX_TOKEN={influx_token}

# ── Flux Direct F1 TV Live (Optionnel) ────────────────────────────────────────
# Jeton Bearer pour le flux officiel SignalR (voir docs/F1_LIVE_TOKEN_GUIDE.md)
# Si vide, le système bascule automatiquement sur OpenF1 / Jolpica / Simulation.
F1_AUTH_TOKEN={existing_f1_token}

# ── Proxy de Cache Node.js ───────────────────────────────────────────────────
PROXY_PORT=3001
NODE_ENV=production
ALLOWED_ORIGINS=http://localhost,http://127.0.0.1
FLUSH_TOKEN={flush_token}

# ── FastAPI Backend ──────────────────────────────────────────────────────────
API_ALLOWED_ORIGINS=http://localhost,http://127.0.0.1

# ── Ports Exposés sur l'Hôte ─────────────────────────────────────────────────
HTTP_PORT=80
HTTPS_PORT=443
"""

    try:
        with open(ENV_FILE, "w", encoding="utf-8") as f:
            f.write(content)

        # Set restrictive permissions on POSIX systems
        if platform.system() != "Windows":
            os.chmod(ENV_FILE, 0o600)

        print(f"  {Colors.GREEN}✔ Fichier .env créé avec succès avec des clés cryptographiques sécurisées !{Colors.RESET}")
        print(f"    - INFLUX_USER      : {Colors.BOLD}f1admin{Colors.RESET}")
        print(f"    - INFLUX_PASSWORD  : {Colors.DIM}(généré aléatoirement - 26 caractères){Colors.RESET}")
        print(f"    - INFLUX_TOKEN     : {Colors.DIM}(généré aléatoirement - 54 caractères){Colors.RESET}")
        print(f"    - FLUSH_TOKEN      : {Colors.DIM}(généré aléatoirement - 32 caractères){Colors.RESET}")
        print(f"    - F1_AUTH_TOKEN    : {Colors.CYAN}{'Configuré' if existing_f1_token else 'Optionnel (laisser vide pour mode auto/open)'}{Colors.RESET}")
        return True
    except Exception as e:
        print(f"  {Colors.RED}✖ Erreur lors de l'écriture de .env : {e}{Colors.RESET}")
        return False


def docker_start(build: bool = True):
    """Start Docker Compose stack."""
    print_header("🚀 Démarrage de la Stack Docker")
    if not os.path.exists(ENV_FILE):
        generate_env(force=True)

    cmd = ["docker", "compose", "up", "-d"]
    if build:
        cmd.insert(3, "--build")

    print(f"  Exécution de : {Colors.BOLD}{' '.join(cmd)}{Colors.RESET} ...\n")
    try:
        subprocess.run(cmd, check=True, cwd=BASE_DIR)
        print(f"\n{Colors.GREEN}{Colors.BOLD}✔ Stack F1 Telemetry démarrée avec succès !{Colors.RESET}")
        print(f"\n  🌐 Dashboard accessible sur : {Colors.CYAN}{Colors.BOLD}{Colors.UNDERLINE}http://localhost{Colors.RESET}")
        print(f"  📊 Documentation API       : {Colors.CYAN}http://localhost/api/health{Colors.RESET}")
        print(f"  ⚡ Statut du Proxy de cache : {Colors.CYAN}http://localhost/proxy/status{Colors.RESET}\n")
    except Exception as e:
        print(f"\n{Colors.RED}✖ Erreur lors du démarrage Docker Compose : {e}{Colors.RESET}")


def docker_stop():
    """Stop Docker Compose stack."""
    print_header("🛑 Arrêt de la Stack Docker")
    cmd = ["docker", "compose", "down"]
    try:
        subprocess.run(cmd, check=True, cwd=BASE_DIR)
        print(f"\n{Colors.GREEN}✔ Tous les conteneurs ont été arrêtés.{Colors.RESET}")
    except Exception as e:
        print(f"\n{Colors.RED}✖ Erreur lors de l'arrêt : {e}{Colors.RESET}")


def docker_status():
    """Check status of containers."""
    print_header("📊 État des Conteneurs")
    cmd = ["docker", "compose", "ps", "-a"]
    try:
        subprocess.run(cmd, check=True, cwd=BASE_DIR)
    except Exception as e:
        print(f"\n{Colors.RED}✖ Erreur : {e}{Colors.RESET}")


def docker_logs(service: str = None):
    """View container logs."""
    cmd = ["docker", "compose", "logs", "-f", "--tail=100"]
    if service:
        cmd.append(service)
    print_header(f"📜 Logs des Conteneurs ({service or 'tous'}) [Ctrl+C pour quitter]")
    try:
        subprocess.run(cmd, cwd=BASE_DIR)
    except KeyboardInterrupt:
        print(f"\n{Colors.GREEN}Fermeture des logs.{Colors.RESET}")


def clean_cache():
    """Clean cache and temporary files."""
    print_header("🧹 Nettoyage du Cache & Fichiers Temporaires")
    count = 0
    if os.path.exists(CACHE_DIR):
        for fname in os.listdir(CACHE_DIR):
            if fname.endswith(".json"):
                try:
                    os.remove(os.path.join(CACHE_DIR, fname))
                    count += 1
                except Exception:
                    pass
    print(f"  {Colors.GREEN}✔ {count} fichiers de cache JSON supprimés du proxy.{Colors.RESET}")


def quick_setup():
    """Perform zero-touch one-command setup."""
    print(BANNER)
    print(f"{Colors.BOLD}Démarrage rapide Plug & Play...{Colors.RESET}\n")
    run_diagnostics()
    if not os.path.exists(ENV_FILE):
        generate_env(force=True)
    docker_start(build=True)


def interactive_menu():
    """Interactive main menu."""
    while True:
        print(BANNER)
        print(f"{Colors.BOLD}Menu Principal :{Colors.RESET}")
        print(f"  {Colors.GREEN}1.{Colors.RESET} 🚀 Démarrage Rapide Plug & Play (Génération .env + Build + Start)")
        print(f"  {Colors.CYAN}2.{Colors.RESET} 🔍 Exécuter le Diagnostic Système (Docker, Ports, Réseau)")
        print(f"  {Colors.CYAN}3.{Colors.RESET} 🔐 Générer / Réinitialiser le fichier .env (Secrets aléatoires)")
        print(f"  {Colors.CYAN}4.{Colors.RESET} 📊 Voir l'état des conteneurs (docker compose ps)")
        print(f"  {Colors.CYAN}5.{Colors.RESET} 📜 Voir les logs en direct")
        print(f"  {Colors.YELLOW}6.{Colors.RESET} 🛑 Arrêter la stack Docker")
        print(f"  {Colors.YELLOW}7.{Colors.RESET} 🧹 Nettoyer le cache local")
        print(f"  {Colors.RED}0.{Colors.RESET} 🚪 Quitter\n")

        choice = input(f"Choix [{Colors.BOLD}1-7, 0{Colors.RESET}] : ").strip()

        if choice == "1":
            quick_setup()
            break
        elif choice == "2":
            run_diagnostics()
            input(f"\nAppuyez sur {Colors.BOLD}Entrée{Colors.RESET} pour revenir au menu...")
        elif choice == "3":
            generate_env(force=True)
            input(f"\nAppuyez sur {Colors.BOLD}Entrée{Colors.RESET} pour revenir au menu...")
        elif choice == "4":
            docker_status()
            input(f"\nAppuyez sur {Colors.BOLD}Entrée{Colors.RESET} pour revenir au menu...")
        elif choice == "5":
            docker_logs()
        elif choice == "6":
            docker_stop()
            input(f"\nAppuyez sur {Colors.BOLD}Entrée{Colors.RESET} pour revenir au menu...")
        elif choice == "7":
            clean_cache()
            input(f"\nAppuyez sur {Colors.BOLD}Entrée{Colors.RESET} pour revenir au menu...")
        elif choice in ("0", "q", "quit", "exit"):
            print("\nAu revoir ! 🏁\n")
            break
        else:
            print(f"\n{Colors.RED}Choix invalide.{Colors.RESET}")
            time.sleep(1)


def main():
    parser = argparse.ArgumentParser(
        description="F1 Telemetry & Dashboard — Universal Setup & Deployment Manager",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--quick", action="store_true", help="One-shot plug & play auto setup & start")
    parser.add_argument("--check", action="store_true", help="Run pre-flight system diagnostics")
    parser.add_argument("--env-only", action="store_true", help="Generate secure .env file only")
    parser.add_argument("--start", action="store_true", help="Build and start all Docker services")
    parser.add_argument("--stop", action="store_true", help="Stop all Docker services")
    parser.add_argument("--status", action="store_true", help="Check container status")
    parser.add_argument("--logs", nargs="?", const="", help="View container logs (optional service name)")
    parser.add_argument("--clean", action="store_true", help="Purge proxy cache files")

    args = parser.parse_args()

    if args.quick:
        quick_setup()
    elif args.check:
        run_diagnostics()
    elif args.env_only:
        generate_env(force=True)
    elif args.start:
        docker_start(build=True)
    elif args.stop:
        docker_stop()
    elif args.status:
        docker_status()
    elif args.logs is not None:
        docker_logs(args.logs if args.logs else None)
    elif args.clean:
        clean_cache()
    else:
        interactive_menu()


if __name__ == "__main__":
    main()
