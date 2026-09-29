import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const description = "好きな作品の聖地と、その間で寄れる地元の味・文化スポットをつないだまち歩きコースを作れるアプリ。区間ごとの徒歩・バスの目安と Google マップでの経路確認まで。";

export const metadata: Metadata = {
  title: "まちぽ｜物語の場所から、まちを歩こう。",
  description,
  icons: { apple: "/app-icon.png" },
  openGraph: { title: "まちぽ｜物語の場所から、まちを歩こう。", description, type: "website", locale: "ja_JP", images: ["/app-icon.png"] },
  twitter: { card: "summary", title: "まちぽ｜物語の場所から、まちを歩こう。", description },
};

export const viewport: Viewport = { themeColor: "#ef6d24" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ja"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
