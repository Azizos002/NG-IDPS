# `train_lstm_vae_16f.py` — Technical Summary

## 1. Purpose

This file implements a **real-time network anomaly detection interface** based on a **Deep LSTM-VAE** model. It consumes network-feature messages from Kafka, maintains a temporal window per source IP, normalizes the features, performs LSTM-VAE inference, computes reconstruction errors, applies a hybrid anomaly decision, and publishes security actions to a Kafka alerts topic.

The detection pipeline combines:

- A global volumetric burst detector for distributed DDoS/spoofing behavior.
- Per-IP packet-rate limiting.
- Temporal LSTM-VAE reconstruction analysis.
- Per-feature threshold voting.
- A global 1-sigma MSE threshold.
- Persistence/correlation across the five most recent evaluations.
- An IP whitelist for critical assets.
- Automatic IP blocking with a cooldown mechanism.

---

## 2. Role in the System

The file acts as the **real-time inference and response layer** between Kafka network telemetry and the automated security response mechanism.

### Data flow

```text
Kafka topic: network-features
          |
          v
   Kafka Consumer
          |
          v
  Source IP extraction
          |
          +------------------------------+
          |                              |
          v                              v
 Global 2-second burst detector     Feature extraction
          |                              |
   DDoS shield alert?                    v
          |                        Per-IP rate limit
          |                              |
          |                              v
          |                       Sliding window (10)
          |                              |
          |                              v
          |                         Scaler transform
          |                              |
          |                              v
          |                         LSTM-VAE model
          |                              |
          |                              v
          |                    Reconstruction errors
          |                              |
          |                    +---------+---------+
          |                    |                   |
          |              Feature votes      Global MSE
          |                    |                   |
          |                    +---------+---------+
          |                              |
          |                      Hybrid ML decision
          |                              |
          |                    Persistence over 5
          |                              |
          |                      Whitelist check
          |                              |
          |                       AUTO_BLOCK_IP
          v                              |
   ENABLE_DDOS_SHIELD                    v
          |                       Kafka topic: ml-alerts
          +------------------------------+
```

---

## 3. Main External Dependencies

The file imports:

| Dependency | Role |
|---|---|
| `os` | File/path existence and path construction |
| `json` | Reading configuration/metadata and serializing Kafka messages |
| `time` | Timestamps, burst windows, cooldowns, latency measurement |
| `logging` | Runtime logging |
| `collections.defaultdict` | Per-IP state initialization |
| `collections.deque` | Sliding temporal windows |
| `numpy` | Numerical arrays and MSE calculations |
| `joblib` | Loading the scaler |
| `tensorflow` | TensorFlow graph compilation with `tf.function` |
| `keras` | Loading and executing the trained LSTM-VAE |
| `keras.layers`, `keras.ops` | Custom VAE layers and tensor operations |
| `kafka-python` | Kafka producer/consumer communication |

---

## 4. Configuration

### Kafka

```python
KAFKA_BOOTSTRAP_SERVERS = "192.168.56.130:9092"
KAFKA_TOPIC = "network-features"
KAFKA_TOPIC_ALERTS = "ml-alerts"
KAFKA_GROUP_ID = "realtime-interface"
```

The application consumes telemetry from `network-features` and publishes detection/security events to `ml-alerts`.

### Model artifacts

```python
DOSSIER_MODELE = "modele_deep_lstm_vae_16features"
CHEMIN_MODELE = os.path.join(DOSSIER_MODELE, "deep_lstm_vae_16f.keras")
CHEMIN_SCALER = os.path.join(DOSSIER_MODELE, "global_scaler_16f.pkl")
CHEMIN_METADATA = os.path.join(DOSSIER_MODELE, "metadata_modele.json")
SCHEMA_FEATURES = "selected_features_global.json"
CHEMIN_ACTIFS_CRITIQUES = "actifs_critiques.json"
```

Expected artifacts:

- Trained Keras model.
- Serialized scaler.
- JSON metadata containing thresholds.
- JSON feature-order/schema definition.
- Optional critical-asset whitelist.

### Temporal and persistence parameters

```python
TAILLE_FENETRE = 10
SEUIL_PERSISTANCE = 3
COOLDOWN_BLOCAGE_SEC = 300
```

Interpretation:

- The ML model evaluates sequences of **10 observations**.
- At least **3 anomaly evaluations** inside the five-entry history trigger the response logic.
- An already blocked IP is protected by a **300-second cooldown** before another block event can be emitted.

### Global burst detection

```python
SEUIL_GLOBAL_FLOOD = 300
```

More than **300 packets within approximately 2 seconds**, aggregated across IPs, triggers the distributed flood/DDoS shield logic, subject to the 30-second global alert suppression interval.

### Per-IP burst detection

```python
FENETRE_TEMPORELLE_SEC = 2.0
SEUIL_SPAM_PAQUETS = 80
```

An IP reaching **80 or more packets during the 2-second window** is marked as suspicious by the rate limiter.

---

## 5. Whitelist Handling

The whitelist is loaded dynamically from:

```text
actifs_critiques.json
```

The parser accepts several structures:

- A JSON list: all values become whitelist IPs.
- A JSON dictionary: list values are added to the whitelist.
- A JSON dictionary: string values are also added.

If the file does not exist, no whitelist is active.

This whitelist is used specifically to prevent automatic blocking of critical assets when the persistence threshold is reached.

---

## 6. Feature Schema Loading

The feature contract is loaded from:

```text
selected_features_global.json
```

Two formats are explicitly supported:

```json
["feature1", "feature2", "..."]
```

or:

```json
{
  "features": ["feature1", "feature2", "..."]
}
```

The code stores the resulting ordered list in:

```python
FEATURES_ORDRE
```

and derives:

```python
NB_FEATURES = len(FEATURES_ORDRE)
```

The comments identify the intended configuration as **16 features**, and later logs use `16` as the number of features.

If the schema file is missing, the program stops immediately with a `FileNotFoundError`.

---

## 7. Custom Keras Layers

### `CoucheEchantillonnage`

This layer implements the VAE latent sampling mechanism.

During training:

```text
z = z_mean + exp(0.5 * z_log_var) * epsilon
```

where `epsilon` is sampled from a normal distribution.

During inference:

```text
z = z_mean
```

Therefore inference is explicitly deterministic and uses the latent mean.

### `CoucheVAELoss`

This layer computes the VAE loss as:

```text
Total Loss = Reconstruction MSE + KL divergence
```

The reconstruction term is:

```text
mean((x - x_reconstructed)^2)
```

The KL component is:

```text
-0.5 * mean(1 + z_log_var - z_mean² - exp(z_log_var))
```

The resulting loss is registered through Keras `add_loss()`.

---

## 8. Model Loading

`charger_artefacts()` loads:

1. The `.keras` LSTM-VAE model.
2. The serialized scaler.
3. The JSON metadata.

The custom layer classes are supplied through `custom_objects`.

The metadata provides:

```python
seuil_1sigma_baseline
feature_p98_thresholds
```

The code falls back to a default global threshold of approximately:

```text
26.095900
```

when the metadata does not contain the corresponding value.

The individual feature thresholds are converted to a NumPy array.

The function logs the active hybrid strategy:

```text
Votes >= 4 OR MSE global >= global 1-sigma threshold
```

---

## 9. Compiled Inference

The model inference wrapper is:

```python
@tf.function(reduce_retracing=True)
def inference_compilee(modele, x):
    return modele(x, training=False)
```

This compiles the inference graph and explicitly disables training behavior.

### Warm-up

`warm_up()` runs one dummy tensor through the model:

```text
shape = (1, 10, NB_FEATURES)
```

This is intended to compile/initialize the execution graph before real traffic is processed.

---

## 10. Per-IP State

The application maintains two main structures.

### Feature buffer

```python
buffers_par_ip = defaultdict(
    lambda: deque(maxlen=TAILLE_FENETRE)
)
```

Each source IP has a sliding feature buffer containing the latest 10 observations.

### Anomaly history

```python
historique_evaluations_ip = defaultdict(
    lambda: deque(maxlen=5)
)
```

Each IP retains the latest five binary anomaly decisions.

The combination creates two temporal layers:

```text
10 observations → LSTM-VAE sequence
5 evaluations   → persistence/correlation decision
```

---

## 11. Feature Extraction

`extraire_features(message)` extracts the features from a Kafka message according to `FEATURES_ORDRE`.

The function:

1. Detects and ignores a possible header row.
2. Converts each required field to `float`.
3. Returns `None` if a required field is missing or malformed.

Handled parsing exceptions include:

- `KeyError`
- `TypeError`
- `ValueError`

The function therefore prevents malformed telemetry from crashing the main message-processing loop.

---

## 12. Main Message Processing

The central function is:

```python
traiter_message(
    message,
    modele,
    scaler,
    feature_thresholds,
    seuil_1sigma_baseline,
    producer_alertes
)
```

The processing sequence is as follows.

### Step 1 — Identify the source IP

```python
src_ip = message.get("src_ip")
```

Messages without a source IP are ignored.

### Step 2 — Record the current timestamp

The function uses `time.time()` as the event-processing timestamp.

---

## 13. Global Volumetric Pre-Filter

Before AI processing, every accepted message contributes its timestamp to:

```python
historique_global_paquets
```

The deque is cleaned so it only contains events from approximately the last two seconds.

When:

```text
number of packets > 300
```

the application declares:

```text
DDoS volumetric by IP spoofing
```

and publishes:

```json
{
  "action": "ENABLE_DDOS_SHIELD",
  "source": "hybrid-global-burst-engine",
  "src_ip": "MULTIPLE_SPOOFED_IPS",
  "threatType": "DDoS Volumétrique par Usurpation d'IP (Spoofing)"
}
```

A global cooldown of **30 seconds** is applied to this alert path.

When the global flood condition is triggered, the function returns immediately and does not continue to the per-IP LSTM-VAE processing for that message.

---

## 14. AI Behavioral Analysis

If the global flood pre-filter does not trigger, the message enters the ML pipeline.

### Rate limiting

The IP's timestamp history is first reduced to the last two seconds.

Then the current timestamp is appended.

The code computes:

```python
nb_paquets_recents = len(historique_paquets_ip[src_ip])
```

and marks:

```text
spam_detecte = True
```

when the count reaches at least **80 packets in 2 seconds**.

This rate-limit result becomes one input to the final hybrid anomaly decision.

---

## 15. Temporal Sliding Window

The feature vector is appended to the IP-specific 10-element buffer.

Inference only starts after the buffer reaches exactly the configured temporal window length.

Until then, the message is ignored for ML scoring.

Expected model input:

```text
(batch=1, timesteps=10, features=16)
```

according to the file's intended configuration.

---

## 16. Normalization

The raw sequence is converted to a NumPy `float32` array and passed through the loaded scaler:

```python
sequence_norm = scaler.transform(sequence_brute)
```

The scaled values are then clipped:

```python
np.clip(..., 0.0, 1.0)
```

and reshaped for model inference.

Thus the model receives a bounded normalized sequence.

---

## 17. LSTM-VAE Inference and Latency

Inference is performed using the compiled TensorFlow function.

The execution duration is explicitly measured:

```text
latence_ms = inference duration × 1000
```

The latency is included in the operational logs but is not itself used as an anomaly criterion.

---

## 18. Reconstruction Error

The model output is treated as a reconstructed tensor with the intended shape:

```text
(1, 10, 16)
```

The reconstruction error is calculated independently for each feature over the temporal dimension:

```text
mean((normalized_input - reconstruction)^2, axis=time)
```

The resulting feature errors are then multiplied by:

```text
1000
```

The overall score is:

```text
MSE_global = mean(feature_errors)
```

Therefore there are two levels of reconstruction scoring:

```text
16 feature-level errors
          |
          v
  global mean reconstruction error
```

---

## 19. Hybrid ML Decision

### Feature voting

For each feature:

```python
feature_error > feature_threshold
```

is evaluated.

The number of exceeded thresholds is stored in:

```python
vote_count
```

The strict ML anomaly criterion is:

```text
vote_count >= 4
OR
MSE_global >= global 1-sigma threshold
```

This is explicitly an **OR logic**, not an AND logic.

### Behavioral rate-limit integration

The final current anomaly state is:

```text
anomalie_actuelle = 1
if ML anomaly is true OR packet spam is detected
```

So an IP can be marked anomalous either through:

- LSTM-VAE reconstruction behavior,
- Per-IP packet burst behavior,
- or both.

---

## 20. Persistence / Correlation Logic

Each current anomaly result (`0` or `1`) is appended to the IP's history of the latest five evaluations.

The persistence score is:

```text
score_persistance = sum(last five anomaly decisions)
```

The response condition is:

```text
score_persistance >= 3
```

Therefore the system does **not require three consecutive anomalous evaluations** despite the variable comment describing a persistence threshold. It requires at least three anomalies among the latest five evaluations.

This distinction is important for understanding the actual runtime behavior.

---

## 21. Alert and Automatic Blocking Logic

When the persistence score reaches the threshold:

### Whitelisted source

If the IP exists in:

```python
WHITELIST_IPS
```

the application logs that the IP is suspicious but protected from automatic blocking.

### Non-whitelisted source

Otherwise it calls:

```python
executer_auto_block(...)
```

and emits an `AUTO_BLOCK_IP` event to Kafka.

After the persistence threshold is handled, the IP's five-entry anomaly history is cleared.

---

## 22. Auto-Block Cooldown

`executer_auto_block()` prevents repeated blocking events for the same IP during the configured cooldown period.

The state is kept in:

```python
ips_deja_bloquees
```

The configured interval is:

```text
300 seconds = 5 minutes
```

When blocking occurs, a timestamp is stored.

A repeated block request during the cooldown is silently ignored.

---

## 23. Auto-Block Kafka Event

The generated Kafka payload is:

```json
{
  "action": "AUTO_BLOCK_IP",
  "source": "hybrid-lstm-vae-burst-engine",
  "src_ip": "...",
  "mse": "...",
  "seuil": "...",
  "timestamp": "..."
}
```

The consumer of `ml-alerts` is therefore responsible for interpreting the `AUTO_BLOCK_IP` action and enforcing the actual network isolation/blocking mechanism.

---

## 24. Logging

Logging is configured at `INFO` level with timestamps and log levels.

The principal runtime information includes:

- Source IP.
- Global MSE.
- Global 1-sigma threshold.
- Number of feature votes.
- Number of packets in the last two seconds.
- Persistence score over five evaluations.
- Model inference latency.

Example structure:

```text
IP=<source>
MSE_global=<value>
Seuil 1σ=<value>
Votes=<count>/16 features
paquets_2s=<count>
Anomalies récentes=<score>/5
latence=<value>ms
```

Critical security events use `logger.critical()`.

Warnings are used for rate-limit detections that do not independently satisfy the strict ML condition.

---

## 25. Kafka Consumer / Producer Architecture

### Producer

The alert producer connects to:

```text
192.168.56.130:9092
```

and serializes dictionaries as UTF-8 JSON.

### Consumer

The consumer subscribes to:

```text
network-features
```

with:

```text
group_id = realtime-interface
auto_offset_reset = latest
```

The latest Kafka messages are therefore processed by the consumer when starting from the current position.

### Main processing loop

For every Kafka record:

```text
record.value
      |
      v
traiter_message(...)
```

The application continues processing messages until interrupted.

---

## 26. Startup Sequence

`main()` performs the following operations:

```text
1. Load model, scaler, thresholds, metadata.
2. Warm up the model.
3. Create Kafka alert producer.
4. Create Kafka telemetry consumer.
5. Enter the message-processing loop.
6. On Ctrl+C, stop gracefully.
7. Close consumer and producer.
```

The application therefore requires all expected model/configuration artifacts to be present before entering the real-time loop.

---

## 27. Key Thresholds and State Variables

| Parameter | Value | Purpose |
|---|---:|---|
| `TAILLE_FENETRE` | 10 | Number of temporal observations used for LSTM-VAE inference |
| `SEUIL_PERSISTANCE` | 3 | Minimum anomalies among the last five evaluations for response |
| `COOLDOWN_BLOCAGE_SEC` | 300 s | Auto-block repeat suppression |
| `SEUIL_GLOBAL_FLOOD` | 300 | Global packet count threshold over ~2 s |
| Global DDoS alert cooldown | 30 s | Prevents repeated global DDoS alerts |
| `FENETRE_TEMPORELLE_SEC` | 2 s | Per-IP packet burst window |
| `SEUIL_SPAM_PAQUETS` | 80 | Per-IP suspicious packet-rate threshold |
| Feature vote threshold | 4 | Minimum exceeded feature thresholds |
| Global MSE threshold | Metadata value | Global reconstruction-error criterion |
| Max anomaly history | 5 | Persistence/correlation window |
| Intended feature count | 16 | Model input dimensionality |

---

## 28. Security Controls Implemented

The file incorporates several defense mechanisms at different layers:

### Layer 1 — Global volumetric defense

Detects aggregate packet floods across source IPs and can emit:

```text
ENABLE_DDOS_SHIELD
```

### Layer 2 — Per-IP burst detection

Detects unusually high packet rates from individual source IPs.

### Layer 3 — Behavioral anomaly detection

Uses LSTM-VAE reconstruction error to identify deviations from learned behavior.

### Layer 4 — Multi-feature consensus

Requires either sufficient individual feature threshold violations or a high global MSE.

### Layer 5 — Temporal persistence

Requires repeated anomalous evaluations before auto-blocking.

### Layer 6 — Critical asset protection

Whitelist prevents automatic blocking of configured critical IPs.

### Layer 7 — Response anti-spam

The auto-block cooldown prevents repeated block commands for the same IP during the configured interval.

---

## 29. Important Implementation Observations

### Observation 1 — File name vs. actual content

The uploaded file is named `train_lstm_vae_16f.py`, but the visible implementation is a **real-time Kafka inference/detection service**, not model training code.

Its main responsibilities are model loading, streaming inference, anomaly detection, and response triggering.

### Observation 2 — Feature count wording

Several comments refer to **32 features**, while the configuration and model path refer to **16 features**, and the runtime log reports `16` features.

The actual runtime feature count is derived dynamically from:

```python
len(FEATURES_ORDRE)
```

so the schema file is authoritative for the actual number of features.

### Observation 3 — Persistence wording

The comments describe `SEUIL_PERSISTANCE = 3` as:

```text
Nombre de dépassements consécutifs avant alerte réelle
```

but the implementation actually uses the **sum of anomalies over the last five evaluations**.

Therefore `3/5` anomalies can trigger the response even when they are not consecutive.

### Observation 4 — Rate limiting is auxiliary to ML

The per-IP rate limiter does not directly call the block function. Instead it contributes to:

```text
anomalie_actuelle
```

which then enters the five-evaluation persistence mechanism.

### Observation 5 — Global DDoS path bypasses the ML path

Once the global flood threshold is exceeded, the current message causes the DDoS shield path to execute and the function returns immediately.

This makes the global volumetric detector a pre-filter in front of the LSTM-VAE path.

---

## 30. Required Runtime Files

For normal operation, the implementation expects:

```text
modele_deep_lstm_vae_16features/
├── deep_lstm_vae_16f.keras
├── global_scaler_16f.pkl
└── metadata_modele.json

selected_features_global.json
actifs_critiques.json   # optional
```

It also requires access to the Kafka broker:

```text
192.168.56.130:9092
```

with the configured input and output topics.

---

## 31. Simplified Pseudocode

```text
START
 |
 |-- Load feature schema
 |-- Load whitelist
 |-- Load LSTM-VAE + scaler + thresholds
 |-- Warm up model
 |-- Connect Kafka producer/consumer
 |
 +--> FOR each Kafka message:
       |
       |-- Extract src_ip
       |
       |-- Update global 2-second packet history
       |
       |-- Global flood > 300?
       |       |
       |       +-- YES --> publish ENABLE_DDOS_SHIELD --> continue
       |
       |-- Extract ordered features
       |-- Update per-IP 2-second packet history
       |-- Detect per-IP spam >= 80
       |-- Append features to 10-observation buffer
       |
       |-- Buffer complete?
       |       |
       |       +-- NO --> continue
       |
       |-- Normalize and clip features
       |-- LSTM-VAE inference
       |-- Compute 16 feature reconstruction errors
       |-- Compute global MSE
       |-- Count threshold violations
       |
       |-- ML anomaly =
       |      (votes >= 4) OR (global MSE >= global threshold)
       |
       |-- Current anomaly =
       |      ML anomaly OR per-IP spam
       |
       |-- Add result to last-5 history
       |-- Compute persistence score
       |
       |-- Persistence >= 3?
       |       |
       |       +-- NO --> continue
       |       |
       |       +-- YES
       |             |
       |             +-- Whitelisted? --> log protection
       |             |
       |             +-- Otherwise --> AUTO_BLOCK_IP
       |
       |-- Clear IP anomaly history
 |
 END
```

---

## 32. Output Artifacts / Actions

The file itself does not directly implement a firewall rule or network isolation command.

Instead, it publishes Kafka actions:

```text
ENABLE_DDOS_SHIELD
AUTO_BLOCK_IP
```

This indicates that the real enforcement layer is external to this Python file and is expected to consume `ml-alerts`.

---

## 33. Function Inventory

| Function | Responsibility |
|---|---|
| `CoucheEchantillonnage.call()` | VAE latent sampling / deterministic inference |
| `CoucheVAELoss.call()` | Reconstruction + KL loss computation |
| `charger_artefacts()` | Load model, scaler, metadata, thresholds |
| `inference_compilee()` | TensorFlow-compiled model inference |
| `warm_up()` | Initialize/compile inference path with dummy input |
| `extraire_features()` | Extract and convert ordered features |
| `traiter_message()` | Complete real-time detection pipeline |
| `executer_auto_block()` | Apply block cooldown and publish block action |
| `main()` | Initialize components and run Kafka loop |

---

## 34. Overall Assessment

This file implements a **hybrid real-time detection engine** rather than a training script. Its architecture combines statistical/volumetric detection, rate limiting, sequence-based LSTM-VAE anomaly detection, feature-level voting, temporal persistence, whitelist protection, and Kafka-driven automated response.

The central decision chain is:

```text
Traffic
  ↓
Global flood check
  ↓
Per-IP rate limiting
  ↓
10-step temporal window
  ↓
LSTM-VAE reconstruction
  ↓
Feature threshold voting + global MSE
  ↓
OR with packet-spam detection
  ↓
5-evaluation persistence
  ↓
Whitelist check
  ↓
AUTO_BLOCK_IP
```

The most important implementation detail to preserve when documenting or testing this component is that the final block decision is **multi-stage**: a single anomalous inference does not directly block an IP; it must first contribute to a persistence score of at least `3` within the latest `5` evaluations, unless the separate global DDoS shield path is triggered.
