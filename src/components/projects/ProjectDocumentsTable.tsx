"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { ProjectDocument } from "@/lib/projects";
import { ProjectDocumentDetail } from "./ProjectDocumentDetail";

interface Props {
  docs: ProjectDocument[];
}


function decisionBadge(decision?: string, error?: string) {
  if (error) return { label: "Error", className: "bg-red-50 text-red-700" };
  if (decision === "auto_approve")
    return { label: "Approved", className: "bg-emerald-50 text-emerald-700" };
  if (decision === "exception_queue")
    return { label: "Review", className: "bg-amber-50 text-amber-700" };
  if (decision === "rejected")
    return { label: "Rejected", className: "bg-red-50 text-red-700" };
  return { label: "Pending", className: "bg-muted text-muted-foreground" };
}

export function ProjectDocumentsTable({ docs }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (docs.length === 0) {
    return (
      <div className="rounded-lg border hairline p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No documents yet. Use “Add files” to upload and process documents into
          this project.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border hairline overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-[var(--color-mist)] text-xs">
          <tr>
            <th className="text-left p-2 font-medium w-6"></th>
            <th className="text-left p-2 font-medium">File</th>
            <th className="text-left p-2 font-medium">Type</th>
            <th className="text-left p-2 font-medium">Decision</th>
            <th className="text-left p-2 font-medium">Confidence</th>
            <th className="text-left p-2 font-medium">Updated</th>
          </tr>
        </thead>
        <tbody>
          {docs.map((d) => {
            const expanded = openId === d.id;
            const badge = decisionBadge(d.decision, d.error);
            const conf = d.classificationConfidence
              ? `${Math.round(d.classificationConfidence * 100)}%`
              : "—";
            return (
              <>
                <tr
                  key={d.id}
                  className="border-t hairline cursor-pointer hover:bg-[var(--color-mist)]/60"
                  onClick={() => setOpenId(expanded ? null : d.id)}
                >
                  <td className="p-2">
                    <ChevronRight
                      className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-90" : ""}`}
                    />
                  </td>
                  <td className="p-2 text-xs">
                    <div className="font-medium truncate max-w-[280px]" title={d.fileName}>
                      {d.fileName}
                    </div>
                  </td>
                  <td className="p-2 text-xs text-muted-foreground">
                    {d.documentType ?? "—"}
                  </td>
                  <td className="p-2">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                  </td>
                  <td className="p-2 text-xs text-muted-foreground">{conf}</td>
                  <td className="p-2 text-xs text-muted-foreground">
                    {new Date(d.updatedAt).toLocaleString()}
                  </td>
                </tr>
                {expanded && (
                  <tr key={`${d.id}-detail`} className="border-t hairline bg-background">
                    <td colSpan={6} className="p-4">
                      <ProjectDocumentDetail doc={d} />
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

