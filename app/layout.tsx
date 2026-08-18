export const metadata = {
  title: "Inbound Triage Assistant",
  description: "LLM triage for the Northwind Advisors shared inbox",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
