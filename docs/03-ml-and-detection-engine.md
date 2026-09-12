# 03 — ML and Detection Engine

This document specifies the **offline CIC-IDS2017 training chain**, the **32-feature contract**, the **Deep LSTM-VAE**, **live inference** in `realtime_interface.py`, **edge extraction trade-offs** in `edge_collector.py`, and the **composite threat score** implemented in `backend/server.js`.

All symbols match the Python/JavaScript identifiers unless a mathematical alias is introduced explicitly.

---

## 1. Dataset and feature selection

### 1.1 Corpus

Training and calibration use the public **CIC-IDS2017** Machine Learning CSV export (`MachineLearningCVE`), referenced as relative paths from `vm-ml/lstm-vae/`:

| Script | Path constant | Intended day / content |
|--------|---------------|------------------------|
| `feature_selector.py` | `CHEMIN_DATA = "cicids2017_data/MachineLearningCVE/Monday-WorkingHours.pcap_ISCX.csv"` | Monday **BENIGN-heavy** working hours; label column dropped before selection |
| `train_lstm_vae.py` | `CHEMIN_DONNEES_TRAIN = "dataset_optimal_features.csv"` | Output of the selector (no label) |
| `calibrate_threshold.py` | `CHEMIN_TUESDAY = ".../Tuesday-WorkingHours.pcap_ISCX.csv"` | Independent day; labels kept (`BENIGN` → 0, else 1) |
| `prepare_tuesday.py` | same Tuesday CSV | Exports **BENIGN-only** 32-column `tuesday_optimal_features.csv` |
| `evaluate_attacks.py` | `CHEMIN_WEDNESDAY = ".../Thursday-WorkingHours-Morning-WebAttacks.pcap_ISCX.csv"` | Variable name says Wednesday; **file is Thursday morning Web Attacks** |
| `finetune.py` | `CHEMIN_CSV = "dataset_finetuning.csv"` | Local VirtualBox capture (`header=None`); **legacy** artefact dir `modele_fenetre_10_enrichi` |

CSV artefacts and `cicids2017_data/` are **not** stored in git.

### 1.2 Unsupervised selection (`feature_selector.py`)

Pipeline on Monday CSV after `df.columns.str.strip()` and drop of `Label` if present:

1. **Sanitation:** `replace([inf, -inf], nan)` then `dropna`.
2. **Variance filter:** `sklearn.feature_selection.VarianceThreshold(threshold=0.01)` (`SEUIL_VARIANCE`). Constant or near-constant CIC columns are removed.
3. **Pearson multicollinearity:** `df_var.corr().abs()`, upper triangle, drop any column with correlation **\(> 0.85\)** (`SEUIL_CORRELATION`) against an earlier retained column.
4. **Contract write:** `selected_features.json`

```json
{
  "n_features": 32,
  "features": [ "...ordered names..." ]
}
```

5. **Table write:** `dataset_optimal_features.csv` (selected columns only).

The committed contract in `vm-edge/selected_features.json` (copied conceptually to the ML node) is:

| # | Feature name (CIC-IDS2017 spelling) |
|---|-------------------------------------|
| 1 | Destination Port |
| 2 | Flow Duration |
| 3 | Total Fwd Packets |
| 4 | Fwd Packet Length Max |
| 5 | Fwd Packet Length Min |
| 6 | Fwd Packet Length Mean |
| 7 | Bwd Packet Length Max |
| 8 | Bwd Packet Length Min |
| 9 | Flow Bytes/s |
| 10 | Flow Packets/s |
| 11 | Flow IAT Mean |
| 12 | Flow IAT Std |
| 13 | Flow IAT Min |
| 14 | Fwd IAT Std |
| 15 | Bwd IAT Std |
| 16 | Fwd PSH Flags |
| 17 | Fwd Header Length |
| 18 | Bwd Header Length |
| 19 | Bwd Packets/s |
| 20 | Min Packet Length |
| 21 | FIN Flag Count |
| 22 | PSH Flag Count |
| 23 | ACK Flag Count |
| 24 | URG Flag Count |
| 25 | Down/Up Ratio |
| 26 | Init_Win_bytes_forward |
| 27 | Init_Win_bytes_backward |
| 28 | min_seg_size_forward |
| 29 | Active Mean |
| 30 | Active Std |
| 31 | Active Max |
| 32 | Idle Std |

`train_lstm_vae.py` **asserts** `NB_FEATURES == 32`.

### 1.3 Live extraction vs CICFlowMeter (`edge_collector.py`)

Suricata `flow` records do **not** expose CICFlowMeter’s bidirectional IAT, TCP flags, or window fields. The collector therefore **approximates** a subset and **zero-fills** the rest, while still emitting a 32-key object in `FEATURES_ORDRE`.

Let \(F\) be `evenement["flow"]`, \(E\) the EVE object.

| Contract feature | Live mapping | Nature |
|------------------|--------------|--------|
| Destination Port | `float(E.get("dest_port", 0))` | Native |
| Flow Duration | `float(F.get("age", 1) * 1_000_000.0)` | **Microsecond estimate** from Suricata `age` (seconds) |
| Total Fwd Packets | `pkts_toserver` | Native |
| Fwd Packet Length Max | `bytes_toserver` | **Not** max packet length — **total forward bytes** reused as a stand-in |
| Fwd Packet Length Min | `0.0` | Missing |
| Fwd Packet Length Mean | `0.0` | Missing |
| Bwd Packet Length Max | `bytes_toclient` | Total backward bytes stand-in |
| Bwd Packet Length Min | `0.0` | Missing |
| Flow Bytes/s | `bytes_toserver + bytes_toclient` | **Counts, not rates** (name retained from CIC) |
| Flow Packets/s | `pkts_toserver + pkts_toclient` | Counts, not rates |
| Flow IAT Mean / Std / Min | `0.0` | Missing |
| Fwd IAT Std / Bwd IAT Std | `0.0` | Missing |
| Fwd PSH Flags | `0.0` | Missing |
| Fwd / Bwd Header Length | `0.0` | Missing |
| Bwd Packets/s | `pkts_toclient` | Count stand-in |
| Min Packet Length | `0.0` | Missing |
| FIN / PSH / ACK / URG Flag Count | `0.0` | Missing |
| Down/Up Ratio | `0.0` | Missing |
| Init_Win_bytes_forward / backward | `0.0` | Missing |
| min_seg_size_forward | `0.0` | Missing |
| Active Mean / Std / Max | `0.0` | Missing |
| Idle Std | `0.0` | Missing |
| `src_ip` (extra key) | `E["src_ip"]` | Grouping key for LSTM buffers; **not** one of the 32 model inputs |

**Implications for the PFE:**

- The model is trained on dense CIC statistics but scored online on a **sparse projection**. Domain shift is expected; `finetune.py` exists to adapt on local captures (legacy paths).
- Anomaly signal in production is carried primarily by **port, duration, packet/byte totals**, plus the **non-ML** burst and flood counters in `realtime_interface.py`.
- Header-like Kafka messages (first field alphabetic or equal to the feature name string) are discarded in `extraire_features()`.

Events that are neither `flow` nor `alert` increment `nb_ignores`.

---

## 2. LSTM-VAE model

### 2.1 Hyperparameters (`train_lstm_vae.py`)

| Symbol / name | Value |
|---------------|-------|
| `TAILLE_FENETRE` | 10 |
| `DIM_LATENTE` | 16 |
| `EPOCHS_MAX` | 50 |
| `PATIENCE` (EarlyStopping on `val_loss`) | 10 |
| `BATCH_SIZE` | 128 |
| `RATIO_VALIDATION` | 0.20 |
| Optimizer | Adam (Keras default) |
| Output dir | `modele_deep_lstm_vae_32features` |

**Anti-leakage split:** MinMax fit is performed on the **full** `dataset_optimal_features.csv`, then the normalized matrix is cut at `idx_split = int(len * 0.8)` **before** sliding windows. Sequences are **not** mixed across the cut. (Scaler still sees validation rows during `fit_transform` of the full file — a documented limitation if a stricter protocol is required.)

Normalization: `MinMaxScaler` then `np.clip(..., 0.0, 1.0)`.

Sliding window: for input matrix \(X \in \mathbb{R}^{N \times 32}\), sequence \(i\) is \(X[i:i+10]\), count \(N-9\).

### 2.2 Network topology (64-32-16-32-64)

Metadata string: `"LSTM-VAE (64-32-16-32-64)"`.

**Encoder**

- Input: `(batch, 10, 32)`, name `sequence_entree`
- `LSTM(64, tanh, return_sequences=True)`
- `LSTM(32, tanh, return_sequences=False)` → vector \(\mathbb{R}^{32}\)
- `Dense(16)` → \(z_{\mathrm{mean}}\)
- `Dense(16)` → \(z_{\log\sigma^{2}}\)
- `CoucheEchantillonnage`

**Latent sampling (`CoucheEchantillonnage`)**

Training:

\[
z = z_{\mathrm{mean}} + \exp\bigl(\tfrac{1}{2} z_{\log\sigma^{2}}\bigr) \odot \varepsilon, \quad \varepsilon \sim \mathcal{N}(0,I)
\]

Inference (`training=False`, including `realtime_interface.py`): **\(z = z_{\mathrm{mean}}\)** (deterministic).

`realtime_interface.py` registers the same layer with `@keras.saving.register_keras_serializable()`; training uses `@keras.utils.register_keras_serializable()`.

**Decoder**

- `RepeatVector(10)` on \(z\)
- `LSTM(32, tanh, return_sequences=True)`
- `LSTM(64, tanh, return_sequences=True)`
- `TimeDistributed(Dense(32, sigmoid))` → reconstruction \(\hat{x} \in [0,1]^{10 \times 32}\)

**Loss layer `CoucheVAELoss`** (added via `self.add_loss`, identity pass-through of \(\hat{x}\)):

\[
\mathcal{L}_{\mathrm{rec}} = \mathrm{mean}\bigl((x-\hat{x})^{2}\bigr)
\]

\[
\mathcal{L}_{\mathrm{KL}} = -\tfrac{1}{2}\,\mathrm{mean}\bigl(1 + z_{\log\sigma^{2}} - z_{\mathrm{mean}}^{2} - \exp(z_{\log\sigma^{2}})\bigr)
\]

\[
\mathcal{L} = \mathcal{L}_{\mathrm{rec}} + \mathcal{L}_{\mathrm{KL}}
\]

`modele.compile(optimizer="adam")` with **no explicit `loss=`** — training is driven entirely by `add_loss`.

### 2.3 Baseline 3σ threshold (Monday validation sequences)

After fit, reconstruction MSE on **validation sequences** is

\[
e_{i} = 1000 \cdot \mathrm{mean}_{t,f}\bigl((x_{i}-\hat{x}_{i})^{2}\bigr)
\]

(`calculer_erreurs_mse`, `batch_size=512`).

\[
\mu = \mathrm{mean}(e),\quad \sigma = \mathrm{std}(e),\quad \tau_{3\sigma} = \mu + 3\sigma
\]

Stored as `seuil_3sigma_baseline`, with `mu_validation`, `sigma_validation`, `duree_entrainement_sec`.

Artefacts:

- `deep_lstm_vae.keras`
- `global_scaler.pkl` (joblib)
- `metadata_modele.json`

### 2.4 Optimal Tuesday calibration (`calibrate_threshold.py`)

Constraint stated in the file header: **maximize recall (TPR) subject to FPR \(\le 5\%\)**.

- Chunk size `100_000`; columns stripped; require all 32 features + `Label`.
- Sequence label = 1 if **any** of the 10 frames is non-`BENIGN`.
- Overlap between chunks: last `taille_fenetre-1` normalized rows carried over.
- `sklearn.metrics.roc_curve(y_true, y_scores)` on MSE scores.
- `indices_valides = where(fpr <= 0.05)`; among them `argmax(tpr)`.
- Write `meta["seuil_optimal_calibre"] = float(seuil_optimal)`.

**Live threshold selection** (`charger_artefacts` in `realtime_interface.py`):

```text
seuil = metadata.get("seuil_optimal_calibre", metadata.get("seuil_3sigma_baseline"))
```

Tuesday calibration **overrides** 3σ when present.

### 2.5 Additional evaluation scripts (not in the live loop)

**`evaluate_attacks.py`**

- Reads `meta["seuil_anomalie"]` — **this key is never written** by `train_lstm_vae.py` (which writes `seuil_3sigma_baseline`). The script will `KeyError` unless metadata was edited by hand or by an older trainer.
- Uses Precision–Recall curve, \(F_1 = 2PR/(P+R+\varepsilon)\), \(\varepsilon=10^{-10}\).
- Prints classification report and confusion matrix for the \(F_1\)-optimal threshold.
- Feature list taken from **header of** `dataset_optimal_features.csv`, not from `selected_features.json`.

**`finetune.py`**

- Loads `modele_fenetre_10_enrichi/lstm_candidate.keras` (not `deep_lstm_vae.keras`).
- Sampling layer **always** uses reparameterization (no `training` flag) — inconsistent with the production deterministic encoder.
- 5 epochs, batch 64, MSE without \(\times 1000\) in `calculer_erreurs_mse`.
- Updates `metadata.json` keys `seuil_mse`, `mu`, `sigma`.
- **Do not** treat this as the production 32-feature path without aligning directories and layer code.

**`prepare_tuesday.py`**

- Aligns Tuesday CSV to the 32 columns of `dataset_optimal_features.csv`, drops Inf/NaN, keeps `Label == BENIGN`, writes `tuesday_optimal_features.csv`.

---

## 3. Realtime inference

File: `vm-ml/lstm-vae/realtime_interface.py`.  
Consumer: topic `network-features`, group `realtime-interface`.  
Producer: topic `ml-alerts`.  
Model load: `safe_mode=False`, custom objects `CoucheEchantillonnage`, `CoucheVAELoss`.  
Warm-up: one zero tensor `(1, 10, 32)` through `@tf.function` `inference_compilee`.

### 3.1 Whitelist load at process start

`actifs_critiques.json` may be a list or a dict whose values are lists or strings. All IPs are unioned into `WHITELIST_IPS`. File missing → empty set and a warning.

Unlike `soar.py`, **this whitelist is not reloaded per message**. Hub `sync_whitelist` updates a JSON path used by `agent_monitor.py` (`/home/aziz/dataset/actifs_critiques.json`); the inference process must be restarted (or the file must be the one loaded at startup) to pick up changes.

### 3.2 Tier 0 — global flood (pre-ML)

Structure: `deque` of timestamps, retention **2.0 s**.

If `len(historique_global_paquets) > 300` (`SEUIL_GLOBAL_FLOOD`):

- At most one alert every **30.0 s** (`derniere_alerte_globale`).
- Produce `ENABLE_DDOS_SHIELD` with dummy `mse: 99.99`.
- **Return immediately** — “court-circuit” so spoofed floods do not expand per-IP LSTM state.

### 3.3 Tier 1 — LSTM-VAE reconstruction MSE

Per `src_ip`: `buffers_par_ip[ip] = deque(maxlen=10)`. No score until 10 vectors.

\[
x_{\mathrm{norm}} = \mathrm{clip}(\mathrm{scaler}(x_{\mathrm{raw}}), 0, 1) \in \mathbb{R}^{10 \times 32}
\]

\[
\mathrm{MSE}_{\mathrm{live}} = 1000 \cdot \mathrm{mean}\bigl((x_{\mathrm{norm}} - \hat{x})^{2}\bigr)
\]

`anomalie_ml_stricte ⇔ MSE_live > seuil`.

Latency is measured around the compiled call (`latence_ms`) and logged; it is attached to auto-block Kafka messages.

### 3.4 Tier 2 — per-IP burst

`historique_paquets_ip[src_ip]` retains timestamps within `FENETRE_TEMPORELLE_SEC = 2.0`.

`spam_detecte ⇔ nb_paquets_recents ≥ 80` (`SEUIL_SPAM_PAQUETS`).

Burst **without** MSE breach still increments the persistence counter and logs `[RATE-LIMITER]`.

### 3.5 Tier 3 — persistence and auto-block

`compteurs_depassement[ip]` increments if `anomalie_ml_stricte or spam_detecte`, else reset to 0.

When counter \(\ge 3\) (`SEUIL_PERSISTANCE`):

- If IP ∈ `WHITELIST_IPS`: log `SÉCURITÉ WHITELIST`, **do not** send `AUTO_BLOCK_IP`.
- Else `executer_auto_block`:
  - Skip if last block for that IP was \(< 300\) s ago (`COOLDOWN_BLOCAGE_SEC`).
  - Else send:

```json
{
  "action": "AUTO_BLOCK_IP",
  "source": "hybrid-lstm-vae-burst-engine",
  "src_ip": "<ip>",
  "mse": <float>,
  "seuil": <float>,
  "timestamp": <unix>
}
```

Counter is reset after handling in both whitelist and block cases.

**Note:** `soar.py` treats **any** `ml-alerts` message with a `src_ip` (and `action != ENABLE_DDOS_SHIELD`) as an ML alert timestamp for correlation; it does not require `action == AUTO_BLOCK_IP` specifically in `traiter_alerte_ml` beyond the DDoS branch. Palier 2 ML-only therefore fires on auto-block events as well.

### 3.6 Logging format

```text
IP={src_ip} | MSE={mse:.4f} | paquets_2s={n} | depassements_consecutifs={c} | latence={ms:.3f}ms
```

---

## 4. Composite threat scoring

Implemented only in the **hub**, function `calculerScoreMenaceCompose(payload)` in `backend/server.js`, invoked when an `incident-reports` message updates a case that is still in `Analyse IA*`.

### 4.1 Formula

\[
\mathrm{Score} = \mathrm{round}\bigl( 0.40 \cdot S_{\mathrm{Suricata}} + 0.30 \cdot S_{\mathrm{ML}} + 0.30 \cdot S_{\mathrm{LLM}} \bigr)
\]

then clipped to \([0, 100]\).

Weights in code:

```javascript
const POIDS_SURICATA = 0.4;
const POIDS_ML = 0.3;
const POIDS_LLM = 0.3;
```

### 4.2 Channel definitions

**Suricata channel \(S_{\mathrm{Suricata}}\)**

Default **50**.

Let \(v = \) `payload.severity || payload.diagnostic_json?.niveau_severite || ""` (lowercased):

- contains `"critique"` → **100**
- contains `"élevé"` **or** `"haut"` → **80**
- otherwise remains **50** (includes `"Moyen"`, `"Faible"`, `"Elevé"` without accent if it does not match `"haut"` / `"élevé"`)

The live Kafka `incident-reports` path often has severity **only** inside `diagnostic_json.niveau_severite` (Llama). The initial `alerts-for-llm` document does **not** call this function.

**ML channel \(S_{\mathrm{ML}}\)**

```javascript
let scoreML = payload.ml_anomaly_score || 75;
```

Neither `agent_ia.py` nor `soar.py` bypass currently sets `ml_anomaly_score`. Therefore **the ML term is 75 unless a future producer adds the field**. The LSTM MSE is **not** mapped into the composite score in the present code.

**LLM channel \(S_{\mathrm{LLM}}\)**

```javascript
let scoreLLM = payload.diagnostic_json?.score_confiance || 80;
```

Llama is prompted to emit `score_confiance` (example 95). Bypass JSON sets **99**. Ollama fallback sets **0**, which **does** participate (falsy `0` is kept because `|| 80` would replace 0 — **note:** in JavaScript `0 || 80` yields **80**. A model that honestly returns confidence 0 is therefore treated as 80. Only missing/`null`/`undefined` and `0` collide this way.)

### 4.3 Worked examples (using actual defaults)

Assume Llama `niveau_severite: "Critique"` (\(S_{\mathrm{Suricata}}=100\)), no `ml_anomaly_score` (\(S_{\mathrm{ML}}=75\)), `score_confiance: 95`:

\[
\mathrm{Score} = \mathrm{round}(0.4\cdot 100 + 0.3\cdot 75 + 0.3\cdot 95) = \mathrm{round}(40 + 22.5 + 28.5) = 91
\]

Night Auto-Pilot condition `calculatedConfidence >= 85` **succeeds** (if no admin, not whitelist).

Assume informational Llama `niveau_severite: "Faible"` (50), defaults 75 and 80:

\[
\mathrm{Score} = \mathrm{round}(20 + 22.5 + 24) = 67
\]

Auto-Pilot does **not** fire; case remains `Ouvert` if not already auto-blocked by SOAR Palier 3.

Bypass Zero-Trust JSON: severity Critique (100), ML 75, LLM 99:

\[
\mathrm{Score} = \mathrm{round}(40 + 22.5 + 29.7) = 92
\]

Hub still **refuses DROP** because `isWhitelisted` is true; status `Alerte Zero Trust (Protégée)`.

### 4.4 Where the score is stored

Written to `SoarCase.aiConfidenceScore` (name is historical; value is the **fused** score, not raw Llama confidence). Dashboard incidents, briefing (`aiConfidenceScore >= 80` for `critical_alerts`), and overview average confidence all read this field.

---

## 5. Interaction with SOAR (detection vs actuation)

The LSTM-VAE **does not** call iptables. It only publishes `ml-alerts`. `soar.py` maps those alerts onto:

- infrastructure shield (`ENABLE_DDOS_SHIELD`);
- Palier 3 DROP + LLM;
- Palier 2 LLM without DROP;
- Zero-Trust bypass `incident-reports`.

Persistence (3 windows) and burst (80/2s) therefore affect **when** `ml-alerts` appears, which affects correlation with `suricata-alerts` inside **30 s**. A slow MSE rise without Suricata may stay Palier 2 (human or Auto-Pilot later). A Suricata-only high severity (`severity <= 2` means **more severe** in Suricata’s scale: 1 highest) can notify the LLM without any LSTM alert.

Suricata severity in EVE is passed through as-is (`alert.get("severity", 3)`). SOAR: `severity <= 2` → Palier 2; `severity > 2` → Palier 1 log-only.

---

## 6. Reproducibility checklist

1. Place CIC-IDS2017 CSVs under `cicids2017_data/MachineLearningCVE/` on VM-ML.
2. Run `feature_selector.py` → commit or copy `selected_features.json` to **both** `vm-edge/` and the LSTM working directory.
3. Run `train_lstm_vae.py` → `modele_deep_lstm_vae_32features/`.
4. Run `calibrate_threshold.py` → `seuil_optimal_calibre` in metadata.
5. Copy `global_scaler.pkl`, `deep_lstm_vae.keras`, `metadata_modele.json`, `selected_features.json`, `actifs_critiques.json` beside `realtime_interface.py`.
6. Start Kafka, then `edge_collector.py`, then `realtime_interface.py`.
7. Do not mix `finetune.py` artefact names with this folder without code changes.
8. Align `evaluate_attacks.py` metadata key if that script is required for the manuscript (rename `seuil_anomalie` or patch the reader).

This is the complete detection-engine specification as implemented in the NG-IDPS repository.
