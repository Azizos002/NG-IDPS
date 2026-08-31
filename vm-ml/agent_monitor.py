import time
import psutil
import socketio
import subprocess
import json  # <--- NOUVEAU: Indispensable pour écrire le fichier json

# ==========================================
# CONFIGURATION - Nœud ML (Data & IA)
# ==========================================
HUB_URL = 'http://192.168.56.1:4000'
HOSTNAME = 'ML'
IP_ADDRESS = '192.168.56.130'

SERVICES_TO_CHECK = ['kafka', 'elasticsearch', 'realtime_interface.py', 'soar.py']
# ==========================================

sio = socketio.Client()

def check_status(target_name):
    """Vérifie si un service systemd OU un fichier/processus spécifique tourne"""
    # 1. Vérification classique via systemd
    try:
        result = subprocess.run(['systemctl', 'is-active', target_name], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if result.stdout.strip() == 'active':
            return True
    except Exception:
        pass

    # 2. Scan des processus actifs (Supervision de fichiers en cours d'exécution)
    for proc in psutil.process_iter(['name', 'cmdline']):
        try:
            cmdline = proc.info.get('cmdline') or []
            name = proc.info.get('name') or ""
            # Si le nom du fichier ciblé est trouvé dans la ligne de commande du processus
            if target_name in name or any(target_name in cmd for cmd in cmdline):
                return True
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            pass

    return False

@sio.event
def connect():
    print(f"[+] Connecté au Hub WebSocket ({HUB_URL})")

@sio.event
def disconnect():
    print("[-] Déconnecté du Hub WebSocket")

# ========================================================
# NOUVEAU : Écouteur pour la synchronisation de la Whitelist
# ========================================================
@sio.on('sync_whitelist')
def on_sync_whitelist(nouvelle_liste):
    print(f"\n[+] Alerte : Synchronisation Whitelist reçue du Dashboard !")

    # Le chemin absolu vers ton fichier json dans le dossier dataset
    chemin_fichier = '/home/aziz/dataset/actifs_critiques.json'

    try:
        # Écrasement du fichier Linux avec les données envoyées par Windows
        with open(chemin_fichier, 'w') as f:
            json.dump({"whitelist": nouvelle_liste}, f, indent=2)

        print(f"[+] Succès : {chemin_fichier} mis à jour. Total: {len(nouvelle_liste)} IPs protégées.")
    except Exception as e:
        print(f"[-] Erreur lors de l'écriture de la whitelist : {e}")
# ========================================================


def collect_and_send_metrics():
    print(f"[*] Démarrage de l'agent de télémétrie sur {HOSTNAME}...")
    while True:
        try:
            # interval=1 garantit une vraie moyenne d'utilisation CPU sur 1 seconde
            cpu_percent = psutil.cpu_percent(interval=1)
            ram = psutil.virtual_memory().percent

            services_status = [{"name": s, "active": check_status(s)} for s in SERVICES_TO_CHECK]

            payload = {
                "hostname": HOSTNAME,
                "ipAddress": IP_ADDRESS,
                "os": "Linux",
                "cpuUsage": cpu_percent,
                "ramUsage": ram,
                "services": services_status
            }

            sio.emit('vm_metrics', payload)

            # Attente de 4s (1s CPU + 4s pause = Envoi toutes les 5 secondes)
            time.sleep(4)
        except Exception as e:
            print(f"[-] Erreur télémétrie : {e}")
            time.sleep(5)

if __name__ == '__main__':
    while True:
        try:
            sio.connect(HUB_URL)
            collect_and_send_metrics()
        except socketio.exceptions.ConnectionError:
            print("[-] Hub injoignable. Retentative dans 5s...")
            time.sleep(5)