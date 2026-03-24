import { useState, useCallback } from "react";
import type { ParsedActivity } from "./types/fit";
import { Header } from "./components/Header";
import { FileDropZone } from "./components/FileDropZone";
import { ActivityChart } from "./components/ActivityChart";
import { StatsBar } from "./components/StatsBar";
import { SummaryCards } from "./components/SummaryCards";
import { CopyBox } from "./components/CopyBox";

function App() {
  const [activity, setActivity] = useState<ParsedActivity | null>(null);
  const [selectionRange, setSelectionRange] = useState<
    [number, number] | null
  >(null);

  const handleFileParsed = useCallback((data: ParsedActivity) => {
    setActivity(data);
    setSelectionRange(null);
  }, []);

  const handleReset = useCallback(() => {
    setActivity(null);
    setSelectionRange(null);
  }, []);

  const handleSelectionChange = useCallback(
    (range: [number, number] | null) => {
      setSelectionRange(range);
    },
    []
  );

  return (
    <div className="min-h-screen flex flex-col bg-[#0f0b1a]">
      <Header hasData={activity !== null} onReset={handleReset} />

      {!activity ? (
        <FileDropZone onFileParsed={handleFileParsed} />
      ) : (
        <div className="flex-1 flex flex-col pt-6 animate-[fadeIn_0.4s_ease-out]">
          {/* Date header */}
          <div className="px-6 mb-4">
            <h2 className="text-2xl font-bold text-[#f1f5f9]">
              Activity on {activity.summary.date}
            </h2>
            <p className="text-sm text-[#94a3b8] mt-1">
              {activity.records.length.toLocaleString()} data points recorded
            </p>
          </div>

          {/* Selection stats bar */}
          <StatsBar
            records={activity.records}
            selectionRange={selectionRange}
          />

          {/* Interactive chart */}
          <ActivityChart
            records={activity.records}
            onSelectionChange={handleSelectionChange}
          />

          {/* Summary cards */}
          <SummaryCards summary={activity.summary} />

          {/* Copyable summary box */}
          <CopyBox summary={activity.summary} />
        </div>
      )}
    </div>
  );
}

export default App;
