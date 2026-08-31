import sys
import subprocess

# --- CONFIGURATION ---
VM_EDGE_USER = "aziz"
VM_EDGE_IP = "192.168.56.128"

def unblock_firewall(ip):
    print(f"[*] Connexion SSH à la VM-Edge ({VM_EDGE_IP}) pour retirer la règle iptables...")
    commande = f"sudo iptables -D INPUT -s {ip} -j DROP"

    try:
        resultat = subprocess.run(
            ["ssh", f"{VM_EDGE_USER}@{VM_EDGE_IP}", commande],
            capture_output=True, text=True
        )
        if resultat.returncode == 0:
            print(f"[+] Succès : Règle iptables supprimée pour {ip}.")
        else:
            print(f"[-] Attention : L'IP n'était peut-être pas bloquée sur iptables. ({resultat.stderr.strip()})")
    except Exception as e:
        print(f"[!] Erreur SSH : {e}")

def main():
    if len(sys.argv) != 2:
        print("Usage: python unblock.py <IP_A_DEBLOQUER>")
        print("Exemple: python unblock.py 192.168.56.150")
        sys.exit(1)

    ip_cible = sys.argv[1]
    print(f"=== PROCÉDURE DE DÉBLOCAGE POUR : {ip_cible} ===")

    unblock_firewall(ip_cible)
    print("\n[i] Note : Comme soar.py garde la mémoire en RAM, il faut le redémarrer (Ctrl+C puis relancer) pour qu'il oublie l'historique de cette IP !")
    print("=== TERMINÉ ===")

if __name__ == "__main__":
    main()