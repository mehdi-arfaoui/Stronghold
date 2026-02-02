import { useMemo, useState, useCallback } from "react";
import type { BusinessProcess } from "../types";

interface BiaPrioritizationProps {
  processes: BusinessProcess[];
  onProcessSelect?: (process: BusinessProcess) => void;
  onBulkAction?: (processIds: string[], action: BulkAction) => void;
}

type SortField = "name" | "criticalityScore" | "impactScore" | "rtoHours" | "rpoMinutes" | "mtpdHours" | "financialImpactLevel";
type SortDirection = "asc" | "desc";
type BulkAction = "export" | "generateRunbook" | "assignBackup";

interface FilterState {
  criticalityMin: number;
  criticalityMax: number;
  rtoMax: number | null;
  rpoMax: number | null;
  financialImpactMin: number;
  searchTerm: string;
  showOnlyCritical: boolean;
  showOnlyUnlinked: boolean;
}

const defaultFilters: FilterState = {
  criticalityMin: 0,
  criticalityMax: 5,
  rtoMax: null,
  rpoMax: null,
  financialImpactMin: 0,
  searchTerm: "",
  showOnlyCritical: false,
  showOnlyUnlinked: false,
};

function SeverityBadge({ level }: { level: number }) {
  const className = level >= 4 ? "error" : level >= 3 ? "warning" : "success";
  const label = level >= 4 ? "Critique" : level >= 3 ? "Modéré" : "Faible";
  return <span className={`pill ${className}`}>{label}</span>;
}

export function BiaPrioritization({ processes, onProcessSelect, onBulkAction }: BiaPrioritizationProps) {
  const [sortField, setSortField] = useState<SortField>("criticalityScore");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  const filteredAndSortedProcesses = useMemo(() => {
    let result = [...processes];

    // Apply filters
    if (filters.searchTerm) {
      const search = filters.searchTerm.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(search) ||
          p.description?.toLowerCase().includes(search) ||
          p.owners?.toLowerCase().includes(search)
      );
    }

    if (filters.criticalityMin > 0) {
      result = result.filter((p) => p.criticalityScore >= filters.criticalityMin);
    }

    if (filters.criticalityMax < 5) {
      result = result.filter((p) => p.criticalityScore <= filters.criticalityMax);
    }

    if (filters.rtoMax !== null) {
      result = result.filter((p) => p.rtoHours <= filters.rtoMax!);
    }

    if (filters.rpoMax !== null) {
      result = result.filter((p) => p.rpoMinutes <= filters.rpoMax!);
    }

    if (filters.financialImpactMin > 0) {
      result = result.filter((p) => p.financialImpactLevel >= filters.financialImpactMin);
    }

    if (filters.showOnlyCritical) {
      result = result.filter((p) => p.criticalityScore >= 4);
    }

    if (filters.showOnlyUnlinked) {
      result = result.filter((p) => p.services.length === 0);
    }

    // Sort
    result.sort((a, b) => {
      let aValue: number | string;
      let bValue: number | string;

      switch (sortField) {
        case "name":
          aValue = a.name.toLowerCase();
          bValue = b.name.toLowerCase();
          break;
        case "criticalityScore":
          aValue = a.criticalityScore;
          bValue = b.criticalityScore;
          break;
        case "impactScore":
          aValue = a.impactScore;
          bValue = b.impactScore;
          break;
        case "rtoHours":
          aValue = a.rtoHours;
          bValue = b.rtoHours;
          break;
        case "rpoMinutes":
          aValue = a.rpoMinutes;
          bValue = b.rpoMinutes;
          break;
        case "mtpdHours":
          aValue = a.mtpdHours;
          bValue = b.mtpdHours;
          break;
        case "financialImpactLevel":
          aValue = a.financialImpactLevel;
          bValue = b.financialImpactLevel;
          break;
        default:
          aValue = a.criticalityScore;
          bValue = b.criticalityScore;
      }

      if (typeof aValue === "string" && typeof bValue === "string") {
        return sortDirection === "asc"
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue);
      }

      return sortDirection === "asc"
        ? (aValue as number) - (bValue as number)
        : (bValue as number) - (aValue as number);
    });

    return result;
  }, [processes, filters, sortField, sortDirection]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredAndSortedProcesses.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredAndSortedProcesses.map((p) => p.id)));
    }
  };

  const handleBulkAction = (action: BulkAction) => {
    if (onBulkAction && selectedIds.size > 0) {
      onBulkAction(Array.from(selectedIds), action);
    }
  };

  const exportToCsv = useCallback(() => {
    const processesToExport = selectedIds.size > 0
      ? filteredAndSortedProcesses.filter((p) => selectedIds.has(p.id))
      : filteredAndSortedProcesses;

    const headers = [
      "Nom",
      "Description",
      "Propriétaires",
      "Impact Financier",
      "Impact Réglementaire",
      "RTO (h)",
      "RPO (min)",
      "MTPD (h)",
      "Score Impact",
      "Score Criticité",
      "Nb Services",
    ];

    const rows = processesToExport.map((p) => [
      p.name,
      p.description || "",
      p.owners || "",
      p.financialImpactLevel,
      p.regulatoryImpactLevel,
      p.rtoHours,
      p.rpoMinutes,
      p.mtpdHours,
      p.impactScore.toFixed(2),
      p.criticalityScore.toFixed(2),
      p.services.length,
    ]);

    const csvContent = [
      headers.join(";"),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(";")),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `bia-processes-${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
  }, [filteredAndSortedProcesses, selectedIds]);

  const resetFilters = () => {
    setFilters(defaultFilters);
    setSelectedIds(new Set());
  };

  const SortHeader = ({ field, label }: { field: SortField; label: string }) => (
    <th
      onClick={() => handleSort(field)}
      style={{ cursor: "pointer", userSelect: "none" }}
      className={sortField === field ? "sorted" : ""}
    >
      {label}
      {sortField === field && (
        <span className="sort-indicator">{sortDirection === "asc" ? " ↑" : " ↓"}</span>
      )}
    </th>
  );

  const criticalCount = filteredAndSortedProcesses.filter((p) => p.criticalityScore >= 4).length;
  const avgCriticality =
    filteredAndSortedProcesses.length > 0
      ? filteredAndSortedProcesses.reduce((sum, p) => sum + p.criticalityScore, 0) /
        filteredAndSortedProcesses.length
      : 0;

  return (
    <div className="bia-prioritization">
      {/* Summary Stats */}
      <div className="prioritization-summary">
        <div className="summary-stat">
          <span className="stat-value">{filteredAndSortedProcesses.length}</span>
          <span className="stat-label">Processus affichés</span>
        </div>
        <div className="summary-stat critical">
          <span className="stat-value">{criticalCount}</span>
          <span className="stat-label">Critiques</span>
        </div>
        <div className="summary-stat">
          <span className="stat-value">{avgCriticality.toFixed(1)}</span>
          <span className="stat-label">Criticité moy.</span>
        </div>
        <div className="summary-stat">
          <span className="stat-value">{selectedIds.size}</span>
          <span className="stat-label">Sélectionnés</span>
        </div>
      </div>

      {/* Filters */}
      <div className="card filters-card">
        <div className="filters-header">
          <div className="filters-main">
            <input
              type="text"
              placeholder="Rechercher un processus..."
              value={filters.searchTerm}
              onChange={(e) => setFilters((prev) => ({ ...prev, searchTerm: e.target.value }))}
              className="search-input"
            />
            <div className="quick-filters">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={filters.showOnlyCritical}
                  onChange={(e) =>
                    setFilters((prev) => ({ ...prev, showOnlyCritical: e.target.checked }))
                  }
                />
                Critiques uniquement
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={filters.showOnlyUnlinked}
                  onChange={(e) =>
                    setFilters((prev) => ({ ...prev, showOnlyUnlinked: e.target.checked }))
                  }
                />
                Sans services liés
              </label>
            </div>
          </div>
          <div className="filters-actions">
            <button
              className="button small"
              onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
            >
              {showAdvancedFilters ? "Masquer filtres" : "Filtres avancés"}
            </button>
            <button className="button small" onClick={resetFilters}>
              Réinitialiser
            </button>
          </div>
        </div>

        {showAdvancedFilters && (
          <div className="advanced-filters">
            <div className="filter-group">
              <label>Criticité min</label>
              <input
                type="range"
                min={0}
                max={5}
                step={0.5}
                value={filters.criticalityMin}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, criticalityMin: Number(e.target.value) }))
                }
              />
              <span>{filters.criticalityMin}</span>
            </div>
            <div className="filter-group">
              <label>Impact financier min</label>
              <select
                value={filters.financialImpactMin}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, financialImpactMin: Number(e.target.value) }))
                }
              >
                <option value={0}>Tous</option>
                <option value={3}>Niveau 3+</option>
                <option value={4}>Niveau 4+</option>
                <option value={5}>Niveau 5 uniquement</option>
              </select>
            </div>
            <div className="filter-group">
              <label>RTO max (heures)</label>
              <input
                type="number"
                min={0}
                placeholder="Illimité"
                value={filters.rtoMax ?? ""}
                onChange={(e) =>
                  setFilters((prev) => ({
                    ...prev,
                    rtoMax: e.target.value ? Number(e.target.value) : null,
                  }))
                }
              />
            </div>
            <div className="filter-group">
              <label>RPO max (minutes)</label>
              <input
                type="number"
                min={0}
                placeholder="Illimité"
                value={filters.rpoMax ?? ""}
                onChange={(e) =>
                  setFilters((prev) => ({
                    ...prev,
                    rpoMax: e.target.value ? Number(e.target.value) : null,
                  }))
                }
              />
            </div>
          </div>
        )}
      </div>

      {/* Bulk Actions */}
      {selectedIds.size > 0 && (
        <div className="bulk-actions">
          <span className="bulk-count">{selectedIds.size} processus sélectionné(s)</span>
          <div className="bulk-buttons">
            <button className="button small" onClick={exportToCsv}>
              Exporter CSV
            </button>
            {onBulkAction && (
              <>
                <button
                  className="button small"
                  onClick={() => handleBulkAction("generateRunbook")}
                >
                  Générer Runbooks
                </button>
                <button className="button small" onClick={() => handleBulkAction("assignBackup")}>
                  Assigner stratégie backup
                </button>
              </>
            )}
            <button className="button small" onClick={() => setSelectedIds(new Set())}>
              Désélectionner tout
            </button>
          </div>
        </div>
      )}

      {/* Export Button (always visible) */}
      {selectedIds.size === 0 && filteredAndSortedProcesses.length > 0 && (
        <div className="export-bar">
          <button className="button" onClick={exportToCsv}>
            Exporter tous les processus (CSV)
          </button>
        </div>
      )}

      {/* Table */}
      <div className="table-wrapper prioritization-table">
        <table className="data-table sortable">
          <thead>
            <tr>
              <th style={{ width: 40 }}>
                <input
                  type="checkbox"
                  checked={
                    filteredAndSortedProcesses.length > 0 &&
                    selectedIds.size === filteredAndSortedProcesses.length
                  }
                  onChange={toggleSelectAll}
                />
              </th>
              <th style={{ width: 40 }}>#</th>
              <SortHeader field="name" label="Processus" />
              <SortHeader field="criticalityScore" label="Criticité" />
              <SortHeader field="impactScore" label="Impact" />
              <SortHeader field="financialImpactLevel" label="Financier" />
              <SortHeader field="rtoHours" label="RTO" />
              <SortHeader field="rpoMinutes" label="RPO" />
              <SortHeader field="mtpdHours" label="MTPD" />
              <th>Services</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredAndSortedProcesses.length === 0 ? (
              <tr>
                <td colSpan={11} style={{ textAlign: "center", padding: "2rem" }}>
                  <p className="muted">Aucun processus ne correspond aux critères.</p>
                </td>
              </tr>
            ) : (
              filteredAndSortedProcesses.map((process, index) => (
                <tr
                  key={process.id}
                  className={selectedIds.has(process.id) ? "selected" : ""}
                >
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(process.id)}
                      onChange={() => toggleSelect(process.id)}
                    />
                  </td>
                  <td className="rank-cell">
                    <span className={`rank ${index < 3 ? "top" : ""}`}>{index + 1}</span>
                  </td>
                  <td>
                    <div className="process-cell">
                      <strong>{process.name}</strong>
                      {process.owners && (
                        <span className="muted small">{process.owners}</span>
                      )}
                    </div>
                  </td>
                  <td>
                    <div className="score-cell">
                      <span className="score-value">{process.criticalityScore.toFixed(1)}</span>
                      <SeverityBadge level={Math.round(process.criticalityScore)} />
                    </div>
                  </td>
                  <td>
                    <span className="score-value">{process.impactScore.toFixed(1)}</span>
                  </td>
                  <td>
                    <span className={`level level-${process.financialImpactLevel}`}>
                      {process.financialImpactLevel}
                    </span>
                  </td>
                  <td>
                    <span className={process.rtoHours <= 4 ? "highlight-short" : ""}>
                      {process.rtoHours}h
                    </span>
                  </td>
                  <td>
                    <span className={process.rpoMinutes <= 30 ? "highlight-short" : ""}>
                      {process.rpoMinutes}min
                    </span>
                  </td>
                  <td>{process.mtpdHours}h</td>
                  <td>
                    {process.services.length === 0 ? (
                      <span className="muted">-</span>
                    ) : (
                      <span className="service-count">{process.services.length}</span>
                    )}
                  </td>
                  <td>
                    <button
                      className="button small"
                      onClick={() => onProcessSelect?.(process)}
                    >
                      Détails
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Styles
export const biaPrioritizationStyles = `
.bia-prioritization {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.prioritization-summary {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}

.summary-stat {
  background: var(--color-surface-secondary);
  padding: 0.75rem 1rem;
  border-radius: 8px;
  text-align: center;
  min-width: 100px;
}

.summary-stat.critical {
  border-left: 3px solid var(--color-error);
}

.stat-value {
  display: block;
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--color-text-primary);
}

.stat-label {
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.filters-card {
  padding: 1rem;
}

.filters-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}

.filters-main {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
  flex: 1;
}

.search-input {
  padding: 0.5rem 1rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  min-width: 250px;
  background: var(--color-surface);
}

.quick-filters {
  display: flex;
  gap: 1rem;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  cursor: pointer;
}

.filters-actions {
  display: flex;
  gap: 0.5rem;
}

.advanced-filters {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--color-border);
}

.filter-group {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.filter-group label {
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.filter-group input[type="range"] {
  width: 100%;
}

.filter-group select,
.filter-group input[type="number"] {
  padding: 0.375rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-surface);
}

.bulk-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  background: rgba(var(--color-primary-rgb, 59, 130, 246), 0.1);
  border: 1px solid var(--color-primary);
  border-radius: 8px;
}

.bulk-count {
  font-weight: 500;
}

.bulk-buttons {
  display: flex;
  gap: 0.5rem;
}

.export-bar {
  display: flex;
  justify-content: flex-end;
}

.prioritization-table {
  overflow-x: auto;
}

.prioritization-table th {
  white-space: nowrap;
}

.prioritization-table th.sorted {
  background: var(--color-surface-secondary);
}

.sort-indicator {
  opacity: 0.7;
}

.prioritization-table tr.selected {
  background: rgba(var(--color-primary-rgb, 59, 130, 246), 0.05);
}

.rank-cell {
  text-align: center;
}

.rank {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--color-surface-secondary);
  font-size: 0.75rem;
  font-weight: 600;
}

.rank.top {
  background: var(--color-warning);
  color: white;
}

.process-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.score-cell {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.score-value {
  font-weight: 600;
}

.level {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  font-weight: 600;
  font-size: 0.875rem;
}

.level-1, .level-2 {
  background: rgba(40, 167, 69, 0.2);
  color: var(--color-success);
}

.level-3 {
  background: rgba(255, 193, 7, 0.2);
  color: var(--color-warning);
}

.level-4, .level-5 {
  background: rgba(255, 107, 107, 0.2);
  color: var(--color-error);
}

.highlight-short {
  color: var(--color-error);
  font-weight: 600;
}

.service-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--color-primary);
  color: white;
  font-size: 0.75rem;
  font-weight: 600;
}

@media (max-width: 768px) {
  .filters-header {
    flex-direction: column;
    align-items: stretch;
  }

  .filters-main {
    flex-direction: column;
    align-items: stretch;
  }

  .search-input {
    min-width: auto;
    width: 100%;
  }

  .quick-filters {
    flex-direction: column;
  }

  .bulk-actions {
    flex-direction: column;
    gap: 0.5rem;
  }

  .bulk-buttons {
    flex-wrap: wrap;
  }
}
`;
