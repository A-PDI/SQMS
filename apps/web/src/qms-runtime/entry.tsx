"use client";
import dynamic from "next/dynamic";
export const QmsApplication = dynamic(() => import("./application"), {
  ssr: false,
});
export const QmsShell = dynamic(
  () => import("./application").then((m) => m.QmsShell),
  { ssr: false },
);
