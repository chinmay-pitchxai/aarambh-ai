import Shell from "@/components/Shell";
import { AuthProvider } from "@/components/AuthProvider";
import { ChatPanel } from "@/components/ChatPanel";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <Shell>{children}</Shell>
      <ChatPanel />
    </AuthProvider>
  );
}
