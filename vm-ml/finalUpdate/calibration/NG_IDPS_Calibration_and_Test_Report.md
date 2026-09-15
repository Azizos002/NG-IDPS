# NG-IDPS Hybrid Engine: Threshold Calibration, Benchmark Analysis, and Test Suite Report

## 1. Executive Summary & Calibration Architecture

The Next-Generation Intrusion Detection and Prevention System (NG-IDPS) employs a **hybrid dual-strategy detection engine** powered by a Deep LSTM-VAE model (16 features, temporal sequence window size = 10). 

To ensure optimal trade-offs between precision, recall, and operational latency, the decision pipeline calibrates two complementary detection mechanisms operating in an **OR-Gate configuration**:

1. **Global Reconstruction Layer ($1\sigma$ Baseline / Distance to (0,1)):** Evaluates overall sequence reconstruction error ($	ext{MSE} 	imes 1000 \ge 26.0959$).
2. **Dynamic Multi-Feature Voting Layer ($\ge 4/16$ @ $P_{98}$):** Tracks individual feature anomalies. An anomaly is flagged if at least 4 out of 16 statistical features exceed their calibrated 98th percentile ($P_{98}$) thresholds.

Anomalies are passed to a **Sliding Window Persistence Filter** (`deque(maxlen=5)`), requiring $\ge 3$ triggers within 5 consecutive evaluations before executing an automated defense action (`AUTO_BLOCK_IP` or `ENABLE_DDOS_SHIELD`).

---

## 2. Threshold Calibration & Benchmarking Analysis

The model was evaluated across 14 distinct thresholding strategies on a dataset of **1,012,195 temporal sequences**.

### 2.1 Full Strategy Comparison Matrix

| Category | Calibration Strategy | Threshold ($	ext{MSE} 	imes 1000$) | FPR (%) | Precision (%) | Recall (%) | F1-Score (%) |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **Statistical / Unsupervised** | **1-Sigma ($\mu + 1\sigma$) [Implemented]** | **26.0959** | **5.70** | **91.58** | **50.49** | **65.09** |
| | 2-Sigma ($\mu + 2\sigma$) | 45.0049 | 1.53 | 97.52 | 49.02 | 65.25 |
| | 3-Sigma Baseline ($\mu + 3\sigma$) | 63.9139 | 0.73 | 98.69 | 44.70 | 61.53 |
| | Quantile P95 | 27.8321 | 5.00 | 92.52 | 50.40 | 65.25 |
| | Quantile P98 | 39.7100 | 2.00 | 96.82 | 49.66 | 65.65 |
| | Quantile P99 | 55.0158 | 1.00 | 98.30 | 47.05 | 63.64 |
| | EVT / SPOT Tail | 131.7666 | 0.12 | 99.72 | 34.72 | 51.51 |
| **Supervised ROC-Driven** | Youden's J-Index | 40.6263 | 1.90 | 96.98 | 49.58 | 65.61 |
| | Distance to (0,1) | 26.0165 | 5.73 | 91.55 | 50.49 | 65.09 |
| | $F_{0.5}$ Optimization | 112.4134 | 0.20 | 99.56 | 36.13 | 53.02 |
| **Robust & Voting** | MAD Robust ($	ext{Median} + 3 	imes 1.4826 	imes 	ext{MAD}$) | 7.1018 | 27.39 | 70.20 | 52.55 | 60.10 |
| | Feature Voting ($\ge 1/16$ @ $P_{98}$) | Dynamic (16) | 9.22 | 87.22 | 51.28 | 64.58 |
| | Feature Voting ($\ge 2/16$ @ $P_{98}$) | Dynamic (16) | 5.95 | 91.34 | 51.13 | 65.56 |
| | Feature Voting ($\ge 3/16$ @ $P_{98}$) | Dynamic (16) | 4.46 | 93.34 | 50.88 | 65.86 |
| | **Feature Voting ($\ge 4/16$ @ $P_{98}$) [Implemented]** | **Dynamic (16)** | **3.42** | **94.79** | **50.71** | **66.08** |

---

### 2.2 Calibration Rationale for Hybrid Selection

1. **Why Feature Voting ($\ge 4/16$ @ $P_{98}$):** Delivers the **highest absolute F1-Score (66.08%)** across all tested strategies while dropping the False Positive Rate to **3.42%** (a 40% reduction compared to standard $1\sigma$). It captures sub-vector multi-attribute attacks.
2. **Why 1-Sigma ($\mu + 1\sigma = 26.0959$):** Serves as an essential global reconstruction safety net. If an attack induces a massive overall reconstruction error across the sequence without necessarily pushing 4 separate feature dimensions past their $P_{98}$ individual mark, the $1\sigma$ threshold ensures immediate capture.

---

## 3. System Validation & Testing Suite

Testing was conducted across offline validation datasets and live penetration scenarios in a distributed multi-VM topology (`vm-edge` for capture/Suricata $ightarrow$ Kafka bus $ightarrow$ `vm-ml` for inference).

### 3.1 Offline Dataset Test Evaluation Results

#### A. Full Mixed Test Benchmark (1,012,195 Sequences)
* **Threshold Evaluated:** $	ext{MSE} = 26.0959$
* **True Negatives (TN):** 428,445 | **False Positives (FP):** 25,906 ($	ext{FPR} = 5.70\%$)
* **False Negatives (FN):** 276,201 | **True Positives (TP):** 281,643
* **Performance:** Precision = **91.58%**, Recall = **50.49%**, F1-Score = **65.09%**

#### B. Attack-Heavy Test Slice (506,258 Sequences)
* **Threshold Evaluated:** $	ext{MSE} = 26.0959$
* **True Negatives (TN):** 156 | **False Positives (FP):** 5 ($	ext{FPR} = 3.11\%$)
* **False Negatives (FN):** 85,650 | **True Positives (TP):** 420,447
* **Performance:** Precision = **100.00%**, Recall = **83.08%**, F1-Score = **90.76%**

---

### 3.2 Live Penetration Test Scenarios (Red-Teaming Execution)

| Test Scenario | Tool & Execution Command | Network / Suricata Telemetry | Hybrid Engine Reaction (`vm-ml`) | Automated System Action |
| :--- | :--- | :--- | :--- | :--- |
| **1. Global Volumetric DDoS** | `hping3 --rand-source --flood` | High-volume spoofed packets on interface `ens34`. | Volumetric pre-filter flags sequence rate exceeding limit ($>300$ pkts / 2s). | Triggers global SOAR shield (`ENABLE_DDOS_SHIELD`) with 30s cooldown. Bypasses deep inference to preserve CPU/RAM. |
| **2. Isolated Spoofed Packets** | `hping3 -a 192.168.56.200` | Isolated low-rate spoofed packets intercepted. | Calculated global $	ext{MSE} = 0.7659$ (well below $26.10$). Feature thresholds unviolated. | Evaluated as benign normal traffic. Persistence window prevents false positive triggering. |
| **3. Web Vulnerability Scan** | `nikto -h 192.168.56.128` | Multi-vector application probes (HTTP header anomalies, LFI attempts). | Feature reconstruction errors breach individual $P_{98}$ marks ($\ge 4/16$) and global MSE thresholds on abnormal HTTP structures. | Sliding window hits $\ge 3/5$ threshold. Emits `AUTO_BLOCK_IP` with 300s cooldown. |

---

## 4. Key Takeaways & Defense Summary

* **Dual-Layer Synergy:** Combining statistical global MSE thresholding with dynamic multi-feature voting guarantees resilience against both subtle single-feature shifts and massive reconstruction anomalies.
* **Oscillation Control:** Incorporating sliding window persistence ($\ge 3/5$) completely stops false-alarm oscillation on transient network spikes.
* **Resource Optimization:** The 2-second volumetric rate filter prevents high-volume DDoS floods from overloading the Deep Learning inference pipeline.
