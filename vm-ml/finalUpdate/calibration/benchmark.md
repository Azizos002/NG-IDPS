**threshold_benchmark_results.json**
[
    {
        "Strategy":"1-Sigma (\u03bc + 1\u03c3)",
        "Threshold":26.0959,
        "FPR (%)":5.7,
        "Precision (%)":91.58,
        "Recall (%)":50.49,
        "F1-Score (%)":65.09
    },
    {
        "Strategy":"2-Sigma (\u03bc + 2\u03c3)",
        "Threshold":45.0049,
        "FPR (%)":1.53,
        "Precision (%)":97.52,
        "Recall (%)":49.02,
        "F1-Score (%)":65.25
    },
    {
        "Strategy":"3-Sigma Baseline",
        "Threshold":63.9139,
        "FPR (%)":0.73,
        "Precision (%)":98.69,
        "Recall (%)":44.7,
        "F1-Score (%)":61.53
    },
    {
        "Strategy":"Quantile P95",
        "Threshold":27.8320999146,
        "FPR (%)":5.0,
        "Precision (%)":92.52,
        "Recall (%)":50.4,
        "F1-Score (%)":65.25
    },
    {
        "Strategy":"Quantile P98",
        "Threshold":39.7099990845,
        "FPR (%)":2.0,
        "Precision (%)":96.82,
        "Recall (%)":49.66,
        "F1-Score (%)":65.65
    },
    {
        "Strategy":"Quantile P99",
        "Threshold":55.0158004761,
        "FPR (%)":1.0,
        "Precision (%)":98.3,
        "Recall (%)":47.05,
        "F1-Score (%)":63.64
    },
    {
        "Strategy":"EVT  SPOT Tail",
        "Threshold":131.7666,
        "FPR (%)":0.12,
        "Precision (%)":99.72,
        "Recall (%)":34.72,
        "F1-Score (%)":51.51
    }
]

**robust_threshold_results.json**
[
    {
        "Strategy":"MAD Robust (Median + 3*1.4826*MAD)",
        "Threshold":7.1018,
        "FPR (%)":27.39,
        "Precision (%)":70.2,
        "Recall (%)":52.55,
        "F1-Score (%)":60.1
    },
    {
        "Strategy":"Feature Voting (>= 116 features @ P98)",
        "Threshold":"Dynamic (16 thresholds)",
        "FPR (%)":9.22,
        "Precision (%)":87.22,
        "Recall (%)":51.28,
        "F1-Score (%)":64.58
    },
    {
        "Strategy":"Feature Voting (>= 216 features @ P98)",
        "Threshold":"Dynamic (16 thresholds)",
        "FPR (%)":5.95,
        "Precision (%)":91.34,
        "Recall (%)":51.13,
        "F1-Score (%)":65.56
    },
    {
        "Strategy":"Feature Voting (>= 316 features @ P98)",
        "Threshold":"Dynamic (16 thresholds)",
        "FPR (%)":4.46,
        "Precision (%)":93.34,
        "Recall (%)":50.88,
        "F1-Score (%)":65.86
    },
    {
        "Strategy":"Feature Voting (>= 416 features @ P98)",
        "Threshold":"Dynamic (16 thresholds)",
        "FPR (%)":3.42,
        "Precision (%)":94.79,
        "Recall (%)":50.71,
        "F1-Score (%)":66.08
    }
]

**supervised_threshold_results.json**
[
    {
        "Strategy":"Youden's J-Index",
        "Threshold":40.6263,
        "FPR (%)":1.9,
        "Precision (%)":96.98,
        "Recall (%)":49.58,
        "F1-Score (%)":65.61
    },
    {
        "Strategy":"Distance to (0,1)",
        "Threshold":26.0165,
        "FPR (%)":5.73,
        "Precision (%)":91.55,
        "Recall (%)":50.49,
        "F1-Score (%)":65.09
    },
    {
        "Strategy":"F0.5 Optimization",
        "Threshold":112.4134,
        "FPR (%)":0.2,
        "Precision (%)":99.56,
        "Recall (%)":36.13,
        "F1-Score (%)":53.02
    }
]