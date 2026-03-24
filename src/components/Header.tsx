import { Activity, Upload } from "lucide-react";

interface HeaderProps {
  hasData: boolean;
  onReset: () => void;
}

export function Header({ hasData, onReset }: HeaderProps) {
  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-[rgba(139,92,246,0.1)]">
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
      {hasData && (
        <button
          onClick={onReset}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-[#94a3b8] hover:text-[#f1f5f9] bg-[#1a1533]/70 hover:bg-[#241e3d] border border-[rgba(139,92,246,0.1)] hover:border-[rgba(139,92,246,0.25)] rounded-xl transition-all duration-200 cursor-pointer"
        >
          <Upload className="w-4 h-4" />
          Load New File
        </button>
      )}
    </header>
  );
}
