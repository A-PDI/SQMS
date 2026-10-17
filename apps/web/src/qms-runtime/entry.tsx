"use client";
import dynamic from "next/dynamic";
export const QmsApplication = dynamic(() => import("./application"), {
  ssr: false,
});
