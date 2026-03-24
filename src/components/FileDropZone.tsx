import { useState, useRef, useCallback } from "react";
import { Upload, FileWarning, Loader2 } from "lucide-react";
import { parseFit } from "../lib/parseFit";
import type { ParsedActivity } from "../types/fit";

interface FileDropZoneProps {
  onFileParsed: (data: ParsedActivity) => void;
}

export function FileDropZone({ onFileParsed }: FileDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith(".fit")) {
        setError("Please select a .fit file");
        return;
      }

      setError(null);
      setIsParsing(true);

      try {
        const arrayBuffer = await file.arrayBuffer();
        const data = parseFit(arrayBuffer);
        onFileParsed(data);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to parse FIT file"
        );
      } finally {
        setIsParsing(false);
      }
    },
    [onFileParsed]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleClick = () => inputRef.current?.click();

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div
        onClick={handleClick}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`
          relative w-full max-w-lg aspect-square flex flex-col items-center justify-center gap-6
          rounded-3xl border-2 border-dashed cursor-pointer
          transition-all duration-300 ease-out
          ${
            isDragging
              ? "border-[#8b5cf6] bg-[#8b5cf6]/10 shadow-[0_0_60px_rgba(139,92,246,0.2)] scale-[1.02]"
              : "border-[rgba(139,92,246,0.2)] bg-[#1a1533]/30 hover:border-[rgba(139,92,246,0.4)] hover:bg-[#1a1533]/50"
          }
        `}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".fit"
          onChange={handleInputChange}
          className="hidden"
        />

        {isParsing ? (
          <>
            <Loader2 className="w-16 h-16 text-[#8b5cf6] animate-spin" />
            <p className="text-lg font-medium text-[#f1f5f9]">
              Parsing FIT file...
            </p>
          </>
        ) : (
          <>
            <div
              className={`flex items-center justify-center w-20 h-20 rounded-2xl transition-all duration-300 ${
                isDragging ? "bg-[#8b5cf6]/30" : "bg-[#8b5cf6]/10"
              }`}
            >
              <Upload
                className={`w-10 h-10 transition-all duration-300 ${
                  isDragging ? "text-[#8b5cf6] scale-110" : "text-[#8b5cf6]/70"
                }`}
              />
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold text-[#f1f5f9]">
                Drop your .fit file here
              </p>
              <p className="mt-1 text-sm text-[#94a3b8]">
                or click to browse
              </p>
            </div>
          </>
        )}

        {error && (
          <div className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-xl">
            <FileWarning className="w-4 h-4 text-red-400" />
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
}
