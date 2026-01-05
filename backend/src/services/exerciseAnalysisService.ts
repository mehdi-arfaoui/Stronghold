type ChecklistItem = {
  status?: string | null;
  blocking?: boolean | null;
};

export function buildExerciseAnalysis(items: ChecklistItem[]) {
  const total = items.length;
  const completed = items.filter((item) => (item.status || "").toUpperCase() === "DONE").length;
  const blockingOpen = items.filter(
    (item) => item.blocking && (item.status || "").toUpperCase() !== "DONE"
  ).length;

  return {
    completionRate: total ? Number((completed / total).toFixed(2)) : 0,
    blockingOpen,
    totalItems: total,
    completedItems: completed,
  };
}
