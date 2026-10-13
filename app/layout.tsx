import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'NIT Silchar | Campus on foot', description: 'Walk through the NIT Silchar sports grounds and APJ Abdul Kalam Library in a local 3D campus recreation.' };
export default function RootLayout({ children }: Readonly<{children: React.ReactNode}>) { return <html lang="en"><body>{children}</body></html>; }
