import type { ReactNode } from "react";
import { WindowChrome } from "./WindowChrome";
import { ChromeStatus } from "./ChromeStatus";
import { StatusBanners } from "../components/StatusBanners";
import type { StatusAction, SubsystemStatus } from "../lib/app-status";
import type { Surface } from "./resolveSurface";

interface PreDataShellProps {
  surface: Surface;
  onNavigate: (next: Surface) => void;
  isRecording: boolean;
  voiceAvailable: boolean;
  statuses: SubsystemStatus[];
  onStatusAction: (action: StatusAction) => void;
  children: ReactNode;
}

/**
 * The window before game data exists: tabs, status line, banners, and one
 * message.
 *
 * Every pre-data state is entitled to the same frame. The banners in
 * particular are the only thing that can explain a failure or offer a way out,
 * and while they lived inside the data-gated subtree the states that most
 * needed them were the states that could not show them.
 */
export function PreDataShell({
  surface,
  onNavigate,
  isRecording,
  voiceAvailable,
  statuses,
  onStatusAction,
  children,
}: PreDataShellProps) {
  return (
    <main className="app-root">
      <WindowChrome
        surface={surface}
        onNavigate={onNavigate}
        statusContent={
          <ChromeStatus
            isRecording={isRecording}
            voiceAvailable={voiceAvailable}
          />
        }
      />
      <StatusBanners statuses={statuses} onAction={onStatusAction} />
      {children}
    </main>
  );
}
