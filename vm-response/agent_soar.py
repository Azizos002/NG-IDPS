import socketio
import subprocess
import re
import time

# ==========================================
# CONFIGURATION - VM-Response
# ==========================================
HUB_URL = 'http://192.168.56.1:4000'
HOSTNAME = 'VM-Response'
IP_ADDRESS = '192.168.56.140'
SERVICES_TO_CHECK = ['ollama']

# --- NOUVELLE CONFIGURATION SSH POUR VM-EDGE ---
IP_VM_EDGE = "192.168.56.128"
CLE_SSH = "/home/aziz/.ssh/soar_key"
UTILISATEUR_EDGE = "aziz"
# ==========================================

sio = socketio.Client()

def is_valid_ip(ip):
    """
    Sécurité : Valide strictement le format de l'IP pour éviter
    toute injection de commande OS via le WebSocket.
    """
    pattern = re.compile(r"^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$")
    return pattern.match(ip) is not None

@sio.event
def connect():
    print(f"=========================================")
    print(f"[+] Agent SOAR connecté au Hub ({HUB_URL})")
    print(f"[*] Mode : Écoute Active (Cible de remédiation : VM-Edge {IP_VM_EDGE})")
    print(f"=========================================")

@sio.event
def disconnect():
    print("[-] Agent SOAR déconnecté du Hub.")


@sio.on('execute_command')
def on_execute_command(data):
    print(f"\n[!] Ordre de remédiation reçu du Dashboard : {data}")

    action = data.get('action')
    target_ip = data.get('targetIp')
    incident_id = data.get('incidentId') # On récupère l'ID envoyé par Next.js

    if action == "BLOCK_IP" and target_ip:
        if not is_valid_ip(target_ip):
            print(f"[-] ALERTE DE SÉCURITÉ : IP malformée.")
            sio.emit('command_result', {'incidentId': incident_id, 'ip': target_ip, 'status': 'error'})
            return

        print(f"[*] Exécution de la sanction via SSH...")
        try:
            cmd = [
                "ssh", "-i", CLE_SSH,
                "-o", "StrictHostKeyChecking=no",
                f"{UTILISATEUR_EDGE}@{IP_VM_EDGE}",
                f"sudo iptables -I INPUT -s {target_ip} -j DROP"
            ]

            result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)

            if result.returncode == 0:
                print(f"[+] SUCCÈS : L'IP a été bannie.")
                # L'Agent SOAR renvoie un accusé de réception positif au Node.js !
                sio.emit('command_result', {'incidentId': incident_id, 'ip': target_ip, 'status': 'success'})
            else:
                print(f"[-] ÉCHEC : {result.stderr}")
                sio.emit('command_result', {'incidentId': incident_id, 'ip': target_ip, 'status': 'error'})

        except Exception as e:
            print(f"[-] Erreur : {e}")
            sio.emit('command_result', {'incidentId': incident_id, 'ip': target_ip, 'status': 'error'})


if __name__ == '__main__':
    while True:
        try:
            print(f"[*] Démarrage du bouclier SOAR Humain sur {HOSTNAME}...")
            sio.connect(HUB_URL)
            sio.wait() # Maintient le script en vie pour écouter indéfiniment
        except socketio.exceptions.ConnectionError:
            print("[-] Le Hub est injoignable. Nouvelle tentative dans 5 secondes...")
            time.sleep(5)