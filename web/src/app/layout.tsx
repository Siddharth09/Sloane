import type { Metadata } from "next";
import { Nunito } from "next/font/google";
import "./globals.css";

const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Lucy Labs",
  description: "Lucy Labs — voice and video cloning",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${nunito.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <div className="art-backdrop" aria-hidden="true">
          <div style={{ backgroundImage: "url(/backgrounds/mosaic-courtyard.png)" }} />
        </div>
        <div className="page-content flex min-h-full flex-1 flex-col">{children}</div>
      </body>
    </html>
  );
}
