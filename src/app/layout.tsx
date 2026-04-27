import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MBG - Airdrop Task Manager",
  description: "Windows 95 themed airdrop task manager",
  icons: {
    icon: "/logo.svg",
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
}

// Error Boundary — catches render crashes and shows recovery UI
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error?: Error }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          minHeight: '100vh', background: '#008080', fontFamily: 'MS Sans Serif, Arial, sans-serif',
          color: '#fff', textAlign: 'center', padding: 20
        }}>
          <div style={{
            background: '#c0c0c0', border: '2px outset', padding: 20, maxWidth: 400,
            color: '#000'
          }}>
            <div style={{ fontWeight: 'bold', fontSize: 14, marginBottom: 10 }}>
              ⚠️ Terjadi Kesalahan
            </div>
            <div style={{ fontSize: 12, marginBottom: 15, color: '#333' }}>
              Aplikasi mengalami error yang tidak terduga.
            </div>
            {this.state.error && (
              <div style={{
                fontSize: 10, color: '#808080', marginBottom: 15,
                padding: '6px 8px', background: '#fff', border: '1px inset',
                textAlign: 'left', wordBreak: 'break-word', maxHeight: 100, overflow: 'auto'
              }}>
                {/* Error details hidden in production to prevent info leakage */}
                {process.env.NODE_ENV === 'development' ? this.state.error.message : 'Error ID: ' + Date.now()}
              </div>
            )}
            <button
              onClick={() => this.setState({ hasError: false, error: undefined })}
              style={{
                background: '#c0c0c0', border: '2px outset', padding: '4px 16px',
                cursor: 'pointer', fontSize: 12
              }}
            >
              🔄 Coba Lagi
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" suppressHydrationWarning>
      <body>
        <ErrorBoundary>{children}</ErrorBoundary>
      </body>
    </html>
  );
}
