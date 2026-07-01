import { createFileRoute } from "@tanstack/react-router";
import { DocumentHistory } from "@/components/DocumentHistory";

export const Route = createFileRoute("/documents")({
  head: () => ({
    meta: [
      { title: "My Documents — IV Doc" },
      {
        name: "description",
        content:
          "Browse your uploaded documents, auto-detected split segments, and extracted fields.",
      },
    ],
  }),
  component: DocumentHistory,
});
