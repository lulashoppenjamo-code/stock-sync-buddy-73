// Maps DB branch codes (A/B) to friendly labels
export const BRANCH_LABELS: Record<"A" | "B", string> = {
  A: "Mina",
  B: "Morelos",
};

export function branchLabel(code: string | null | undefined): string {
  if (code === "A" || code === "B") return BRANCH_LABELS[code];
  return code ?? "";
}
