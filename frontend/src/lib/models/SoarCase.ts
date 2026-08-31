import mongoose, { Schema, Document } from "mongoose";

// Structure d'une Action spécifique (Sous-document)
interface IAction {
  actionName: string;      // Ex: "Blocage IP", "Isolement Machine", "Alerte Email"
  targetSystem: string;    // Ex: "Firewall iptables", "Switch Cisco"
  status: "En attente" | "Succès" | "Échec";
  executionTime?: Date;
}

// Structure globale du Dossier SOAR
export interface ISoarCase extends Document {
  // 1. L'ALERTE (Le contexte)
  kibanaUrl: string;       // Lien direct vers le log détaillé dans Kibana
  sourceSensor: string;    // Ex: "Suricata", "Wazuh"
  maliciousIp: string;
  threatType: string;
  severity: "Basse" | "Moyenne" | "Haute" | "Critique";

  // 2. L'IA (L'analyse contextuelle)
  aiSummary: string;       // Le résumé généré par ton modèle Llama
  aiConfidence: number;    // Score de confiance de l'IA (0-100)

  // 3. LES ACTIONS (La riposte)
  actions: IAction[];      // Historique des actions prises pour cette alerte

  // Statut global
  caseStatus: "Ouvert" | "Résolu" | "Faux Positif";
  createdAt: Date;
}

const ActionSchema = new Schema<IAction>({
  actionName: { type: String, required: true },
  targetSystem: { type: String, required: true },
  status: { type: String, enum: ["En attente", "Succès", "Échec"], required: true },
  executionTime: { type: Date }
});

const SoarCaseSchema: Schema = new Schema({
  kibanaUrl: { type: String, required: true },
  sourceSensor: { type: String, required: true },
  maliciousIp: { type: String, required: true },
  threatType: { type: String, required: true },
  severity: { type: String, enum: ["Basse", "Moyenne", "Haute", "Critique"], required: true },
  
  aiSummary: { type: String, required: true },
  aiConfidence: { type: Number, required: true, min: 0, max: 100 },
  
  actions: [ActionSchema], // Un tableau d'actions liées à cette alerte
  
  caseStatus: { type: String, enum: ["Ouvert", "Résolu", "Faux Positif"], default: "Ouvert" },
  createdAt: { type: Date, default: Date.now }
});

export const SoarCase = mongoose.models.SoarCase || mongoose.model<ISoarCase>("SoarCase", SoarCaseSchema);