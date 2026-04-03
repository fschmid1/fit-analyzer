import { Activity, ArrowLeft, BotMessageSquare, Settings, Upload } from "lucide-react";
import { useMatch, useNavigate } from "react-router-dom";
import type { UserInfo } from "../lib/api";

interface HeaderProps {
  onBackToHistory: () => void;
  onUploadNew: () => void;
  onOpenTrainer: () => void;
  user?: UserInfo | null;
}

/** Generate initials from the user's display name or username */
function getInitials(user: UserInfo): string {
  const displayName = user.name || user.username;
  const parts = displayName.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return displayName.slice(0, 2).toUpperCase();
}

/** Simple hash to pick a consistent color for a username */
function getAvatarColor(username: string): string {
  const colors = [
    "#8b5cf6", // violet
    "#6366f1", // indigo
    "#3b82f6", // blue
    "#06b6d4", // cyan
    "#14b8a6", // teal
    "#10b981", // emerald
    "#f59e0b", // amber
    "#ef4444", // red
    "#ec4899", // pink
    "#f97316", // orange
  ];
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

export function Header({ onBackToHistory, onUploadNew, onOpenTrainer, user }: HeaderProps) {
  const navigate = useNavigate();
  const isHistory = useMatch("/");
  const isAnalysis = useMatch("/activity/:id");
  const isTrainer = useMatch("/trainer");
  const isSettings = useMatch("/settings");

  // Show back button everywhere except the history page
  const showBack = !isHistory;
  // Show "Load New File" only on the analysis page
  const showUpload = !!isAnalysis;
  // Show trainer button everywhere except the trainer page itself
  const showTrainer = !isTrainer;
  // Show settings button everywhere except the settings page
  const showSettings = !isSettings;

  return (
    <header className="sticky top-0 z-50 flex items-center justify-between px-6 py-4 border-b border-[rgba(139,92,246,0.1)] bg-[#0f0b1a]">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-[#8b5cf6]/20">
          <Activity className="w-5 h-5 text-[#8b5cf6]" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-[#f1f5f9] leading-tight">
            FIT Analyzer
          </h1>
          <p className="text-xs text-[#94a3b8]">Training Data Visualization</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* Back to History button — shown on all pages except history */}
        {showBack && (
          <button
            onClick={onBackToHistory}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-[#94a3b8] hover:text-[#f1f5f9] bg-[#1a1533]/70 hover:bg-[#241e3d] border border-[rgba(139,92,246,0.1)] hover:border-[rgba(139,92,246,0.25)] rounded-xl transition-all duration-200 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            History
          </button>
        )}

        {/* Upload button — shown in analysis view */}
        {showUpload && (
          <button
            onClick={onUploadNew}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-[#94a3b8] hover:text-[#f1f5f9] bg-[#1a1533]/70 hover:bg-[#241e3d] border border-[rgba(139,92,246,0.1)] hover:border-[rgba(139,92,246,0.25)] rounded-xl transition-all duration-200 cursor-pointer"
          >
            <Upload className="w-4 h-4" />
            Load New File
          </button>
        )}

        {/* Trainer button — shown on all pages except the trainer itself */}
        {showTrainer && (
          <button
            onClick={onOpenTrainer}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-[#c4b5fd] hover:text-[#f1f5f9] bg-[#8b5cf6]/10 hover:bg-[#8b5cf6]/20 border border-[#8b5cf6]/20 hover:border-[#8b5cf6]/40 rounded-xl transition-all duration-200 cursor-pointer"
          >
            <BotMessageSquare className="w-4 h-4" />
            Trainer
          </button>
        )}

        {/* Settings button */}
        {showSettings && (
          <button
            onClick={() => navigate("/settings")}
            className="flex items-center justify-center w-9 h-9 text-[#94a3b8] hover:text-[#f1f5f9] bg-[#1a1533]/70 hover:bg-[#241e3d] border border-[rgba(139,92,246,0.1)] hover:border-[rgba(139,92,246,0.25)] rounded-xl transition-all duration-200 cursor-pointer"
            title="Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
        )}

        {/* User avatar */}
        {user && (
          <div className="flex items-center gap-2.5 pl-3 border-l border-[rgba(139,92,246,0.15)]">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium text-[#f1f5f9] leading-tight">
                {user.name || user.username}
              </p>
              {user.name && user.username && user.name !== user.username && (
                <p className="text-xs text-[#94a3b8] leading-tight">
                  {user.username}
                </p>
              )}
            </div>
            <div
              className="flex items-center justify-center w-9 h-9 rounded-full text-sm font-bold text-white shrink-0"
              style={{ backgroundColor: getAvatarColor(user.username) }}
              title={`${user.name || user.username} (${user.email})`}
            >
              {getInitials(user)}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
