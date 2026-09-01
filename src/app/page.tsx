import { Header } from "@/components/shell/header";
import { Sidebar } from "@/components/shell/sidebar";
import { PipelineStatus } from "@/components/shell/pipeline-status";
import { EmptyState } from "@/components/shell/empty-state";

export default function Home() {
  return (
    <div className="flex h-dvh flex-col">
      <Header />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          <PipelineStatus />
          <EmptyState />
        </main>
      </div>
    </div>
  );
}
