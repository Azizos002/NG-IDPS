import socketio
import time

# Création du client Socket.IO
sio = socketio.Client()

@sio.event
def connect():
    print("=========================================")
    print("[+] Capteur Python connecté au Hub Node.js")
    print("=========================================")
    
    # Le payload JSON qui simule la réponse de ton modèle Llama
    alert_data = {
        "kibanaUrl": "http://192.168.1.20:5601/app/discover#/view/...",
        "sourceSensor": "Suricata (NIDS)",
        "maliciousIp": "45.33.32.156",
        "threatType": "Brute Force SSH",
        "severity": "Critique",
        "aiSummary": "Le modèle a détecté un dictionnaire de mots de passe ciblant le port 22. Le comportement automatisé indique un risque imminent d'intrusion.",
        "aiConfidenceScore": 98,
        "caseStatus": "Ouvert"
    }
    
    print("[!] Injection de l'alerte critique en cours...")
    sio.emit('new_security_alert', alert_data)
    
    # On attend 2 secondes pour laisser le temps au réseau de transmettre
    time.sleep(2)
    sio.disconnect()

@sio.event
def disconnect():
    print("[-] Fin de la simulation. Capteur déconnecté.")

if __name__ == '__main__':
    try:
        # Connexion à ton Hub sur le port 4000
        sio.connect('http://localhost:4000')
        sio.wait()
    except Exception as e:
        print(f"[-] Erreur de connexion au Hub : {e}")