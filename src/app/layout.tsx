import "./globals.css";

export const metadata = {
  title: "AarambhAI — Zero-Leakage AI GTM Engine",
  description: "Tell us what you sell. We bring you leads directly. Zero leakage. Under 5 minutes.",
  icons: {
    icon: [
      { url: "/favicon.png", type: "image/png" },
    ],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
