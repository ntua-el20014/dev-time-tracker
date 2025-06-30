import { getMonday } from "../utils";
import type { DailySummaryRow } from "@shared/types";
import { ByDateViewState, createByDateViewState } from "./summaryByDateView";
import {
  BySessionViewState,
  createBySessionViewState,
} from "./summaryBySessionView";

export interface SummaryState {
  // Week navigation
  currentWeekMonday: Date;

  // Data storage
  allDailyData: DailySummaryRow[];

  // View states
  byDateView: ByDateViewState;
  bySessionView: BySessionViewState;
}

export function createSummaryState(): SummaryState {
  return {
    currentWeekMonday: getMonday(new Date()),
    allDailyData: [],
    byDateView: createByDateViewState(),
    bySessionView: createBySessionViewState(),
  };
}

export function resetSummaryState(state: SummaryState): void {
  state.currentWeekMonday = getMonday(new Date());
  state.allDailyData = [];

  // Reset by-date view state
  state.byDateView.filteredData = [];
  state.byDateView.sortState = { column: null, direction: "asc" };
  state.byDateView.pagination = null;

  // Reset by-session view state
  state.bySessionView.filteredSessions = [];
  state.bySessionView.sortState = { column: null, direction: "asc" };
  state.bySessionView.pagination = null;
}
