import mongoose, { Schema, Document } from "mongoose";

// Structure pour un service spécifique tournant sur la VM
interface IService {
  name: string;           // Ex: "suricata", "filebeat", "elasticsearch", "agent-ia"
  status: "running" | "stopped" | "failed";
  uptime: string;         // Ex: "12h 45m"
}

// Structure globale de la machine virtuelle
export interface IVmNode extends Document {
  hostname: string;       // Ex: "VM-Sensor-NIDS" ou "VM-SIEM-Core"
  ipAddress: string;
  os: string;             // Ex: "Ubuntu 24.04 LTS"
  
  // Métriques pour les graphiques fantastiques
  cpuUsage: number;       // Pourcentage (0-100)
  ramUsage: number;       // Pourcentage (0-100)
  diskUsage: number;      // Pourcentage (0-100)
  
  services: IService[];   // La liste des services surveillés sur cette machine
  
  lastHeartbeat: Date;    // Le dernier "signe de vie" reçu de la VM
  nodeStatus: "Online" | "Offline" | "Degraded"; 
}

const ServiceSchema = new Schema<IService>({
  name: { type: String, required: true },
  status: { type: String, enum: ["running", "stopped", "failed"], required: true },
  uptime: { type: String, default: "0m" }
});

const VmNodeSchema: Schema = new Schema({
  hostname: { type: String, required: true, unique: true },
  ipAddress: { type: String, required: true },
  os: { type: String, required: true },
  
  cpuUsage: { type: Number, default: 0 },
  ramUsage: { type: Number, default: 0 },
  diskUsage: { type: Number, default: 0 },
  
  services: [ServiceSchema],
  
  lastHeartbeat: { type: Date, default: Date.now },
  nodeStatus: { 
    type: String, 
    enum: ["Online", "Offline", "Degraded"], 
    default: "Offline" 
  }
});

// Index pour trouver rapidement les serveurs déconnectés
VmNodeSchema.index({ lastHeartbeat: 1 });

export const VmNode = mongoose.models.VmNode || mongoose.model<IVmNode>("VmNode", VmNodeSchema);