import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Switchyard Demo — NVIDIA NeMo",
  description: "Intelligent LLM routing with NVIDIA Switchyard on Amazon Bedrock",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#0a0a0a] text-gray-100 antialiased">
        {children}
      </body>
    </html>
  );
}
