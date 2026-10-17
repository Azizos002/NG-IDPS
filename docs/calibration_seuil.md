aziz@ml:~/dataset/modele_deep_lstm_vae_16features_balanced$ cat rapport_1.5sigma_by_type.json
{
    "seuil_2sigma_seul": {
        "global": {
            "recall": 0.5129337234065438,
            "precision": 0.8825804660631391,
            "f1_score": 0.648800690211088,
            "fpr": 0.08381625068254275
        },
        "par_type": {
            "Bot": {
                "n_fenetres": 1984,
                "n_detectees": 235,
                "recall_pct": 11.84475806451613
            },
            "DDoS": {
                "n_fenetres": 128045,
                "n_detectees": 106316,
                "recall_pct": 83.03018470069117
            },
            "DoS GoldenEye": {
                "n_fenetres": 10272,
                "n_detectees": 7580,
                "recall_pct": 73.79283489096574
            },
            "DoS Hulk": {
                "n_fenetres": 231091,
                "n_detectees": 159471,
                "recall_pct": 69.00788001263571
            },
            "DoS Slowhttptest": {
                "n_fenetres": 5490,
                "n_detectees": 2014,
                "recall_pct": 36.68488160291439
            },
            "DoS slowloris": {
                "n_fenetres": 5796,
                "n_detectees": 2244,
                "recall_pct": 38.71635610766045
            },
            "FTP-Patator": {
                "n_fenetres": 7947,
                "n_detectees": 7789,
                "recall_pct": 98.01182836290424
            },
            "Infiltration": {
                "n_fenetres": 63,
                "n_detectees": 35,
                "recall_pct": 55.55555555555556
            },
            "MIXTE(DoS GoldenEye+DoS Hulk)": {
                "n_fenetres": 9,
                "n_detectees": 9,
                "recall_pct": 100.0
            },
            "MIXTE(DoS GoldenEye+Heartbleed)": {
                "n_fenetres": 50,
                "n_detectees": 50,
                "recall_pct": 100.0
            },
            "MIXTE(DoS Hulk+DoS Slowhttptest)": {
                "n_fenetres": 9,
                "n_detectees": 9,
                "recall_pct": 100.0
            },
            "MIXTE(DoS Slowhttptest+DoS slowloris)": {
                "n_fenetres": 9,
                "n_detectees": 9,
                "recall_pct": 100.0
            },
            "MIXTE(FTP-Patator+SSH-Patator)": {
                "n_fenetres": 9,
                "n_detectees": 0,
                "recall_pct": 0.0
            },
            "MIXTE(Web Attack � Brute Force+Web Attack � XSS)": {
                "n_fenetres": 9,
                "n_detectees": 0,
                "recall_pct": 0.0
            },
            "MIXTE(Web Attack � Sql Injection+Web Attack � XSS)": {
                "n_fenetres": 9,
                "n_detectees": 0,
                "recall_pct": 0.0
            },
            "PortScan": {
                "n_fenetres": 158957,
                "n_detectees": 0,
                "recall_pct": 0.0
            },
            "SSH-Patator": {
                "n_fenetres": 5924,
                "n_detectees": 369,
                "recall_pct": 6.228899392302498
            },
            "Web Attack � Brute Force": {
                "n_fenetres": 1507,
                "n_detectees": 6,
                "recall_pct": 0.3981420039814201
            },
            "Web Attack � Sql Injection": {
                "n_fenetres": 21,
                "n_detectees": 1,
                "recall_pct": 4.761904761904762
            },
            "Web Attack � XSS": {
                "n_fenetres": 643,
                "n_detectees": 0,
                "recall_pct": 0.0
            }
        }
    },
    "hybride_vote_ou_1.5sigma": {
        "global": {
            "recall": 0.5219452033184905,
            "precision": 0.8741379879731122,
            "f1_score": 0.6536173957354722,
            "fpr": 0.09230400014091206
        },
        "par_type": {
            "Bot": {
                "n_fenetres": 1984,
                "n_detectees": 241,
                "recall_pct": 12.14717741935484
            },
            "DDoS": {
                "n_fenetres": 128045,
                "n_detectees": 107537,
                "recall_pct": 83.98375571088289
            },
            "DoS GoldenEye": {
                "n_fenetres": 10272,
                "n_detectees": 8090,
                "recall_pct": 78.75778816199377
            },
            "DoS Hulk": {
                "n_fenetres": 231091,
                "n_detectees": 162463,
                "recall_pct": 70.30260806349014
            },
            "DoS Slowhttptest": {
                "n_fenetres": 5490,
                "n_detectees": 2014,
                "recall_pct": 36.68488160291439
            },
            "DoS slowloris": {
                "n_fenetres": 5796,
                "n_detectees": 2244,
                "recall_pct": 38.71635610766045
            },
            "FTP-Patator": {
                "n_fenetres": 7947,
                "n_detectees": 7789,
                "recall_pct": 98.01182836290424
            },
            "Infiltration": {
                "n_fenetres": 63,
                "n_detectees": 35,
                "recall_pct": 55.55555555555556
            },
            "MIXTE(DoS GoldenEye+DoS Hulk)": {
                "n_fenetres": 9,
                "n_detectees": 9,
                "recall_pct": 100.0
            },
            "MIXTE(DoS GoldenEye+Heartbleed)": {
                "n_fenetres": 50,
                "n_detectees": 50,
                "recall_pct": 100.0
            },
            "MIXTE(DoS Hulk+DoS Slowhttptest)": {
                "n_fenetres": 9,
                "n_detectees": 9,
                "recall_pct": 100.0
            },
            "MIXTE(DoS Slowhttptest+DoS slowloris)": {
                "n_fenetres": 9,
                "n_detectees": 9,
                "recall_pct": 100.0
            },
            "MIXTE(FTP-Patator+SSH-Patator)": {
                "n_fenetres": 9,
                "n_detectees": 0,
                "recall_pct": 0.0
            },
            "MIXTE(Web Attack � Brute Force+Web Attack � XSS)": {
                "n_fenetres": 9,
                "n_detectees": 1,
                "recall_pct": 11.11111111111111
            },
            "MIXTE(Web Attack � Sql Injection+Web Attack � XSS)": {
                "n_fenetres": 9,
                "n_detectees": 0,
                "recall_pct": 0.0
            },
            "PortScan": {
                "n_fenetres": 158957,
                "n_detectees": 286,
                "recall_pct": 0.17992287222330566
            },
            "SSH-Patator": {
                "n_fenetres": 5924,
                "n_detectees": 369,
                "recall_pct": 6.228899392302498
            },
            "Web Attack � Brute Force": {
                "n_fenetres": 1507,
                "n_detectees": 13,
                "recall_pct": 0.8626410086264101
            },
            "Web Attack � Sql Injection": {
                "n_fenetres": 21,
                "n_detectees": 1,
                "recall_pct": 4.761904761904762
            },
            "Web Attack � XSS": {
                "n_fenetres": 643,
                "n_detectees": 4,
                "recall_pct": 0.6220839813374806
            }
        }
    }
}

aziz@ml:~/dataset/modele_deep_lstm_vae_16features_balanced$ cat rapport_2sigma_by_type.json
{
    "seuil_2sigma_seul": {
        "global": {
            "recall": 0.5006220377022967,
            "precision": 0.9273233805735234,
            "f1_score": 0.6502188591385332,
            "fpr": 0.048189720465714334
        },
        "par_type": {
            "Bot": {
                "n_fenetres": 1984,
                "n_detectees": 43,
                "recall_pct": 2.1673387096774195
            },
            "DDoS": {
                "n_fenetres": 128045,
                "n_detectees": 103746,
                "recall_pct": 81.02307782420243
            },
            "DoS GoldenEye": {
                "n_fenetres": 10272,
                "n_detectees": 7234,
                "recall_pct": 70.42445482866043
            },
            "DoS Hulk": {
                "n_fenetres": 231091,
                "n_detectees": 157277,
                "recall_pct": 68.05847047267093
            },
            "DoS Slowhttptest": {
                "n_fenetres": 5490,
                "n_detectees": 1475,
                "recall_pct": 26.86703096539162
            },
            "DoS slowloris": {
                "n_fenetres": 5796,
                "n_detectees": 2077,
                "recall_pct": 35.83505866114562
            },
            "FTP-Patator": {
                "n_fenetres": 7947,
                "n_detectees": 7279,
                "recall_pct": 91.59431231911414
            },
            "Infiltration": {
                "n_fenetres": 63,
                "n_detectees": 27,
                "recall_pct": 42.857142857142854
            },
            "MIXTE(DoS GoldenEye+DoS Hulk)": {
                "n_fenetres": 9,
                "n_detectees": 9,
                "recall_pct": 100.0
            },
            "MIXTE(DoS GoldenEye+Heartbleed)": {
                "n_fenetres": 50,
                "n_detectees": 50,
                "recall_pct": 100.0
            },
            "MIXTE(DoS Hulk+DoS Slowhttptest)": {
                "n_fenetres": 9,
                "n_detectees": 9,
                "recall_pct": 100.0
            },
            "MIXTE(DoS Slowhttptest+DoS slowloris)": {
                "n_fenetres": 9,
                "n_detectees": 9,
                "recall_pct": 100.0
            },
            "MIXTE(FTP-Patator+SSH-Patator)": {
                "n_fenetres": 9,
                "n_detectees": 0,
                "recall_pct": 0.0
            },
            "MIXTE(Web Attack � Brute Force+Web Attack � XSS)": {
                "n_fenetres": 9,
                "n_detectees": 0,
                "recall_pct": 0.0
            },
            "MIXTE(Web Attack � Sql Injection+Web Attack � XSS)": {
                "n_fenetres": 9,
                "n_detectees": 0,
                "recall_pct": 0.0
            },
            "PortScan": {
                "n_fenetres": 158957,
                "n_detectees": 0,
                "recall_pct": 0.0
            },
            "SSH-Patator": {
                "n_fenetres": 5924,
                "n_detectees": 31,
                "recall_pct": 0.5232950708980418
            },
            "Web Attack � Brute Force": {
                "n_fenetres": 1507,
                "n_detectees": 3,
                "recall_pct": 0.19907100199071004
            },
            "Web Attack � Sql Injection": {
                "n_fenetres": 21,
                "n_detectees": 0,
                "recall_pct": 0.0
            },
            "Web Attack � XSS": {
                "n_fenetres": 643,
                "n_detectees": 0,
                "recall_pct": 0.0
            }
        }
    },
    "hybride_vote_ou_2sigma": {
        "global": {
            "recall": 0.5188941711302801,
            "precision": 0.9164743242687031,
            "f1_score": 0.662621739822156,
            "fpr": 0.05808438870589893
        },
        "par_type": {
            "Bot": {
                "n_fenetres": 1984,
                "n_detectees": 180,
                "recall_pct": 9.07258064516129
            },
            "DDoS": {
                "n_fenetres": 128045,
                "n_detectees": 107537,
                "recall_pct": 83.98375571088289
            },
            "DoS GoldenEye": {
                "n_fenetres": 10272,
                "n_detectees": 8090,
                "recall_pct": 78.75778816199377
            },
            "DoS Hulk": {
                "n_fenetres": 231091,
                "n_detectees": 162388,
                "recall_pct": 70.27015331622609
            },
            "DoS Slowhttptest": {
                "n_fenetres": 5490,
                "n_detectees": 1475,
                "recall_pct": 26.86703096539162
            },
            "DoS slowloris": {
                "n_fenetres": 5796,
                "n_detectees": 2077,
                "recall_pct": 35.83505866114562
            },
            "FTP-Patator": {
                "n_fenetres": 7947,
                "n_detectees": 7279,
                "recall_pct": 91.59431231911414
            },
            "Infiltration": {
                "n_fenetres": 63,
                "n_detectees": 27,
                "recall_pct": 42.857142857142854
            },
            "MIXTE(DoS GoldenEye+DoS Hulk)": {
                "n_fenetres": 9,
                "n_detectees": 9,
                "recall_pct": 100.0
            },
            "MIXTE(DoS GoldenEye+Heartbleed)": {
                "n_fenetres": 50,
                "n_detectees": 50,
                "recall_pct": 100.0
            },
            "MIXTE(DoS Hulk+DoS Slowhttptest)": {
                "n_fenetres": 9,
                "n_detectees": 9,
                "recall_pct": 100.0
            },
            "MIXTE(DoS Slowhttptest+DoS slowloris)": {
                "n_fenetres": 9,
                "n_detectees": 9,
                "recall_pct": 100.0
            },
            "MIXTE(FTP-Patator+SSH-Patator)": {
                "n_fenetres": 9,
                "n_detectees": 0,
                "recall_pct": 0.0
            },
            "MIXTE(Web Attack � Brute Force+Web Attack � XSS)": {
                "n_fenetres": 9,
                "n_detectees": 1,
                "recall_pct": 11.11111111111111
            },
            "MIXTE(Web Attack � Sql Injection+Web Attack � XSS)": {
                "n_fenetres": 9,
                "n_detectees": 0,
                "recall_pct": 0.0
            },
            "PortScan": {
                "n_fenetres": 158957,
                "n_detectees": 286,
                "recall_pct": 0.17992287222330566
            },
            "SSH-Patator": {
                "n_fenetres": 5924,
                "n_detectees": 31,
                "recall_pct": 0.5232950708980418
            },
            "Web Attack � Brute Force": {
                "n_fenetres": 1507,
                "n_detectees": 10,
                "recall_pct": 0.6635700066357001
            },
            "Web Attack � Sql Injection": {
                "n_fenetres": 21,
                "n_detectees": 0,
                "recall_pct": 0.0
            },
            "Web Attack � XSS": {
                "n_fenetres": 643,
                "n_detectees": 4,
                "recall_pct": 0.6220839813374806
            }
        }
    }
}

}aziz@ml:~/dataset/modele_deep_lstm_vae_16features_balanced$ cat rapport_3sigma_by_type.json
{
    "seuil_3sigma_seul": {
        "global": {
            "recall": 0.4082575056825923,
            "precision": 0.9675588410230266,
            "f1_score": 0.5742236745232115,
            "fpr": 0.016812569355151217
        },
        "par_type": {
            "Bot": {
                "n_fenetres": 1984,
                "n_detectees": 3,
                "recall_pct": 0.15120967741935484
            },
            "DDoS": {
                "n_fenetres": 128045,
                "n_detectees": 87143,
                "recall_pct": 68.05654262173455
            },
            "DoS GoldenEye": {
                "n_fenetres": 10272,
                "n_detectees": 5631,
                "recall_pct": 54.818925233644855
            },
            "DoS Hulk": {
                "n_fenetres": 231091,
                "n_detectees": 129532,
                "recall_pct": 56.05237763478457
            },
            "DoS Slowhttptest": {
                "n_fenetres": 5490,
                "n_detectees": 1249,
                "recall_pct": 22.750455373406194
            },
            "DoS slowloris": {
                "n_fenetres": 5796,
                "n_detectees": 1777,
                "recall_pct": 30.659075224292614
            },
            "FTP-Patator": {
                "n_fenetres": 7947,
                "n_detectees": 2324,
                "recall_pct": 29.24373977601611
            },
            "Infiltration": {
                "n_fenetres": 63,
                "n_detectees": 14,
                "recall_pct": 22.22222222222222
            },
            "MIXTE(DoS GoldenEye+DoS Hulk)": {
                "n_fenetres": 9,
                "n_detectees": 6,
                "recall_pct": 66.66666666666666
            },
            "MIXTE(DoS GoldenEye+Heartbleed)": {
                "n_fenetres": 50,
                "n_detectees": 50,
                "recall_pct": 100.0
            },
            "MIXTE(DoS Hulk+DoS Slowhttptest)": {
                "n_fenetres": 9,
                "n_detectees": 9,
                "recall_pct": 100.0
            },
            "MIXTE(DoS Slowhttptest+DoS slowloris)": {
                "n_fenetres": 9,
                "n_detectees": 6,
                "recall_pct": 66.66666666666666
            },
            "MIXTE(FTP-Patator+SSH-Patator)": {
                "n_fenetres": 9,
                "n_detectees": 0,
                "recall_pct": 0.0
            },
            "MIXTE(Web Attack � Brute Force+Web Attack � XSS)": {
                "n_fenetres": 9,
                "n_detectees": 0,
                "recall_pct": 0.0
            },
            "MIXTE(Web Attack � Sql Injection+Web Attack � XSS)": {
                "n_fenetres": 9,
                "n_detectees": 0,
                "recall_pct": 0.0
            },
            "PortScan": {
                "n_fenetres": 158957,
                "n_detectees": 0,
                "recall_pct": 0.0
            },
            "SSH-Patator": {
                "n_fenetres": 5924,
                "n_detectees": 0,
                "recall_pct": 0.0
            },
            "Web Attack � Brute Force": {
                "n_fenetres": 1507,
                "n_detectees": 0,
                "recall_pct": 0.0
            },
            "Web Attack � Sql Injection": {
                "n_fenetres": 21,
                "n_detectees": 0,
                "recall_pct": 0.0
            },
            "Web Attack � XSS": {
                "n_fenetres": 643,
                "n_detectees": 0,
                "recall_pct": 0.0
            }
        }
    },
    "hybride_vote_ou_3sigma": {
        "global": {
            "recall": 0.5089702497472411,
            "precision": 0.9524521972492452,
            "f1_score": 0.6634219061060069,
            "fpr": 0.03120761629647896
        },
        "par_type": {
            "Bot": {
                "n_fenetres": 1984,
                "n_detectees": 180,
                "recall_pct": 9.07258064516129
            },
            "DDoS": {
                "n_fenetres": 128045,
                "n_detectees": 107537,
                "recall_pct": 83.98375571088289
            },
            "DoS GoldenEye": {
                "n_fenetres": 10272,
                "n_detectees": 8071,
                "recall_pct": 78.57281931464173
            },
            "DoS Hulk": {
                "n_fenetres": 231091,
                "n_detectees": 162251,
                "recall_pct": 70.21086931122372
            },
            "DoS Slowhttptest": {
                "n_fenetres": 5490,
                "n_detectees": 1401,
                "recall_pct": 25.519125683060107
            },
            "DoS slowloris": {
                "n_fenetres": 5796,
                "n_detectees": 1777,
                "recall_pct": 30.659075224292614
            },
            "FTP-Patator": {
                "n_fenetres": 7947,
                "n_detectees": 2324,
                "recall_pct": 29.24373977601611
            },
            "Infiltration": {
                "n_fenetres": 63,
                "n_detectees": 14,
                "recall_pct": 22.22222222222222
            },
            "MIXTE(DoS GoldenEye+DoS Hulk)": {
                "n_fenetres": 9,
                "n_detectees": 8,
                "recall_pct": 88.88888888888889
            },
            "MIXTE(DoS GoldenEye+Heartbleed)": {
                "n_fenetres": 50,
                "n_detectees": 50,
                "recall_pct": 100.0
            },
            "MIXTE(DoS Hulk+DoS Slowhttptest)": {
                "n_fenetres": 9,
                "n_detectees": 9,
                "recall_pct": 100.0
            },
            "MIXTE(DoS Slowhttptest+DoS slowloris)": {
                "n_fenetres": 9,
                "n_detectees": 6,
                "recall_pct": 66.66666666666666
            },
            "MIXTE(FTP-Patator+SSH-Patator)": {
                "n_fenetres": 9,
                "n_detectees": 0,
                "recall_pct": 0.0
            },
            "MIXTE(Web Attack � Brute Force+Web Attack � XSS)": {
                "n_fenetres": 9,
                "n_detectees": 1,
                "recall_pct": 11.11111111111111
            },
            "MIXTE(Web Attack � Sql Injection+Web Attack � XSS)": {
                "n_fenetres": 9,
                "n_detectees": 0,
                "recall_pct": 0.0
            },
            "PortScan": {
                "n_fenetres": 158957,
                "n_detectees": 286,
                "recall_pct": 0.17992287222330566
            },
            "SSH-Patator": {
                "n_fenetres": 5924,
                "n_detectees": 0,
                "recall_pct": 0.0
            },
            "Web Attack � Brute Force": {
                "n_fenetres": 1507,
                "n_detectees": 7,
                "recall_pct": 0.46449900464499
            },
            "Web Attack � Sql Injection": {
                "n_fenetres": 21,
                "n_detectees": 0,
                "recall_pct": 0.0
            },
            "Web Attack � XSS": {
                "n_fenetres": 643,
                "n_detectees": 4,
                "recall_pct": 0.6220839813374806
            }
        }
    }
}