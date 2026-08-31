import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import mongoose from "mongoose";

export async function GET() {
  await connectDB();
  
  const status = mongoose.connection.readyState;
  const isConnected = status === 1;

  return NextResponse.json({ 
    connected: isConnected,
    message: isConnected ? "MongoDB est en ligne" : "MongoDB est hors ligne"
  });
}