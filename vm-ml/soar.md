# `soar.py` — Technical Summary

## 1. Purpose

`soar.py` implements the **SOAR orchestration and AI bridge layer**. It consolidates alerts from the LSTM-VAE engine and Suricata, applies staged response logic, performs targeted or global mitigation on the Edge VM through SSH, and forwards selected incident context to the AI Agent.

Main responsibilities:

- Consume `ml-alerts` and `suricata-alerts` from Kafka.
- Correlate ML and Suricata alerts for the same IP within a 30-second window.
- Activate a global anti-DDoS shield for distributed flood events.
- Block malicious source IPs remotely with `iptables`.
- Protect critical/whitelisted assets from automatic blocking.
- Forward security context to the AI Agent through Kafka.
- Debounce repeated AI notifications to limit LLM saturation.
- Avoid duplicate firewall operations through in-memory state.

## 2. Position in the Architecture

```text
LSTM-VAE Engine ──► ml-alerts ──┐
                                │
Suricata ────────► suricata-alerts ──► SOAR ──► Edge VM / iptables
                                │          │
                                │          └──► alerts-for-llm
                                └──────────────► incident-reports
```

The SOAR is therefore the **decision and response layer** between detection engines, network enforcement, and AI analysis. The source describes it as an orchestrator and bridge agent, with a global anti-DDoS shield and protection against LLM saturation. fileciteturn1file0L2-L8

## 3. Dependencies

| Dependency | Role |
|---|---|
| `json` | Kafka payloads and whitelist parsing |
| `time` | Timestamps, correlation, cooldowns |
| `re` | IP format validation |
| `logging` | Security and operational logs |
| `subprocess` | Execute remote SSH commands |
| `kafka-python` | Kafka consumer/producer |

## 4. Configuration

### Kafka

```python
KAFKA_BOOTSTRAP_SERVERS = "192.168.56.130:9092"
TOPIC_ML = "ml-alerts"
TOPIC_SURICATA = "suricata-alerts"
TOPIC_LLM = "alerts-for-llm"
```

The application consumes ML and Suricata alerts and sends AI context to `alerts-for-llm`.

### Correlation and whitelist

```python
FENETRE_CORRELATION_SEC = 30
CHEMIN_ACTIFS_CRITIQUES = "actifs_critiques.json"
```

Two alerts for the same IP are correlated when their timestamps differ by at most 30 seconds.

### Edge VM / SSH

```python
IP_VM_EDGE = "192.168.56.128"
CLE_SSH = "/home/aziz/.ssh/soar_key"
UTILISATEUR_EDGE = "aziz"
```

The SOAR remotely executes privileged networking commands on the Edge VM.

### LLM cooldown

```python
COOLDOWN_LLM_SEC = 60
```

The same Suricata alert category generates at most one AI report per 60 seconds.

## 5. In-Memory State

```python
derniere_alerte_ml = {}
derniere_alerte_suricata = {}
ips_deja_bloquees = set()
ips_en_cours_ia = set()
cache_alertes_soar = {}
```

Their purposes are:

| Variable | Purpose |
|---|---|
| `derniere_alerte_ml` | Last ML alert timestamp per IP |
| `derniere_alerte_suricata` | Last Suricata alert timestamp per IP |
| `ips_deja_bloquees` | IPs considered blocked/already handled |
| `ips_en_cours_ia` | IPs currently represented to the AI workflow |
| `cache_alertes_soar` | Last AI-notification time per Suricata category |

All of these are process-memory state and are reset when the SOAR restarts.

## 6. Critical-Asset Whitelist

`charger_actifs_critiques()` reads `actifs_critiques.json`.

The expected data can use either:

```json
{"whitelist": [...]}
```

or:

```json
{"actifs_critiques": [...]}
```

The result is converted to a Python `set`.

If the file is missing, the function logs a warning and returns an empty set.

The whitelist is consulted before targeted automatic blocking and before treating alerts from critical assets as ordinary attacker IPs.

## 7. IP Validation

`ip_valide()` uses this pattern:

```text
^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$
```

The purpose stated in the source is to prevent command-injection-style input before an IP is inserted into an SSH/`iptables` command.

Important limitation: the regex validates the shape of an IPv4 address but does not enforce octet values between 0 and 255. For example, `999.999.999.999` matches the pattern.

## 8. Global Anti-DDoS Shield

`activer_bouclier_anti_ddos()` is triggered when the ML pipeline sends:

```text
ENABLE_DDOS_SHIELD
```

It connects to the Edge VM through SSH and executes:

```bash
sudo sysctl -w net.ipv4.tcp_syncookies=1
```

then inserts an HTTP SYN rate limiter:

```bash
sudo iptables -I INPUT -p tcp --syn --dport 80   -m limit --limit 100/s --limit-burst 150 -j ACCEPT
```

and finally:

```bash
sudo iptables -A INPUT -p tcp --syn --dport 80 -j DROP
```

Each SSH command has a 10-second timeout.

If all commands succeed, the SOAR publishes an event to `alerts-for-llm` describing the global DDoS shield activation with:

```text
src_ip = MULTIPLE_SPOOFED_IPS
source_detection = Bouclier Anti-DDoS (SOAR)
auto_blocked = true
```

If one of the commands fails, the operation is marked unsuccessful and the failure is logged.

## 9. Targeted IP Blocking

`bloquer_ip()` performs the targeted containment workflow.

Order of checks:

```text
Critical/whitelisted IP?
        ↓
Already blocked?
        ↓
Valid IP format?
        ↓
SSH → iptables DROP
```

The remote rule is:

```bash
sudo iptables -I INPUT -s <ip> -j DROP
```

On success the IP is inserted into `ips_deja_bloquees`.

The function explicitly handles:

- `subprocess.CalledProcessError`
- `subprocess.TimeoutExpired`

and returns a Boolean success status.

## 10. AI Notification Bridge

`notifier_agent_ia()` creates a Kafka payload containing:

```json
{
  "src_ip": "...",
  "source_detection": "...",
  "details": "...",
  "auto_blocked": false,
  "timestamp": "..."
}
```

and publishes it to:

```text
alerts-for-llm
```

The file therefore does not directly call an LLM API. It acts as a **Kafka bridge** for the AI Agent.

## 11. ML + Suricata Correlation

`evaluer_correlation()` checks:

```python
t_ml = derniere_alerte_ml.get(src_ip)
t_sur = derniere_alerte_suricata.get(src_ip)
```

Correlation is valid when both timestamps exist and:

```text
abs(t_ml - t_sur) <= 30 seconds
```

This provides the strongest standard targeted-confidence signal in the orchestration logic.

# 12. ML Alert Processing

`traiter_alerte_ml()` handles messages from `ml-alerts`.

## 12.1 Global DDoS Action

If:

```python
action == "ENABLE_DDOS_SHIELD"
```

the SOAR directly invokes:

```python
activer_bouclier_anti_ddos(...)
```

and stops processing the current event.

## 12.2 Missing Source IP

Messages without `src_ip` are ignored.

## 12.3 Critical Asset / Zero Trust Path

If the source IP is in the critical-assets whitelist, the normal block path is bypassed.

The SOAR:

1. Logs a critical Zero Trust event.
2. Adds the IP to `ips_deja_bloquees`.
3. Sends an urgent message to `incident-reports`.
4. Returns without inserting the normal `iptables DROP` rule.

The source states that the automatic block is refused to preserve continuity of service, while the incident should be isolated manually.

## 12.4 Normal ML Path

For non-whitelisted IPs, the current timestamp is stored in:

```python
derniere_alerte_ml[src_ip]
```

Then the SOAR evaluates ML + Suricata correlation.

### Palier 3 — ML + Suricata

If correlation is true:

```text
HIGH PRIORITY
```

The SOAR attempts `bloquer_ip()`.

When the block succeeds, it notifies the AI Agent as:

```text
Multi-Source
```

with:

```text
auto_blocked = true
```

### Palier 2 — ML only

When no Suricata correlation exists, the SOAR logs a Palier 2 event.

If the IP is not already in `ips_en_cours_ia`, it is added and the AI Agent receives:

```text
source_detection = LSTM-VAE (IA)
auto_blocked = false
```

No immediate targeted firewall block is performed in this branch.

# 13. Suricata Alert Processing

`traiter_alerte_suricata()` handles `suricata-alerts`.

The source IP is resolved from the first available field among:

```text
src_ip
source_ip
ip
```

It also extracts:

```text
signature
category
severity
```

with fallback values.

## 13.1 Critical Asset Path

For a whitelisted source IP, the SOAR:

1. Logs a critical Zero Trust event.
2. Adds the IP to the handled/blocked state set.
3. Sends an urgent diagnostic to `incident-reports`.
4. Returns without normal firewall blocking.

## 13.2 Duplicate Handling

Already-handled IPs are ignored before normal blocking logic.

## 13.3 LLM Debouncer

The AI-report decision is category-based.

An AI report is permitted when:

```text
category not previously seen
OR
60 seconds have elapsed since the category's last report
```

This means many repeated Suricata events can still be processed for security decisions while redundant LLM notifications are suppressed.

# 14. Suricata Escalation Levels

## Palier 3 — Suricata + ML

When the Suricata alert correlates with a recent ML alert for the same IP:

```text
ML + Suricata
```

the SOAR attempts to block the IP.

When successful and the AI cooldown allows it, the AI Agent receives a `Multi-Source` report.

## Critical signature bypass

If the signature contains:

```text
[CRITIQUE]
```

the alert receives a direct blocking path even without ML correlation.

When blocking succeeds and AI notification is allowed, the AI Agent receives:

```text
Suricata (Critique Bypass)
```

## Palier 2 — Suricata severity <= 2

When:

```text
severity <= 2
```

the event is considered important enough for AI involvement.

The IP is added to `ips_en_cours_ia`, and an AI notification is sent when the category cooldown allows it.

No immediate firewall block occurs in this branch.

## Palier 1 — Informational

When:

```text
severity > 2
```

the event is logged only.

# 15. Decision Matrix

| Detection | Correlation / condition | Response |
|---|---|---|
| ML | `ENABLE_DDOS_SHIELD` | Activate global DDoS shield |
| ML | No Suricata correlation | AI context, no direct block |
| ML | ML + Suricata <= 30 s | Block IP + AI context |
| ML | Critical asset | No normal auto-block + urgent incident |
| Suricata | ML correlation | Block IP + optional AI context |
| Suricata | `[CRITIQUE]` in signature | Direct block + optional AI context |
| Suricata | `severity <= 2` | AI context, no direct block |
| Suricata | `severity > 2` | Log only |
| Any | Already handled | Ignore duplicate block |

# 16. Main Kafka Architecture

The `main()` function creates one consumer for:

```text
ml-alerts
suricata-alerts
```

with:

```text
group_id = soar-orchestrator
auto_offset_reset = latest
```

It also creates a Kafka producer for:

```text
alerts-for-llm
```

For every message:

```text
Kafka record
    ↓
deserialize JSON
    ↓
reload critical-assets whitelist
    ↓
identify topic
    ↓
dispatch to handler
```

Dispatch:

```text
ml-alerts
    → traiter_alerte_ml()

suricata-alerts
    → traiter_alerte_suricata()
```

## 17. Dynamic Whitelist Reload

The whitelist is re-read inside the main event loop:

```python
actifs_critiques = charger_actifs_critiques()
```

Therefore changes to `actifs_critiques.json` can be picked up without restarting the SOAR, as long as new Kafka messages are processed.

## 18. SSH Enforcement Model

The SOAR does not directly modify the local firewall.

Instead:

```text
SOAR
  |
  | SSH
  v
Edge VM 192.168.56.128
  |
  +-- sysctl
  +-- iptables
```

This separates orchestration from network enforcement.

## 19. Global DDoS vs Targeted Response

The implementation has two distinct mitigation modes.

### Global

Designed for distributed/saturation attacks:

```text
ENABLE_DDOS_SHIELD
    ↓
SSH
    ↓
TCP SYN Cookies
    +
SYN rate limiting
    +
SYN DROP
```

### Targeted

Designed for a specific malicious source:

```text
source IP
    ↓
iptables -I INPUT -s <ip> -j DROP
```

## 20. AI Integration Model

The SOAR is a **bridge**, not the LLM itself:

```text
Detection Engines
       ↓
     Kafka
       ↓
      SOAR
       ↓
alerts-for-llm
       ↓
AI Agent / Llama 3
```

The SOAR controls what context is forwarded and whether an IP has already been automatically blocked.

## 21. Security and Implementation Observations

### 21.1 SSH host-key verification is disabled

Every SSH command uses:

```text
-o StrictHostKeyChecking=no
```

This weakens normal SSH server identity verification and exposes the connection to greater man-in-the-middle risk.

### 21.2 The IP regex is not full IPv4 validation

It prevents malformed command-like strings from matching the expected pattern, but it does not verify valid 0–255 octets.

### 21.3 Global DDoS rules are additive

The file inserts the global iptables rules but does not include a corresponding cleanup/removal routine. Repeated activation could therefore create duplicate rules unless another component manages their lifecycle.

### 21.4 In-memory state is volatile

Restarting the process clears:

```text
last alert timestamps
blocked-IP set
AI-in-progress set
LLM debounce cache
```

Remote firewall rules may nevertheless remain active on the Edge VM.

### 21.5 `ips_deja_bloquees` has broader meaning than only firewall success

The source also adds critical/whitelisted source IPs to this set during the Zero Trust path. Thus the set represents IPs treated as already handled/protected from repeated processing, not only IPs for which `bloquer_ip()` successfully inserted a DROP rule.

### 21.6 AI cooldown is category-based

The LLM protection uses Suricata `category`, not source IP, as the cache key. This reduces repeated reports from noisy categories across potentially multiple IPs.

## 22. Function Inventory

| Function | Responsibility |
|---|---|
| `charger_actifs_critiques()` | Load critical/whitelisted assets |
| `ip_valide()` | Validate IP format before shell command construction |
| `activer_bouclier_anti_ddos()` | Apply global DDoS mitigation remotely |
| `bloquer_ip()` | Apply targeted firewall isolation |
| `notifier_agent_ia()` | Publish incident context to the AI Agent |
| `evaluer_correlation()` | Validate ML + Suricata temporal correlation |
| `traiter_alerte_ml()` | Process ML-generated events |
| `traiter_alerte_suricata()` | Process Suricata events |
| `main()` | Initialize Kafka and run the orchestration loop |

## 23. Runtime Requirements

The implementation expects:

```text
Kafka broker:
192.168.56.130:9092

Input topics:
- ml-alerts
- suricata-alerts

AI output:
- alerts-for-llm

Emergency incident topic:
- incident-reports

Edge VM:
192.168.56.128

SSH key:
~/.ssh/soar_key

Whitelist:
actifs_critiques.json
```

The Edge VM must also be reachable over SSH and permit the configured user to execute the required privileged `sysctl` and `iptables` commands.

## 24. End-to-End Scenarios

### Scenario A — ML-only anomaly

```text
LSTM-VAE
   ↓
ml-alerts
   ↓
SOAR
   ↓
No Suricata correlation
   ↓
Palier 2
   ↓
AI context
```

### Scenario B — Correlated ML + Suricata

```text
LSTM-VAE alert
      +
Suricata alert
      ↓
same IP + <= 30 seconds
      ↓
Palier 3
      ↓
iptables DROP
      ↓
AI Multi-Source report
```

### Scenario C — Critical Suricata signature

```text
Suricata
   ↓
signature contains [CRITIQUE]
   ↓
Direct bypass
   ↓
iptables DROP
   ↓
AI context
```

This branch still respects the critical-asset path.

### Scenario D — Distributed DDoS

```text
LSTM-VAE / upstream detector
          ↓
ENABLE_DDOS_SHIELD
          ↓
SOAR
          ↓
SSH to Edge VM
          ↓
SYN Cookies + rate limiting + DROP
          ↓
AI notification
```

## 25. Core Decision Pattern

The overall SOAR logic can be summarized as:

```text
DETECT
  ↓
IDENTIFY SOURCE
  ↓
CHECK CRITICAL ASSET
  ↓
CORRELATE ML + SURICATA
  ↓
CLASSIFY SEVERITY / SIGNATURE
  ↓
MITIGATE
  ↓
NOTIFY AI
```

with the global DDoS branch:

```text
GLOBAL FLOOD EVENT
       ↓
ENABLE_DDOS_SHIELD
       ↓
INFRASTRUCTURE MITIGATION
```

## 26. Overall Assessment

`soar.py` is the **central automated-response component** of the architecture.

Its design combines:

```text
Multi-source correlation
+
Deterministic Suricata escalation
+
ML anomaly escalation
+
Global DDoS infrastructure protection
+
Targeted firewall isolation
+
Critical-asset protection
+
LLM notification control
```

The principal security pattern is:

```text
Detect → Correlate → Decide → Mitigate → Notify
```

The strongest normal targeted response is the **ML + Suricata correlation path**, while `[CRITIQUE]` Suricata signatures provide a deterministic bypass. Global DDoS alerts are handled separately through infrastructure-level mitigation rather than individual-IP blocking.
